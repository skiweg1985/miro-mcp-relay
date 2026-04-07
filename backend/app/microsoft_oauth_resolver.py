from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Integration, MicrosoftOAuthSettings, Organization
from app.security import decrypt_text, loads_json


@dataclass(frozen=True)
class ResolvedMicrosoftOAuth:
    authority_base: str
    tenant_id: str
    client_id: str
    client_secret: str
    scope_list: list[str]


def microsoft_authorize_url(authority_base: str, tenant_id: str) -> str:
    base = authority_base.rstrip("/")
    tenant = tenant_id.strip() or "common"
    return f"{base}/{tenant}/oauth2/v2.0/authorize"


def microsoft_token_url(authority_base: str, tenant_id: str) -> str:
    base = authority_base.rstrip("/")
    tenant = tenant_id.strip() or "common"
    return f"{base}/{tenant}/oauth2/v2.0/token"


def _scope_list_from_string(scope: str) -> list[str]:
    return [part.strip() for part in str(scope or "").split() if part.strip()]


def _from_env(settings: Settings) -> ResolvedMicrosoftOAuth | None:
    client_id = str(settings.microsoft_broker_client_id or "").strip()
    client_secret = str(settings.microsoft_broker_client_secret or "").strip()
    if not client_id or not client_secret:
        return None
    return ResolvedMicrosoftOAuth(
        authority_base=settings.microsoft_broker_authority_base,
        tenant_id=settings.microsoft_broker_tenant_id,
        client_id=client_id,
        client_secret=client_secret,
        scope_list=settings.microsoft_scope_list,
    )


def resolve_microsoft_oauth(db: Session, settings: Settings) -> ResolvedMicrosoftOAuth | None:
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        return _from_env(settings)

    row = db.scalar(select(MicrosoftOAuthSettings).where(MicrosoftOAuthSettings.organization_id == org.id))
    secret_plain: str | None = None
    if row and row.encrypted_client_secret:
        secret_plain = decrypt_text(row.encrypted_client_secret)
    db_ready = bool(
        row
        and str(row.client_id or "").strip()
        and secret_plain
        and str(secret_plain).strip()
    )
    if db_ready:
        assert row is not None
        authority = (row.authority_base or "").strip() or settings.microsoft_broker_authority_base
        tenant = (row.tenant_id or "").strip() or settings.microsoft_broker_tenant_id
        scope_raw = (row.scope or "").strip() or settings.microsoft_broker_scope
        scope_list = _scope_list_from_string(scope_raw)
        return ResolvedMicrosoftOAuth(
            authority_base=authority,
            tenant_id=tenant,
            client_id=str(row.client_id).strip(),
            client_secret=str(secret_plain).strip(),
            scope_list=scope_list,
        )

    return _from_env(settings)


GRAPH_TEMPLATE_KEY = "microsoft_graph_default"


def resolve_microsoft_oauth_for_graph_integration(
    db: Session,
    integration: Integration,
    settings: Settings,
) -> ResolvedMicrosoftOAuth | None:
    """Broker defaults vs. custom Entra app for the Microsoft Graph integration template."""
    cfg = loads_json(integration.config_json, {})
    if str(cfg.get("template_key") or "") != GRAPH_TEMPLATE_KEY:
        return resolve_microsoft_oauth(db, settings)
    if cfg.get("graph_oauth_use_broker_defaults", True) is not False:
        return resolve_microsoft_oauth(db, settings)
    authority = str(cfg.get("graph_oauth_authority_base") or "").strip() or settings.microsoft_broker_authority_base
    tenant = str(cfg.get("graph_oauth_tenant_id") or "").strip() or settings.microsoft_broker_tenant_id
    cid = str(cfg.get("graph_oauth_client_id") or "").strip()
    if not cid:
        return None
    if not integration.oauth_client_secret_encrypted:
        return None
    secret_plain = decrypt_text(integration.oauth_client_secret_encrypted)
    if not secret_plain or not str(secret_plain).strip():
        return None
    scope_raw = str(cfg.get("graph_oauth_scope") or "").strip() or settings.microsoft_broker_scope
    scope_list = _scope_list_from_string(scope_raw)
    return ResolvedMicrosoftOAuth(
        authority_base=authority,
        tenant_id=tenant,
        client_id=cid,
        client_secret=str(secret_plain).strip(),
        scope_list=scope_list,
    )


def effective_microsoft_oauth_source(db: Session, settings: Settings) -> str:
    if resolve_microsoft_oauth(db, settings) is None:
        return "none"
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        return "environment"
    row = db.scalar(select(MicrosoftOAuthSettings).where(MicrosoftOAuthSettings.organization_id == org.id))
    secret_plain: str | None = None
    if row and row.encrypted_client_secret:
        secret_plain = decrypt_text(row.encrypted_client_secret)
    db_ready = bool(
        row
        and str(row.client_id or "").strip()
        and secret_plain
        and str(secret_plain).strip()
    )
    if db_ready:
        return "database"
    return "environment"
