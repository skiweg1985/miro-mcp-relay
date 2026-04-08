"""Resolve upstream OAuth bearer tokens for IntegrationInstance (session and grants)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.generic_integration_oauth import (
    TEMPLATE_KEY_GENERIC_OAUTH,
    resolve_generic_client_credentials,
    token_endpoint_auth_method,
)
from app.microsoft_oauth_resolver import microsoft_token_url, resolve_microsoft_oauth_for_graph_integration
from app.models import AuthMode, Integration, IntegrationInstance, User, UserConnection, UserConnectionStatus
from app.security import decrypt_text, dumps_json, encrypt_text, loads_json, utcnow

_REFRESH_SKEW_SECONDS = 60


def oauth_token_from_connection_row(conn: UserConnection | None) -> str | None:
    if not conn or conn.status != UserConnectionStatus.ACTIVE.value:
        return None
    token = decrypt_text(conn.oauth_access_token_encrypted)
    if token and token.strip():
        return token.strip()
    return None


def _expiry_from_metadata(conn: UserConnection) -> datetime | None:
    payload = loads_json(conn.metadata_json, {})
    if not isinstance(payload, dict):
        return None
    raw = payload.get("oauth_expires_at")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _token_expiring_soon(conn: UserConnection) -> bool:
    expires_at = _expiry_from_metadata(conn)
    if expires_at is None:
        # Legacy rows often have no expiry metadata; force one refresh attempt to normalize.
        return True
    return expires_at <= (utcnow() + timedelta(seconds=_REFRESH_SKEW_SECONDS))


def _store_refreshed_tokens(
    conn: UserConnection,
    *,
    access_token: str,
    refresh_token: str | None,
    expires_in: int | None,
) -> None:
    refreshed_at = utcnow()
    conn.oauth_access_token_encrypted = encrypt_text(access_token)
    if refresh_token and refresh_token.strip():
        conn.oauth_refresh_token_encrypted = encrypt_text(refresh_token.strip())
    meta = loads_json(conn.metadata_json, {})
    if not isinstance(meta, dict):
        meta = {}
    meta["oauth_last_refresh_at"] = refreshed_at.isoformat()
    if expires_in is not None and expires_in > 0:
        meta["oauth_expires_at"] = (refreshed_at + timedelta(seconds=expires_in)).isoformat()
    conn.metadata_json = dumps_json(meta)
    conn.status = UserConnectionStatus.ACTIVE.value


def _miro_client_credentials(
    *,
    integration_cfg: dict,
    conn: UserConnection,
) -> tuple[str, str] | tuple[None, None]:
    settings = get_settings()
    static_id = str(integration_cfg.get("oauth_client_id") or settings.miro_oauth_client_id or "").strip()
    static_secret = str(integration_cfg.get("oauth_client_secret") or settings.miro_oauth_client_secret or "").strip()
    if static_id and static_secret:
        return static_id, static_secret
    if conn.oauth_dcr_client_id and conn.oauth_dcr_client_secret_encrypted:
        dcr_secret = decrypt_text(conn.oauth_dcr_client_secret_encrypted)
        if dcr_secret and str(dcr_secret).strip():
            return conn.oauth_dcr_client_id, str(dcr_secret).strip()
    return None, None


def _refresh_token_for_connection(
    db: Session,
    *,
    user: User,
    instance: IntegrationInstance,
    conn: UserConnection,
) -> bool:
    refresh_token = decrypt_text(conn.oauth_refresh_token_encrypted)
    if not refresh_token or not refresh_token.strip():
        return False
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        return False
    integration_cfg = loads_json(integration.config_json, {})
    if not isinstance(integration_cfg, dict):
        integration_cfg = {}
    template = str(integration_cfg.get("template_key") or "").strip()

    token_endpoint = str(integration_cfg.get("oauth_token_endpoint") or "").strip()
    client_id = ""
    client_secret = ""

    if template == "microsoft_graph_default":
        settings = get_settings()
        resolved = resolve_microsoft_oauth_for_graph_integration(db, integration, settings)
        if not resolved:
            return False
        token_endpoint = microsoft_token_url(resolved.authority_base, resolved.tenant_id)
        client_id = resolved.client_id
        client_secret = resolved.client_secret
    elif template == "miro_default":
        if not token_endpoint:
            settings = get_settings()
            token_endpoint = f"{settings.miro_mcp_base.rstrip('/')}/token"
        cid, csec = _miro_client_credentials(integration_cfg=integration_cfg, conn=conn)
        if not cid or not csec:
            return False
        client_id = cid
        client_secret = csec
    elif template == TEMPLATE_KEY_GENERIC_OAUTH:
        token_endpoint = str(integration_cfg.get("oauth_token_endpoint") or "").strip()
        client_id, client_secret = resolve_generic_client_credentials(integration, integration_cfg)
        if not token_endpoint or not client_id or not client_secret:
            return False
    else:
        # Legacy: loose config_json credentials without explicit generic template.
        client_id = str(integration_cfg.get("oauth_client_id") or "").strip()
        client_secret = str(integration_cfg.get("oauth_client_secret") or "").strip()
        if not token_endpoint or not client_id or not client_secret:
            return False

    try:
        with httpx.Client(timeout=30.0) as client:
            post_headers = {"Content-Type": "application/x-www-form-urlencoded"}
            if template == TEMPLATE_KEY_GENERIC_OAUTH and token_endpoint_auth_method(integration_cfg) == "client_secret_basic":
                response = client.post(
                    token_endpoint,
                    data={
                        "grant_type": "refresh_token",
                        "client_id": client_id,
                        "refresh_token": refresh_token.strip(),
                    },
                    auth=(client_id, client_secret),
                    headers=post_headers,
                )
            else:
                response = client.post(
                    token_endpoint,
                    data={
                        "grant_type": "refresh_token",
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "refresh_token": refresh_token.strip(),
                    },
                    headers=post_headers,
                )
    except httpx.HTTPError:
        return False
    if response.status_code >= 400:
        return False
    content_type = (response.headers.get("content-type") or "").lower()
    body = response.json() if "application/json" in content_type else {}
    if not isinstance(body, dict):
        return False
    new_access = str(body.get("access_token") or "").strip()
    if not new_access:
        return False
    new_refresh = str(body.get("refresh_token") or "").strip() or None
    expires_in_raw = body.get("expires_in")
    try:
        expires_in = int(expires_in_raw) if expires_in_raw is not None else None
    except (TypeError, ValueError):
        expires_in = None
    _store_refreshed_tokens(conn, access_token=new_access, refresh_token=new_refresh, expires_in=expires_in)
    db.add(conn)
    db.flush()
    return True


def get_or_refresh_upstream_oauth_token_for_session(
    db: Session,
    *,
    user: User,
    instance: IntegrationInstance,
) -> str | None:
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == user.id,
            UserConnection.integration_instance_id == instance.id,
            UserConnection.organization_id == user.organization_id,
            UserConnection.status == UserConnectionStatus.ACTIVE.value,
        )
    )
    token = oauth_token_from_connection_row(conn)
    if not conn:
        return None
    if token and not _token_expiring_soon(conn):
        return token
    if _refresh_token_for_connection(db, user=user, instance=instance, conn=conn):
        return oauth_token_from_connection_row(conn)
    return token


def get_or_refresh_upstream_oauth_token_for_grant(
    db: Session,
    *,
    grant_user_id: str,
    organization_id: str,
    instance: IntegrationInstance,
    user_connection_id: str | None,
) -> str | None:
    conn: UserConnection | None = None
    if user_connection_id:
        row = db.get(UserConnection, user_connection_id)
        if (
            row
            and row.user_id == grant_user_id
            and row.integration_instance_id == instance.id
            and row.organization_id == organization_id
            and row.status == UserConnectionStatus.ACTIVE.value
        ):
            conn = row
    else:
        conn = db.scalar(
            select(UserConnection).where(
                UserConnection.user_id == grant_user_id,
                UserConnection.integration_instance_id == instance.id,
                UserConnection.organization_id == organization_id,
                UserConnection.status == UserConnectionStatus.ACTIVE.value,
            )
        )
    token = oauth_token_from_connection_row(conn)
    if not conn:
        return None
    if token and not _token_expiring_soon(conn):
        return token
    user = db.get(User, grant_user_id)
    if not user:
        return token
    if _refresh_token_for_connection(db, user=user, instance=instance, conn=conn):
        return oauth_token_from_connection_row(conn)
    return token


def get_upstream_oauth_token_for_session(
    db: Session,
    *,
    user: User,
    instance: IntegrationInstance,
    x_user_token: str | None,
) -> str | None:
    """Prefer X-User-Token header, else stored UserConnection for this user+instance."""
    if instance.auth_mode != AuthMode.OAUTH.value:
        return None
    if x_user_token and x_user_token.strip():
        return x_user_token.strip()
    return get_or_refresh_upstream_oauth_token_for_session(db, user=user, instance=instance)


def user_has_oauth_connection(db: Session, *, user_id: str, organization_id: str, instance_id: str) -> bool:
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == user_id,
            UserConnection.integration_instance_id == instance_id,
            UserConnection.organization_id == organization_id,
            UserConnection.status == UserConnectionStatus.ACTIVE.value,
        )
    )
    return oauth_token_from_connection_row(conn) is not None
