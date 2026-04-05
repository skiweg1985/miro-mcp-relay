from __future__ import annotations

from app.models import ProviderApp, ProviderInstance
from app.security import loads_json


def _use_pkce(instance: ProviderInstance) -> bool:
    settings = loads_json(instance.settings_json, {})
    return bool(settings.get("use_pkce"))


def oauth_integration_configured(
    *,
    provider_app: ProviderApp,
    provider_instance: ProviderInstance,
    needs_tenant: bool = False,
) -> tuple[bool, str | None]:
    """Same rules as frontend oauthIntegrationConfigured (authorize + token + client rules)."""
    settings = loads_json(provider_instance.settings_json, {})
    tenant_ok = True
    if needs_tenant:
        tenant_ok = bool(str(settings.get("tenant_id") or "").strip())
    if not tenant_ok:
        return False, "Directory (tenant) not set"

    authz = str(provider_instance.authorization_endpoint or "").strip()
    tok = str(provider_instance.token_endpoint or "").strip()
    pkce = _use_pkce(provider_instance)

    dcr = bool(getattr(provider_app, "oauth_dynamic_client_registration_enabled", False))
    reg = str(getattr(provider_app, "oauth_registration_endpoint", None) or "").strip()

    if not authz:
        return False, "Authorize URL missing"
    if not tok:
        return False, "Token URL missing"

    if dcr:
        if not reg:
            return False, "Registration URL missing"
        return True, None

    if not str(provider_app.client_id or "").strip():
        return False, "Client ID missing"
    if not bool(provider_app.encrypted_client_secret) and not pkce:
        return False, "Client secret or PKCE required"
    return True, None


def oauth_integration_configured_for_apps(
    provider_app: ProviderApp,
    provider_instance: ProviderInstance | None,
    *,
    needs_tenant: bool = False,
) -> tuple[bool, str | None]:
    if not provider_instance:
        return False, "Provider instance missing"
    return oauth_integration_configured(
        provider_app=provider_app,
        provider_instance=provider_instance,
        needs_tenant=needs_tenant,
    )
