from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.models import AccessMode, ProviderApp
from app.provider_templates import MICROSOFT_GRAPH_DIRECT_TEMPLATE, MIRO_RELAY_TEMPLATE, provider_app_matches_template
from app.security import dumps_json, loads_json


class RelayConfig(BaseModel):
    """Runtime relay behavior for an integration; persisted in ProviderApp.relay_config_json and merged with template presets."""

    allowed_connection_types: list[str] = Field(default_factory=lambda: ["relay"])
    relay_type: str = "generic_http"
    upstream_base_url: str = ""
    upstream_path_template: str | None = None
    method_mode: str = "passthrough"
    fixed_method: str | None = None
    token_transport: str = "authorization_bearer"
    token_header_name: str | None = None
    token_query_param: str | None = None
    static_headers: dict[str, str] = Field(default_factory=dict)
    dynamic_headers: dict[str, str] = Field(default_factory=dict)
    forward_path: bool = False
    forward_query: bool = False
    forward_body: bool = True
    allowed_request_headers: list[str] | None = None
    blocked_request_headers: list[str] | None = None
    force_content_type: str | None = None
    supports_refresh: bool = True
    retry_enabled: bool = True
    retry_count: int = 2
    stream_response: bool = True
    circuit_breaker_enabled: bool = True
    circuit_breaker_fail_threshold: int = 5
    circuit_breaker_open_ms: int = 30000
    oauth_refresh_client_credential_source: str = "connected_account"
    relay_health_url: str | None = None


def _preset_for_template(template_key: str | None, settings: Settings) -> dict[str, Any]:
    miro_base = settings.miro_mcp_base.rstrip("/")
    graph_base = "https://graph.microsoft.com"
    if template_key == MIRO_RELAY_TEMPLATE:
        return {
            "allowed_connection_types": ["relay"],
            "relay_type": "streamable_http",
            "upstream_base_url": miro_base,
            "method_mode": "fixed",
            "fixed_method": "POST",
            "token_transport": "authorization_bearer",
            "static_headers": {"Accept": "application/json, text/event-stream"},
            "forward_path": False,
            "forward_query": False,
            "forward_body": True,
            "supports_refresh": True,
            "retry_enabled": True,
            "retry_count": settings.miro_retry_count,
            "stream_response": True,
            "circuit_breaker_enabled": True,
            "circuit_breaker_fail_threshold": settings.miro_breaker_fail_threshold,
            "circuit_breaker_open_ms": settings.miro_breaker_open_ms,
            "oauth_refresh_client_credential_source": "connected_account",
            "relay_health_url": f"{miro_base}/.well-known/oauth-protected-resource",
        }
    if template_key == MICROSOFT_GRAPH_DIRECT_TEMPLATE:
        return {
            "allowed_connection_types": ["direct_token", "relay"],
            "relay_type": "rest_proxy",
            "upstream_base_url": graph_base,
            "method_mode": "passthrough",
            "token_transport": "authorization_bearer",
            "forward_path": True,
            "forward_query": True,
            "forward_body": True,
            "supports_refresh": True,
            "retry_enabled": True,
            "stream_response": False,
            "circuit_breaker_enabled": False,
            "oauth_refresh_client_credential_source": "provider_app",
        }
    return {}


def _legacy_allowed_connection_types(provider_app: ProviderApp) -> list[str]:
    modes: list[str] = []
    am = provider_app.access_mode
    if am in (AccessMode.RELAY.value, AccessMode.HYBRID.value) and provider_app.allow_relay:
        modes.append("relay")
    if am in (AccessMode.DIRECT_TOKEN.value, AccessMode.HYBRID.value) and provider_app.allow_direct_token_return:
        modes.append("direct_token")
    if not modes and provider_app.allow_relay:
        modes.append("relay")
    return modes


def effective_allowed_connection_types(provider_app: ProviderApp) -> list[str]:
    raw = loads_json(provider_app.relay_config_json or "{}", {})
    stored = raw.get("allowed_connection_types")
    if isinstance(stored, list) and stored:
        return [str(x) for x in stored if x in {"relay", "direct_token"}]
    return _legacy_allowed_connection_types(provider_app)


def relay_config_from_storage(provider_app: ProviderApp) -> dict[str, Any]:
    raw = loads_json(provider_app.relay_config_json or "{}", {})
    return raw if isinstance(raw, dict) else {}


def effective_relay_config(provider_app: ProviderApp, settings: Settings | None = None) -> RelayConfig:
    settings = settings or get_settings()
    preset: dict[str, Any] = {}
    if provider_app.template_key:
        preset = _preset_for_template(provider_app.template_key, settings)
    elif provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        preset = _preset_for_template(MIRO_RELAY_TEMPLATE, settings)
    elif provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE):
        preset = _preset_for_template(MICROSOFT_GRAPH_DIRECT_TEMPLATE, settings)

    merged = {**preset, **relay_config_from_storage(provider_app)}
    act = merged.get("allowed_connection_types")
    if not act:
        merged["allowed_connection_types"] = _legacy_allowed_connection_types(provider_app) or ["relay"]

    if not str(merged.get("upstream_base_url") or "").strip():
        merged["upstream_base_url"] = preset.get("upstream_base_url") or ""

    return RelayConfig.model_validate(merged)


def resolve_upstream_base_url(provider_app: ProviderApp, config: RelayConfig, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    base = str(config.upstream_base_url or "").strip().rstrip("/")
    if base:
        return base
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        return settings.miro_mcp_base.rstrip("/")
    return ""


def update_relay_json_allowed_types_from_legacy_columns(provider_app: ProviderApp) -> None:
    raw = loads_json(provider_app.relay_config_json or "{}", {})
    raw["allowed_connection_types"] = _legacy_allowed_connection_types(provider_app)
    provider_app.relay_config_json = dumps_json(raw)


def sync_legacy_access_fields_from_relay(provider_app: ProviderApp) -> None:
    types = set(effective_allowed_connection_types(provider_app))
    provider_app.allow_relay = "relay" in types
    provider_app.allow_direct_token_return = "direct_token" in types
    if "relay" in types and "direct_token" in types:
        provider_app.access_mode = AccessMode.HYBRID.value
    elif "direct_token" in types:
        provider_app.access_mode = AccessMode.DIRECT_TOKEN.value
    else:
        provider_app.access_mode = AccessMode.RELAY.value


def relay_health_check_url(provider_app: ProviderApp, config: RelayConfig, settings: Settings | None = None) -> str | None:
    if config.relay_health_url:
        return config.relay_health_url.strip()
    base = resolve_upstream_base_url(provider_app, config, settings)
    if base and provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        return f"{base}/.well-known/oauth-protected-resource"
    return None
