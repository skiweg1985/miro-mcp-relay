from __future__ import annotations

import httpx

from app.broker_login.base import BrokerLoginAuthProvider
from app.broker_login.canonical import CanonicalUserClaims
from app.broker_login.token_bundle import TokenBundle
from app.broker_login.user_resolution import parse_email_like
from app.core.config import Settings
from app.microsoft_oauth_resolver import (
    ResolvedMicrosoftOAuth,
    microsoft_authorize_url,
    microsoft_token_url,
)


class MicrosoftEntraLoginProvider(BrokerLoginAuthProvider):
    """Microsoft Entra ID (Azure AD) v2 login using existing broker Microsoft OAuth resolution."""

    def __init__(self, resolved: ResolvedMicrosoftOAuth) -> None:
        self._resolved = resolved

    @property
    def provider_id(self) -> str:
        return "microsoft"

    def redirect_uri(self, settings: Settings) -> str:
        base = settings.broker_public_base_url.rstrip("/")
        api = str(settings.api_v1_prefix or "").strip()
        if not api.startswith("/"):
            api = "/" + api
        return f"{base}{api}/auth/{self.provider_id}/callback"

    def authorize_url(
        self,
        *,
        settings: Settings,
        redirect_uri: str,
        state: str,
        nonce: str,
        code_challenge: str,
    ) -> str:
        r = self._resolved
        params = {
            "client_id": r.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": " ".join(r.scope_list),
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        auth_base = microsoft_authorize_url(r.authority_base, r.tenant_id)
        return f"{auth_base}?{httpx.QueryParams(params)}"

    async def exchange_code(
        self,
        client: httpx.AsyncClient,
        *,
        code: str,
        redirect_uri: str,
        code_verifier: str,
    ) -> TokenBundle:
        r = self._resolved
        token_endpoint = microsoft_token_url(r.authority_base, r.tenant_id)
        response = await client.post(
            token_endpoint,
            data={
                "grant_type": "authorization_code",
                "client_id": r.client_id,
                "client_secret": r.client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
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

    def map_claims(self, *, id_token_claims: dict, userinfo: dict | None) -> CanonicalUserClaims:
        _ = userinfo
        claims = id_token_claims
        subject = str(claims.get("sub") or "").strip()
        email = parse_email_like(
            str(claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip()
        )
        if not subject:
            raise ValueError("missing subject")
        if not email:
            raise ValueError("missing email")
        display = str(claims.get("name") or claims.get("preferred_username") or email).strip() or email
        issuer = str(claims.get("iss") or "").strip() or None
        pref = str(claims.get("preferred_username") or "").strip() or None
        loc = str(claims.get("locale") or "").strip() or None
        zone = str(claims.get("zoneinfo") or "").strip() or None
        return CanonicalUserClaims(
            subject=subject,
            email=email,
            display_name=display,
            issuer=issuer,
            preferred_username=pref,
            locale=loc,
            zoneinfo=zone,
        )
