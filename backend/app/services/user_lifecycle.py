from __future__ import annotations

from datetime import datetime
from typing import Literal

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.models import (
    AccessGrant,
    AccessGrantStatus,
    IntegrationInstance,
    OAuthIdentity,
    Session as SessionModel,
    User,
    UserConnection,
    UserConnectionStatus,
)
from app.security import ensure_utc, utcnow
from app.services.access_grants import is_grant_usable

AccountStatus = Literal["active", "disabled", "deleted"]


def account_status(user: User) -> AccountStatus:
    if user.deleted_at is not None:
        return "deleted"
    if not user.is_active:
        return "disabled"
    return "active"


def count_org_admins_not_deleted(db: Session, organization_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == organization_id,
                User.is_admin.is_(True),
                User.deleted_at.is_(None),
            )
        )
        or 0
    )


def assert_mutable_admin_target_db(db: Session, *, actor: User, target: User) -> None:
    from fastapi import HTTPException, status

    if actor.id == target.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot_modify_own_account")
    if target.is_admin:
        n = count_org_admins_not_deleted(db, target.organization_id)
        if n <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot_remove_last_admin")


def revoke_all_sessions(db: Session, user_id: str, *, now: datetime | None = None) -> int:
    t = now or utcnow()
    rows = db.scalars(
        select(SessionModel).where(SessionModel.user_id == user_id, SessionModel.revoked_at.is_(None))
    ).all()
    for s in rows:
        s.revoked_at = t
    return len(rows)


def revoke_active_access_grants(db: Session, user_id: str, *, now: datetime | None = None) -> int:
    t = now or utcnow()
    n = 0
    grants = db.scalars(select(AccessGrant).where(AccessGrant.user_id == user_id)).all()
    for g in grants:
        if g.status != AccessGrantStatus.ACTIVE.value:
            continue
        if g.revoked_at is not None:
            continue
        g.status = AccessGrantStatus.REVOKED.value
        g.revoked_at = t
        n += 1
    return n


def clear_user_connections(db: Session, user_id: str) -> int:
    n = 0
    conns = db.scalars(select(UserConnection).where(UserConnection.user_id == user_id)).all()
    for c in conns:
        c.status = UserConnectionStatus.DISCONNECTED.value
        c.oauth_access_token_encrypted = None
        c.oauth_refresh_token_encrypted = None
        c.oauth_dcr_client_id = None
        c.oauth_dcr_client_secret_encrypted = None
        n += 1
    return n


def lifecycle_cleanup_counts(db: Session, user_id: str) -> dict[str, int]:
    now = utcnow()
    open_sessions = db.scalars(
        select(SessionModel).where(SessionModel.user_id == user_id, SessionModel.revoked_at.is_(None))
    ).all()
    active_sessions = sum(
        1 for s in open_sessions if (exp := ensure_utc(s.expires_at)) is not None and exp > now
    )
    grants = db.scalars(select(AccessGrant).where(AccessGrant.user_id == user_id)).all()
    active_keys = sum(1 for g in grants if is_grant_usable(g, now=now))
    revoked_keys = sum(1 for g in grants if g.status == AccessGrantStatus.REVOKED.value)
    invalid_keys = sum(1 for g in grants if g.status == AccessGrantStatus.INVALID.value)
    conns = db.scalars(select(UserConnection).where(UserConnection.user_id == user_id)).all()
    connection_rows = len(conns)
    connections_with_oauth = sum(
        1
        for c in conns
        if (c.oauth_access_token_encrypted or c.oauth_refresh_token_encrypted or c.oauth_dcr_client_secret_encrypted)
    )
    oid = db.scalar(select(func.count()).select_from(OAuthIdentity).where(OAuthIdentity.user_id == user_id))
    oauth_identities = int(oid or 0)
    return {
        "active_sessions": active_sessions,
        "access_keys_active": active_keys,
        "access_keys_revoked": revoked_keys,
        "access_keys_invalid": invalid_keys,
        "access_keys_total": len(grants),
        "connections_total": connection_rows,
        "connections_with_stored_oauth": connections_with_oauth,
        "oauth_identities": oauth_identities,
    }


def apply_full_user_cleanup(db: Session, user_id: str) -> dict[str, int]:
    return {
        "sessions_revoked": revoke_all_sessions(db, user_id),
        "access_grants_revoked": revoke_active_access_grants(db, user_id),
        "connections_cleared": clear_user_connections(db, user_id),
    }


def deprovision_user(db: Session, target: User) -> dict[str, int]:
    stats = apply_full_user_cleanup(db, target.id)
    target.is_active = False
    return stats


def soft_delete_user(db: Session, target: User) -> dict[str, int]:
    stats = apply_full_user_cleanup(db, target.id)
    target.is_active = False
    target.deleted_at = utcnow()
    return stats


def reactivate_user(db: Session, target: User) -> None:
    target.deleted_at = None
    target.is_active = True


def hard_delete_user(db: Session, target: User) -> None:
    uid = target.id
    apply_full_user_cleanup(db, uid)
    db.execute(delete(SessionModel).where(SessionModel.user_id == uid))
    db.execute(delete(OAuthIdentity).where(OAuthIdentity.user_id == uid))
    db.execute(delete(UserConnection).where(UserConnection.user_id == uid))
    db.execute(delete(AccessGrant).where(AccessGrant.user_id == uid))
    db.execute(update(AccessGrant).where(AccessGrant.created_by_user_id == uid).values(created_by_user_id=None))
    db.execute(
        update(IntegrationInstance).where(IntegrationInstance.created_by_user_id == uid).values(created_by_user_id=None)
    )
    db.delete(target)


def revoke_one_session(db: Session, *, user_id: str, session_id: str) -> bool:
    row = db.scalar(
        select(SessionModel).where(SessionModel.id == session_id, SessionModel.user_id == user_id)
    )
    if not row or row.revoked_at is not None:
        return False
    row.revoked_at = utcnow()
    return True
