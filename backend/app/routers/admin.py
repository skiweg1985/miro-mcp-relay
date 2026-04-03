from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import record_audit, require_admin, require_csrf
from app.miro import import_legacy_miro_data, migration_status
from app.models import AuditEvent, ConnectedAccount, DelegationGrant, GrantedCapability, ProviderApp, ProviderDefinition, ProviderInstance, ServiceClient, TokenMaterial, User
from app.schemas import (
    AuditEventOut,
    ConnectedAccountCreate,
    ConnectedAccountOut,
    DelegationGrantCreate,
    DelegationGrantOut,
    DelegationGrantSecretResponse,
    MiroMigrationImportResponse,
    MiroMigrationStatus,
    ProviderAppCreate,
    ProviderAppOut,
    ProviderInstanceCreate,
    ProviderInstanceOut,
    ServiceClientCreate,
    ServiceClientOut,
    ServiceClientSecretResponse,
    UserOut,
)
from app.security import dumps_json, encrypt_text, hash_secret, issue_plain_secret, utcnow

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(require_csrf)])
def list_users(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at.desc())).all()


@router.get("/provider-instances", response_model=list[ProviderInstanceOut], dependencies=[Depends(require_csrf)])
def list_provider_instances(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(ProviderInstance).order_by(ProviderInstance.display_name.asc())).all()


@router.post("/provider-instances", response_model=ProviderInstanceOut, dependencies=[Depends(require_csrf)])
def create_provider_instance(payload: ProviderInstanceCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    provider_definition = db.scalar(select(ProviderDefinition).where(ProviderDefinition.key == payload.provider_definition_key))
    if not provider_definition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider definition not found")

    provider_instance = ProviderInstance(
        organization_id=admin.organization_id,
        provider_definition_id=provider_definition.id,
        key=payload.key,
        display_name=payload.display_name,
        role=payload.role,
        issuer=payload.issuer,
        authorization_endpoint=payload.authorization_endpoint,
        token_endpoint=payload.token_endpoint,
        userinfo_endpoint=payload.userinfo_endpoint,
        is_enabled=payload.is_enabled,
    )
    db.add(provider_instance)
    record_audit(db, action="admin.provider_instance.created", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"key": payload.key})
    db.commit()
    db.refresh(provider_instance)
    return provider_instance


@router.get("/provider-apps", response_model=list[ProviderAppOut], dependencies=[Depends(require_csrf)])
def list_provider_apps(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(ProviderApp).order_by(ProviderApp.created_at.desc())).all()


@router.post("/provider-apps", response_model=ProviderAppOut, dependencies=[Depends(require_csrf)])
def create_provider_app(payload: ProviderAppCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    provider_instance = db.scalar(select(ProviderInstance).where(ProviderInstance.key == payload.provider_instance_key))
    if not provider_instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider instance not found")

    provider_app = ProviderApp(
        organization_id=admin.organization_id,
        provider_instance_id=provider_instance.id,
        key=payload.key,
        display_name=payload.display_name,
        client_id=payload.client_id,
        encrypted_client_secret=encrypt_text(payload.client_secret),
        redirect_uris_json=dumps_json(payload.redirect_uris),
        default_scopes_json=dumps_json(payload.default_scopes),
        scope_ceiling_json=dumps_json(payload.scope_ceiling),
        access_mode=payload.access_mode,
        allow_relay=payload.allow_relay,
        allow_direct_token_return=payload.allow_direct_token_return,
        relay_protocol=payload.relay_protocol,
        is_enabled=payload.is_enabled,
    )
    db.add(provider_app)
    record_audit(db, action="admin.provider_app.created", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"key": payload.key})
    db.commit()
    db.refresh(provider_app)
    return provider_app


@router.get("/service-clients", response_model=list[ServiceClientOut], dependencies=[Depends(require_csrf)])
def list_service_clients(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(ServiceClient).order_by(ServiceClient.created_at.desc())).all()


