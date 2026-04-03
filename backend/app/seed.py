from __future__ import annotations

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import Base, engine
from app.models import AccessMode, Organization, ProviderApp, ProviderDefinition, ProviderInstance, ProviderRole, User
from app.security import dumps_json, encrypt_text, hash_secret


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    reconcile_schema()
    settings = get_settings()
    microsoft_authority = f"{settings.microsoft_broker_authority_base.rstrip('/')}/{settings.microsoft_broker_tenant_id.strip('/')}"
    microsoft_redirect_uri = f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/auth/microsoft/callback"
    with Session(engine) as db:
        org = db.scalar(select(Organization).where(Organization.slug == settings.default_org_slug))
        if not org:
            org = Organization(slug=settings.default_org_slug, name=settings.default_org_name)
            db.add(org)
            db.flush()

        admin = db.scalar(select(User).where(User.organization_id == org.id, User.email == settings.bootstrap_admin_email))
        if not admin:
            admin = User(
                organization_id=org.id,
                email=settings.bootstrap_admin_email,
                display_name=settings.bootstrap_admin_display_name,
                password_hash=hash_secret(settings.bootstrap_admin_password),
                is_admin=True,
                is_active=True,
            )
            db.add(admin)

        miro = _ensure_provider_definition(
            db,
            key="miro",
            display_name="Miro",
            protocol="oauth2",
            supports_broker_auth=False,
            supports_downstream_oauth=True,
            metadata={"relay_protocols": ["mcp_streamable_http"]},
        )
        microsoft = _ensure_provider_definition(
            db,
            key="microsoft",
            display_name="Microsoft",
            protocol="oidc+oauth2",
            supports_broker_auth=True,
            supports_downstream_oauth=True,
            metadata={"broker_auth": True, "downstream": ["graph"]},
        )

        miro_instance = _ensure_provider_instance(
            db,
            organization_id=org.id,
            provider_definition_id=miro.id,
            key="miro-downstream",
            display_name="Miro Downstream OAuth",
            role=ProviderRole.DOWNSTREAM_OAUTH.value,
            authorization_endpoint=f"{settings.miro_mcp_base.rstrip('/')}/authorize",
            token_endpoint=f"{settings.miro_mcp_base.rstrip('/')}/token",
        )
        _ensure_provider_app(
            db,
            organization_id=org.id,
            provider_instance_id=miro_instance.id,
            key="miro-default",
            display_name="Miro Relay App",
            access_mode=AccessMode.RELAY.value,
            allow_relay=True,
            allow_direct_token_return=False,
            relay_protocol="mcp_streamable_http",
            default_scopes=settings.miro_scope_list,
            scope_ceiling=settings.miro_scope_list,
        )

        microsoft_auth = _ensure_provider_instance(
            db,
            organization_id=org.id,
            provider_definition_id=microsoft.id,
            key="microsoft-broker-auth",
            display_name="Microsoft Broker Login",
            role=ProviderRole.BROKER_AUTH.value,
            issuer=f"{microsoft_authority}/v2.0",
            authorization_endpoint=f"{microsoft_authority}/oauth2/v2.0/authorize",
            token_endpoint=f"{microsoft_authority}/oauth2/v2.0/token",
        )
        _ensure_provider_app(
            db,
            organization_id=org.id,
            provider_instance_id=microsoft_auth.id,
            key="microsoft-broker-default",
            display_name="Microsoft Broker Login App",
            access_mode=AccessMode.RELAY.value,
            allow_relay=False,
            allow_direct_token_return=False,
            default_scopes=["openid", "profile", "email"],
            scope_ceiling=["openid", "profile", "email"],
            client_id=settings.microsoft_broker_client_id or None,
            client_secret=settings.microsoft_broker_client_secret or None,
            redirect_uris=[microsoft_redirect_uri] if settings.microsoft_broker_client_id else None,
        )

        microsoft_graph = _ensure_provider_instance(
            db,
            organization_id=org.id,
            provider_definition_id=microsoft.id,
            key="microsoft-graph-downstream",
            display_name="Microsoft Graph Downstream OAuth",
            role=ProviderRole.DOWNSTREAM_OAUTH.value,
        )
        _ensure_provider_app(
            db,
            organization_id=org.id,
            provider_instance_id=microsoft_graph.id,
            key="microsoft-graph-default",
            display_name="Microsoft Graph App",
            access_mode=AccessMode.HYBRID.value,
            allow_relay=True,
            allow_direct_token_return=True,
            relay_protocol="rest_proxy",
            default_scopes=["openid", "profile", "email", "offline_access", "Mail.Read"],
            scope_ceiling=["openid", "profile", "email", "offline_access", "Mail.Read", "Calendars.Read", "Files.Read"],
        )

        db.commit()


