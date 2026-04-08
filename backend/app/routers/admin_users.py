from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import record_audit, require_admin, require_csrf
from app.models import (
    AccessGrant,
    IntegrationInstance,
    OAuthIdentity,
    Organization,
    Session as SessionModel,
    User,
    UserConnection,
)
from app.schemas import (
    AdminUserAccessGrantSummaryOut,
    AdminUserActionResultOut,
    AdminUserConnectionOut,
    AdminUserDetailOut,
    AdminUserHardDeleteBody,
    AdminUserHardDeleteResultOut,
    AdminUserLifecycleCountsOut,
    AdminUserListOut,
    AdminUserListRowOut,
    AdminUserSessionOut,
    AdminOAuthIdentityOut,
)
from app.security import ensure_utc, utcnow
from app.services.access_grants import effective_grant_display_status
from app.services.user_lifecycle import (
    account_status,
    assert_mutable_admin_target_db,
    deprovision_user,
    hard_delete_user,
    lifecycle_cleanup_counts,
    reactivate_user,
    revoke_active_access_grants,
    revoke_all_sessions,
    revoke_one_session,
    soft_delete_user,
)

router = APIRouter(tags=["admin"])


def _org_or_404(db: Session) -> Organization:
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")
    return org


def _auth_summary(identities: list[OAuthIdentity], has_password: bool) -> str:
    keys = sorted({i.provider_key for i in identities})
    if keys and has_password:
        return f"Password + {', '.join(keys)}"
    if keys:
        return ", ".join(keys)
    if has_password:
        return "Password"
    return "Unknown"


def _last_activity_at(db: Session, user_id: str, last_login_at: datetime | None) -> datetime | None:
    candidates: list[datetime] = []
    if last_login_at is not None:
        candidates.append(last_login_at)
    m_sess = db.scalar(select(func.max(SessionModel.created_at)).where(SessionModel.user_id == user_id))
    if m_sess is not None:
        candidates.append(m_sess)
    m_used = db.scalar(select(func.max(AccessGrant.last_used_at)).where(AccessGrant.user_id == user_id))
    if m_used is not None:
        candidates.append(m_used)
    return max(candidates) if candidates else None


def _apply_user_filters(
    stmt,
    *,
    org_id: str,
    status_filter: str,
    q: str | None,
    provider_key: str | None,
):
    stmt = stmt.where(User.organization_id == org_id)
    sf = status_filter.strip().lower()
    if sf == "active":
        stmt = stmt.where(User.is_active.is_(True), User.deleted_at.is_(None))
    elif sf == "disabled":
        stmt = stmt.where(User.is_active.is_(False), User.deleted_at.is_(None))
    elif sf == "deleted":
        stmt = stmt.where(User.deleted_at.is_not(None))
    elif sf != "all":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status_filter")

    if q:
        term = f"%{q.strip()[:200]}%"
        stmt = stmt.where(or_(User.email.ilike(term), User.display_name.ilike(term)))

    if provider_key:
        pk = provider_key.strip()
        if pk:
            stmt = stmt.where(
                exists(select(OAuthIdentity.id).where(OAuthIdentity.user_id == User.id, OAuthIdentity.provider_key == pk))
            )
    return stmt


