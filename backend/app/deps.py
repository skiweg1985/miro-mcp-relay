from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.models import AccessMode, AuditEvent, ConnectedAccount, DelegationGrant, ProviderApp, ServiceClient, Session as SessionModel, TokenIssueEvent, TokenMaterial, User
from app.relay_config import effective_allowed_connection_types
from app.security import dumps_json, hash_secret, issue_plain_secret, loads_json, lookup_secret_hash, utcnow, verify_secret

# Plaintext secret presented by callers (HTTP `X-Access-Key` or legacy `X-Delegated-Credential`).
AccessCredential = str


def coalesce_service_access_headers(
    x_access_key: str | None,
    x_delegated_credential: str | None,
) -> str | None:
    primary = (x_access_key or "").strip()
    if primary:
        return primary
    return (x_delegated_credential or "").strip() or None


def coalesce_legacy_mcp_access_headers(
    x_access_key: str | None,
    x_relay_key: str | None,
    bearer_token: str | None,
) -> str | None:
    for candidate in (x_access_key, x_relay_key, bearer_token):
        v = (candidate or "").strip()
        if v:
            return v
    return None


@dataclass
class ServiceAuthContext:
    service_client: ServiceClient | None = None
    grant: DelegationGrant | None = None
    provider_app: ProviderApp | None = None
    connected_account: ConnectedAccount | None = None
    token_material: TokenMaterial | None = None


def service_access_audit_actor(auth_context: ServiceAuthContext) -> tuple[str, str | None]:
    if auth_context.service_client:
        return "service_client", auth_context.service_client.id
    if auth_context.grant:
        return "credential", auth_context.grant.id
    return "credential", None


def record_audit(db: Session, *, action: str, actor_type: str, actor_id: str | None, organization_id: str | None, metadata: dict) -> AuditEvent:
    event = AuditEvent(
        organization_id=organization_id,
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        metadata_json=dumps_json(metadata),
    )
    db.add(event)
    db.flush()
    return event


def get_current_session(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=get_settings().session_cookie_name),
) -> SessionModel:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing session")

    session = db.scalar(select(SessionModel).where(SessionModel.session_token_hash == hash_secret_lookup(session_token)))
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    if session.revoked_at is not None or ensure_live(session.expires_at) <= utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Expired session")
    return session


def hash_secret_lookup(value: str) -> str:
    # lightweight deterministic lookup hash for bearer/session tokens
    return lookup_secret_hash(value)


def ensure_live(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def get_current_user(session: SessionModel = Depends(get_current_session), db: Session = Depends(get_db)) -> User:
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_csrf(
    current_session: SessionModel = Depends(get_current_session),
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> str:
    if not x_csrf_token or not verify_secret(x_csrf_token, current_session.csrf_token_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    return x_csrf_token


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name, httponly=True, samesite="strict")


def _find_delegation_grant_by_credential(
    db: Session,
    access_credential: AccessCredential,
    *,
    service_client_id: str | None = None,
) -> DelegationGrant | None:
    cred_lookup = lookup_secret_hash(access_credential)
    q = select(DelegationGrant).where(
        DelegationGrant.is_enabled.is_(True),
        DelegationGrant.revoked_at.is_(None),
        DelegationGrant.credential_lookup_hash == cred_lookup,
    )
    if service_client_id is not None:
        q = q.where(DelegationGrant.service_client_id == service_client_id)
    exact_grants = db.scalars(q).all()
    return next((g for g in exact_grants if verify_secret(access_credential, g.credential_hash)), None)


def diagnose_service_access(
    *,
    db: Session,
    provider_app_key: str,
    access_credential: str | None,
    service_secret: str | None,
    requested_scopes: list[str],
    required_mode: str = AccessMode.DIRECT_TOKEN.value,
    connected_account_id: str | None = None,
 ) -> tuple[ServiceAuthContext, HTTPException | None]:
    auth_context = ServiceAuthContext()

    if not access_credential or not str(access_credential).strip():
        return auth_context, HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access credential")

    service_secret_value = str(service_secret).strip() if service_secret else ""

    auth_context.grant = _find_delegation_grant_by_credential(db, access_credential, service_client_id=None)
    if not auth_context.grant:
        return auth_context, HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access credential")

    if service_secret_value:
        svc_lookup = lookup_secret_hash(service_secret_value)
        exact_clients = db.scalars(
            select(ServiceClient).where(ServiceClient.is_enabled.is_(True), ServiceClient.secret_lookup_hash == svc_lookup)
        ).all()
        resolved_client = next(
            (client for client in exact_clients if verify_secret(service_secret_value, client.secret_hash)),
            None,
        )
        if not resolved_client:
            return auth_context, HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service client")
        if auth_context.grant.service_client_id is not None and auth_context.grant.service_client_id != resolved_client.id:
            return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access credential does not match service client")
        auth_context.service_client = resolved_client if auth_context.grant.service_client_id is not None else None
    elif auth_context.grant.service_client_id is not None:
        auth_context.service_client = db.get(ServiceClient, auth_context.grant.service_client_id)
        if not auth_context.service_client or not auth_context.service_client.is_enabled:
            return auth_context, HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Service client not found")

    if auth_context.grant.expires_at and ensure_live(auth_context.grant.expires_at) <= utcnow():
        return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Delegation expired")

    auth_context.provider_app = db.scalar(select(ProviderApp).where(ProviderApp.id == auth_context.grant.provider_app_id))
    if not auth_context.provider_app or auth_context.provider_app.key != provider_app_key or not auth_context.provider_app.is_enabled:
        return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider app not allowed")

    allowed = set(effective_allowed_connection_types(auth_context.provider_app))
    if required_mode == AccessMode.DIRECT_TOKEN.value:
        if "direct_token" not in allowed:
            return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider app does not allow direct token return")
    elif required_mode == AccessMode.RELAY.value:
        if "relay" not in allowed:
            return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider app does not allow relay access")
    else:
        return auth_context, HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported access mode")

    if auth_context.service_client is not None:
        allowed_provider_app_keys = loads_json(auth_context.service_client.allowed_provider_app_keys_json, [])
        if allowed_provider_app_keys and auth_context.provider_app.key not in allowed_provider_app_keys:
            return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Service client not allowed for provider app")

    grant_modes = set(loads_json(auth_context.grant.allowed_access_modes_json, []))
    if required_mode not in grant_modes:
        detail = "Delegation grant does not allow relay access" if required_mode == AccessMode.RELAY.value else "Delegation grant does not allow direct token access"
        return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    scope_ceiling = set(loads_json(auth_context.grant.scope_ceiling_json, []))
    if requested_scopes and scope_ceiling and not set(requested_scopes).issubset(scope_ceiling):
        return auth_context, HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requested scopes exceed delegation scope ceiling")

    if connected_account_id:
        auth_context.connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.id == connected_account_id,
                ConnectedAccount.user_id == auth_context.grant.user_id,
                ConnectedAccount.provider_app_id == auth_context.provider_app.id,
                ConnectedAccount.status == "connected",
            )
        )
    else:
        auth_context.connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == auth_context.grant.user_id,
                ConnectedAccount.provider_app_id == auth_context.provider_app.id,
                ConnectedAccount.status == "connected",
            )
        )

    if not auth_context.connected_account:
        return auth_context, HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected account not found")

    auth_context.token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == auth_context.connected_account.id))
    if not auth_context.token_material or not auth_context.token_material.encrypted_access_token:
        return auth_context, HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token material not found")

    return auth_context, None


