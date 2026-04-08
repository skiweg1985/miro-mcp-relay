from __future__ import annotations

from abc import ABC, abstractmethod

import httpx

from app.broker_login.canonical import CanonicalUserClaims
from app.broker_login.token_bundle import TokenBundle
from app.core.config import Settings


class BrokerLoginAuthProvider(ABC):
    """Pluggable broker login (session) OAuth/OIDC provider — not integration MCP OAuth."""

    @property
    @abstractmethod
    def provider_id(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def redirect_uri(self, settings: Settings) -> str:
        raise NotImplementedError

    @abstractmethod
    def authorize_url(
        self,
        *,
        settings: Settings,
        redirect_uri: str,
        state: str,
        nonce: str,
        code_challenge: str,
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    async def exchange_code(
        self,
        client: httpx.AsyncClient,
        *,
        code: str,
        redirect_uri: str,
        code_verifier: str,
    ) -> TokenBundle:
        raise NotImplementedError

    async def refresh_token(
        self,
        _client: httpx.AsyncClient,
        *,
        _refresh_token: str,
        _redirect_uri: str,
    ) -> TokenBundle:
        raise NotImplementedError("refresh_token is not supported for this login provider")

    def id_token_claims(self, bundle: TokenBundle) -> dict:
        from app.security import decode_jwt_payload_unverified

        if not bundle.id_token:
            return {}
        return decode_jwt_payload_unverified(bundle.id_token) or {}

    async def fetch_userinfo(
        self,
        client: httpx.AsyncClient,
        bundle: TokenBundle,
    ) -> dict | None:
        return None

    @abstractmethod
    def map_claims(self, *, id_token_claims: dict, userinfo: dict | None) -> CanonicalUserClaims:
        raise NotImplementedError

    def validate_nonce(self, *, id_token_claims: dict, expected_nonce: str) -> bool:
        got = str(id_token_claims.get("nonce") or "").strip()
        exp = str(expected_nonce or "").strip()
        return bool(got and exp and got == exp)