@router.post("/service-clients", response_model=ServiceClientSecretResponse, dependencies=[Depends(require_csrf)])
def create_service_client(payload: ServiceClientCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    secret = issue_plain_secret()
    service_client = ServiceClient(
        organization_id=admin.organization_id,
        key=payload.key,
        display_name=payload.display_name,
        secret_hash=hash_secret(secret),
        environment=payload.environment,
        allowed_provider_app_keys_json=dumps_json(payload.allowed_provider_app_keys),
    )
    db.add(service_client)
    record_audit(db, action="admin.service_client.created", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"key": payload.key})
    db.commit()
    db.refresh(service_client)
    return ServiceClientSecretResponse(service_client=ServiceClientOut.model_validate(service_client), client_secret=secret)


@router.get("/connected-accounts", response_model=list[ConnectedAccountOut], dependencies=[Depends(require_csrf)])
def list_connected_accounts(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(ConnectedAccount).order_by(ConnectedAccount.connected_at.desc())).all()


@router.post("/connected-accounts/manual", response_model=ConnectedAccountOut, dependencies=[Depends(require_csrf)])
def create_connected_account(payload: ConnectedAccountCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.user_email))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    provider_app = db.scalar(select(ProviderApp).where(ProviderApp.key == payload.provider_app_key))
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
    return connected_account


@router.get("/delegation-grants", response_model=list[DelegationGrantOut], dependencies=[Depends(require_csrf)])
def list_delegation_grants(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(DelegationGrant).order_by(DelegationGrant.created_at.desc())).all()


@router.post("/delegation-grants", response_model=DelegationGrantSecretResponse, dependencies=[Depends(require_csrf)])
def create_delegation_grant(payload: DelegationGrantCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.user_email))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    service_client = db.scalar(select(ServiceClient).where(ServiceClient.key == payload.service_client_key))
    if not service_client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service client not found")

    provider_app = db.scalar(select(ProviderApp).where(ProviderApp.key == payload.provider_app_key))
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")

    connected_account_id = payload.connected_account_id
    if connected_account_id:
        connected_account = db.get(ConnectedAccount, connected_account_id)
        if not connected_account or connected_account.user_id != user.id or connected_account.provider_app_id != provider_app.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connected account mismatch")

    delegated_credential = issue_plain_secret()
    grant = DelegationGrant(
        organization_id=admin.organization_id,
        user_id=user.id,
        service_client_id=service_client.id,
        provider_app_id=provider_app.id,
        connected_account_id=connected_account_id,
        credential_hash=hash_secret(delegated_credential),
        allowed_access_modes_json=dumps_json(payload.allowed_access_modes),
        scope_ceiling_json=dumps_json(payload.scope_ceiling),
        environment=payload.environment,
        expires_at=utcnow() + timedelta(hours=payload.expires_in_hours),
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
        metadata={"grant_id": grant.id, "service_client_id": service_client.id, "provider_app_id": provider_app.id},
    )
    db.commit()
    db.refresh(grant)
    return DelegationGrantSecretResponse(delegation_grant=DelegationGrantOut.model_validate(grant), delegated_credential=delegated_credential)


@router.post("/delegation-grants/{grant_id}/revoke", response_model=DelegationGrantOut, dependencies=[Depends(require_csrf)])
def revoke_delegation_grant(grant_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    grant = db.get(DelegationGrant, grant_id)
    if not grant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delegation grant not found")
    grant.is_enabled = False
    grant.revoked_at = utcnow()
    record_audit(db, action="admin.delegation_grant.revoked", actor_type="user", actor_id=admin.id, organization_id=admin.organization_id, metadata={"grant_id": grant.id})
    db.commit()
    db.refresh(grant)
    return grant


@router.get("/audit", response_model=list[AuditEventOut], dependencies=[Depends(require_csrf)])
def list_audit_events(_admin: User = Depends(require_admin), db: Session = Depends(get_db), limit: int = 200):
    return db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(max(1, min(limit, 1000)))).all()


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
