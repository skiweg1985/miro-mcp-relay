from __future__ import annotations

import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccessGrant, AccessGrantStatus, IntegrationInstance, UserConnection, UserConnectionStatus
from app.security import dumps_json, lookup_secret_hash, utcnow, verify_lookup_secret
from app.upstream_oauth import get_or_refresh_upstream_oauth_token_for_grant, oauth_token_from_connection_row


BROKER_ACCESS_KEY_PREFIX = "bkr_"


def issue_raw_access_key() -> str:
    return f"{BROKER_ACCESS_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def key_prefix_from_full(raw: str) -> str:
    if len(raw) <= 12:
        return raw
    return raw[:12]


def create_access_grant(
    db: Session,
    *,
    organization_id: str,
    user_id: str,
    integration_instance_id: str,
    name: str,
    created_by_user_id: str | None,
    expires_at: datetime | None,
    allowed_tools: list[str] | None,
    user_connection_id: str | None,
    notes: str | None,
    policy_ref: str | None,
) -> tuple[AccessGrant, str]:
    raw = issue_raw_access_key()
    key_hash = lookup_secret_hash(raw)
    prefix = key_prefix_from_full(raw)
    allowed_payload: list[str] = []
    if allowed_tools is not None:
        allowed_payload = [str(x).strip() for x in allowed_tools if str(x).strip()]

    row = AccessGrant(
        organization_id=organization_id,
        user_id=user_id,
        integration_instance_id=integration_instance_id,
        user_connection_id=user_connection_id,
        name=name.strip(),
        key_prefix=prefix,
        key_hash=key_hash,
        status=AccessGrantStatus.ACTIVE.value,
        allowed_tools_json=dumps_json(allowed_payload),
        notes=notes.strip() if notes else None,
        policy_ref=policy_ref.strip() if policy_ref else None,
        created_by_user_id=created_by_user_id,
    )
    if expires_at is not None:
        row.expires_at = expires_at
    db.add(row)
    db.flush()
    return row, raw


def get_grant_by_presented_key(db: Session, raw_key: str) -> AccessGrant | None:
    if not raw_key or not raw_key.strip():
        return None
    stripped = raw_key.strip()
    if not stripped.startswith(BROKER_ACCESS_KEY_PREFIX):
        return None
    digest = lookup_secret_hash(stripped)
    row = db.scalar(select(AccessGrant).where(AccessGrant.key_hash == digest))
    if not row:
        return None
    if not verify_lookup_secret(stripped, row.key_hash):
        return None
    return row


def is_grant_usable(row: AccessGrant, *, now: datetime | None = None) -> bool:
    t = now or utcnow()
    if row.status != AccessGrantStatus.ACTIVE.value:
        return False
    if row.revoked_at is not None:
        return False
    if row.expires_at is not None and row.expires_at <= t:
        return False
    return True


def effective_grant_display_status(row: AccessGrant, *, now: datetime | None = None) -> str:
    t = now or utcnow()
    if row.status == AccessGrantStatus.REVOKED.value:
        return "revoked"
    if row.status == AccessGrantStatus.INVALID.value:
        return "invalid"
    if row.expires_at is not None and row.expires_at <= t:
        return "expired"
    return "active"


def touch_grant_used(db: Session, grant: AccessGrant) -> None:
    grant.last_used_at = utcnow()
    db.add(grant)


def resolve_upstream_oauth_token_for_grant(
    db: Session,
    *,
    grant: AccessGrant,
    instance: IntegrationInstance,
    x_user_token: str | None,
) -> str | None:
    """Returns bearer token for upstream OAuth, or None if not required / not available."""
    from app.models import AuthMode

    if instance.auth_mode != AuthMode.OAUTH.value:
        return None
    refreshed = get_or_refresh_upstream_oauth_token_for_grant(
        db,
        grant_user_id=grant.user_id,
        organization_id=grant.organization_id,
        instance=instance,
        user_connection_id=grant.user_connection_id,
    )
    if refreshed:
        return refreshed
    if grant.user_connection_id:
        conn = db.get(UserConnection, grant.user_connection_id)
        if (
            conn
            and conn.user_id == grant.user_id
            and conn.integration_instance_id == instance.id
            and conn.status == UserConnectionStatus.ACTIVE.value
        ):
            return oauth_token_from_connection_row(conn)
        return None
    if x_user_token and x_user_token.strip():
        return x_user_token.strip()
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == grant.user_id,
            UserConnection.integration_instance_id == instance.id,
            UserConnection.organization_id == grant.organization_id,
            UserConnection.status == UserConnectionStatus.ACTIVE.value,
        )
    )
    return oauth_token_from_connection_row(conn)