def reconcile_schema() -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        _ensure_columns(
            conn,
            inspector,
            "connected_accounts",
            {
                "oauth_client_id": "VARCHAR(255)",
                "encrypted_oauth_client_secret": "TEXT",
                "oauth_redirect_uri": "VARCHAR(512)",
                "consented_scopes_json": "TEXT DEFAULT '[]'",
                "last_error": "TEXT",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "token_material",
            {
                "refresh_expires_at": "TIMESTAMP NULL",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "token_issue_events",
            {
                "reason": "VARCHAR(255)",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "service_clients",
            {
                "is_enabled": "BOOLEAN DEFAULT TRUE",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "delegation_grants",
            {
                "is_enabled": "BOOLEAN DEFAULT TRUE",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "users",
            {
                "is_active": "BOOLEAN DEFAULT TRUE",
            },
        )


def _ensure_columns(conn, inspector, table_name: str, columns: dict[str, str]) -> None:
    existing_tables = set(inspector.get_table_names())
    if table_name not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    for column_name, column_sql in columns.items():
        if column_name in existing_columns:
            continue
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))


def _ensure_provider_definition(db: Session, *, key: str, display_name: str, protocol: str, supports_broker_auth: bool, supports_downstream_oauth: bool, metadata: dict) -> ProviderDefinition:
    provider_definition = db.scalar(select(ProviderDefinition).where(ProviderDefinition.key == key))
    if provider_definition:
        return provider_definition
    provider_definition = ProviderDefinition(
        key=key,
        display_name=display_name,
        protocol=protocol,
        supports_broker_auth=supports_broker_auth,
        supports_downstream_oauth=supports_downstream_oauth,
        metadata_json=dumps_json(metadata),
    )
    db.add(provider_definition)
    db.flush()
    return provider_definition


def _ensure_provider_instance(
    db: Session,
    *,
    organization_id: str,
    provider_definition_id: str,
    key: str,
    display_name: str,
    role: str,
    issuer: str | None = None,
    authorization_endpoint: str | None = None,
    token_endpoint: str | None = None,
    userinfo_endpoint: str | None = None,
) -> ProviderInstance:
    provider_instance = db.scalar(select(ProviderInstance).where(ProviderInstance.organization_id == organization_id, ProviderInstance.key == key))
    if provider_instance:
        if issuer:
            provider_instance.issuer = issuer
        if authorization_endpoint:
            provider_instance.authorization_endpoint = authorization_endpoint
        if token_endpoint:
            provider_instance.token_endpoint = token_endpoint
        if userinfo_endpoint:
            provider_instance.userinfo_endpoint = userinfo_endpoint
        return provider_instance
    provider_instance = ProviderInstance(
        organization_id=organization_id,
        provider_definition_id=provider_definition_id,
        key=key,
        display_name=display_name,
        role=role,
        issuer=issuer,
        authorization_endpoint=authorization_endpoint,
        token_endpoint=token_endpoint,
        userinfo_endpoint=userinfo_endpoint,
    )
    db.add(provider_instance)
    db.flush()
    return provider_instance


def _ensure_provider_app(
    db: Session,
    *,
    organization_id: str,
    provider_instance_id: str,
    key: str,
    display_name: str,
    access_mode: str,
    allow_relay: bool,
    allow_direct_token_return: bool,
    default_scopes: list[str],
    scope_ceiling: list[str],
    relay_protocol: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    redirect_uris: list[str] | None = None,
) -> ProviderApp:
    provider_app = db.scalar(select(ProviderApp).where(ProviderApp.organization_id == organization_id, ProviderApp.key == key))
    if provider_app:
        if client_id:
            provider_app.client_id = client_id
        if client_secret:
            provider_app.encrypted_client_secret = encrypt_text(client_secret)
        if redirect_uris:
            provider_app.redirect_uris_json = dumps_json(redirect_uris)
        return provider_app
    provider_app = ProviderApp(
        organization_id=organization_id,
        provider_instance_id=provider_instance_id,
        key=key,
        display_name=display_name,
        client_id=client_id,
        encrypted_client_secret=encrypt_text(client_secret),
        redirect_uris_json=dumps_json(redirect_uris or []),
        default_scopes_json=dumps_json(default_scopes),
        scope_ceiling_json=dumps_json(scope_ceiling),
        access_mode=access_mode,
        allow_relay=allow_relay,
        allow_direct_token_return=allow_direct_token_return,
        relay_protocol=relay_protocol,
    )
    db.add(provider_app)
    db.flush()
    return provider_app
