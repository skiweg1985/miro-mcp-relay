from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import authenticate_service, record_audit, record_token_issue
from app.schemas import ProviderAccessIssueRequest, ProviderAccessIssueResponse
from app.security import decrypt_text, loads_json

router = APIRouter(prefix="/token-issues", tags=["token-issuance"])


@router.post("/provider-access", response_model=ProviderAccessIssueResponse)
def issue_provider_access_token(
    payload: ProviderAccessIssueRequest,
    db: Session = Depends(get_db),
    x_service_secret: str | None = Header(default=None, alias="X-Service-Secret"),
    x_delegated_credential: str | None = Header(default=None, alias="X-Delegated-Credential"),
):
    service_client, grant, provider_app, connected_account, token_material = authenticate_service(
        db=db,
        provider_app_key=payload.provider_app_key,
        delegated_credential=x_delegated_credential,
        service_secret=x_service_secret,
        requested_scopes=payload.requested_scopes,
        connected_account_id=payload.connected_account_id,
    )

    scopes = loads_json(token_material.scopes_json, [])
    event = record_token_issue(
        db,
        organization_id=grant.organization_id,
        user_id=grant.user_id,
        service_client_id=service_client.id,
        delegation_grant_id=grant.id,
        provider_app_id=provider_app.id,
        connected_account_id=connected_account.id,
        decision="issued",
        reason=None,
        scopes=payload.requested_scopes or scopes,
        metadata={"provider_app_key": provider_app.key, "service_client_key": service_client.key},
    )
    record_audit(
        db,
        action="service.provider_access_token.issued",
        actor_type="service_client",
        actor_id=service_client.id,
        organization_id=grant.organization_id,
        metadata={"grant_id": grant.id, "connected_account_id": connected_account.id, "token_issue_event_id": event.id},
    )
    db.commit()

    return ProviderAccessIssueResponse(
        provider_app_key=provider_app.key,
        connected_account_id=connected_account.id,
        access_token=decrypt_text(token_material.encrypted_access_token) or "",
        token_type=token_material.token_type,
        expires_at=token_material.expires_at,
        scopes=payload.requested_scopes or scopes,
        audit_event_id=event.id,
    )
