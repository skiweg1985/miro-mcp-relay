from __future__ import annotations

from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import record_audit, require_admin, require_csrf
from app.miro import import_legacy_miro_data, migration_status
from app.connection_serializers import serialize_connected_account
from app.models import AuditEvent, ConnectedAccount, DelegationGrant, GrantedCapability, ProviderApp, ProviderDefinition, ProviderInstance, ServiceClient, TokenIssueEvent, TokenMaterial, User
from app.provider_app_delete import (
    count_active_delegation_grants,
    count_blocking_connected_accounts,
    count_pending_oauth_flows_for_app,
    force_clear_provider_app_dependencies,
    freed_key_after_soft_delete,
    maybe_disable_orphaned_provider_instance,
)
from app.provider_templates import (
    MICROSOFT_BROKER_LOGIN_TEMPLATE,
    MICROSOFT_GRAPH_DIRECT_TEMPLATE,
    MIRO_RELAY_TEMPLATE,
    dump_settings,
    enforce_singleton_template,
    get_provider_app_by_template,
    normalize_instance_settings,
    serialize_json_field,
    validate_template_assignment,
)
from app.schemas import (
    AuditEventOut,
    ConnectedAccountCreate,
    ConnectedAccountOut,
    DelegationGrantCreate,
    DelegationGrantOut,
    DelegationGrantSecretResponse,
    IntegrationDeleteConflictDetail,
    IntegrationTestOut,
    IntegrationTestRequest,
    MiroMigrationImportResponse,
    MiroMigrationStatus,
    ProviderAppCreate,
    ProviderAppOut,
    ProviderInstanceCreate,
    ProviderInstanceOut,
    ProviderAppUpdate,
    ProviderInstanceUpdate,
    ServiceClientOut,
    TokenIssueEventOut,
    UserOut,
)
from app.relay_config import (
    effective_allowed_connection_types,
    relay_config_from_storage,
    sync_legacy_access_fields_from_relay,
    update_relay_json_allowed_types_from_legacy_columns,
)
from app.security import dumps_json, encrypt_text, hash_secret, issue_plain_secret, loads_json, lookup_secret_hash, utcnow

router = APIRouter(prefix="/admin", tags=["admin"])


def _provider_instance_out(provider_instance: ProviderInstance, provider_definition_key: str) -> ProviderInstanceOut:
    return ProviderInstanceOut(
        id=provider_instance.id,
        key=provider_instance.key,
        display_name=provider_instance.display_name,
        provider_definition_key=provider_definition_key,
        role=provider_instance.role,
        issuer=provider_instance.issuer,
        authorization_endpoint=provider_instance.authorization_endpoint,
        token_endpoint=provider_instance.token_endpoint,
        userinfo_endpoint=provider_instance.userinfo_endpoint,
        settings=serialize_json_field(provider_instance.settings_json, {}),
        is_enabled=provider_instance.is_enabled,
    )


def _provider_app_out(provider_app: ProviderApp, provider_instance: ProviderInstance | None) -> ProviderAppOut:
    return ProviderAppOut(
        id=provider_app.id,
        key=provider_app.key,
        template_key=provider_app.template_key,
        display_name=provider_app.display_name,
        provider_instance_id=provider_app.provider_instance_id,
        provider_instance_key=provider_instance.key if provider_instance else None,
        access_mode=provider_app.access_mode,
        allow_relay=provider_app.allow_relay,
        allow_direct_token_return=provider_app.allow_direct_token_return,
        relay_protocol=provider_app.relay_protocol,
        client_id=provider_app.client_id,
        has_client_secret=bool(provider_app.encrypted_client_secret),
        redirect_uris=loads_json(provider_app.redirect_uris_json, []),
        default_scopes=loads_json(provider_app.default_scopes_json, []),
        scope_ceiling=loads_json(provider_app.scope_ceiling_json, []),
        allowed_connection_types=effective_allowed_connection_types(provider_app),
        relay_config=relay_config_from_storage(provider_app),
        is_enabled=provider_app.is_enabled,
        oauth_authorization_endpoint=provider_instance.authorization_endpoint if provider_instance else None,
        oauth_token_endpoint=provider_instance.token_endpoint if provider_instance else None,
        oauth_userinfo_endpoint=provider_instance.userinfo_endpoint if provider_instance else None,
        oauth_instance_settings=loads_json(provider_instance.settings_json, {}) if provider_instance else {},
        oauth_dynamic_client_registration_enabled=bool(provider_app.oauth_dynamic_client_registration_enabled),
        oauth_registration_endpoint=provider_app.oauth_registration_endpoint,
        oauth_registration_auth_method=str(provider_app.oauth_registration_auth_method or "none"),
    )


