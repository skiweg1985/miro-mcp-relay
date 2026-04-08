from __future__ import annotations

import httpx

from app.broker_login.base import BrokerLoginAuthProvider
from app.broker_login.canonical import CanonicalUserClaims
from app.broker_login.claim_paths import get_by_path, stringify_claim
from app.broker_login.oidc_config import GenericOidcLoginConfig
from app.broker_login.token_bundle import TokenBundle
from app.broker_login.user_resolution import parse_email_like
from app.core.config import Settings


class GenericOidcLoginProvider(BrokerLoginAuthProvider):
    """RFC-style authorization code + PKCE against configurable OIDC endpoints (not Microsoft-specific)."""

    def __init__(self, *, provider_key: str, client_id: str, client_secret: str, config: GenericOidcLoginConfig) -> None:
        self._provider_key = provider_key
        self._client_id = client_id
        self._client_secret = client_secret
        self._cfg = config

    @property
    def provider_id(self) -> str:
        return self._provider_key

    def redirect_uri(self, settings: Settings) -> str:
        base = settings.broker_public_base_url.rstrip("/")
        api = str(settings.api_v1_prefix or "").strip()
        if not api.startswith("/"):
            api = "/" + api
        return f"{base}{api}/auth/{self._provider_key}/callback"

    def authorize_url(
        self,
        *,
        settings: Settings,
        redirect_uri: str,
        state: str,
        nonce: str,
        code_challenge: str,
    ) -> str:
        _ = settings
        c = self._cfg
        params = {
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": " ".join(c.scopes),
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        sep = "&" if "?" in c.authorization_endpoint else "?"
        return f"{c.authorization_endpoint}{sep}{httpx.QueryParams(params)}"

    async def exchange_code(
        self,
        client: httpx.AsyncClient,
        *,
        code: str,
        redirect_uri: str,
        code_verifier: str,
    ) -> TokenBundle:
        data = {
            "grant_type": "authorization_code",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }
        response = await client.post(
            self._cfg.token_endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        raw: dict = {}
        try:
            raw = response.json()
        except Exception:
            raw = {}
        if response.status_code >= 400:
            return TokenBundle(access_token=None, id_token=None, raw_token_response={"_http_status": response.status_code, **raw})
        id_tok = raw.get("id_token")
        id_str = str(id_tok).strip() if id_tok else None
        access = raw.get("access_token")
        return TokenBundle(
            access_token=str(access).strip() if access else None,
            id_token=id_str,
            raw_token_response=raw,
        )

    async def fetch_userinfo(
        self,
        client: httpx.AsyncClient,
        bundle: TokenBundle,
    ) -> dict | None:
        url = (self._cfg.userinfo_endpoint or "").strip()
        if not url:
            return None
        token = bundle.access_token
        if not token:
            return None
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        if response.status_code >= 400:
            return None
        try:
            data = response.json()
        except Exception:
            return None
        return data if isinstance(data, dict) else None

    def map_claims(self, *, id_token_claims: dict, userinfo: dict | None) -> CanonicalUserClaims:
        merged: dict = {**(id_token_claims or {}), **(userinfo or {})}
        m = self._cfg.claim_mapping

        def req(key: str) -> str:
            path = m.get(key) or ""
            return stringify_claim(get_by_path(merged, path))

        subject = req("subject")
        email_raw = req("email")
        email = parse_email_like(email_raw) or parse_email_like(stringify_claim(get_by_path(merged, m.get("email") or "email")))
        display = req("display_name") or (email or subject)
        issuer = stringify_claim(get_by_path(merged, "iss")) or (self._cfg.issuer.strip() or None)
        if not subject:
            raise ValueError("missing subject")
        if not email:
            raise ValueError("missing email")
        pref = stringify_claim(get_by_path(merged, m.get("preferred_username") or "preferred_username")) or None
        loc = stringify_claim(get_by_path(merged, m.get("locale") or "locale")) or None
        zone = stringify_claim(get_by_path(merged, m.get("zoneinfo") or "zoneinfo")) or None
        return CanonicalUserClaims(
            subject=subject,
            email=email,
            display_name=display or email,
            issuer=issuer,
            preferred_username=pref,
            locale=loc,
            zoneinfo=zone,
        )
