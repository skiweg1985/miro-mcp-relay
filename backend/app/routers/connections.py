from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.database import get_db
from app.deps import diagnose_service_access, get_current_user, record_audit, record_service_access_decision, require_csrf, service_access_audit_actor
from app.microsoft_graph import (
    fetch_graph_me,
    finalize_microsoft_graph_callback,
    get_microsoft_graph_provider_app,
    refresh_microsoft_graph_connection,
    start_microsoft_graph_connection,
)
from app.connection_access_details import build_connection_access_details, issue_rotated_connection_access_key
from app.miro import (
    build_miro_access_payload,
    consume_miro_setup_token,
    ensure_legacy_miro_identity,
    fetch_miro_token_context,
    finalize_miro_callback,
    get_miro_provider_app,
    refresh_connected_account,
    start_miro_connection,
)
from app.relay_config import effective_allowed_connection_types, relay_config_from_storage
from app.relay_engine import execute_relay_request
from app.connection_serializers import serialize_connected_account
from app.models import AccessMode, ConnectedAccount, ProviderApp, ProviderInstance, TokenMaterial, User
from app.provider_templates import (
    MICROSOFT_GRAPH_DIRECT_TEMPLATE,
    MIRO_RELAY_TEMPLATE,
    provider_app_matches_template,
)
from app.schemas import (
    ConnectedAccountOut,
    ConnectionAccessDetailsOut,
    ConnectionProbeResponse,
    MiroConnectStartRequest,
    MiroConnectStartResponse,
    MiroRelayAccessResponse,
    MiroSetupExchangeRequest,
    ProviderAppOut,
    ProviderConnectStartRequest,
    ProviderConnectStartResponse,
)
from app.security import decrypt_text, loads_json, utcnow

router = APIRouter(tags=["connections"])


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
    )


@router.get("/provider-apps", response_model=list[ProviderAppOut])
def list_provider_apps(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    provider_apps = db.scalars(
        select(ProviderApp).where(
            ProviderApp.organization_id == current_user.organization_id,
            ProviderApp.is_enabled.is_(True),
        ).order_by(ProviderApp.display_name.asc())
    ).all()
    provider_instances = {
        instance.id: instance
        for instance in db.scalars(
            select(ProviderInstance).where(ProviderInstance.organization_id == current_user.organization_id)
        ).all()
    }
    return [_provider_app_out(provider_app, provider_instances.get(provider_app.provider_instance_id)) for provider_app in provider_apps]


@router.get("/connections", response_model=list[ConnectedAccountOut])
def list_connections(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    connections = db.scalars(select(ConnectedAccount).where(ConnectedAccount.user_id == current_user.id).order_by(ConnectedAccount.connected_at.desc())).all()
    return [serialize_connected_account(db, connection) for connection in connections]


def _load_user_connection(db: Session, current_user: User, connection_id: str) -> ConnectedAccount:
    connection = db.get(ConnectedAccount, connection_id)
    if not connection or (connection.user_id != current_user.id and not current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    return connection


def _connection_provider_app(db: Session, connection: ConnectedAccount) -> ProviderApp:
    provider_app = db.get(ProviderApp, connection.provider_app_id)
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")
    return provider_app


def _ensure_connection_template(db: Session, connection: ConnectedAccount, template_key: str) -> ProviderApp:
    provider_app = _connection_provider_app(db, connection)
    if not provider_app_matches_template(provider_app, template_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection is not compatible with this action")
    return provider_app


@router.post("/connections/provider-connect/start", response_model=ProviderConnectStartResponse)
async def start_provider_connect(
    payload: ProviderConnectStartRequest,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    provider_app = db.scalar(
        select(ProviderApp).where(
            ProviderApp.organization_id == current_user.organization_id,
            ProviderApp.key == payload.provider_app_key,
            ProviderApp.is_enabled.is_(True),
        )
    )
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")

    connected_account = None
    if payload.connected_account_id:
        connected_account = _load_user_connection(db, current_user, payload.connected_account_id)
        if connected_account.provider_app_id != provider_app.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connected account mismatch")

    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        state, auth_url = await start_miro_connection(
            db=db,
            user=current_user,
            target_user=current_user,
            connected_account=connected_account,
        )
    elif provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE):
        state, auth_url, _provider = await start_microsoft_graph_connection(
            db=db,
            user=current_user,
            connected_account=connected_account,
        )
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider app does not support self-service connect")

    record_audit(
        db,
        action="user.connection.start",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"provider_app_key": provider_app.key, "connected_account_id": connected_account.id if connected_account else None, "state": state},
    )
    db.commit()
    return ProviderConnectStartResponse(auth_url=auth_url, state=state, provider_app_key=provider_app.key)


@router.post("/connections/miro/start", response_model=MiroConnectStartResponse)
async def start_miro(
    payload: MiroConnectStartRequest,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    provider_app = get_miro_provider_app(db)
    connected_account = None
    if payload.connected_account_id:
        connected_account = _load_user_connection(db, current_user, payload.connected_account_id)
        if connected_account.provider_app_id != provider_app.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connected account mismatch")
    state, auth_url = await start_miro_connection(
        db=db,
        user=current_user,
        target_user=current_user,
        connected_account=connected_account,
    )
    record_audit(
        db,
        action="miro.connection.start",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"connected_account_id": connected_account.id if connected_account else None, "state": state},
    )
    db.commit()
    return MiroConnectStartResponse(auth_url=auth_url, state=state)


@router.get("/connections/provider-oauth/callback")
def provider_oauth_callback():
    settings = get_settings()
    return RedirectResponse(
        url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?oauth_callback=unsupported",
        status_code=302,
    )


@router.get("/connections/miro/callback")
async def miro_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: Session = Depends(get_db),
):
    from app.core.config import get_settings

    settings = get_settings()
    if error:
        message = "Miro authorization was denied." if error == "access_denied" else (error_description or "Miro returned an authorization error.")
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?miro_status=error&message={quote(message)}",
            status_code=302,
        )
    if not code or not state:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?miro_status=error&message={quote('Missing or expired Miro callback parameters')}",
            status_code=302,
        )
    try:
        return await finalize_miro_callback(db, state, code)
    except HTTPException as exc:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?miro_status=error&message={quote(str(exc.detail))}",
            status_code=302,
        )


