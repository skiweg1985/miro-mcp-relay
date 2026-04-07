"""OAuth connect flows for IntegrationInstance (upstream user tokens -> UserConnection)."""

from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.database import get_db
from app.deps import get_current_user, require_csrf
from app.models import AuthMode, Integration, IntegrationInstance, User, UserConnection, UserConnectionStatus
from app.microsoft_oauth_resolver import microsoft_authorize_url, microsoft_token_url, resolve_microsoft_oauth
from app.oauth_pending_store import put_oauth_pending, pop_oauth_pending_payload
from app.schemas import AuthFlowStartResponse
from app.security import encrypt_text, loads_json

router = APIRouter(tags=["integration-oauth"])

FLOW_KEY = "integration_oauth"
TEMPLATE_MIRO = "miro_default"
TEMPLATE_GRAPH = "microsoft_graph_default"
KIND_MIRO = "miro"
KIND_MICROSOFT_GRAPH = "microsoft_graph"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _make_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(64))
    challenge = _b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def _make_state() -> str:
    return _b64url(secrets.token_bytes(24))


def integration_oauth_redirect_uri() -> str:
    settings = get_settings()
    return f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/integration-instances/oauth/callback"


def _redirect_workspace(*, ok: bool, message: str | None = None) -> RedirectResponse:
    settings = get_settings()
    base = f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations-v2"
    if ok:
        return RedirectResponse(f"{base}?connection_status=connected", status_code=302)
    msg = quote(message or "connection_failed", safe="")
    return RedirectResponse(f"{base}?connection_status=error&message={msg}", status_code=302)


def _graph_scope_string(cfg: dict) -> str:
    raw = cfg.get("default_scopes")
    parts: list[str] = ["openid", "offline_access"]
    if isinstance(raw, list) and raw:
        parts.extend(str(x).strip() for x in raw if str(x).strip())
    else:
        parts.append("User.Read")
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return " ".join(out)


def _miro_client_credentials(cfg: dict) -> tuple[str, str]:
    settings = get_settings()
    cid = str(cfg.get("oauth_client_id") or settings.miro_oauth_client_id or "").strip()
    sec = str(cfg.get("oauth_client_secret") or settings.miro_oauth_client_secret or "").strip()
    return cid, sec


def _upsert_user_connection(
    db: Session,
    *,
    organization_id: str,
    user_id: str,
    instance_id: str,
    access_token: str,
    refresh_token: str | None,
) -> None:
    row = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == user_id,
            UserConnection.integration_instance_id == instance_id,
        )
    )
    if not row:
        row = UserConnection(
            organization_id=organization_id,
            user_id=user_id,
            integration_instance_id=instance_id,
        )
        db.add(row)
    row.status = UserConnectionStatus.ACTIVE.value
    row.oauth_access_token_encrypted = encrypt_text(access_token)
    row.oauth_refresh_token_encrypted = encrypt_text(refresh_token) if refresh_token else None
    db.flush()


@router.post("/integration-instances/{instance_id}/oauth/start", response_model=AuthFlowStartResponse)
def start_integration_oauth(
    instance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings = get_settings()
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
        )
    )
    if not instance or instance.auth_mode != AuthMode.OAUTH.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == current_user.organization_id,
        )
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")

    cfg = loads_json(integration.config_json, {})
    template = str(cfg.get("template_key") or "").strip()
    redirect_uri = integration_oauth_redirect_uri()

    if template == TEMPLATE_GRAPH:
        resolved = resolve_microsoft_oauth(db, settings)
        if not resolved:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="microsoft_oauth_not_configured")
        verifier, challenge = _make_pkce()
        state = _make_state()
        scope_str = _graph_scope_string(cfg)
        put_oauth_pending(
            db,
            state,
            FLOW_KEY,
            {
                "kind": KIND_MICROSOFT_GRAPH,
                "user_id": current_user.id,
                "instance_id": instance.id,
                "verifier": verifier,
            },
        )
        params = {
            "client_id": resolved.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": scope_str,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        auth_base = microsoft_authorize_url(resolved.authority_base, resolved.tenant_id)
        db.commit()
        return AuthFlowStartResponse(auth_url=f"{auth_base}?{httpx.QueryParams(params)}", state=state)

    if template == TEMPLATE_MIRO:
        client_id, client_secret = _miro_client_credentials(cfg)
        if not client_id or not client_secret:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="miro_oauth_not_configured")
        auth_ep = str(cfg.get("oauth_authorization_endpoint") or "https://miro.com/oauth/authorize").strip()
        state = _make_state()
        put_oauth_pending(
            db,
            state,
            FLOW_KEY,
            {
                "kind": KIND_MIRO,
                "user_id": current_user.id,
                "instance_id": instance.id,
            },
        )
        params = {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "state": state,
        }
        db.commit()
        return AuthFlowStartResponse(auth_url=f"{auth_ep}?{httpx.QueryParams(params)}", state=state)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_oauth_template_unsupported")


