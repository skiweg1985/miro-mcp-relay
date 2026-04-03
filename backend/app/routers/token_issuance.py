from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import diagnose_service_access, record_audit, record_service_access_decision
from app.microsoft_graph import refresh_microsoft_graph_connection
from app.models import AccessMode, ProviderApp
from app.provider_templates import MICROSOFT_GRAPH_DIRECT_TEMPLATE, provider_app_matches_template
from app.schemas import ProviderAccessIssueRequest, ProviderAccessIssueResponse
from app.security import decrypt_text, ensure_utc, loads_json, utcnow

router = APIRouter(prefix="/token-issues", tags=["token-issuance"])


@router.post("/provider-access", response_model=ProviderAccessIssueResponse)
async def issue_provider_access_token(
    payload: ProviderAccessIssueRequest,
    db: Session = Depends(get_db),
    x_service_secret: str | None = Header(default=None, alias="X-Service-Secret"),
    x_delegated_credential: str | None = Header(default=None, alias="X-Delegated-Credential"),
):
    auth_context, auth_error = diagnose_service_access(
        db=db,
        provider_app_key=payload.provider_app_key,
        delegated_credential=x_delegated_credential,
        service_secret=x_service_secret,
        requested_scopes=payload.requested_scopes,
        required_mode=AccessMode.DIRECT_TOKEN.value,
        connected_account_id=payload.connected_account_id,
    )
    if auth_error:
        event = record_service_access_decision(
            db,
            auth_context=auth_context,
            provider_app_key=payload.provider_app_key,
            requested_scopes=payload.requested_scopes,
            decision="blocked",
            reason=str(auth_error.detail),
            metadata={"required_mode": AccessMode.DIRECT_TOKEN.value},
        )
        if event and auth_context.service_client:
            record_audit(
                db,
                action="service.provider_access_token.blocked",
                actor_type="service_client",
                actor_id=auth_context.service_client.id,
                organization_id=event.organization_id,
                metadata={"token_issue_event_id": event.id, "reason": str(auth_error.detail)},
            )
            db.commit()
        raise auth_error

    service_client = auth_context.service_client
    grant = auth_context.grant
    provider_app = auth_context.provider_app
    connected_account = auth_context.connected_account
    token_material = auth_context.token_material

    exp = ensure_utc(token_material.expires_at)
    if (
        provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE)
        and exp is not None
        and exp <= utcnow()
    ):
        token_material = await refresh_microsoft_graph_connection(db, connected_account)

    scopes = loads_json(token_material.scopes_json, [])
    event = record_service_access_decision(
        db,
        auth_context=auth_context,
        provider_app_key=provider_app.key,
        requested_scopes=payload.requested_scopes or scopes,
        decision="issued",
        reason=None,
        metadata={"required_mode": AccessMode.DIRECT_TOKEN.value},
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
