from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, record_audit, require_csrf
from app.models import ConnectedAccount, DelegationGrant, GrantedCapability, ProviderApp, ServiceClient, TokenIssueEvent, User
from app.relay_config import effective_allowed_connection_types
from app.schemas import (
    DelegatedCredentialRotateOut,
    SelfServiceDelegationGrantCreate,
    SelfServiceDelegationGrantOut,
    SelfServiceDelegationGrantSecretResponse,
    TokenIssueEventOut,
    VisibleServiceClientOut,
)
from app.security import dumps_json, hash_secret, issue_plain_secret, loads_json, lookup_secret_hash, utcnow

router = APIRouter(tags=["user"])


def _grant_to_out(
    grant: DelegationGrant,
    *,
    service_clients: dict[str, ServiceClient],
    provider_apps: dict[str, ProviderApp],
    connections: dict[str, ConnectedAccount],
    capabilities: dict[str, list[str]],
) -> SelfServiceDelegationGrantOut:
    service_client = service_clients.get(grant.service_client_id) if grant.service_client_id else None
    provider_app = provider_apps.get(grant.provider_app_id)
    connection = connections.get(grant.connected_account_id or "")
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant dependencies not found")
    return SelfServiceDelegationGrantOut(
        id=grant.id,
        service_client_id=service_client.id if service_client else None,
        service_client_key=service_client.key if service_client else None,
        service_client_display_name=service_client.display_name if service_client else None,
        provider_app_id=provider_app.id,
        provider_app_key=provider_app.key,
        provider_app_display_name=provider_app.display_name,
        connected_account_id=grant.connected_account_id,
        connected_account_display_name=(connection.display_name or connection.external_email) if connection else None,
        allowed_access_modes=loads_json(grant.allowed_access_modes_json, []),
        scope_ceiling=loads_json(grant.scope_ceiling_json, []),
        capabilities=capabilities.get(grant.id, []),
        environment=grant.environment,
        is_enabled=grant.is_enabled,
        expires_at=grant.expires_at,
        revoked_at=grant.revoked_at,
        created_at=grant.created_at,
    )


@router.get("/service-clients", response_model=list[VisibleServiceClientOut])
def list_service_clients(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(ServiceClient).where(
            ServiceClient.organization_id == current_user.organization_id,
            ServiceClient.is_enabled.is_(True),
        ).order_by(ServiceClient.display_name.asc())
    ).all()


@router.get("/delegation-grants", response_model=list[SelfServiceDelegationGrantOut])
def list_my_delegation_grants(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants = db.scalars(
        select(DelegationGrant).where(DelegationGrant.user_id == current_user.id).order_by(DelegationGrant.created_at.desc())
    ).all()
    service_clients = {
        client.id: client
        for client in db.scalars(select(ServiceClient).where(ServiceClient.organization_id == current_user.organization_id)).all()
    }
    provider_apps = {
        app.id: app
        for app in db.scalars(select(ProviderApp).where(ProviderApp.organization_id == current_user.organization_id)).all()
    }
    connections = {
        connection.id: connection
        for connection in db.scalars(select(ConnectedAccount).where(ConnectedAccount.user_id == current_user.id)).all()
    }
    capability_rows = db.scalars(
        select(GrantedCapability).where(GrantedCapability.delegation_grant_id.in_([grant.id for grant in grants]))
    ).all() if grants else []
    capabilities: dict[str, list[str]] = {}
    for capability in capability_rows:
        capabilities.setdefault(capability.delegation_grant_id, []).append(capability.capability_key)
    return [
        _grant_to_out(
            grant,
            service_clients=service_clients,
            provider_apps=provider_apps,
            connections=connections,
            capabilities=capabilities,
        )
        for grant in grants
    ]


@router.post("/delegation-grants", response_model=SelfServiceDelegationGrantSecretResponse, dependencies=[Depends(require_csrf)])
def create_my_delegation_grant(
    payload: SelfServiceDelegationGrantCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sc_key = (payload.service_client_key or "").strip()
    service_client = None
    if sc_key:
        service_client = db.scalar(
            select(ServiceClient).where(
                ServiceClient.organization_id == current_user.organization_id,
                ServiceClient.key == sc_key,
                ServiceClient.is_enabled.is_(True),
            )
        )
        if not service_client:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service client not found")

    provider_app = db.scalar(
        select(ProviderApp).where(
            ProviderApp.organization_id == current_user.organization_id,
            ProviderApp.key == payload.provider_app_key,
            ProviderApp.is_enabled.is_(True),
        )
    )
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")

    if service_client:
        allowed_provider_app_keys = loads_json(service_client.allowed_provider_app_keys_json, [])
        if allowed_provider_app_keys and provider_app.key not in allowed_provider_app_keys:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Service client is not allowed for this provider app")

    allowed_access_modes = [m for m in effective_allowed_connection_types(provider_app) if m in {"relay", "direct_token"}]
    if not allowed_access_modes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider app has no access modes configured")

    connected_account = None
    if payload.connected_account_id:
        connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.id == payload.connected_account_id,
                ConnectedAccount.user_id == current_user.id,
                ConnectedAccount.provider_app_id == provider_app.id,
                ConnectedAccount.status == "connected",
            )
        )
        if not connected_account:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connected account mismatch")
    else:
        connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == current_user.id,
                ConnectedAccount.provider_app_id == provider_app.id,
                ConnectedAccount.status == "connected",
            )
        )
        if not connected_account:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active connection exists for this provider app")

    delegated_credential = issue_plain_secret()
    grant = DelegationGrant(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        service_client_id=service_client.id if service_client else None,
        provider_app_id=provider_app.id,
        connected_account_id=connected_account.id if connected_account else None,
        credential_hash=hash_secret(delegated_credential),
        credential_lookup_hash=lookup_secret_hash(delegated_credential),
        allowed_access_modes_json=dumps_json(allowed_access_modes),
        scope_ceiling_json=dumps_json(payload.scope_ceiling),
        environment=payload.environment,
        expires_at=utcnow() + timedelta(days=payload.expires_in_days),
    )
    db.add(grant)
    db.flush()

    for capability in payload.capabilities:
        db.add(
            GrantedCapability(
                organization_id=current_user.organization_id,
                delegation_grant_id=grant.id,
                capability_key=capability,
            )
        )

    record_audit(
        db,
        action="user.delegation_grant.created",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={
            "grant_id": grant.id,
            "service_client_id": service_client.id if service_client else None,
            "provider_app_id": provider_app.id,
        },
    )
    db.commit()
    return SelfServiceDelegationGrantSecretResponse(
        delegation_grant=_grant_to_out(
            grant,
            service_clients={service_client.id: service_client} if service_client else {},
            provider_apps={provider_app.id: provider_app},
            connections={connected_account.id: connected_account} if connected_account else {},
            capabilities={grant.id: payload.capabilities},
        ),
        delegated_credential=delegated_credential,
    )


