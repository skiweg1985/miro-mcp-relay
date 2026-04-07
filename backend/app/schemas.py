from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class LoginOptionsResponse(BaseModel):
    ok: bool = True
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


class AccessGrantCreate(BaseModel):
    integration_instance_id: str = Field(min_length=1, max_length=36)
    name: str = Field(min_length=1, max_length=255)
    expires_at: datetime | None = None
    allowed_tools: list[str] = Field(default_factory=list)
    user_connection_id: str | None = Field(default=None, max_length=36)
    notes: str | None = Field(default=None, max_length=2000)
    policy_ref: str | None = Field(default=None, max_length=255)

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
    allowed_tools: list[str] = Field(default_factory=list)
    policy_ref: str | None = None
    notes: str | None = None
    created_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None


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
