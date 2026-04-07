from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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