@router.get("/connections/microsoft-graph/callback")
async def microsoft_graph_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: Session = Depends(get_db),
):
    from app.core.config import get_settings

    settings = get_settings()
    if error:
        message = "Microsoft Graph authorization was denied." if error == "access_denied" else (error_description or "Microsoft Graph returned an authorization error.")
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?provider_status=error&message={quote(message)}",
            status_code=302,
        )
    if not code or not state:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?provider_status=error&message={quote('Missing or expired Microsoft Graph callback parameters')}",
            status_code=302,
        )
    try:
        return await finalize_microsoft_graph_callback(db, state, code)
    except HTTPException as exc:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations?provider_status=error&message={quote(str(exc.detail))}",
            status_code=302,
        )


@router.post("/connections/{connection_id}/refresh", response_model=ConnectedAccountOut)
async def refresh_connection(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    connection = _load_user_connection(db, current_user, connection_id)
    provider_app = _connection_provider_app(db, connection)
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        await refresh_connected_account(db, connection)
        action = "miro.connection.refresh"
    elif provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE):
        await refresh_microsoft_graph_connection(db, connection)
        action = "microsoft_graph.connection.refresh"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection refresh is not supported for this provider")
    record_audit(
        db,
        action=action,
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"connected_account_id": connection.id},
    )
    db.refresh(connection)
    return serialize_connected_account(db, connection)


@router.post("/connections/{connection_id}/revoke", response_model=ConnectedAccountOut)
def revoke_connection(connection_id: str, current_user: User = Depends(get_current_user), _csrf: str = Depends(require_csrf), db: Session = Depends(get_db)):
    connection = _load_user_connection(db, current_user, connection_id)
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
    return serialize_connected_account(db, connection)


