from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.generic_oauth import FLOW_GENERIC
from app.models import ConnectedAccount, DelegationGrant, OAuthPendingState, ProviderApp, ProviderInstance
from app.security import loads_json, utcnow


def count_active_delegation_grants(db: Session, *, provider_app_id: str) -> int:
    now = utcnow()
    return (
        db.scalar(
            select(func.count())
            .select_from(DelegationGrant)
            .where(
                DelegationGrant.provider_app_id == provider_app_id,
                DelegationGrant.revoked_at.is_(None),
                DelegationGrant.is_enabled.is_(True),
                or_(DelegationGrant.expires_at.is_(None), DelegationGrant.expires_at > now),
            )
        )
        or 0
    )


def count_blocking_connected_accounts(db: Session, *, provider_app_id: str) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ConnectedAccount)
            .where(
                ConnectedAccount.provider_app_id == provider_app_id,
                ConnectedAccount.revoked_at.is_(None),
            )
        )
        or 0
    )


def count_pending_oauth_flows_for_app(db: Session, *, provider_app_id: str) -> int:
    rows = db.scalars(
        select(OAuthPendingState).where(
            OAuthPendingState.flow == FLOW_GENERIC,
            OAuthPendingState.expires_at > utcnow(),
        )
    ).all()
    n = 0
    for row in rows:
        payload = loads_json(row.payload_json, {})
        if str(payload.get("provider_app_id") or "") == provider_app_id:
            n += 1
    return n


def freed_key_after_soft_delete(*, previous_key: str, provider_app_id: str) -> str:
    stamp = f"-deleted-{provider_app_id}"
    if len(previous_key) + len(stamp) <= 120:
        return previous_key + stamp
    keep = 120 - len(stamp)
    return (previous_key[:keep] + stamp) if keep > 0 else stamp[:120]


def maybe_disable_orphaned_provider_instance(db: Session, *, provider_instance_id: str) -> bool:
    remaining = (
        db.scalar(
            select(func.count())
            .select_from(ProviderApp)
            .where(
                ProviderApp.provider_instance_id == provider_instance_id,
                ProviderApp.deleted_at.is_(None),
            )
        )
        or 0
    )
    if remaining > 0:
        return False
    instance = db.get(ProviderInstance, provider_instance_id)
    if not instance:
        return False
    instance.is_enabled = False
    return True
