"""Consumer: retrieve upstream OAuth access token when grant allows direct token access."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuthMode
from app.schemas import ConsumerUpstreamOAuthTokenOut
from app.services.access_grants import BROKER_ACCESS_KEY_PREFIX, resolve_upstream_oauth_token_for_grant
from app.services.access_usage_audit import (
    AccessUsageEventType,
    AccessUsageOutcome,
    AccessUsageType,
    RequestAuditInfo,
    record_access_usage_event,
)
from app.services.consumer_access import resolve_consumer_grant_context
from app.upstream_oauth import (
    get_user_connection_for_grant_oauth,
    oauth_expires_at_from_connection,
    oauth_expires_in_seconds,
    upstream_identity_from_connection,
)

router = APIRouter(tags=["consumer-token"])


def _extract_broker_access_key(authorization: str | None, x_broker_access_key: str | None) -> str | None:
    if x_broker_access_key and x_broker_access_key.strip():
        return x_broker_access_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token.startswith(BROKER_ACCESS_KEY_PREFIX):
            return token
    return None


def _audit(request: Request) -> RequestAuditInfo:
    return RequestAuditInfo(
        request_id=(request.headers.get("x-request-id") or "").strip() or None,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/consumer/integration-instances/{instance_id}/token", response_model=ConsumerUpstreamOAuthTokenOut)
def consumer_upstream_oauth_token(
    request: Request,
    instance_id: str,
    authorization: str | None = Header(default=None),
    x_broker_access_key: str | None = Header(default=None, alias="X-Broker-Access-Key"),
    db: Session = Depends(get_db),
):
    """Return the current upstream OAuth access token for this grant's connection (no refresh token).

    Requires ``direct_token_access`` on the grant. Does not accept ``X-User-Token``; only broker-stored tokens.
    """
    audit = _audit(request)
    raw = _extract_broker_access_key(authorization, x_broker_access_key)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_broker_access_key")
    grant, instance, integration = resolve_consumer_grant_context(
        db,
        raw_key=raw,
        instance_id=instance_id,
        usage_type=AccessUsageType.DIRECT_TOKEN,
        request=audit,
    )
    connection_name = instance.name
    access_name = grant.name

    if not grant.direct_token_access_enabled:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance.id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.DIRECT_TOKEN,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="direct_token_access_disabled",
            request=audit,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="direct_token_access_disabled")
    if instance.auth_mode != AuthMode.OAUTH.value:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance.id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.DIRECT_TOKEN,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="direct_token_requires_oauth_connection",
            request=audit,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="direct_token_requires_oauth_connection")

    upstream = resolve_upstream_oauth_token_for_grant(db, grant=grant, instance=instance, x_user_token=None)
    if not upstream:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance.id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.DIRECT_TOKEN,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="oauth_upstream_token_missing",
            request=audit,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_missing")

    conn = get_user_connection_for_grant_oauth(
        db,
        grant_user_id=grant.user_id,
        organization_id=grant.organization_id,
        instance=instance,
        user_connection_id=grant.user_connection_id,
    )
    if conn:
        db.refresh(conn)

    expires_at = oauth_expires_at_from_connection(conn)
    expires_in = oauth_expires_in_seconds(conn)
    email, username = upstream_identity_from_connection(conn)

    record_access_usage_event(
        db,
        grant=grant,
        integration_instance_id=instance.id,
        integration_id=integration.id,
        event_type=AccessUsageEventType.TOKEN_ISSUED,
        usage_type=AccessUsageType.DIRECT_TOKEN,
        outcome=AccessUsageOutcome.SUCCESS,
        status_code=200,
        request=audit,
        metadata={},
    )
    db.commit()

    return ConsumerUpstreamOAuthTokenOut(
        access_token=upstream,
        token_type="Bearer",
        expires_at=expires_at,
        expires_in=expires_in,
        connection_id=conn.id if conn else None,
        connection_name=connection_name,
        access_name=access_name,
        email=email,
        username=username,
    )