@router.post(
    "/delegation-grants/{grant_id}/rotate-credential",
    response_model=DelegatedCredentialRotateOut,
    dependencies=[Depends(require_csrf)],
)
def rotate_my_delegation_grant_credential(grant_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = db.scalar(select(DelegationGrant).where(DelegationGrant.id == grant_id, DelegationGrant.user_id == current_user.id))
    if not grant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delegation grant not found")
    if grant.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delegation grant is revoked")
    if not grant.is_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delegation grant is disabled")

    delegated_credential = issue_plain_secret()
    grant.credential_hash = hash_secret(delegated_credential)
    grant.credential_lookup_hash = lookup_secret_hash(delegated_credential)
    grant.updated_at = utcnow()
    record_audit(
        db,
        action="user.delegation_grant.credential_rotated",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"grant_id": grant.id},
    )
    db.commit()
    return DelegatedCredentialRotateOut(delegated_credential=delegated_credential)


@router.post("/delegation-grants/{grant_id}/revoke", response_model=SelfServiceDelegationGrantOut, dependencies=[Depends(require_csrf)])
def revoke_my_delegation_grant(grant_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = db.scalar(select(DelegationGrant).where(DelegationGrant.id == grant_id, DelegationGrant.user_id == current_user.id))
    if not grant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delegation grant not found")
    grant.is_enabled = False
    grant.revoked_at = utcnow()
    record_audit(
        db,
        action="user.delegation_grant.revoked",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"grant_id": grant.id},
    )
    db.commit()

    service_client = db.get(ServiceClient, grant.service_client_id) if grant.service_client_id else None
    provider_app = db.get(ProviderApp, grant.provider_app_id)
    connection = db.get(ConnectedAccount, grant.connected_account_id) if grant.connected_account_id else None
    capability_rows = db.scalars(
        select(GrantedCapability).where(GrantedCapability.delegation_grant_id == grant.id)
    ).all()
    return _grant_to_out(
        grant,
        service_clients={service_client.id: service_client} if service_client else {},
        provider_apps={provider_app.id: provider_app},
        connections={connection.id: connection} if connection else {},
        capabilities={grant.id: [capability.capability_key for capability in capability_rows]},
    )


@router.get("/token-issues", response_model=list[TokenIssueEventOut])
def list_my_token_issues(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service_client_id: str | None = None,
    delegation_grant_id: str | None = None,
    from_time: datetime | None = Query(default=None),
    to_time: datetime | None = Query(default=None),
    limit: int = 100,
):
    query = select(TokenIssueEvent).where(TokenIssueEvent.user_id == current_user.id)
    if service_client_id:
        query = query.where(TokenIssueEvent.service_client_id == service_client_id)
    if delegation_grant_id:
        query = query.where(TokenIssueEvent.delegation_grant_id == delegation_grant_id)
    if from_time:
        query = query.where(TokenIssueEvent.created_at >= from_time)
    if to_time:
        query = query.where(TokenIssueEvent.created_at <= to_time)
    issues = db.scalars(query.order_by(TokenIssueEvent.created_at.desc()).limit(max(1, min(limit, 500)))).all()
    service_clients = {
        client.id: client
        for client in db.scalars(select(ServiceClient).where(ServiceClient.organization_id == current_user.organization_id)).all()
    }
    provider_apps = {
        app.id: app
        for app in db.scalars(select(ProviderApp).where(ProviderApp.organization_id == current_user.organization_id)).all()
    }
    connections = {
        connection.id: connection for connection in db.scalars(select(ConnectedAccount).where(ConnectedAccount.user_id == current_user.id)).all()
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