def _get_user_in_org(db: Session, org_id: str, user_id: str) -> User:
    user = db.scalar(select(User).where(User.id == user_id, User.organization_id == org_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
    return user


@router.get("/admin/users", response_model=AdminUserListOut)
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
    status_filter: str = Query("active", alias="status"),
    q: str | None = Query(None),
    provider_key: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    org = _org_or_404(db)
    base = _apply_user_filters(select(User), org_id=org.id, status_filter=status_filter, q=q, provider_key=provider_key)
    count_stmt = _apply_user_filters(
        select(func.count()).select_from(User), org_id=org.id, status_filter=status_filter, q=q, provider_key=provider_key
    )
    total = int(db.scalar(count_stmt) or 0)
    rows = db.scalars(base.order_by(User.created_at.desc()).offset(offset).limit(limit)).all()

    out_rows: list[AdminUserListRowOut] = []
    for u in rows:
        identities = db.scalars(select(OAuthIdentity).where(OAuthIdentity.user_id == u.id)).all()
        has_pw = bool(u.password_hash and str(u.password_hash).strip())
        counts = lifecycle_cleanup_counts(db, u.id)
        out_rows.append(
            AdminUserListRowOut(
                id=u.id,
                organization_id=u.organization_id,
                email=u.email,
                display_name=u.display_name,
                is_admin=u.is_admin,
                account_status=account_status(u),
                auth_summary=_auth_summary(identities, has_pw),
                created_at=u.created_at,
                last_login_at=u.last_login_at,
                last_activity_at=_last_activity_at(db, u.id, u.last_login_at),
                access_keys_active=counts["access_keys_active"],
                access_keys_total=counts["access_keys_total"],
                connections_total=counts["connections_total"],
            )
        )
    return AdminUserListOut(users=out_rows, total=total, limit=limit, offset=offset)


@router.get("/admin/users/{user_id}", response_model=AdminUserDetailOut)
def get_user_detail(user_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    org = _org_or_404(db)
    user = _get_user_in_org(db, org.id, user_id)
    identities = db.scalars(select(OAuthIdentity).where(OAuthIdentity.user_id == user.id).order_by(OAuthIdentity.created_at.asc())).all()
    has_pw = bool(user.password_hash and str(user.password_hash).strip())

    now = utcnow()
    sess_rows = db.scalars(
        select(SessionModel).where(SessionModel.user_id == user.id).order_by(SessionModel.created_at.desc()).limit(50)
    ).all()
    sessions_out: list[AdminUserSessionOut] = []
    for s in sess_rows:
        exp = ensure_utc(s.expires_at)
        live = bool(exp is not None and s.revoked_at is None and exp > now)
        sessions_out.append(
            AdminUserSessionOut(id=s.id, created_at=s.created_at, expires_at=s.expires_at, is_active=live)
        )

    conn_rows = db.scalars(select(UserConnection).where(UserConnection.user_id == user.id)).all()
    connections_out: list[AdminUserConnectionOut] = []
    for c in conn_rows:
        inst = db.get(IntegrationInstance, c.integration_instance_id)
        has_oauth = bool(
            c.oauth_access_token_encrypted or c.oauth_refresh_token_encrypted or c.oauth_dcr_client_secret_encrypted
        )
        connections_out.append(
            AdminUserConnectionOut(
                id=c.id,
                integration_instance_id=c.integration_instance_id,
                integration_instance_name=inst.name if inst else c.integration_instance_id,
                status=c.status,
                has_stored_oauth=has_oauth,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
        )

    grant_rows = db.scalars(select(AccessGrant).where(AccessGrant.user_id == user.id).order_by(AccessGrant.created_at.desc())).all()
    grants_out: list[AdminUserAccessGrantSummaryOut] = []
    for g in grant_rows:
        inst = db.get(IntegrationInstance, g.integration_instance_id)
        grants_out.append(
            AdminUserAccessGrantSummaryOut(
                id=g.id,
                integration_instance_id=g.integration_instance_id,
                integration_instance_name=inst.name if inst else g.integration_instance_id,
                name=g.name,
                key_prefix=g.key_prefix,
                status=g.status,
                effective_status=effective_grant_display_status(g),
                created_at=g.created_at,
                last_used_at=g.last_used_at,
                revoked_at=g.revoked_at,
            )
        )

    lc = lifecycle_cleanup_counts(db, user.id)
    counts = AdminUserLifecycleCountsOut(
        active_sessions=lc["active_sessions"],
        access_keys_active=lc["access_keys_active"],
        access_keys_revoked=lc["access_keys_revoked"],
        access_keys_invalid=lc["access_keys_invalid"],
        access_keys_total=lc["access_keys_total"],
        connections_total=lc["connections_total"],
        connections_with_stored_oauth=lc["connections_with_stored_oauth"],
        oauth_identities=lc["oauth_identities"],
    )

    return AdminUserDetailOut(
        id=user.id,
        organization_id=user.organization_id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        account_status=account_status(user),
        auth_summary=_auth_summary(identities, has_pw),
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_login_at=user.last_login_at,
        last_activity_at=_last_activity_at(db, user.id, user.last_login_at),
        counts=counts,
        oauth_identities=[
            AdminOAuthIdentityOut(
                id=i.id,
                provider_key=i.provider_key,
                subject=i.subject,
                issuer=i.issuer,
                email=i.email,
                display_name=i.display_name,
                created_at=i.created_at,
                updated_at=i.updated_at,
            )
            for i in identities
        ],
        sessions=sessions_out,
        connections=connections_out,
        access_grants=grants_out,
    )


@router.post("/admin/users/{user_id}/deprovision", response_model=AdminUserActionResultOut)
def admin_deprovision_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    if account_status(target) == "deleted":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_already_deleted")
    stats = deprovision_user(db, target)
    record_audit(
        db,
        action="admin.user.deprovision",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"target_user_id": target.id},
    )
    db.commit()
    db.refresh(target)
    return AdminUserActionResultOut(
        account_status=account_status(target),
        sessions_revoked=stats["sessions_revoked"],
        access_grants_revoked=stats["access_grants_revoked"],
        connections_cleared=stats["connections_cleared"],
    )


@router.post("/admin/users/{user_id}/soft-delete", response_model=AdminUserActionResultOut)
def admin_soft_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    if target.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_already_deleted")
    stats = soft_delete_user(db, target)
    record_audit(
        db,
        action="admin.user.soft_delete",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"target_user_id": target.id},
    )
    db.commit()
    db.refresh(target)
    return AdminUserActionResultOut(
        account_status=account_status(target),
        sessions_revoked=stats["sessions_revoked"],
        access_grants_revoked=stats["access_grants_revoked"],
        connections_cleared=stats["connections_cleared"],
    )


@router.post("/admin/users/{user_id}/reactivate", response_model=AdminUserActionResultOut)
def admin_reactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    if account_status(target) == "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_already_active")
    reactivate_user(db, target)
    record_audit(
        db,
        action="admin.user.reactivate",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"target_user_id": target.id},
    )
    db.commit()
    db.refresh(target)
    return AdminUserActionResultOut(account_status=account_status(target))


