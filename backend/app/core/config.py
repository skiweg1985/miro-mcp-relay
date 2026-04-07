from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    app_name: str = "oauth-broker"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./broker.db"
    cors_origins: str = "http://localhost:5173,http://localhost:8787"
    broker_public_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:5173"
    legacy_miro_data_dir: str = "data"

    session_cookie_name: str = "broker_session"
    session_ttl_hours: int = 8
    session_secure_cookie: bool = False
    session_secret: str = "change-me-broker-session-secret"

    broker_encryption_key: str = ""

    default_org_slug: str = "default"
    default_org_name: str = "Default Organization"
    bootstrap_admin_email: str = "admin@example.com"
    bootstrap_admin_password: str = "change-me-admin-password"
    bootstrap_admin_display_name: str = "Broker Admin"

    miro_mcp_base: str = "https://mcp.miro.com"
    miro_api_base: str = "https://api.miro.com"
    miro_oauth_client_id: str = ""
    miro_oauth_client_secret: str = ""
    miro_oauth_scope: str = "boards:read boards:write"
    miro_oauth_email_mode: str = "warn"
    miro_retry_count: int = 2
    miro_breaker_fail_threshold: int = 5
    miro_breaker_open_ms: int = 30000

    microsoft_broker_authority_base: str = "https://login.microsoftonline.com"
    microsoft_broker_tenant_id: str = "common"
    microsoft_broker_client_id: str = ""
    microsoft_broker_client_secret: str = ""
    microsoft_broker_scope: str = "openid profile email User.Read"
    # Microsoft Graph Integration-OAuth: leer = {BROKER_PUBLIC_BASE_URL}{api_v1_prefix}{microsoft_graph_oauth_redirect_path}
    microsoft_graph_oauth_redirect_uri: str = ""
    microsoft_graph_oauth_redirect_path: str = "/connections/microsoft-graph/callback"

    @field_validator("broker_encryption_key", mode="before")
    @classmethod
    def derive_encryption_key(cls, value: str, info):
        raw = str(value or "").strip()
        if raw:
            return raw
        session_secret = str(info.data.get("session_secret") or "change-me-broker-session-secret")
        digest = hashlib.sha256(session_secret.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest).decode("utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def miro_scope_list(self) -> list[str]:
        return [scope.strip() for scope in self.miro_oauth_scope.split() if scope.strip()]

    @property
    def microsoft_scope_list(self) -> list[str]:
        return [scope.strip() for scope in self.microsoft_broker_scope.split() if scope.strip()]

    @property
    def microsoft_authorize_url(self) -> str:
        base = self.microsoft_broker_authority_base.rstrip("/")
        tenant = self.microsoft_broker_tenant_id.strip() or "common"
        return f"{base}/{tenant}/oauth2/v2.0/authorize"

    @property
    def microsoft_token_url(self) -> str:
        base = self.microsoft_broker_authority_base.rstrip("/")
        tenant = self.microsoft_broker_tenant_id.strip() or "common"
        return f"{base}/{tenant}/oauth2/v2.0/token"


@lru_cache
def get_settings() -> Settings:
    return Settings()
