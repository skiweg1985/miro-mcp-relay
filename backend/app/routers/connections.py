from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse
from urllib.parse import quote

from app.database import get_db
from app.deps import authenticate_service, get_current_user, record_audit, require_csrf
from app.miro import fetch_miro_token_context, finalize_miro_callback, get_miro_provider_app, refresh_connected_account, relay_miro_request, start_miro_connection
from app.models import AccessMode, ConnectedAccount, ProviderApp, TokenMaterial, User
from app.schemas import ConnectedAccountOut, ConnectionProbeResponse, MiroConnectStartRequest, MiroConnectStartResponse, ProviderAppOut
from app.security import decrypt_text, utcnow

router = APIRouter(tags=["connections"])


@router.get("/provider-apps", response_model=list[ProviderAppOut])
def list_provider_apps(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.scalars(
        select(ProviderApp).where(
            ProviderApp.organization_id == current_user.organization_id,
            ProviderApp.is_enabled.is_(True),
        ).order_by(ProviderApp.display_name.asc())
    ).all()


@router.get("/connections", response_model=list[ConnectedAccountOut])
def list_connections(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(ConnectedAccount).where(ConnectedAccount.user_id == current_user.id).order_by(ConnectedAccount.connected_at.desc())).all()


@router.post("/connections/miro/start", response_model=MiroConnectStartResponse)
async def start_miro(
    payload: MiroConnectStartRequest,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    target_user = current_user
    if payload.user_email:
        if not current_user.is_admin and payload.user_email.lower() != current_user.email.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required for target user selection")
        target_user = db.scalar(
            select(User).where(User.organization_id == current_user.organization_id, User.email == payload.user_email)
        )
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    connected_account = None
    if payload.connected_account_id:
        connected_account = db.get(ConnectedAccount, payload.connected_account_id)
        if not connected_account or connected_account.user_id != target_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected account not found")

    state, auth_url = await start_miro_connection(db=db, user=current_user, target_user=target_user, connected_account=connected_account)
    record_audit(
        db,
        action="miro.connection.start",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"target_user_id": target_user.id, "connected_account_id": connected_account.id if connected_account else None, "state": state},
    )
    db.commit()
    return MiroConnectStartResponse(auth_url=auth_url, state=state)


@router.get("/connections/miro/callback")
async def miro_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        return await finalize_miro_callback(db, state, code)
    except HTTPException as exc:
        from app.core.config import get_settings

        settings = get_settings()
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace?miro_status=error&message={quote(str(exc.detail))}",
            status_code=302,
        )


@router.post("/connections/{connection_id}/refresh", response_model=ConnectedAccountOut)
async def refresh_connection(connection_id: str, current_user: User = Depends(get_current_user), _csrf: str = Depends(require_csrf), db: Session = Depends(get_db)):
    connection = db.get(ConnectedAccount, connection_id)
    if not connection or (connection.user_id != current_user.id and not current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    provider_app = db.get(ProviderApp, connection.provider_app_id)
    if not provider_app or provider_app.key != "miro-default":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refresh is currently implemented for Miro connections only")
    await refresh_connected_account(db, connection)
    record_audit(
        db,
        action="miro.connection.refresh",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"connected_account_id": connection.id},
    )
    db.refresh(connection)
    return connection


@router.post("/connections/{connection_id}/revoke", response_model=ConnectedAccountOut)
def revoke_connection(connection_id: str, current_user: User = Depends(get_current_user), _csrf: str = Depends(require_csrf), db: Session = Depends(get_db)):
    connection = db.get(ConnectedAccount, connection_id)
    if not connection or (connection.user_id != current_user.id and not current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    connection.status = "revoked"
    connection.revoked_at = utcnow()
    record_audit(
        db,
        action="user.connection.revoked",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"connected_account_id": connection.id},
    )
    db.commit()
    db.refresh(connection)
    return connection


@router.post("/connections/{connection_id}/probe", response_model=ConnectionProbeResponse)
async def probe_connection(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    connection = db.get(ConnectedAccount, connection_id)
    if not connection or (connection.user_id != current_user.id and not current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    provider_app = db.get(ProviderApp, connection.provider_app_id)
    if not provider_app or provider_app.key != "miro-default":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection probe is currently implemented for Miro connections only")

    checked_at = utcnow()
    refreshed = False
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connection.id))
    if not token_material or not token_material.encrypted_access_token:
        return ConnectionProbeResponse(
            ok=False,
            status="error",
            connected_account_id=connection.id,
            provider_app_key=provider_app.key,
            checked_at=checked_at,
            message="Token material not found",
        )

    access_token = decrypt_text(token_material.encrypted_access_token)
    context = await fetch_miro_token_context(access_token or "")
    if not context.get("ok") and token_material.encrypted_refresh_token and connection.oauth_client_id and connection.encrypted_oauth_client_secret:
        try:
            await refresh_connected_account(db, connection)
            refreshed = True
            db.refresh(connection)
            token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connection.id))
            access_token = decrypt_text(token_material.encrypted_access_token) if token_material else None
            context = await fetch_miro_token_context(access_token or "")
        except HTTPException as exc:
            context = {"ok": False, "error": str(exc.detail)}

    if context.get("ok"):
        connection.last_error = None
        record_audit(
            db,
            action="user.connection.probe",
            actor_type="user",
            actor_id=current_user.id,
            organization_id=current_user.organization_id,
            metadata={"connected_account_id": connection.id, "ok": True, "refreshed": refreshed},
        )
        db.commit()
        return ConnectionProbeResponse(
            ok=True,
            status="ok",
            connected_account_id=connection.id,
            provider_app_key=provider_app.key,
            checked_at=checked_at,
            refreshed=refreshed,
            external_user_id=str(context.get("user_id") or "") or None,
            external_user_name=str(context.get("user_name") or "") or None,
        )

    message = str(context.get("error") or "Probe failed")
    connection.last_error = message
    record_audit(
        db,
        action="user.connection.probe",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"connected_account_id": connection.id, "ok": False, "refreshed": refreshed, "error": message},
    )
    db.commit()
    return ConnectionProbeResponse(
        ok=False,
        status="error",
        connected_account_id=connection.id,
        provider_app_key=provider_app.key,
        checked_at=checked_at,
        refreshed=refreshed,
        message=message,
    )


@router.post("/broker-proxy/miro/{connected_account_id}")
async def broker_proxy_miro(
    connected_account_id: str,
    request: Request,
    db: Session = Depends(get_db),
    x_service_secret: str | None = Header(default=None, alias="X-Service-Secret"),
    x_delegated_credential: str | None = Header(default=None, alias="X-Delegated-Credential"),
):
    connected_account = db.get(ConnectedAccount, connected_account_id)
    if not connected_account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected account not found")
    provider_app = db.get(ProviderApp, connected_account.provider_app_id)
    if not provider_app or provider_app.key != "miro-default":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connected account is not a Miro connection")

    service_client, grant, _, _, _ = authenticate_service(
        db=db,
        provider_app_key=provider_app.key,
        delegated_credential=x_delegated_credential,
        service_secret=x_service_secret,
        requested_scopes=[],
        required_mode=AccessMode.RELAY.value,
        connected_account_id=connected_account.id,
    )
    record_audit(
        db,
        action="service.miro.relay",
        actor_type="service_client",
        actor_id=service_client.id,
        organization_id=grant.organization_id,
        metadata={"grant_id": grant.id, "connected_account_id": connected_account.id},
    )
    db.commit()
    return await relay_miro_request(db, connected_account, request)
