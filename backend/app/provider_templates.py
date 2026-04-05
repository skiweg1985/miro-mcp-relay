from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ProviderApp
from app.security import dumps_json, loads_json

MIRO_RELAY_TEMPLATE = "miro-relay"
MICROSOFT_BROKER_LOGIN_TEMPLATE = "microsoft-broker-login"
MICROSOFT_GRAPH_DIRECT_TEMPLATE = "microsoft-graph-direct"

LEGACY_TEMPLATE_KEYS = {
    MIRO_RELAY_TEMPLATE: {"miro-default"},
    MICROSOFT_BROKER_LOGIN_TEMPLATE: {"microsoft-broker-default"},
    MICROSOFT_GRAPH_DIRECT_TEMPLATE: {"microsoft-graph-default"},
}


def provider_templates() -> dict[str, dict[str, Any]]:
    return {
        MIRO_RELAY_TEMPLATE: {
            "template_key": MIRO_RELAY_TEMPLATE,
            "provider_definition_key": "miro",
            "route_key": "miro",
            "display_name": "Miro Relay",
            "description": "Brokered Miro relay app for MCP access with broker-held token refresh.",
            "instance": {
                "key": "miro-relay",
                "display_name": "Miro Downstream OAuth",
                "role": "downstream_oauth",
                "issuer": None,
                "authorization_endpoint": "https://mcp.miro.com/authorize",
                "token_endpoint": "https://mcp.miro.com/token",
                "userinfo_endpoint": "https://api.miro.com/v1/oauth-token",
                "settings": {},
            },
            "app": {
                "key": "miro-relay",
                "display_name": "Miro Relay App",
                "client_id": None,
                "redirect_uris": [],
                "default_scopes": ["boards:read", "boards:write"],
                "scope_ceiling": ["boards:read", "boards:write"],
                "access_mode": "relay",
                "allow_relay": True,
                "allow_direct_token_return": False,
                "relay_protocol": "mcp_streamable_http",
            },
        },
        MICROSOFT_BROKER_LOGIN_TEMPLATE: {
            "template_key": MICROSOFT_BROKER_LOGIN_TEMPLATE,
            "provider_definition_key": "microsoft",
            "route_key": "microsoft-broker-login",
            "display_name": "Microsoft Broker Login",
            "description": "Microsoft Entra / Azure AD login for broker user sign-in.",
            "instance": {
                "key": "microsoft-broker-auth",
                "display_name": "Microsoft Broker Login",
                "role": "broker_auth",
                "issuer": None,
                "authorization_endpoint": None,
                "token_endpoint": None,
                "userinfo_endpoint": None,
                "settings": {"tenant_id": "common"},
            },
            "app": {
                "key": "microsoft-broker-login",
                "display_name": "Microsoft Broker Login App",
                "client_id": None,
                "redirect_uris": [],
                "default_scopes": ["openid", "profile", "email"],
                "scope_ceiling": ["openid", "profile", "email"],
                "access_mode": "relay",
                "allow_relay": False,
                "allow_direct_token_return": False,
                "relay_protocol": None,
            },
        },
        MICROSOFT_GRAPH_DIRECT_TEMPLATE: {
            "template_key": MICROSOFT_GRAPH_DIRECT_TEMPLATE,
            "provider_definition_key": "microsoft",
            "route_key": "microsoft-graph",
            "display_name": "Microsoft Graph",
            "description": "Broker-held Microsoft Graph OAuth connection with delegated token issuance.",
            "instance": {
                "key": "microsoft-graph-oauth",
                "display_name": "Microsoft Graph Downstream OAuth",
                "role": "downstream_oauth",
                "issuer": None,
                "authorization_endpoint": None,
                "token_endpoint": None,
                "userinfo_endpoint": "https://graph.microsoft.com/v1.0/me",
                "settings": {"tenant_id": "common"},
            },
            "app": {
                "key": "microsoft-graph",
                "display_name": "Microsoft Graph App",
                "client_id": None,
                "redirect_uris": [],
                "default_scopes": ["openid", "profile", "email", "offline_access", "User.Read"],
                "scope_ceiling": [
                    "openid",
                    "profile",
                    "email",
                    "offline_access",
                    "User.Read",
                    "Mail.Read",
                    "Calendars.Read",
                    "Files.Read",
                ],
                "access_mode": "hybrid",
                "allow_relay": True,
                "allow_direct_token_return": True,
                "relay_protocol": "rest_proxy",
            },
        },
    }


