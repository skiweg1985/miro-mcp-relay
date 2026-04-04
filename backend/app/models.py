from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ProviderRole(StrEnum):
    BROKER_AUTH = "broker_auth"
    DOWNSTREAM_OAUTH = "downstream_oauth"


class AccessMode(StrEnum):
    RELAY = "relay"
    DIRECT_TOKEN = "direct_token"
    HYBRID = "hybrid"


class ServiceAuthMethod(StrEnum):
    SHARED_SECRET = "shared_secret"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (UniqueConstraint("organization_id", "email", name="uq_users_org_email"),)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_token_hash: Mapped[str] = mapped_column(Text, unique=True)
    csrf_token_hash: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ProviderDefinition(Base):
    __tablename__ = "provider_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    protocol: Mapped[str] = mapped_column(String(120))
    supports_broker_auth: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_downstream_oauth: Mapped[bool] = mapped_column(Boolean, default=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ProviderInstance(Base):
    __tablename__ = "provider_instances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    provider_definition_id: Mapped[str] = mapped_column(ForeignKey("provider_definitions.id"))
    key: Mapped[str] = mapped_column(String(120), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(64))
    issuer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    authorization_endpoint: Mapped[str | None] = mapped_column(String(512), nullable=True)
    token_endpoint: Mapped[str | None] = mapped_column(String(512), nullable=True)
    userinfo_endpoint: Mapped[str | None] = mapped_column(String(512), nullable=True)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (UniqueConstraint("organization_id", "key", name="uq_provider_instances_org_key"),)


class ProviderApp(Base):
    __tablename__ = "provider_apps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    provider_instance_id: Mapped[str] = mapped_column(ForeignKey("provider_instances.id"), index=True)
    key: Mapped[str] = mapped_column(String(120), index=True)
    template_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    encrypted_client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    redirect_uris_json: Mapped[str] = mapped_column(Text, default="[]")
    default_scopes_json: Mapped[str] = mapped_column(Text, default="[]")
    scope_ceiling_json: Mapped[str] = mapped_column(Text, default="[]")
    access_mode: Mapped[str] = mapped_column(String(64), default=AccessMode.RELAY.value)
    allow_relay: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_direct_token_return: Mapped[bool] = mapped_column(Boolean, default=False)
    relay_protocol: Mapped[str | None] = mapped_column(String(120), nullable=True)
    relay_config_json: Mapped[str] = mapped_column(Text, default="{}")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (UniqueConstraint("organization_id", "key", name="uq_provider_apps_org_key"),)


class UserAuthIdentity(Base):
    __tablename__ = "user_auth_identities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider_instance_id: Mapped[str] = mapped_column(ForeignKey("provider_instances.id"), index=True)
    issuer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(255), index=True)
    tenant_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    object_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preferred_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claims_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("provider_instance_id", "subject", name="uq_auth_identity_provider_subject"),)


class ConnectedAccount(Base):
    __tablename__ = "connected_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider_app_id: Mapped[str] = mapped_column(ForeignKey("provider_apps.id"), index=True)
    external_account_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    encrypted_oauth_client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    oauth_redirect_uri: Mapped[str | None] = mapped_column(String(512), nullable=True)
    consented_scopes_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(64), default="connected")
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class TokenMaterial(Base):
    __tablename__ = "token_material"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    connected_account_id: Mapped[str] = mapped_column(ForeignKey("connected_accounts.id"), index=True, unique=True)
    encrypted_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scopes_json: Mapped[str] = mapped_column(Text, default="[]")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    refresh_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    key_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ServiceClient(Base):
    __tablename__ = "service_clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    key: Mapped[str] = mapped_column(String(120), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    auth_method: Mapped[str] = mapped_column(String(64), default=ServiceAuthMethod.SHARED_SECRET.value)
    secret_hash: Mapped[str] = mapped_column(Text)
    secret_lookup_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    environment: Mapped[str | None] = mapped_column(String(64), nullable=True)
    allowed_provider_app_keys_json: Mapped[str] = mapped_column(Text, default="[]")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (UniqueConstraint("organization_id", "key", name="uq_service_clients_org_key"),)


class DelegationGrant(Base):
    __tablename__ = "delegation_grants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    service_client_id: Mapped[str | None] = mapped_column(ForeignKey("service_clients.id"), nullable=True, index=True)
    provider_app_id: Mapped[str] = mapped_column(ForeignKey("provider_apps.id"), index=True)
    connected_account_id: Mapped[str | None] = mapped_column(ForeignKey("connected_accounts.id"), nullable=True, index=True)
    credential_hash: Mapped[str] = mapped_column(Text)
    credential_lookup_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    encrypted_delegated_credential: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_access_modes_json: Mapped[str] = mapped_column(Text, default="[]")
    scope_ceiling_json: Mapped[str] = mapped_column(Text, default="[]")
    environment: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class GrantedCapability(Base):
    __tablename__ = "granted_capabilities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    delegation_grant_id: Mapped[str] = mapped_column(ForeignKey("delegation_grants.id"), index=True)
    capability_key: Mapped[str] = mapped_column(String(255))
    scope_hint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class TokenIssueEvent(Base):
    __tablename__ = "token_issue_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    service_client_id: Mapped[str | None] = mapped_column(ForeignKey("service_clients.id"), nullable=True, index=True)
    delegation_grant_id: Mapped[str | None] = mapped_column(ForeignKey("delegation_grants.id"), nullable=True, index=True)
    provider_app_id: Mapped[str | None] = mapped_column(ForeignKey("provider_apps.id"), nullable=True, index=True)
    connected_account_id: Mapped[str | None] = mapped_column(ForeignKey("connected_accounts.id"), nullable=True, index=True)
    decision: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scopes_json: Mapped[str] = mapped_column(Text, default="[]")
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    actor_type: Mapped[str] = mapped_column(String(64))
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(255), index=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    job_type: Mapped[str] = mapped_column(String(128), index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(64), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class OAuthPendingState(Base):
    __tablename__ = "oauth_pending_states"

    state_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    flow: Mapped[str] = mapped_column(String(64), index=True)
    payload_json: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