def _apply_provider_instance_payload(
    provider_instance: ProviderInstance,
    *,
    provider_definition: ProviderDefinition,
    display_name: str,
    role: str,
    issuer: str | None,
    authorization_endpoint: str | None,
    token_endpoint: str | None,
    userinfo_endpoint: str | None,
    settings: dict,
    is_enabled: bool,
) -> None:
    normalized_settings, derived = normalize_instance_settings(provider_definition.key, settings)
    provider_instance.display_name = display_name
    provider_instance.role = role
    provider_instance.issuer = derived["issuer"] if derived["issuer"] else issuer
    provider_instance.authorization_endpoint = (
        derived["authorization_endpoint"] if derived["authorization_endpoint"] else authorization_endpoint
    )
    provider_instance.token_endpoint = derived["token_endpoint"] if derived["token_endpoint"] else token_endpoint
    provider_instance.userinfo_endpoint = userinfo_endpoint
    provider_instance.settings_json = dump_settings(normalized_settings)
    provider_instance.is_enabled = is_enabled


def _apply_provider_app_payload(
    provider_app: ProviderApp,
    *,
    template_key: str | None,
    display_name: str,
    client_id: str | None,
    client_secret: str | None,
    clear_client_secret: bool = False,
    redirect_uris: list[str],
    default_scopes: list[str],
    scope_ceiling: list[str],
    access_mode: str,
    allow_relay: bool,
    allow_direct_token_return: bool,
    relay_protocol: str | None,
    is_enabled: bool,
    oauth_dynamic_client_registration_enabled: bool = False,
    oauth_registration_endpoint: str | None = None,
    oauth_registration_auth_method: str = "none",
) -> None:
    provider_app.template_key = template_key
    provider_app.display_name = display_name
    provider_app.client_id = client_id
    if clear_client_secret:
        provider_app.encrypted_client_secret = None
    elif client_secret:
        provider_app.encrypted_client_secret = encrypt_text(client_secret)
    provider_app.redirect_uris_json = dumps_json(redirect_uris)
    provider_app.default_scopes_json = dumps_json(default_scopes)
    provider_app.scope_ceiling_json = dumps_json(scope_ceiling)
    provider_app.access_mode = access_mode
    provider_app.allow_relay = allow_relay
    provider_app.allow_direct_token_return = allow_direct_token_return
    provider_app.relay_protocol = relay_protocol
    provider_app.is_enabled = is_enabled
    provider_app.oauth_dynamic_client_registration_enabled = oauth_dynamic_client_registration_enabled
    provider_app.oauth_registration_endpoint = (oauth_registration_endpoint or "").strip() or None
    provider_app.oauth_registration_auth_method = (oauth_registration_auth_method or "none").strip() or "none"


def _finalize_provider_app_relay(
    provider_app: ProviderApp,
    *,
    allowed_connection_types: list[str] | None,
    relay_config: dict | None,
) -> None:
    if allowed_connection_types is not None or relay_config is not None:
        raw = loads_json(provider_app.relay_config_json or "{}", {})
        if relay_config:
            raw.update(relay_config)
        if allowed_connection_types is not None:
            raw["allowed_connection_types"] = allowed_connection_types
        provider_app.relay_config_json = dumps_json(raw)
    else:
        update_relay_json_allowed_types_from_legacy_columns(provider_app)
    sync_legacy_access_fields_from_relay(provider_app)


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(require_csrf)])
def list_users(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(User).where(User.organization_id == _admin.organization_id).order_by(User.created_at.desc())).all()