def microsoft_authority(tenant_id: str | None) -> str:
    tenant = str(tenant_id or "common").strip().strip("/") or "common"
    return f"https://login.microsoftonline.com/{tenant}"


def microsoft_endpoints(tenant_id: str | None) -> dict[str, str]:
    authority = microsoft_authority(tenant_id)
    return {
        "issuer": f"{authority}/v2.0",
        "authorization_endpoint": f"{authority}/oauth2/v2.0/authorize",
        "token_endpoint": f"{authority}/oauth2/v2.0/token",
    }


def normalize_instance_settings(provider_definition_key: str, settings: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, str | None]]:
    normalized = dict(settings or {})
    if provider_definition_key == "microsoft":
        tenant_id = str(normalized.get("tenant_id") or "common").strip() or "common"
        normalized = {"tenant_id": tenant_id}
        return normalized, microsoft_endpoints(tenant_id)
    return normalized, {
        "issuer": None,
        "authorization_endpoint": None,
        "token_endpoint": None,
    }


def provider_app_matches_template(provider_app: ProviderApp, template_key: str) -> bool:
    if provider_app.template_key == template_key:
        return True
    return provider_app.key in LEGACY_TEMPLATE_KEYS.get(template_key, set())


def get_provider_app_by_template(
    db: Session,
    *,
    organization_id: str,
    template_key: str,
    enabled_only: bool = True,
) -> ProviderApp | None:
    provider_apps = db.scalars(
        select(ProviderApp).where(ProviderApp.organization_id == organization_id).order_by(ProviderApp.created_at.desc())
    ).all()
    for provider_app in provider_apps:
        if provider_app.deleted_at is not None:
            continue
        if enabled_only and not provider_app.is_enabled:
            continue
        if provider_app_matches_template(provider_app, template_key):
            return provider_app
    return None


def require_provider_app_by_template(
    db: Session,
    *,
    organization_id: str,
    template_key: str,
    detail: str,
) -> ProviderApp:
    provider_app = get_provider_app_by_template(db, organization_id=organization_id, template_key=template_key)
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return provider_app


def validate_template_assignment(template_key: str | None, provider_definition_key: str) -> None:
    if not template_key:
        return
    template = provider_templates().get(template_key)
    if not template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown provider template")
    if template["provider_definition_key"] != provider_definition_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template does not match provider definition")


def enforce_singleton_template(
    db: Session,
    *,
    organization_id: str,
    template_key: str | None,
    current_app_id: str | None = None,
) -> None:
    if template_key not in {MIRO_RELAY_TEMPLATE, MICROSOFT_BROKER_LOGIN_TEMPLATE}:
        return
    provider_apps = db.scalars(select(ProviderApp).where(ProviderApp.organization_id == organization_id)).all()
    conflict = next(
        (
            provider_app
            for provider_app in provider_apps
            if provider_app.deleted_at is None
            and provider_app.id != current_app_id
            and provider_app_matches_template(provider_app, template_key)
        ),
        None,
    )
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A provider app for this template already exists")


def provider_definition_metadata() -> dict[str, dict[str, Any]]:
    templates = provider_templates()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for template in templates.values():
        grouped.setdefault(template["provider_definition_key"], []).append(
            {
                "template_key": template["template_key"],
                "route_key": template["route_key"],
                "display_name": template["display_name"],
                "description": template["description"],
                "instance": template["instance"],
                "app": template["app"],
            }
        )
    return {
        key: {"templates": value}
        for key, value in grouped.items()
    }


def serialize_json_field(raw: str | None, fallback: Any) -> Any:
    return loads_json(raw, fallback)


def dump_settings(settings: dict[str, Any]) -> str:
    return dumps_json(settings)
