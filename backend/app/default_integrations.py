"""Vordefinierte Integrationen pro Organisation (Miro MCP, Microsoft Graph OAuth)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import (
    AuthMode,
    Integration,
    IntegrationAccessMode,
    IntegrationInstance,
    IntegrationType,
)
from app.security import dumps_json, loads_json

# Feste IDs: idempotenter Seed pro Organisation, keine Geheimnisse.
INTEGRATION_MIRO_DEFAULT_ID = "00000000-0000-4000-8000-000000000101"
INTEGRATION_GRAPH_DEFAULT_ID = "00000000-0000-4000-8000-000000000102"
INSTANCE_MIRO_DEFAULT_ID = "00000000-0000-4000-8000-000000000201"
INSTANCE_GRAPH_DEFAULT_ID = "00000000-0000-4000-8000-000000000202"

TEMPLATE_KEY_MIRO_DEFAULT = "miro_default"
# Falscher Default (MCP-DCR-Clients sind dort unbekannt); Reconcile ersetzt durch {miro_mcp_base}/token.
LEGACY_MIRO_REST_OAUTH_TOKEN_ENDPOINT = "https://api.miro.com/v1/oauth/token"


def _miro_integration_config(settings: Settings) -> dict:
    base = settings.miro_mcp_base.rstrip("/")
    return {
        "template_key": TEMPLATE_KEY_MIRO_DEFAULT,
        "oauth_dynamic_client_registration_enabled": True,
        "endpoint": f"{base}/mcp",
        "mcp_relay_base_url": f"{base}/",
        "oauth_registration_endpoint": f"{base}/register",
        "oauth_authorization_endpoint": f"{base}/authorize",
        "oauth_token_endpoint": f"{base}/token",
    }


def reconcile_miro_default_integration_token_endpoint(db: Session) -> None:
    """Bestehende Seed-Integrationen: MCP-OAuth-Token nur am Authorization Server (nicht api.miro.com/v1/oauth/token)."""
    settings = get_settings()
    row = db.get(Integration, INTEGRATION_MIRO_DEFAULT_ID)
    if not row:
        return
    cfg = loads_json(row.config_json, {})
    if str(cfg.get("template_key") or "").strip() != TEMPLATE_KEY_MIRO_DEFAULT:
        return
    base = settings.miro_mcp_base.rstrip("/")
    changed = False
    expected_token = f"{base}/token"
    current_token = str(cfg.get("oauth_token_endpoint") or "").strip()
    if current_token != expected_token and current_token in ("", LEGACY_MIRO_REST_OAUTH_TOKEN_ENDPOINT):
        cfg["oauth_token_endpoint"] = expected_token
        changed = True
    expected_relay = f"{base}/"
    current_relay = str(cfg.get("mcp_relay_base_url") or "").strip()
    if current_relay != expected_relay:
        cfg["mcp_relay_base_url"] = expected_relay
        changed = True
    if changed:
        row.config_json = dumps_json(cfg)
        db.add(row)


def _graph_integration_config(settings: Settings) -> dict:
    return {
        "template_key": "microsoft_graph_default",
        "graph_oauth_use_broker_defaults": True,
        "graph_oauth_authority_base": settings.microsoft_broker_authority_base,
        "graph_oauth_tenant_id": settings.microsoft_broker_tenant_id,
        "graph_oauth_client_id": "",
        "graph_oauth_scope": settings.microsoft_broker_scope,
        "graph_oauth_redirect_uri": "",
        "graph_base_url": "https://graph.microsoft.com/v1.0",
        "oauth": {
            "authorization_endpoint": settings.microsoft_authorize_url,
            "token_endpoint": settings.microsoft_token_url,
        },
        "default_scopes": ["User.Read"],
    }


def _oauth_upstream_auth_config() -> dict:
    return {"header_name": "Authorization", "prefix": "Bearer"}


def ensure_default_integrations(db: Session, organization_id: str, created_by_user_id: str | None) -> None:
    settings = get_settings()
    auth_json = dumps_json(_oauth_upstream_auth_config())

    if db.get(Integration, INTEGRATION_MIRO_DEFAULT_ID) is None:
        db.add(
            Integration(
                id=INTEGRATION_MIRO_DEFAULT_ID,
                organization_id=organization_id,
                name="Miro MCP",
                type=IntegrationType.MCP_SERVER.value,
                config_json=dumps_json(_miro_integration_config(settings)),
                mcp_enabled=True,
            )
        )
    if db.get(IntegrationInstance, INSTANCE_MIRO_DEFAULT_ID) is None:
        db.add(
            IntegrationInstance(
                id=INSTANCE_MIRO_DEFAULT_ID,
                organization_id=organization_id,
                integration_id=INTEGRATION_MIRO_DEFAULT_ID,
                name="Miro MCP",
                auth_mode=AuthMode.OAUTH.value,
                auth_config_json=auth_json,
                access_mode=IntegrationAccessMode.RELAY.value,
                access_config_json=dumps_json({}),
                created_by_user_id=created_by_user_id,
            )
        )

    if db.get(Integration, INTEGRATION_GRAPH_DEFAULT_ID) is None:
        db.add(
            Integration(
                id=INTEGRATION_GRAPH_DEFAULT_ID,
                organization_id=organization_id,
                name="Microsoft Graph",
                type=IntegrationType.OAUTH_PROVIDER.value,
                config_json=dumps_json(_graph_integration_config(settings)),
                mcp_enabled=False,
            )
        )
    if db.get(IntegrationInstance, INSTANCE_GRAPH_DEFAULT_ID) is None:
        db.add(
            IntegrationInstance(
                id=INSTANCE_GRAPH_DEFAULT_ID,
                organization_id=organization_id,
                integration_id=INTEGRATION_GRAPH_DEFAULT_ID,
                name="Microsoft Graph",
                auth_mode=AuthMode.OAUTH.value,
                auth_config_json=auth_json,
                access_mode=IntegrationAccessMode.RELAY.value,
                access_config_json=dumps_json({}),
                created_by_user_id=created_by_user_id,
            )
        )

    reconcile_miro_default_integration_token_endpoint(db)