def authenticate_service(
    *,
    db: Session,
    provider_app_key: str,
    access_credential: str | None,
    service_secret: str | None,
    requested_scopes: list[str],
    required_mode: str = AccessMode.DIRECT_TOKEN.value,
    connected_account_id: str | None = None,
):
    auth_context, auth_error = diagnose_service_access(
        db=db,
        provider_app_key=provider_app_key,
        access_credential=access_credential,
        service_secret=service_secret,
        requested_scopes=requested_scopes,
        required_mode=required_mode,
        connected_account_id=connected_account_id,
    )
    if auth_error:
        raise auth_error

    return (
        auth_context.service_client,
        auth_context.grant,
        auth_context.provider_app,
        auth_context.connected_account,
        auth_context.token_material,
    )


def refresh_csrf_token(db: Session, current_session: SessionModel) -> str:
    csrf_token = issue_plain_secret(16)
    current_session.csrf_token_hash = hash_secret(csrf_token)
    db.flush()
    return csrf_token


def record_token_issue(
    db: Session,
    *,
    organization_id: str,
    user_id: str | None,
    service_client_id: str | None,
    delegation_grant_id: str | None,
    provider_app_id: str | None,
    connected_account_id: str | None,
    decision: str,
    reason: str | None,
    scopes: list[str],
    metadata: dict,
) -> TokenIssueEvent:
    event = TokenIssueEvent(
        organization_id=organization_id,
        user_id=user_id,
        service_client_id=service_client_id,
        delegation_grant_id=delegation_grant_id,
        provider_app_id=provider_app_id,
        connected_account_id=connected_account_id,
        decision=decision,
        reason=reason,
        scopes_json=dumps_json(scopes),
        metadata_json=dumps_json(metadata),
    )
    db.add(event)
    db.flush()
    return event


def record_service_access_decision(
    db: Session,
    *,
    auth_context: ServiceAuthContext,
    provider_app_key: str,
    requested_scopes: list[str],
    decision: str,
    reason: str | None,
    metadata: dict | None = None,
) -> TokenIssueEvent | None:
    organization_id = auth_context.grant.organization_id if auth_context.grant else (
        auth_context.service_client.organization_id if auth_context.service_client else None
    )
    if not organization_id:
        return None

    scopes = requested_scopes
    if not scopes and auth_context.token_material:
        scopes = loads_json(auth_context.token_material.scopes_json, [])

    event_metadata = {
        "provider_app_key": provider_app_key,
        "service_client_key": auth_context.service_client.key if auth_context.service_client else None,
    }
    if metadata:
        event_metadata.update(metadata)

    return record_token_issue(
        db,
        organization_id=organization_id,
        user_id=auth_context.grant.user_id if auth_context.grant else None,
        service_client_id=auth_context.service_client.id if auth_context.service_client else None,
        delegation_grant_id=auth_context.grant.id if auth_context.grant else None,
        provider_app_id=auth_context.provider_app.id if auth_context.provider_app else None,
        connected_account_id=auth_context.connected_account.id if auth_context.connected_account else None,
        decision=decision,
        reason=reason,
        scopes=scopes,
        metadata=event_metadata,
    )
