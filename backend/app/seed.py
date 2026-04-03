from __future__ import annotations

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import Base, engine
from app.models import Organization, ProviderApp, ProviderDefinition, ProviderInstance, User
from app.provider_templates import (
    MICROSOFT_BROKER_LOGIN_TEMPLATE,
    MICROSOFT_GRAPH_DIRECT_TEMPLATE,
    MIRO_RELAY_TEMPLATE,
    dump_settings,
    provider_definition_metadata,
)
from app.security import dumps_json, hash_secret


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    reconcile_schema()
    settings = get_settings()
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

        definition_metadata = provider_definition_metadata()
        miro = _ensure_provider_definition(
            db,
            key="miro",
            display_name="Miro",
            protocol="oauth2",
            supports_broker_auth=False,
            supports_downstream_oauth=True,
            metadata=definition_metadata.get("miro", {}),
        )
        microsoft = _ensure_provider_definition(
            db,
            key="microsoft",
            display_name="Microsoft",
            protocol="oidc+oauth2",
            supports_broker_auth=True,
            supports_downstream_oauth=True,
            metadata=definition_metadata.get("microsoft", {}),
        )

        _backfill_legacy_templates(db, organization_id=org.id, miro_definition_id=miro.id, microsoft_definition_id=microsoft.id)
        db.commit()


def reconcile_schema() -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        _ensure_columns(
            conn,
            inspector,
            "provider_instances",
            {
                "settings_json": "TEXT DEFAULT '{}'",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "provider_apps",
            {
                "template_key": "VARCHAR(120)",
            },
        )
        _ensure_columns(
            conn,
            inspector,
            "connected_accounts",
            {
                "legacy_profile_id": "VARCHAR(255)",
                "legacy_relay_token_hash": "TEXT",
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


def _ensure_provider_definition(
    db: Session,
    *,
    key: str,
    display_name: str,
    protocol: str,
    supports_broker_auth: bool,
    supports_downstream_oauth: bool,
    metadata: dict,
) -> ProviderDefinition:
    provider_definition = db.scalar(select(ProviderDefinition).where(ProviderDefinition.key == key))
    if provider_definition:
        provider_definition.display_name = display_name
        provider_definition.protocol = protocol
        provider_definition.supports_broker_auth = supports_broker_auth
        provider_definition.supports_downstream_oauth = supports_downstream_oauth
        provider_definition.metadata_json = dumps_json(metadata)
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


def _backfill_legacy_templates(db: Session, *, organization_id: str, miro_definition_id: str, microsoft_definition_id: str) -> None:
    provider_instances = db.scalars(select(ProviderInstance).where(ProviderInstance.organization_id == organization_id)).all()
    provider_apps = db.scalars(select(ProviderApp).where(ProviderApp.organization_id == organization_id)).all()

    for provider_instance in provider_instances:
        if provider_instance.key in {"microsoft-broker-auth", "microsoft-graph-downstream"} and not provider_instance.settings_json:
            provider_instance.settings_json = dump_settings({"tenant_id": "common"})

    for provider_app in provider_apps:
        if provider_app.key == "miro-default" and not provider_app.template_key:
            provider_app.template_key = MIRO_RELAY_TEMPLATE
        elif provider_app.key == "microsoft-broker-default" and not provider_app.template_key:
            provider_app.template_key = MICROSOFT_BROKER_LOGIN_TEMPLATE
        elif provider_app.key == "microsoft-graph-default" and not provider_app.template_key:
            provider_app.template_key = MICROSOFT_GRAPH_DIRECT_TEMPLATE

        provider_instance = db.get(ProviderInstance, provider_app.provider_instance_id)
        if not provider_instance:
            continue
        if provider_app.template_key == MIRO_RELAY_TEMPLATE:
            provider_instance.provider_definition_id = miro_definition_id
        elif provider_app.template_key in {MICROSOFT_BROKER_LOGIN_TEMPLATE, MICROSOFT_GRAPH_DIRECT_TEMPLATE}:
            provider_instance.provider_definition_id = microsoft_definition_id