@router.post("/connections/{connection_id}/probe", response_model=ConnectionProbeResponse)
async def probe_connection(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    connection = _load_user_connection(db, current_user, connection_id)
    provider_app = _connection_provider_app(db, connection)
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

    access_token = decrypt_text(token_material.encrypted_access_token) or ""
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        context = await fetch_miro_token_context(access_token)
        if not context.get("ok") and token_material.encrypted_refresh_token:
            try:
                await refresh_connected_account(db, connection)
                refreshed = True
                db.refresh(connection)
                token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connection.id))
                access_token = decrypt_text(token_material.encrypted_access_token) if token_material else ""
                context = await fetch_miro_token_context(access_token or "")
            except HTTPException as exc:
                context = {"ok": False, "error": str(exc.detail)}
        external_user_id = str(context.get("user_id") or "") or None
        external_user_name = str(context.get("user_name") or "") or None
    elif provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE):
        context = await fetch_graph_me(access_token)
        if not context.get("ok") and token_material.encrypted_refresh_token:
            try:
                await refresh_microsoft_graph_connection(db, connection)
                refreshed = True
                db.refresh(connection)
                token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connection.id))
                access_token = decrypt_text(token_material.encrypted_access_token) if token_material else ""
                context = await fetch_graph_me(access_token or "")
            except HTTPException as exc:
                context = {"ok": False, "error": str(exc.detail)}
        external_user_id = str(context.get("id") or "") or None
        external_user_name = str(context.get("displayName") or context.get("userPrincipalName") or "") or None
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection probe is not supported for this provider")

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
            external_user_id=external_user_id,
            external_user_name=external_user_name,
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


@router.get("/connections/{connection_id}/access-details", response_model=ConnectionAccessDetailsOut)
def get_connection_access_details(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    connection = _load_user_connection(db, current_user, connection_id)
    provider_app = _connection_provider_app(db, connection)
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE) and not connection.legacy_profile_id:
        owner = db.get(User, connection.user_id) or current_user
        ensure_legacy_miro_identity(db, user=owner, connected_account=connection)
        db.commit()
        db.refresh(connection)
    return build_connection_access_details(db=db, provider_app=provider_app, connection=connection)