@router.get("/integration-instances/oauth/callback")
async def integration_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    settings = get_settings()
    if error:
        return _redirect_workspace(ok=False, message=error)
    if not code or not state:
        return _redirect_workspace(ok=False, message="missing_callback_parameters")

    raw = pop_oauth_pending_payload(db, state)
    if not raw or str(raw.get("kind") or "") not in (KIND_MICROSOFT_GRAPH, KIND_MIRO):
        return _redirect_workspace(ok=False, message="invalid_oauth_state")

    kind = str(raw.get("kind"))
    user_id = str(raw.get("user_id") or "")
    instance_id = str(raw.get("instance_id") or "")
    user = db.get(User, user_id)
    instance = db.get(IntegrationInstance, instance_id)
    if not user or not instance or instance.organization_id != user.organization_id:
        db.commit()
        return _redirect_workspace(ok=False, message="invalid_connection_target")

    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == user.organization_id,
        )
    )
    if not integration:
        db.commit()
        return _redirect_workspace(ok=False, message="integration_not_found")

    cfg = loads_json(integration.config_json, {})
    redirect_uri = integration_oauth_redirect_uri()

    try:
        if kind == KIND_MICROSOFT_GRAPH:
            resolved = resolve_microsoft_oauth(db, settings)
            if not resolved:
                db.commit()
                return _redirect_workspace(ok=False, message="microsoft_oauth_not_configured")
            verifier = str(raw.get("verifier") or "")
            token_endpoint = microsoft_token_url(resolved.authority_base, resolved.tenant_id)
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    token_endpoint,
                    data={
                        "grant_type": "authorization_code",
                        "client_id": resolved.client_id,
                        "client_secret": resolved.client_secret,
                        "code": code,
                        "redirect_uri": redirect_uri,
                        "code_verifier": verifier,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            if response.status_code >= 400:
                db.commit()
                return _redirect_workspace(ok=False, message="token_exchange_failed")
            token_data = response.json()
            access_token = str(token_data.get("access_token") or "").strip()
            refresh_token = str(token_data.get("refresh_token") or "").strip() or None
            if not access_token:
                db.commit()
                return _redirect_workspace(ok=False, message="missing_access_token")

        else:
            client_id, client_secret = _miro_client_credentials(cfg)
            token_ep = str(cfg.get("oauth_token_endpoint") or "https://api.miro.com/v1/oauth/token").strip()
            if not client_id or not client_secret:
                db.commit()
                return _redirect_workspace(ok=False, message="miro_oauth_not_configured")
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    token_ep,
                    data={
                        "grant_type": "authorization_code",
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "code": code,
                        "redirect_uri": redirect_uri,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            if response.status_code >= 400:
                db.commit()
                return _redirect_workspace(ok=False, message="token_exchange_failed")
            token_data = response.json()
            access_token = str(token_data.get("access_token") or "").strip()
            refresh_token = str(token_data.get("refresh_token") or "").strip() or None
            if not access_token:
                db.commit()
                return _redirect_workspace(ok=False, message="missing_access_token")

        _upsert_user_connection(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            instance_id=instance.id,
            access_token=access_token,
            refresh_token=refresh_token,
        )
        db.commit()
        return _redirect_workspace(ok=True)
    except Exception as exc:
        db.rollback()
        return _redirect_workspace(ok=False, message=str(exc)[:200])


@router.post("/integration-instances/{instance_id}/oauth/disconnect")
def disconnect_integration_oauth(
    instance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
        )
    )
    if not instance or instance.auth_mode != AuthMode.OAUTH.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == current_user.id,
            UserConnection.integration_instance_id == instance.id,
        )
    )
    if conn:
        conn.oauth_access_token_encrypted = None
        conn.oauth_refresh_token_encrypted = None
        conn.status = UserConnectionStatus.DISCONNECTED.value
        db.add(conn)
    db.commit()
    return {"ok": True}
