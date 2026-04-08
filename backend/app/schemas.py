from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    email: str
    display_name: str
    is_admin: bool
    is_active: bool
    created_at: datetime


class SessionResponse(BaseModel):
    ok: bool = True
    user: UserOut
    csrf_token: str


class AuthFlowStartResponse(BaseModel):
    ok: bool = True
    auth_url: str
    state: str


class LoginProviderOption(BaseModel):
    id: str
    display_name: str


class LoginOptionsResponse(BaseModel):
    ok: bool = True
    login_providers: list[LoginProviderOption] = Field(default_factory=list)
    microsoft_enabled: bool
    microsoft_display_name: str | None = None


class BrokerCallbackUrlsOut(BaseModel):
    ok: bool = True
    microsoft_login: str
    integration_oauth: str
    microsoft_graph: str
    miro: str
    custom_oauth: str


class IntegrationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str
    config: dict[str, Any] = Field(default_factory=dict)
    mcp_enabled: bool = False
    oauth_integration_client_secret: str | None = None


class IntegrationOut(BaseModel):
    id: str
    name: str
    type: str
    config: dict[str, Any] = Field(default_factory=dict)
    mcp_enabled: bool
    created_at: datetime
    updated_at: datetime
    oauth_client_secret_configured: bool = False
    integration_oauth_callback_url: str = ""


class IntegrationUpdate(BaseModel):
    config: dict[str, Any] | None = None
    graph_oauth_client_secret: str | None = None
    clear_graph_oauth_client_secret: bool = False
    oauth_integration_client_secret: str | None = None
    clear_oauth_integration_client_secret: bool = False


class IntegrationInstanceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    integration_id: str
    auth_mode: str
    auth_config: dict[str, Any] = Field(default_factory=dict)
    access_mode: str = "relay"
    access_config: dict[str, Any] = Field(default_factory=dict)


class IntegrationInstanceOut(BaseModel):
    id: str
    name: str
    integration_id: str
    auth_mode: str
    auth_config: dict[str, Any] = Field(default_factory=dict)
    access_mode: str
    access_config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    oauth_connected: bool = False


class IntegrationInstanceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    auth_mode: str | None = None
    auth_config: dict[str, Any] | None = None
    access_mode: str | None = None
    access_config: dict[str, Any] | None = None
    acknowledge_critical_change: bool = False


class IntegrationInstanceDeleteResult(BaseModel):
    ok: bool = True
    id: str
    grants_invalidated: int


class IntegrationDeleteResult(BaseModel):
    ok: bool = True
    id: str
    grants_invalidated: int
    connections_removed: int


class UserConnectionSummaryOut(BaseModel):
    id: str
    status: str
    created_at: datetime
    updated_at: datetime
    profile: dict[str, Any] = Field(default_factory=dict)


class IntegrationInstanceInspectOut(BaseModel):
    instance: IntegrationInstanceOut
    integration: IntegrationOut
    user_connection: UserConnectionSummaryOut | None = None


class IntegrationToolOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict)
    visible: bool
    allowed: bool


class IntegrationExecuteRequest(BaseModel):
    action: str = Field(default="call_tool")
    tool_name: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)


class IntegrationExecuteResponse(BaseModel):
    ok: bool = True
    result: dict[str, Any] = Field(default_factory=dict)


class MicrosoftOAuthAdminOut(BaseModel):
    ok: bool = True
    authority_base: str = ""
    tenant_id: str = ""
    client_id: str = ""
    scope: str = ""
    has_client_secret: bool = False
    effective_source: str
    microsoft_login_enabled: bool
    redirect_uri: str


class MicrosoftOAuthAdminUpdate(BaseModel):
    authority_base: str = Field(default="", max_length=512)
    tenant_id: str = Field(default="", max_length=120)
    client_id: str = Field(default="", max_length=512)
    scope: str = Field(default="", max_length=2000)
    client_secret: str | None = None


