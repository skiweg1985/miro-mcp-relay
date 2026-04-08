"""Generic OAuth/OIDC configuration for user-bound Integration connections (not broker login)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from app.broker_login.claim_paths import get_by_path, stringify_claim
from app.models import Integration
from app.security import decrypt_text

TEMPLATE_KEY_GENERIC_OAUTH = "generic_oauth"
KIND_GENERIC_OAUTH = "generic_oauth"

_CLAIM_PATH_RE = re.compile(r"^[a-zA-Z0-9_.]+$")

DEFAULT_OAUTH_CLAIM_MAPPING: dict[str, str] = {
    "subject": "sub",
    "email": "email",
    "display_name": "name",
    "preferred_username": "preferred_username",
}


def is_generic_oauth_template(cfg: dict[str, Any]) -> bool:
    return str(cfg.get("template_key") or "").strip() == TEMPLATE_KEY_GENERIC_OAUTH


def _is_http_url(url: str) -> bool:
    try:
        p = urlparse(url.strip())
    except Exception:
        return False
    return p.scheme in ("http", "https") and bool(p.netloc)


def normalized_claim_mapping(cfg: dict[str, Any]) -> dict[str, str]:
    raw = cfg.get("oauth_claim_mapping")
    out = dict(DEFAULT_OAUTH_CLAIM_MAPPING)
    if isinstance(raw, dict):
        for k in ("subject", "email", "display_name", "preferred_username"):
            v = raw.get(k)
            if isinstance(v, str) and v.strip() and _CLAIM_PATH_RE.match(v.strip()):
                out[k] = v.strip()
    return out


def merge_id_token_and_userinfo(
    id_token_claims: dict[str, Any] | None,
    userinfo: dict[str, Any] | None,
) -> dict[str, Any]:
    base: dict[str, Any] = {}
    if isinstance(id_token_claims, dict):
        base.update(id_token_claims)
    if isinstance(userinfo, dict):
        base.update(userinfo)
    return base


def profile_from_claims(merged_claims: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    meta: dict[str, Any] = {"provider": KIND_GENERIC_OAUTH}
    sub_path = mapping.get("subject") or "sub"
    subject = stringify_claim(get_by_path(merged_claims, sub_path))
    if subject:
        meta["external_subject"] = subject
    email = stringify_claim(get_by_path(merged_claims, mapping.get("email") or "email"))
    if email:
        meta["email"] = email
    display = stringify_claim(get_by_path(merged_claims, mapping.get("display_name") or "name"))
    if display:
        meta["display_name"] = display
    pref = stringify_claim(get_by_path(merged_claims, mapping.get("preferred_username") or "preferred_username"))
    if pref:
        meta["preferred_username"] = pref
        if not meta.get("username"):
            meta["username"] = pref
    return meta


def oauth_scope_string(cfg: dict[str, Any]) -> str:
    raw = cfg.get("oauth_scopes")
    if isinstance(raw, list) and raw:
        parts = [str(x).strip() for x in raw if str(x).strip()]
        return " ".join(parts)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return "openid profile email"


def oauth_pkce_enabled(cfg: dict[str, Any]) -> bool:
    return cfg.get("oauth_pkce_enabled", True) is not False


def resolve_generic_client_credentials(
    integration: Integration,
    cfg: dict[str, Any],
) -> tuple[str, str]:
    client_id = str(cfg.get("oauth_client_id") or "").strip()
    secret = ""
    if integration.oauth_client_secret_encrypted:
        secret = str(decrypt_text(integration.oauth_client_secret_encrypted) or "").strip()
    if not secret:
        secret = str(cfg.get("oauth_client_secret") or "").strip()
    return client_id, secret


def first_generic_oauth_config_error(
    cfg: dict[str, Any],
    integration: Integration,
    *,
    require_client_secret: bool = True,
) -> str | None:
    if not is_generic_oauth_template(cfg):
        return "integration_oauth_template_unsupported"
    authz = str(cfg.get("oauth_authorization_endpoint") or "").strip()
    if not authz:
        return "oauth_authorization_endpoint_missing"
    if not _is_http_url(authz):
        return "oauth_invalid_authorization_url"
    token_ep = str(cfg.get("oauth_token_endpoint") or "").strip()
    if not token_ep:
        return "oauth_token_endpoint_missing"
    if not _is_http_url(token_ep):
        return "oauth_invalid_token_url"
    client_id = str(cfg.get("oauth_client_id") or "").strip()
    if not client_id:
        return "oauth_client_id_missing"
    if require_client_secret:
        _cid, sec = resolve_generic_client_credentials(integration, cfg)
        if not sec:
            return "oauth_client_secret_not_configured"
    userinfo = str(cfg.get("oauth_userinfo_endpoint") or "").strip()
    if userinfo and not _is_http_url(userinfo):
        return "oauth_invalid_userinfo_url"
    disc = str(cfg.get("oauth_discovery_url") or "").strip()
    if disc and not _is_http_url(disc):
        return "oauth_invalid_discovery_url"
    jwks = str(cfg.get("oauth_jwks_uri") or "").strip()
    if jwks and not _is_http_url(jwks):
        return "oauth_invalid_jwks_url"
    return None


def token_endpoint_auth_method(cfg: dict[str, Any]) -> str:
    raw = str(cfg.get("oauth_token_endpoint_auth_method") or "client_secret_post").strip().lower()
    if raw == "client_secret_basic":
        return "client_secret_basic"
    return "client_secret_post"