@router.post("/admin/users/{user_id}/sessions/revoke-all", response_model=AdminUserActionResultOut)
def admin_revoke_all_sessions(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    n = revoke_all_sessions(db, target.id)
    record_audit(
        db,
        action="admin.user.sessions_revoke_all",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"target_user_id": target.id, "count": n},
    )
    db.commit()
    db.refresh(target)
    return AdminUserActionResultOut(account_status=account_status(target), sessions_revoked=n)


@router.post("/admin/users/{user_id}/sessions/{session_id}/revoke", response_model=AdminUserActionResultOut)
def admin_revoke_one_session(
    user_id: str,
    session_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    ok = revoke_one_session(db, user_id=target.id, session_id=session_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session_not_found")
    record_audit(
        db,
        action="admin.user.session_revoke",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"target_user_id": target.id, "session_id": session_id},
    )
    db.commit()
    db.refresh(target)
    return AdminUserActionResultOut(account_status=account_status(target), sessions_revoked=1)


@router.post("/admin/users/{user_id}/access-keys/revoke-all", response_model=AdminUserActionResultOut)
def admin_revoke_all_access_keys(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    n = revoke_active_access_grants(db, target.id)
    record_audit(
        db,
        action="admin.user.access_keys_revoke_all",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"target_user_id": target.id, "count": n},
    )
    db.commit()
    db.refresh(target)
    return AdminUserActionResultOut(account_status=account_status(target), access_grants_revoked=n)


@router.delete("/admin/users/{user_id}", response_model=AdminUserHardDeleteResultOut)
def admin_hard_delete_user(
    user_id: str,
    payload: AdminUserHardDeleteBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    org = _org_or_404(db)
    target = _get_user_in_org(db, org.id, user_id)
    assert_mutable_admin_target_db(db, actor=admin, target=target)
    confirm = payload.confirm_email.strip().lower()
    if confirm != target.email.strip().lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="email_confirmation_mismatch")
    uid = target.id
    hard_delete_user(db, target)
    record_audit(
        db,
        action="admin.user.hard_delete",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"removed_user_id": uid},
    )
    db.commit()
    return AdminUserHardDeleteResultOut(id=uid)