@router.post("/connections/{connection_id}/access-details/rotate", response_model=ConnectionAccessDetailsOut)
def rotate_connection_access_details(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    connection = _load_user_connection(db, current_user, connection_id)
    provider_app = _connection_provider_app(db, connection)
    try:
        relay_token = issue_rotated_connection_access_key(
            db=db,
            current_user=current_user,
            connection=connection,
            provider_app=provider_app,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Access keys are not available for this connection")
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        record_audit(
            db,
            action="miro.connection.relay_token.rotated",
            actor_type="user",
            actor_id=current_user.id,
            organization_id=current_user.organization_id,
            metadata={"connected_account_id": connection.id, "profile_id": connection.legacy_profile_id},
        )
    db.commit()
    db.refresh(connection)
    return build_connection_access_details(
        db=db,
        provider_app=provider_app,
        connection=connection,
        relay_token_plain=relay_token,
    )


@router.get("/connections/{connection_id}/miro-access", response_model=MiroRelayAccessResponse)
def get_miro_access(connection_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    connection = _load_user_connection(db, current_user, connection_id)
    _ensure_connection_template(db, connection, MIRO_RELAY_TEMPLATE)
    if not connection.legacy_profile_id:
        owner = db.get(User, connection.user_id) or current_user
        ensure_legacy_miro_identity(db, user=owner, connected_account=connection)
        db.commit()
        db.refresh(connection)
    return MiroRelayAccessResponse(**build_miro_access_payload(connection))


@router.post("/connections/{connection_id}/miro-access/reset", response_model=MiroRelayAccessResponse)
def reset_miro_access(
    connection_id: str,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    connection = _load_user_connection(db, current_user, connection_id)
    provider_app = _ensure_connection_template(db, connection, MIRO_RELAY_TEMPLATE)
    try:
        relay_token = issue_rotated_connection_access_key(
            db=db,
            current_user=current_user,
            connection=connection,
            provider_app=provider_app,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection is not compatible with this action")
    record_audit(
        db,
        action="miro.connection.relay_token.rotated",
        actor_type="user",
        actor_id=current_user.id,
        organization_id=current_user.organization_id,
        metadata={"connected_account_id": connection.id, "profile_id": connection.legacy_profile_id},
    )
    db.commit()
    db.refresh(connection)
    return MiroRelayAccessResponse(**build_miro_access_payload(connection, relay_token))


@router.post("/connections/miro/setup/exchange", response_model=MiroRelayAccessResponse)
def exchange_miro_setup(
    payload: MiroSetupExchangeRequest,
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    snapshot = consume_miro_setup_token(db, payload.setup_token)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setup session expired")
    connection = _load_user_connection(db, current_user, str(snapshot.get("connected_account_id") or ""))
    _ensure_connection_template(db, connection, MIRO_RELAY_TEMPLATE)
    relay_token = str(snapshot.get("relay_token") or "").strip()
    if not relay_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setup session expired")
    return MiroRelayAccessResponse(**build_miro_access_payload(connection, relay_token))


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
    provider_app = _ensure_connection_template(db, connected_account, MIRO_RELAY_TEMPLATE)

    auth_context, auth_error = diagnose_service_access(
        db=db,
        provider_app_key=provider_app.key,
        delegated_credential=x_delegated_credential,
        service_secret=x_service_secret,
        requested_scopes=[],
        required_mode=AccessMode.RELAY.value,
        connected_account_id=connected_account.id,
    )
    if auth_error:
        event = record_service_access_decision(
            db,
            auth_context=auth_context,
            provider_app_key=provider_app.key,
            requested_scopes=[],
            decision="blocked",
            reason=str(auth_error.detail),
            metadata={"required_mode": AccessMode.RELAY.value, "channel": "miro_proxy"},
        )
        if event and (auth_context.service_client or auth_context.grant):
            b_actor_type, b_actor_id = service_access_audit_actor(auth_context)
            record_audit(
                db,
                action="service.miro.relay.blocked",
                actor_type=b_actor_type,
                actor_id=b_actor_id,
                organization_id=event.organization_id,
                metadata={"token_issue_event_id": event.id, "reason": str(auth_error.detail)},
            )
            db.commit()
        raise auth_error

    provider_instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not provider_instance:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Provider instance not found")
    try:
        response = await execute_relay_request(
            db,
            provider_app=provider_app,
            provider_instance=provider_instance,
            connected_account=connected_account,
            request=request,
        )
    except HTTPException as exc:
        event = record_service_access_decision(
            db,
            auth_context=auth_context,
            provider_app_key=provider_app.key,
            requested_scopes=[],
            decision="error",
            reason=str(exc.detail),
            metadata={"required_mode": AccessMode.RELAY.value, "channel": "miro_proxy"},
        )
        if event:
            err_actor_type, err_actor_id = service_access_audit_actor(auth_context)
            record_audit(
                db,
                action="service.miro.relay.error",
                actor_type=err_actor_type,
                actor_id=err_actor_id,
                organization_id=event.organization_id,
                metadata={
                    "grant_id": auth_context.grant.id,
                    "connected_account_id": connected_account.id,
                    "token_issue_event_id": event.id,
                },
            )
            db.commit()
        raise

    event = record_service_access_decision(
        db,
        auth_context=auth_context,
        provider_app_key=provider_app.key,
        requested_scopes=[],
        decision="relayed" if response.status_code < 400 else "error",
        reason=None if response.status_code < 400 else f"miro_upstream_{response.status_code}",
        metadata={"required_mode": AccessMode.RELAY.value, "channel": "miro_proxy", "upstream_status": response.status_code},
    )
    rel_actor_type, rel_actor_id = service_access_audit_actor(auth_context)
    record_audit(
        db,
        action="service.miro.relay",
        actor_type=rel_actor_type,
        actor_id=rel_actor_id,
        organization_id=auth_context.grant.organization_id,
        metadata={
            "grant_id": auth_context.grant.id,
            "connected_account_id": connected_account.id,
            "token_issue_event_id": event.id if event else None,
            "upstream_status": response.status_code,
        },
    )
    db.commit()
    return response
