from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.models import AccessMode, AuditEvent, ConnectedAccount, DelegationGrant, ProviderApp, ServiceClient, Session as SessionModel, TokenIssueEvent, TokenMaterial, User
from app.security import dumps_json, hash_secret, issue_plain_secret, loads_json, utcnow, verify_secret


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
    import hashlib
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


def authenticate_service(
    *,
    db: Session,
    provider_app_key: str,
    delegated_credential: str | None,
    service_secret: str | None,
    requested_scopes: list[str],
    required_mode: str = AccessMode.DIRECT_TOKEN.value,
    connected_account_id: str | None = None,
):
    if not delegated_credential or not service_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing service credentials")

    service_clients = db.scalars(select(ServiceClient).where(ServiceClient.is_enabled.is_(True))).all()
    service_client = next((client for client in service_clients if verify_secret(service_secret, client.secret_hash)), None)
    if not service_client:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service client")

    grants = db.scalars(
        select(DelegationGrant).where(
            DelegationGrant.service_client_id == service_client.id,
            DelegationGrant.is_enabled.is_(True),
            DelegationGrant.revoked_at.is_(None),
        )
    ).all()
    grant = next((candidate for candidate in grants if verify_secret(delegated_credential, candidate.credential_hash)), None)
    if not grant:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid delegated credential")

    if grant.expires_at and ensure_live(grant.expires_at) <= utcnow():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Delegation expired")

    provider_app = db.scalar(select(ProviderApp).where(ProviderApp.id == grant.provider_app_id))
    if not provider_app or provider_app.key != provider_app_key or not provider_app.is_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider app not allowed")

    if required_mode == AccessMode.DIRECT_TOKEN.value:
        if not provider_app.allow_direct_token_return or provider_app.access_mode not in {AccessMode.DIRECT_TOKEN.value, AccessMode.HYBRID.value}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider app does not allow direct token return")
    elif required_mode == AccessMode.RELAY.value:
        if not provider_app.allow_relay or provider_app.access_mode not in {AccessMode.RELAY.value, AccessMode.HYBRID.value}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider app does not allow relay access")
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported access mode")

    allowed_provider_app_keys = loads_json(service_client.allowed_provider_app_keys_json, [])
    if allowed_provider_app_keys and provider_app.key not in allowed_provider_app_keys:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Service client not allowed for provider app")

    grant_modes = set(loads_json(grant.allowed_access_modes_json, []))
    if required_mode not in grant_modes:
        detail = "Delegation grant does not allow relay access" if required_mode == AccessMode.RELAY.value else "Delegation grant does not allow direct token access"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    scope_ceiling = set(loads_json(grant.scope_ceiling_json, []))
    if requested_scopes and scope_ceiling and not set(requested_scopes).issubset(scope_ceiling):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requested scopes exceed delegation scope ceiling")

    if connected_account_id:
        connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.id == connected_account_id,
                ConnectedAccount.user_id == grant.user_id,
                ConnectedAccount.provider_app_id == provider_app.id,
                ConnectedAccount.status == "connected",
            )
        )
    else:
        connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == grant.user_id,
                ConnectedAccount.provider_app_id == provider_app.id,
                ConnectedAccount.status == "connected",
            )
        )

    if not connected_account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected account not found")

    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_access_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token material not found")

    return service_client, grant, provider_app, connected_account, token_material


def refresh_csrf_token(db: Session, current_session: SessionModel) -> str:
    csrf_token = issue_plain_secret(16)
    current_session.csrf_token_hash = hash_secret(csrf_token)
    db.flush()
    return csrf_token


def record_token_issue(
    db: Session,
    *,
    organization_id: str,
    user_id: str,
    service_client_id: str,
    delegation_grant_id: str,
    provider_app_id: str,
    connected_account_id: str,
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