def _http_url(value: str, field_label: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{field_label} is required")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"{field_label} must be a valid http(s) URL")
    return raw


class BrokerLoginOIDCConfigIn(BaseModel):
    issuer: str = Field(default="", max_length=512)
    authorization_endpoint: str = Field(min_length=1, max_length=2000)
    token_endpoint: str = Field(min_length=1, max_length=2000)
    userinfo_endpoint: str | None = Field(default=None, max_length=2000)
    jwks_uri: str | None = Field(default=None, max_length=2000)
    scopes: list[str] = Field(default_factory=lambda: ["openid", "profile", "email"])
    claim_mapping: dict[str, str] = Field(
        default_factory=lambda: {
            "subject": "sub",
            "email": "email",
            "display_name": "name",
            "preferred_username": "preferred_username",
            "locale": "locale",
            "zoneinfo": "zoneinfo",
        }
    )

    @field_validator("authorization_endpoint", "token_endpoint", mode="before")
    @classmethod
    def _validate_core_urls(cls, v: object) -> str:
        return _http_url(str(v or ""), "Endpoint URL")

    @field_validator("userinfo_endpoint", "jwks_uri", mode="before")
    @classmethod
    def _validate_optional_urls(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        return _http_url(s, "URL")

    @field_validator("issuer", mode="before")
    @classmethod
    def _issuer_optional_url(cls, v: object) -> str:
        s = str(v or "").strip()
        if not s:
            return ""
        return _http_url(s, "Issuer")

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes_non_empty(cls, v: object) -> list[str]:
        if v is None:
            return ["openid", "profile", "email"]
        if isinstance(v, str):
            parts = [p.strip() for p in v.split() if p.strip()]
            return parts if parts else ["openid", "profile", "email"]
        if isinstance(v, list):
            parts = [str(x).strip() for x in v if str(x).strip()]
            return parts if parts else ["openid", "profile", "email"]
        return ["openid", "profile", "email"]

    @model_validator(mode="after")
    def _claim_mapping_required_paths(self) -> BrokerLoginOIDCConfigIn:
        m = self.claim_mapping or {}
        sub_path = str(m.get("subject") or "").strip()
        email_path = str(m.get("email") or "").strip()
        if not sub_path:
            raise ValueError("claim_mapping.subject must be a non-empty claim path (e.g. sub)")
        if not email_path:
            raise ValueError("claim_mapping.email must be a non-empty claim path (e.g. email)")
        return self


class BrokerLoginProviderOut(BaseModel):
    ok: bool = True
    provider_key: str
    display_name: str
    enabled: bool
    client_id: str
    has_client_secret: bool
    oidc: BrokerLoginOIDCConfigIn
    callback_redirect_uri: str


class BrokerLoginProviderCreate(BaseModel):
    provider_key: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    display_name: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    client_id: str = Field(min_length=1, max_length=512)
    client_secret: str | None = None
    oidc: BrokerLoginOIDCConfigIn


class BrokerLoginProviderUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None
    client_id: str | None = Field(default=None, max_length=512)
    client_secret: str | None = None
    oidc: BrokerLoginOIDCConfigIn | None = None


class AccessGrantCreate(BaseModel):
    integration_instance_id: str = Field(min_length=1, max_length=36)
    name: str = Field(min_length=1, max_length=255)
    expires_at: datetime | None = None
    allowed_tools: list[str] = Field(default_factory=list)
    user_connection_id: str | None = Field(default=None, max_length=36)
    notes: str | None = Field(default=None, max_length=2000)
    policy_ref: str | None = Field(default=None, max_length=255)
    direct_token_access: bool = False

    @field_validator("allowed_tools")
    @classmethod
    def normalize_tool_names(cls, value: list[str]) -> list[str]:
        return [str(v).strip() for v in value if str(v).strip()]


class AccessGrantOut(BaseModel):
    id: str
    user_id: str
    integration_instance_id: str
    integration_instance_name: str
    user_connection_id: str | None = None
    name: str
    key_prefix: str
    status: str
    effective_status: str
    allowed_tools: list[str] = Field(default_factory=list)
    direct_token_access: bool = False
    policy_ref: str | None = None
    notes: str | None = None
    created_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    invalidated_at: datetime | None = None
    invalidation_reason: str | None = None
    last_used_at: datetime | None = None


class AccessGrantDeleteResult(BaseModel):
    ok: bool = True
    id: str


class AccessGrantCreatedOut(BaseModel):
    ok: bool = True
    grant: AccessGrantOut
    access_key: str


class AccessGrantValidateRequest(BaseModel):
    token: str = Field(min_length=8, max_length=500)


class AccessGrantValidateResponse(BaseModel):
    ok: bool = True
    grant_id: str
    user_id: str
    integration_instance_id: str
    status: str


class ConsumerUpstreamOAuthTokenOut(BaseModel):
    ok: bool = True
    access_token: str
    token_type: str = "Bearer"
    expires_at: datetime | None = None
    expires_in: int | None = None
    connection_id: str | None = None


class AdminUserLifecycleCountsOut(BaseModel):
    active_sessions: int
    access_keys_active: int
    access_keys_revoked: int
    access_keys_invalid: int
    access_keys_total: int
    connections_total: int
    connections_with_stored_oauth: int
    oauth_identities: int


class AdminUserListRowOut(BaseModel):
    id: str
    organization_id: str
    email: str
    display_name: str
    is_admin: bool
    account_status: str
    auth_summary: str
    created_at: datetime
    last_login_at: datetime | None = None
    last_activity_at: datetime | None = None
    access_keys_active: int
    access_keys_total: int
    connections_total: int


class AdminUserListOut(BaseModel):
    ok: bool = True
    users: list[AdminUserListRowOut]
    total: int
    limit: int
    offset: int


class AdminOAuthIdentityOut(BaseModel):
    id: str
    provider_key: str
    subject: str
    issuer: str | None = None
    email: str | None = None
    display_name: str | None = None
    created_at: datetime
    updated_at: datetime


class AdminUserSessionOut(BaseModel):
    id: str
    created_at: datetime
    expires_at: datetime
    is_active: bool


class AdminUserConnectionOut(BaseModel):
    id: str
    integration_instance_id: str
    integration_instance_name: str
    status: str
    has_stored_oauth: bool
    created_at: datetime
    updated_at: datetime


class AdminUserAccessGrantSummaryOut(BaseModel):
    id: str
    integration_instance_id: str
    integration_instance_name: str
    name: str
    key_prefix: str
    status: str
    effective_status: str
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None


class AdminUserDetailOut(BaseModel):
    ok: bool = True
    id: str
    organization_id: str
    email: str
    display_name: str
    is_admin: bool
    account_status: str
    auth_summary: str
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None = None
    last_activity_at: datetime | None = None
    counts: AdminUserLifecycleCountsOut
    oauth_identities: list[AdminOAuthIdentityOut]
    sessions: list[AdminUserSessionOut]
    connections: list[AdminUserConnectionOut]
    access_grants: list[AdminUserAccessGrantSummaryOut]


class AdminUserActionResultOut(BaseModel):
    ok: bool = True
    account_status: str
    sessions_revoked: int = 0
    access_grants_revoked: int = 0
    connections_cleared: int = 0


class AdminUserHardDeleteBody(BaseModel):
    confirm_email: str = Field(min_length=3, max_length=255)


class AdminUserHardDeleteResultOut(BaseModel):
    ok: bool = True
    id: str
