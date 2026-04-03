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


class ProviderDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    protocol: str
    supports_broker_auth: bool
    supports_downstream_oauth: bool


class ProviderInstanceCreate(BaseModel):
    key: str
    display_name: str
    provider_definition_key: str
    role: str
    issuer: str | None = None
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    is_enabled: bool = True


class ProviderInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    role: str
    issuer: str | None = None
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    is_enabled: bool


class ProviderAppCreate(BaseModel):
    provider_instance_key: str
    key: str
    display_name: str
    client_id: str | None = None
    client_secret: str | None = None
    redirect_uris: list[str] = Field(default_factory=list)
    default_scopes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    access_mode: str = "relay"
    allow_relay: bool = True
    allow_direct_token_return: bool = False
    relay_protocol: str | None = None
    is_enabled: bool = True


class ProviderAppOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    provider_instance_id: str
    access_mode: str
    allow_relay: bool
    allow_direct_token_return: bool
    relay_protocol: str | None = None
    is_enabled: bool


class ServiceClientCreate(BaseModel):
    key: str
    display_name: str
    environment: str | None = None
    allowed_provider_app_keys: list[str] = Field(default_factory=list)


class ServiceClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    auth_method: str
    environment: str | None = None
    is_enabled: bool
    created_at: datetime


class ServiceClientSecretResponse(BaseModel):
    ok: bool = True
    service_client: ServiceClientOut
    client_secret: str


class ConnectedAccountCreate(BaseModel):
    user_email: str
    provider_app_key: str
    external_account_ref: str | None = None
    external_email: str | None = None
    display_name: str | None = None
    consented_scopes: list[str] = Field(default_factory=list)
    access_token: str
    refresh_token: str | None = None
    token_type: str | None = "Bearer"
    expires_at: datetime | None = None
    refresh_expires_at: datetime | None = None
    oauth_client_id: str | None = None
    oauth_client_secret: str | None = None
    oauth_redirect_uri: str | None = None


class ConnectedAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    provider_app_id: str
    external_account_ref: str | None = None
    external_email: str | None = None
    display_name: str | None = None
    status: str
    last_error: str | None = None
    connected_at: datetime


class MiroConnectStartRequest(BaseModel):
    user_email: str | None = None
    connected_account_id: str | None = None


class MiroConnectStartResponse(BaseModel):
    ok: bool = True
    auth_url: str
    state: str


class ConnectionProbeResponse(BaseModel):
    ok: bool
    status: str
    connected_account_id: str
    provider_app_key: str
    checked_at: datetime
    refreshed: bool = False
    message: str | None = None
    external_user_id: str | None = None
    external_user_name: str | None = None


class MiroMigrationStatus(BaseModel):
    ok: bool = True
    legacy_profiles: int
    imported_users: int
    imported_miro_connections: int
    migrated_profile_ids: list[str] = Field(default_factory=list)


class MiroMigrationImportResponse(BaseModel):
    ok: bool = True
    imported_users: int
    imported_connections: int
    skipped_profiles: list[str] = Field(default_factory=list)
    migrated_profile_ids: list[str] = Field(default_factory=list)


class DelegationGrantCreate(BaseModel):
    user_email: str
    service_client_key: str
    provider_app_key: str
    connected_account_id: str | None = None
    allowed_access_modes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    environment: str | None = None
    expires_in_hours: int = Field(default=24, ge=1, le=24 * 365)
    capabilities: list[str] = Field(default_factory=list)


class DelegationGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    service_client_id: str
    provider_app_id: str
    connected_account_id: str | None = None
    environment: str | None = None
    is_enabled: bool
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime


class DelegationGrantSecretResponse(BaseModel):
    ok: bool = True
    delegation_grant: DelegationGrantOut
    delegated_credential: str


class VisibleServiceClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    environment: str | None = None
    created_at: datetime


class SelfServiceDelegationGrantCreate(BaseModel):
    service_client_key: str
    provider_app_key: str
    connected_account_id: str | None = None
    allowed_access_modes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    environment: str | None = None
    expires_in_hours: int = Field(default=24, ge=1, le=24 * 365)
    capabilities: list[str] = Field(default_factory=list)


class SelfServiceDelegationGrantOut(BaseModel):
    id: str
    service_client_id: str
    service_client_key: str
    service_client_display_name: str
    provider_app_id: str
    provider_app_key: str
    provider_app_display_name: str
    connected_account_id: str | None = None
    connected_account_display_name: str | None = None
    allowed_access_modes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    environment: str | None = None
    is_enabled: bool
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime


class SelfServiceDelegationGrantSecretResponse(BaseModel):
    ok: bool = True
    delegation_grant: SelfServiceDelegationGrantOut
    delegated_credential: str


class ProviderAccessIssueRequest(BaseModel):
    provider_app_key: str
    connected_account_id: str | None = None
    requested_scopes: list[str] = Field(default_factory=list)


class ProviderAccessIssueResponse(BaseModel):
    ok: bool = True
    provider_app_key: str
    connected_account_id: str
    access_token: str
    token_type: str | None = None
    expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)
    audit_event_id: str


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_type: str
    actor_id: str | None = None
    action: str
    metadata_json: str
    created_at: datetime


class TokenIssueEventOut(BaseModel):
    id: str
    service_client_id: str | None = None
    service_client_display_name: str | None = None
    delegation_grant_id: str | None = None
    provider_app_id: str | None = None
    provider_app_display_name: str | None = None
    connected_account_id: str | None = None
    connected_account_display_name: str | None = None
    decision: str
    reason: str | None = None
    scopes: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
