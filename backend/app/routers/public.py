from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Organization, ProviderDefinition, ProviderInstance
from app.provider_templates import MICROSOFT_BROKER_LOGIN_TEMPLATE, get_provider_app_by_template, serialize_json_field
from app.core.config import get_settings
from app.schemas import BrokerCallbackUrlsOut, LoginOptionsResponse, ProviderDefinitionOut

router = APIRouter(tags=["public"])


@router.get("/health")
def health():
    return {"ok": True, "service": "oauth-broker-backend"}


@router.get("/broker-callback-urls", response_model=BrokerCallbackUrlsOut)
def broker_callback_urls():
    settings = get_settings()
    base = settings.broker_public_base_url.rstrip("/")
    api = settings.api_v1_prefix
    return BrokerCallbackUrlsOut(
        microsoft_login=f"{base}{api}/auth/microsoft/callback",
        microsoft_graph=f"{base}{api}/connections/microsoft-graph/callback",
        miro=f"{base}{api}/connections/miro/callback",
        custom_oauth=f"{base}{api}/connections/provider-oauth/callback",
    )


@router.get("/provider-definitions", response_model=list[ProviderDefinitionOut])
def list_provider_definitions(db: Session = Depends(get_db)):
    definitions = db.scalars(select(ProviderDefinition).order_by(ProviderDefinition.display_name.asc())).all()
    return [
        ProviderDefinitionOut(
            id=definition.id,
            key=definition.key,
            display_name=definition.display_name,
            protocol=definition.protocol,
            supports_broker_auth=definition.supports_broker_auth,
            supports_downstream_oauth=definition.supports_downstream_oauth,
            metadata=serialize_json_field(definition.metadata_json, {}),
        )
        for definition in definitions
    ]


@router.get("/auth/login-options", response_model=LoginOptionsResponse)
def login_options(db: Session = Depends(get_db)):
    provider_definition = db.scalar(select(ProviderDefinition).where(ProviderDefinition.key == "microsoft"))
    microsoft_display_name = "Microsoft"
    if provider_definition:
        microsoft_display_name = provider_definition.display_name

    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    broker_login = None
    provider_instance = None
    if org:
        broker_login = get_provider_app_by_template(
            db,
            organization_id=org.id,
            template_key=MICROSOFT_BROKER_LOGIN_TEMPLATE,
        )
        provider_instance = db.get(ProviderInstance, broker_login.provider_instance_id) if broker_login else None
    return LoginOptionsResponse(
        microsoft_enabled=bool(
            broker_login
            and broker_login.client_id
            and broker_login.encrypted_client_secret
            and provider_instance
            and provider_instance.authorization_endpoint
            and provider_instance.token_endpoint
        ),
        microsoft_display_name=broker_login.display_name if broker_login else microsoft_display_name,
    )