@router.get("/provider-instances", response_model=list[ProviderInstanceOut], dependencies=[Depends(require_csrf)])
def list_provider_instances(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    provider_instances = db.scalars(select(ProviderInstance).where(ProviderInstance.organization_id == _admin.organization_id).order_by(ProviderInstance.display_name.asc())).all()
    provider_definitions = {
        definition.id: definition
        for definition in db.scalars(select(ProviderDefinition)).all()
    }
    return [
        _provider_instance_out(
            provider_instance,
            provider_definitions.get(provider_instance.provider_definition_id).key
            if provider_instance.provider_definition_id in provider_definitions
            else "",
        )
        for provider_instance in provider_instances
    ]


@router.post("/provider-instances", response_model=ProviderInstanceOut, dependencies=[Depends(require_csrf)])
def create_provider_instance(payload: ProviderInstanceCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    provider_definition = db.scalar(
        select(ProviderDefinition).where(ProviderDefinition.key == payload.provider_definition_key)
    )
    if not provider_definition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider definition not found")

    provider_instance = ProviderInstance(
        organization_id=admin.organization_id,
        provider_definition_id=provider_definition.id,
        key=payload.key,
    )
    _apply_provider_instance_payload(
        provider_instance,
        provider_definition=provider_definition,
        display_name=payload.display_name,
        role=payload.role,
        issuer=payload.issuer,
        authorization_endpoint=payload.authorization_endpoint,
        token_endpoint=payload.token_endpoint,
        userinfo_endpoint=payload.userinfo_endpoint,
        settings=payload.settings,
        is_enabled=payload.is_enabled,
    )
    db.add(provider_instance)
    record_audit(db, action="admin.provider_instance.created", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"key": payload.key})
    db.commit()
    db.refresh(provider_instance)
    return _provider_instance_out(provider_instance, provider_definition.key)


@router.patch("/provider-instances/{provider_instance_id}", response_model=ProviderInstanceOut, dependencies=[Depends(require_csrf)])
def update_provider_instance(
    provider_instance_id: str,
    payload: ProviderInstanceUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    provider_instance = db.get(ProviderInstance, provider_instance_id)
    if not provider_instance or provider_instance.organization_id != admin.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider instance not found")
    provider_definition = db.get(ProviderDefinition, provider_instance.provider_definition_id)
    if not provider_definition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider definition not found")
    _apply_provider_instance_payload(
        provider_instance,
        provider_definition=provider_definition,
        display_name=payload.display_name,
        role=payload.role,
        issuer=payload.issuer,
        authorization_endpoint=payload.authorization_endpoint,
        token_endpoint=payload.token_endpoint,
        userinfo_endpoint=payload.userinfo_endpoint,
        settings=payload.settings,
        is_enabled=payload.is_enabled,
    )
    record_audit(
        db,
        action="admin.provider_instance.updated",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata={"provider_instance_id": provider_instance.id, "key": provider_instance.key},
    )
    db.commit()
    db.refresh(provider_instance)
    return _provider_instance_out(provider_instance, provider_definition.key)


@router.get("/provider-apps", response_model=list[ProviderAppOut], dependencies=[Depends(require_csrf)])
def list_provider_apps(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    provider_apps = db.scalars(
        select(ProviderApp)
        .where(ProviderApp.organization_id == _admin.organization_id, ProviderApp.deleted_at.is_(None))
        .order_by(ProviderApp.created_at.desc())
    ).all()
    provider_instances = {
        instance.id: instance
        for instance in db.scalars(select(ProviderInstance).where(ProviderInstance.organization_id == _admin.organization_id)).all()
    }
    return [_provider_app_out(provider_app, provider_instances.get(provider_app.provider_instance_id)) for provider_app in provider_apps]


@router.post("/provider-apps", response_model=ProviderAppOut, dependencies=[Depends(require_csrf)])
def create_provider_app(payload: ProviderAppCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    provider_instance = db.scalar(
        select(ProviderInstance).where(
            ProviderInstance.organization_id == admin.organization_id,
            ProviderInstance.key == payload.provider_instance_key,
        )
    )
    if not provider_instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider instance not found")
    provider_definition = db.get(ProviderDefinition, provider_instance.provider_definition_id)
    if not provider_definition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider definition not found")
    validate_template_assignment(payload.template_key, provider_definition.key)
    enforce_singleton_template(db, organization_id=admin.organization_id, template_key=payload.template_key)

    provider_app = ProviderApp(
        organization_id=admin.organization_id,
        provider_instance_id=provider_instance.id,
        key=payload.key,
    )
    _apply_provider_app_payload(
        provider_app,
        template_key=payload.template_key,
        display_name=payload.display_name,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        clear_client_secret=False,
        redirect_uris=payload.redirect_uris,
        default_scopes=payload.default_scopes,
        scope_ceiling=payload.scope_ceiling,
        access_mode=payload.access_mode,
        allow_relay=payload.allow_relay,
        allow_direct_token_return=payload.allow_direct_token_return,
        relay_protocol=payload.relay_protocol,
        is_enabled=payload.is_enabled,
        oauth_dynamic_client_registration_enabled=payload.oauth_dynamic_client_registration_enabled,
        oauth_registration_endpoint=payload.oauth_registration_endpoint,
        oauth_registration_auth_method=payload.oauth_registration_auth_method,
    )
    _finalize_provider_app_relay(
        provider_app,
        allowed_connection_types=payload.allowed_connection_types,
        relay_config=payload.relay_config,
    )
    db.add(provider_app)
    record_audit(db, action="admin.provider_app.created", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"key": payload.key})
    db.commit()
    db.refresh(provider_app)
    return _provider_app_out(provider_app, provider_instance)


@router.patch("/provider-apps/{provider_app_id}", response_model=ProviderAppOut, dependencies=[Depends(require_csrf)])
def update_provider_app(
    provider_app_id: str,
    payload: ProviderAppUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    provider_app = db.get(ProviderApp, provider_app_id)
    if not provider_app or provider_app.organization_id != admin.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")
    if provider_app.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")
    provider_instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not provider_instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider instance not found")
    provider_definition = db.get(ProviderDefinition, provider_instance.provider_definition_id)
    if not provider_definition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider definition not found")
    validate_template_assignment(payload.template_key, provider_definition.key)
    enforce_singleton_template(
        db,
        organization_id=admin.organization_id,
        template_key=payload.template_key,
        current_app_id=provider_app.id,
    )
    _apply_provider_app_payload(
        provider_app,
        template_key=payload.template_key,
        display_name=payload.display_name,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        clear_client_secret=payload.clear_client_secret,
        redirect_uris=payload.redirect_uris,
        default_scopes=payload.default_scopes,
        scope_ceiling=payload.scope_ceiling,
        access_mode=payload.access_mode,
        allow_relay=payload.allow_relay,
        allow_direct_token_return=payload.allow_direct_token_return,
        relay_protocol=payload.relay_protocol,
        is_enabled=payload.is_enabled,
        oauth_dynamic_client_registration_enabled=payload.oauth_dynamic_client_registration_enabled,
        oauth_registration_endpoint=payload.oauth_registration_endpoint,
        oauth_registration_auth_method=payload.oauth_registration_auth_method,
    )
    _finalize_provider_app_relay(
        provider_app,
        allowed_connection_types=payload.allowed_connection_types,
        relay_config=payload.relay_config,
    )
    record_audit(
        db,
        action="admin.provider_app.updated",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata={"provider_app_id": provider_app.id, "key": provider_app.key},
    )
    db.commit()
    db.refresh(provider_app)
    return _provider_app_out(provider_app, provider_instance)


@router.delete("/provider-apps/{provider_app_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)])
def delete_provider_app(
    provider_app_id: str,
    force: bool = Query(default=False, description="Revoke related grants and connections, then soft-delete"),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    provider_app = db.get(ProviderApp, provider_app_id)
    if not provider_app or provider_app.organization_id != admin.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")
    if provider_app.deleted_at is not None:
        return None
    if provider_app.template_key is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Built-in template integrations cannot be removed with this action",
        )

    cleared: dict[str, int] | None = None
    if force:
        cleared = force_clear_provider_app_dependencies(
            db,
            provider_app_id=provider_app.id,
            organization_id=admin.organization_id,
        )

    grants = count_active_delegation_grants(db, provider_app_id=provider_app.id)
    connections = count_blocking_connected_accounts(db, provider_app_id=provider_app.id)
    pending_oauth = count_pending_oauth_flows_for_app(db, provider_app_id=provider_app.id)
    if grants or connections or pending_oauth:
        detail = IntegrationDeleteConflictDetail(
            message="Integration is still in use; revoke access rules, disconnect accounts, or wait for OAuth flows to finish.",
            active_delegation_grants=grants,
            active_connected_accounts=connections,
            pending_oauth_flows=pending_oauth,
        )
        record_audit(
            db,
            action="admin.integration.delete.blocked",
            actor_type="user",
            actor_id=admin.id,
            organization_id=admin.organization_id,
            metadata={
                "org_id": admin.organization_id,
                "provider_app_id": provider_app.id,
                "template_key": provider_app.template_key,
                "active_delegation_grants": grants,
                "active_connected_accounts": connections,
                "pending_oauth_flows": pending_oauth,
            },
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail.model_dump())

    instance_id = provider_app.provider_instance_id
    previous_key = provider_app.key
    provider_app.key = freed_key_after_soft_delete(previous_key=previous_key, provider_app_id=provider_app.id)
    provider_app.is_enabled = False
    provider_app.deleted_at = utcnow()
    provider_app.encrypted_client_secret = None

    maybe_disable_orphaned_provider_instance(db, provider_instance_id=instance_id)

    record_audit(
        db,
        action="admin.integration.deleted",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata={
            "org_id": admin.organization_id,
            "provider_app_id": provider_app.id,
            "template_key": provider_app.template_key,
            "deletion_kind": "soft",
            "provider_instance_id": instance_id,
            "previous_key": previous_key,
            "force": bool(force),
            "cleared_dependencies": cleared,
        },
    )
    db.commit()
    return None


@router.get("/service-clients", response_model=list[ServiceClientOut], dependencies=[Depends(require_csrf)])
def list_service_clients(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(
        select(ServiceClient).where(ServiceClient.organization_id == _admin.organization_id).order_by(ServiceClient.created_at.desc())
    ).all()


@router.get("/users/{user_id}/service-clients", response_model=list[ServiceClientOut], dependencies=[Depends(require_csrf)])
def list_service_clients_for_user(user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    subject = db.get(User, user_id)
    if not subject or subject.organization_id != admin.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return db.scalars(
        select(ServiceClient).where(
            ServiceClient.organization_id == admin.organization_id,
            ServiceClient.created_by_user_id == user_id,
        ).order_by(ServiceClient.display_name.asc())
    ).all()


@router.get("/connected-accounts", response_model=list[ConnectedAccountOut], dependencies=[Depends(require_csrf)])
def list_connected_accounts(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_email: str | None = None,
    provider_app_key: str | None = None,
    status: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
):
    query = select(ConnectedAccount).where(ConnectedAccount.organization_id == admin.organization_id)
    if user_email:
        user = db.scalar(select(User).where(User.organization_id == admin.organization_id, User.email == user_email))
        if not user:
            return []
        query = query.where(ConnectedAccount.user_id == user.id)
    if provider_app_key:
        provider_app = db.scalar(
            select(ProviderApp).where(ProviderApp.organization_id == admin.organization_id, ProviderApp.key == provider_app_key)
        )
        if not provider_app:
            return []
        query = query.where(ConnectedAccount.provider_app_id == provider_app.id)
    if status:
        query = query.where(ConnectedAccount.status == status)
    connections = db.scalars(query.order_by(ConnectedAccount.connected_at.desc()).limit(limit)).all()
    return [serialize_connected_account(db, connection) for connection in connections]


@router.post("/connected-accounts/manual", response_model=ConnectedAccountOut, dependencies=[Depends(require_csrf)])
def create_connected_account(payload: ConnectedAccountCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.scalar(
        select(User).where(User.organization_id == admin.organization_id, User.email == payload.user_email.strip().lower())
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    provider_app = db.scalar(
        select(ProviderApp).where(ProviderApp.organization_id == admin.organization_id, ProviderApp.key == payload.provider_app_key)
    )
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")

    connected_account = ConnectedAccount(
        organization_id=admin.organization_id,
        user_id=user.id,
        provider_app_id=provider_app.id,
        external_account_ref=payload.external_account_ref,
        external_email=payload.external_email,
        display_name=payload.display_name,
        oauth_client_id=payload.oauth_client_id,
        encrypted_oauth_client_secret=encrypt_text(payload.oauth_client_secret),
        oauth_redirect_uri=payload.oauth_redirect_uri,
        consented_scopes_json=dumps_json(payload.consented_scopes),
        status="connected",
    )
    db.add(connected_account)
    db.flush()

    token_material = TokenMaterial(
        organization_id=admin.organization_id,
        connected_account_id=connected_account.id,
        encrypted_access_token=encrypt_text(payload.access_token),
        encrypted_refresh_token=encrypt_text(payload.refresh_token),
        token_type=payload.token_type,
        scopes_json=dumps_json(payload.consented_scopes),
        expires_at=payload.expires_at,
        refresh_expires_at=payload.refresh_expires_at,
    )
    db.add(token_material)
    record_audit(
        db,
        action="admin.connected_account.manual_created",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata={"user_id": user.id, "provider_app_key": provider_app.key, "connected_account_id": connected_account.id},
    )
    db.commit()
    db.refresh(connected_account)
    return serialize_connected_account(db, connected_account)


@router.get("/delegation-grants", response_model=list[DelegationGrantOut], dependencies=[Depends(require_csrf)])
def list_delegation_grants(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(
        select(DelegationGrant).where(DelegationGrant.organization_id == _admin.organization_id).order_by(DelegationGrant.created_at.desc())
    ).all()


@router.post("/delegation-grants", response_model=DelegationGrantSecretResponse, dependencies=[Depends(require_csrf)])
def create_delegation_grant(payload: DelegationGrantCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.scalar(
        select(User).where(User.organization_id == admin.organization_id, User.email == payload.user_email.strip().lower())
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    sc_key = (payload.service_client_key or "").strip()
    service_client = None
    if sc_key:
        service_client = db.scalar(
            select(ServiceClient).where(
                ServiceClient.organization_id == admin.organization_id,
                ServiceClient.key == sc_key,
            )
        )
        if not service_client:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service client not found")
        if service_client.created_by_user_id is not None and service_client.created_by_user_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Service client does not belong to this user")

    provider_app = db.scalar(
        select(ProviderApp).where(ProviderApp.organization_id == admin.organization_id, ProviderApp.key == payload.provider_app_key)
    )
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")

    grant_modes = [m for m in effective_allowed_connection_types(provider_app) if m in {"relay", "direct_token"}]
    if not grant_modes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider app has no access modes configured")

    connected_account_id = payload.connected_account_id
    if connected_account_id:
        connected_account = db.get(ConnectedAccount, connected_account_id)
        if (
            not connected_account
            or connected_account.organization_id != admin.organization_id
            or connected_account.user_id != user.id
            or connected_account.provider_app_id != provider_app.id
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connected account mismatch")

    access_credential = issue_plain_secret()
    grant = DelegationGrant(
        organization_id=admin.organization_id,
        user_id=user.id,
        service_client_id=service_client.id if service_client else None,
        provider_app_id=provider_app.id,
        connected_account_id=connected_account_id,
        credential_hash=hash_secret(access_credential),
        credential_lookup_hash=lookup_secret_hash(access_credential),
        encrypted_delegated_credential=encrypt_text(access_credential),
        allowed_access_modes_json=dumps_json(grant_modes),
        scope_ceiling_json=dumps_json(payload.scope_ceiling),
        environment=payload.environment,
        expires_at=utcnow() + timedelta(days=payload.expires_in_days),
    )
    db.add(grant)
    db.flush()

    for capability in payload.capabilities:
        db.add(
            GrantedCapability(
                organization_id=admin.organization_id,
                delegation_grant_id=grant.id,
                capability_key=capability,
            )
        )

    record_audit(
        db,
        action="admin.delegation_grant.created",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata={
            "grant_id": grant.id,
            "service_client_id": service_client.id if service_client else None,
            "provider_app_id": provider_app.id,
        },
    )
    db.commit()
    db.refresh(grant)
    return DelegationGrantSecretResponse(delegation_grant=DelegationGrantOut.model_validate(grant), access_credential=access_credential)


@router.post("/delegation-grants/{grant_id}/revoke", response_model=DelegationGrantOut, dependencies=[Depends(require_csrf)])
def revoke_delegation_grant(grant_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    grant = db.get(DelegationGrant, grant_id)
    if not grant or grant.organization_id != admin.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delegation grant not found")
    grant.is_enabled = False
    grant.revoked_at = utcnow()
    grant.encrypted_delegated_credential = None
    record_audit(db, action="admin.delegation_grant.revoked", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"grant_id": grant.id})
    db.commit()
    db.refresh(grant)
    return grant


@router.get("/audit", response_model=list[AuditEventOut], dependencies=[Depends(require_csrf)])
def list_audit_events(_admin: User = Depends(require_admin), db: Session = Depends(get_db), limit: int = 200):
    return db.scalars(
        select(AuditEvent)
        .where(AuditEvent.organization_id == _admin.organization_id)
        .order_by(AuditEvent.created_at.desc())
        .limit(max(1, min(limit, 1000)))
    ).all()


@router.get("/token-issues", response_model=list[TokenIssueEventOut], dependencies=[Depends(require_csrf)])
def list_token_issues(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: str | None = None,
    service_client_id: str | None = None,
    provider_app_id: str | None = None,
    decision: str | None = None,
    from_time: datetime | None = Query(default=None),
    to_time: datetime | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
):
    query = select(TokenIssueEvent).where(TokenIssueEvent.organization_id == admin.organization_id)
    if user_id:
        query = query.where(TokenIssueEvent.user_id == user_id)
    if service_client_id:
        query = query.where(TokenIssueEvent.service_client_id == service_client_id)
    if provider_app_id:
        query = query.where(TokenIssueEvent.provider_app_id == provider_app_id)
    if decision:
        query = query.where(TokenIssueEvent.decision == decision)
    if from_time:
        query = query.where(TokenIssueEvent.created_at >= from_time)
    if to_time:
        query = query.where(TokenIssueEvent.created_at <= to_time)

    issues = db.scalars(query.order_by(TokenIssueEvent.created_at.desc()).limit(limit)).all()
    service_clients = {
        client.id: client
        for client in db.scalars(select(ServiceClient).where(ServiceClient.organization_id == admin.organization_id)).all()
    }
    provider_apps = {
        app.id: app
        for app in db.scalars(select(ProviderApp).where(ProviderApp.organization_id == admin.organization_id)).all()
    }
    connections = {
        connection.id: connection
        for connection in db.scalars(select(ConnectedAccount).where(ConnectedAccount.organization_id == admin.organization_id)).all()
    }
    return [
        TokenIssueEventOut(
            id=issue.id,
            service_client_id=issue.service_client_id,
            service_client_display_name=service_clients[issue.service_client_id].display_name if issue.service_client_id in service_clients else None,
            delegation_grant_id=issue.delegation_grant_id,
            provider_app_id=issue.provider_app_id,
            provider_app_display_name=provider_apps[issue.provider_app_id].display_name if issue.provider_app_id in provider_apps else None,
            connected_account_id=issue.connected_account_id,
            connected_account_display_name=(
                connections[issue.connected_account_id].display_name
                or connections[issue.connected_account_id].external_email
            ) if issue.connected_account_id in connections else None,
            decision=issue.decision,
            reason=issue.reason,
            scopes=loads_json(issue.scopes_json, []),
            metadata=loads_json(issue.metadata_json, {}),
            created_at=issue.created_at,
        )
        for issue in issues
    ]


@router.post("/integrations/test", response_model=IntegrationTestOut, dependencies=[Depends(require_csrf)])
async def test_integration_configuration(
    payload: IntegrationTestRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    template_key = payload.template_key.strip()
    known = {
        MICROSOFT_BROKER_LOGIN_TEMPLATE,
        MICROSOFT_GRAPH_DIRECT_TEMPLATE,
        MIRO_RELAY_TEMPLATE,
    }
    if template_key not in known:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported integration type")

    provider_app = get_provider_app_by_template(
        db,
        organization_id=admin.organization_id,
        template_key=template_key,
        enabled_only=False,
    )
    if not provider_app:
        return IntegrationTestOut(ok=False, message="No configuration found for this integration yet.")

    if template_key in {MICROSOFT_BROKER_LOGIN_TEMPLATE, MICROSOFT_GRAPH_DIRECT_TEMPLATE}:
        instance = db.get(ProviderInstance, provider_app.provider_instance_id)
        if not instance or instance.organization_id != admin.organization_id:
            return IntegrationTestOut(ok=False, message="Integration instance is missing.")
        settings = loads_json(instance.settings_json, {})
        tenant_id = str(settings.get("tenant_id") or "common").strip() or "common"
        url = f"https://login.microsoftonline.com/{tenant_id}/v2.0/.well-known/openid-configuration"
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.get(url)
        except httpx.RequestError as exc:
            return IntegrationTestOut(ok=False, message=f"Could not reach Microsoft OpenID discovery ({exc.__class__.__name__}).")
        if response.status_code == 200:
            return IntegrationTestOut(ok=True, message="Microsoft OpenID discovery succeeded.")
        return IntegrationTestOut(ok=False, message=f"Microsoft OpenID discovery returned HTTP {response.status_code}.")

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get("https://mcp.miro.com/authorize", follow_redirects=False)
    except httpx.RequestError as exc:
        return IntegrationTestOut(ok=False, message=f"Could not reach Miro authorize URL ({exc.__class__.__name__}).")
    if response.status_code in {200, 302, 303, 307, 308}:
        return IntegrationTestOut(ok=True, message="Miro authorization endpoint responded.")
    return IntegrationTestOut(ok=False, message=f"Miro authorization endpoint returned HTTP {response.status_code}.")


@router.get("/migrations/miro/status", response_model=MiroMigrationStatus, dependencies=[Depends(require_csrf)])
def miro_migration_current_status(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return MiroMigrationStatus(**migration_status(db))


@router.post("/migrations/miro/import", response_model=MiroMigrationImportResponse, dependencies=[Depends(require_csrf)])
def miro_import(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    result = import_legacy_miro_data(db)
    record_audit(
        db,
        action="admin.migrations.miro.import",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata=result,
    )
    db.commit()
    return MiroMigrationImportResponse(**result)
