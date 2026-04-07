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
from app.security import dumps_json

# Feste IDs: idempotenter Seed pro Organisation, keine Geheimnisse.
INTEGRATION_MIRO_DEFAULT_ID = "00000000-0000-4000-8000-000000000101"
INTEGRATION_GRAPH_DEFAULT_ID = "00000000-0000-4000-8000-000000000102"
INSTANCE_MIRO_DEFAULT_ID = "00000000-0000-4000-8000-000000000201"
INSTANCE_GRAPH_DEFAULT_ID = "00000000-0000-4000-8000-000000000202"


def _miro_integration_config(settings: Settings) -> dict:
    base = settings.miro_mcp_base.rstrip("/")
    return {
        "template_key": "miro_default",
        "endpoint": f"{base}/mcp",
        "oauth_registration_endpoint": f"{base}/register",
        "oauth_authorization_endpoint": "https://miro.com/oauth/authorize",
        "oauth_token_endpoint": "https://api.miro.com/v1/oauth/token",
    }


def _graph_integration_config(settings: Settings) -> dict:
    return {
        "template_key": "microsoft_graph_default",
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
