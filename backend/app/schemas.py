from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class IntegrationTestRequest(BaseModel):
    template_key: str = Field(min_length=3, max_length=120)


class IntegrationTestOut(BaseModel):
    ok: bool
    message: str


class ProviderDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    protocol: str
    supports_broker_auth: bool
    supports_downstream_oauth: bool
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderInstanceCreate(BaseModel):
    key: str
    display_name: str
    provider_definition_key: str
    role: str
    issuer: str | None = None
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class ProviderInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    provider_definition_key: str
    role: str
    issuer: str | None = None
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool


class ProviderAppCreate(BaseModel):
    provider_instance_key: str
    key: str
    template_key: str | None = None
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
    allowed_connection_types: list[str] | None = None
    relay_config: dict[str, Any] | None = None
    is_enabled: bool = True


class ProviderInstanceUpdate(BaseModel):
    display_name: str
    role: str
    issuer: str | None = None
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class ProviderAppUpdate(BaseModel):
    display_name: str
    template_key: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    redirect_uris: list[str] = Field(default_factory=list)
    default_scopes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    access_mode: str = "relay"
    allow_relay: bool = True
    allow_direct_token_return: bool = False
    relay_protocol: str | None = None
    allowed_connection_types: list[str] | None = None
    relay_config: dict[str, Any] | None = None
    is_enabled: bool = True


class ProviderAppOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    template_key: str | None = None
    display_name: str
    provider_instance_id: str
    provider_instance_key: str | None = None
    access_mode: str
    allow_relay: bool
    allow_direct_token_return: bool
    relay_protocol: str | None = None
    client_id: str | None = None
    has_client_secret: bool = False
    redirect_uris: list[str] = Field(default_factory=list)
    default_scopes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    allowed_connection_types: list[str] = Field(default_factory=list)
    relay_config: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool


class ServiceClientCreate(BaseModel):
    key: str | None = None
    display_name: str = Field(min_length=1, max_length=255)
    environment: str | None = None
    allowed_provider_app_keys: list[str] = Field(default_factory=list)
    client_secret: str | None = None


class ServiceClientUpdate(BaseModel):
    display_name: str | None = None
    environment: str | None = None
    allowed_provider_app_keys: list[str] | None = None
    is_enabled: bool | None = None


class ServiceClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    display_name: str
    auth_method: str
    environment: str | None = None
    is_enabled: bool
    created_at: datetime
    allowed_provider_app_keys: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _coerce_from_service_client(cls, data: Any) -> Any:
        from app.models import ServiceClient
        from app.security import loads_json

        if isinstance(data, ServiceClient):
            return {
                "id": data.id,
                "key": data.key,
                "display_name": data.display_name,
                "auth_method": data.auth_method,
                "environment": data.environment,
                "is_enabled": data.is_enabled,
                "created_at": data.created_at,
                "allowed_provider_app_keys": loads_json(data.allowed_provider_app_keys_json, []),
            }
        return data


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
    access_token_expires_at: datetime | None = None
    refresh_token_expires_at: datetime | None = None
    refresh_token_available: bool = False
    token_material_updated_at: datetime | None = None


class MiroConnectStartRequest(BaseModel):
    user_email: str | None = None
    connected_account_id: str | None = None


class MiroConnectStartResponse(BaseModel):
    ok: bool = True
    auth_url: str
    state: str


class ProviderConnectStartRequest(BaseModel):
    provider_app_key: str
    connected_account_id: str | None = None


class ProviderConnectStartResponse(BaseModel):
    ok: bool = True
    auth_url: str
    state: str
    provider_app_key: str


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


class AccessDetailRowOut(BaseModel):
    label: str
    value: str | None = None
    copyable: bool = False
    monospace: bool = False


class AccessCredentialKeyOut(BaseModel):
    status: str
    label: str = "Access key"
    masked_hint: str | None = None
    plaintext: str | None = None


class AccessCopyBlockOut(BaseModel):
    title: str
    body: str
    value: str


class ConnectionAccessDetailsOut(BaseModel):
    ok: bool = True
    supported: bool
    connected_account_id: str
    provider_app_key: str = ""
    provider_display_name: str | None = None
    connection_type_label: str | None = None
    section_title: str | None = None
    connection_summary: str | None = None
    connection_status_label: str | None = None
    rows: list[AccessDetailRowOut] = Field(default_factory=list)
    key_section: AccessCredentialKeyOut | None = None
    extra_blocks: list[AccessCopyBlockOut] = Field(default_factory=list)
    can_rotate: bool = False
    manage_path: str | None = None


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
    service_client_key: str | None = None
    provider_app_key: str
    connected_account_id: str | None = None
    allowed_access_modes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    environment: str | None = None
    expires_in_days: int = Field(default=365, ge=1, le=365)
    capabilities: list[str] = Field(default_factory=list)


class DelegationGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    service_client_id: str | None = None
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
    access_credential: str


class SelfServiceDelegationGrantCreate(BaseModel):
    service_client_key: str | None = None
    provider_app_key: str
    connected_account_id: str | None = None
    allowed_access_modes: list[str] = Field(default_factory=list)
    scope_ceiling: list[str] = Field(default_factory=list)
    environment: str | None = None
    expires_in_days: int = Field(default=365, ge=1, le=365)
    capabilities: list[str] = Field(default_factory=list)


class SelfServiceDelegationGrantOut(BaseModel):
    id: str
    service_client_id: str | None = None
    service_client_key: str | None = None
    service_client_display_name: str | None = None
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
    access_credential: str


class AccessCredentialRotateOut(BaseModel):
    ok: bool = True
    access_credential: str


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
