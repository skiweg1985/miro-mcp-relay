from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
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


class OAuthIdentity(Base):
    """Links an external OAuth subject (e.g. Microsoft) to a local user."""

    __tablename__ = "oauth_identities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider_key: Mapped[str] = mapped_column(String(64), index=True)
    subject: Mapped[str] = mapped_column(String(255), index=True)
    issuer: Mapped[str | None] = mapped_column(String(512), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claims_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (UniqueConstraint("provider_key", "subject", name="uq_oauth_identity_provider_subject"),)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    actor_type: Mapped[str] = mapped_column(String(64))
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(255), index=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class OAuthPendingState(Base):
    __tablename__ = "oauth_pending_states"

    state_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    flow: Mapped[str] = mapped_column(String(64), index=True)
    payload_json: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class MicrosoftOAuthSettings(Base):
    """Tenant-scoped Microsoft Entra (Azure AD) app registration for end-user sign-in."""

    __tablename__ = "microsoft_oauth_settings"
    __table_args__ = (UniqueConstraint("organization_id", name="uq_microsoft_oauth_org"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    authority_base: Mapped[str | None] = mapped_column(String(512), nullable=True)
    tenant_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    encrypted_client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class BrokerLoginProvider(Base):
    """Declarative OIDC/OAuth2 broker login (end-user session), not integration MCP OAuth."""

    __tablename__ = "broker_login_providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    provider_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    display_name: Mapped[str] = mapped_column(String(200))
    client_id: Mapped[str] = mapped_column(String(512))
    encrypted_client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_config_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class IntegrationType(StrEnum):
    MCP_SERVER = "mcp_server"
    OAUTH_PROVIDER = "oauth_provider"
    API = "api"


class AuthMode(StrEnum):
    NONE = "none"
    OAUTH = "oauth"
    API_KEY = "api_key"
    SHARED_CREDENTIALS = "shared_credentials"


class IntegrationAccessMode(StrEnum):
    RELAY = "relay"
    DIRECT = "direct"


class UserConnectionStatus(StrEnum):
    ACTIVE = "active"
    DISCONNECTED = "disconnected"


class AccessGrantStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"
    INVALID = "invalid"


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(64), index=True)
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    # Optional: Microsoft Graph custom Entra app (when graph_oauth_use_broker_defaults is false in config_json)
    oauth_client_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    mcp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class IntegrationInstance(Base):
    __tablename__ = "integration_instances"

    # access_mode / access_config_json describe how the broker exposes this instance (e.g. relay),
    # not end-user consumer credentials. Consumer access is modeled by AccessGrant.
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    integration_id: Mapped[str] = mapped_column(ForeignKey("integrations.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    auth_mode: Mapped[str] = mapped_column(String(64), index=True)
    auth_config_json: Mapped[str] = mapped_column(Text, default="{}")
    access_mode: Mapped[str] = mapped_column(String(64), default=IntegrationAccessMode.RELAY.value)
    access_config_json: Mapped[str] = mapped_column(Text, default="{}")
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class UserConnection(Base):
    """Optional per-user link to a target system for upstream auth (e.g. OAuth token for MCP)."""

    __tablename__ = "user_connections"
    __table_args__ = (UniqueConstraint("user_id", "integration_instance_id", name="uq_user_connection_instance"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    integration_instance_id: Mapped[str] = mapped_column(ForeignKey("integration_instances.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True, default=UserConnectionStatus.ACTIVE.value)
    oauth_access_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    oauth_refresh_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Miro DCR: per-user registered OAuth client (when not using static MIRO_OAUTH_* credentials)
    oauth_dcr_client_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    oauth_dcr_client_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AccessGrant(Base):
    """Broker-issued credential: authorizes a client against this broker for one IntegrationInstance."""

    __tablename__ = "access_grants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    integration_instance_id: Mapped[str] = mapped_column(ForeignKey("integration_instances.id"), index=True)
    user_connection_id: Mapped[str | None] = mapped_column(ForeignKey("user_connections.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    key_prefix: Mapped[str] = mapped_column(String(32), index=True)
    key_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), index=True, default=AccessGrantStatus.ACTIVE.value)
    allowed_tools_json: Mapped[str] = mapped_column(Text, default="[]")
    policy_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # When true, consumer may call POST …/consumer/integration-instances/{id}/token to read upstream OAuth access token.
    direct_token_access_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    usage_count_total: Mapped[int] = mapped_column(Integer, default=0)
    last_usage_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)


class AccessUsageEvent(Base):
    """Structured audit row for broker access key usage (no secrets)."""

    __tablename__ = "access_usage_events"
    __table_args__ = (
        Index("ix_access_usage_events_grant_created", "access_grant_id", "created_at"),
        Index("ix_access_usage_events_org_created", "organization_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    access_grant_id: Mapped[str] = mapped_column(ForeignKey("access_grants.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    integration_instance_id: Mapped[str] = mapped_column(String(36), index=True)
    integration_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_connection_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    usage_type: Mapped[str] = mapped_column(String(64), index=True)
    outcome: Mapped[str] = mapped_column(String(32), index=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    denied_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")


class IntegrationTool(Base):
    __tablename__ = "integration_tools"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    integration_id: Mapped[str] = mapped_column(ForeignKey("integrations.id"), index=True)
    tool_name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_schema_json: Mapped[str] = mapped_column(Text, default="{}")
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (UniqueConstraint("integration_id", "tool_name", name="uq_integration_tool_name"),)
