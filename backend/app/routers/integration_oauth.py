"""OAuth connect flows for IntegrationInstance (upstream user tokens -> UserConnection)."""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from typing import Any
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
from app.microsoft_oauth_resolver import (
    ResolvedMicrosoftOAuth,
    microsoft_authorize_url,
    microsoft_graph_oauth_redirect_uri,
    microsoft_token_url,
    resolve_microsoft_oauth_for_graph_integration,
)
from app.oauth_dcr import register_oauth_client_at_endpoint
from app.oauth_pending_store import put_oauth_pending, pop_oauth_pending_payload
from app.schemas import AuthFlowStartResponse
from app.security import decode_jwt_payload_unverified, decrypt_text, dumps_json, encrypt_text, loads_json

router = APIRouter(tags=["integration-oauth"])
logger = logging.getLogger(__name__)

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


def _log_upstream_token_error(*, provider: str, endpoint: str, response: httpx.Response) -> None:
    body = (response.text or "")[:1200]
    logger.warning(
        "upstream token exchange failed: provider=%s status=%s endpoint=%s body=%s",
        provider,
        response.status_code,
        endpoint,
        body,
    )


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


def _graph_scope_for_authorize(cfg: dict, resolved: ResolvedMicrosoftOAuth) -> str:
    if cfg.get("graph_oauth_use_broker_defaults", True) is not False:
        return _graph_scope_string(cfg)
    parts = list(resolved.scope_list) if resolved.scope_list else []
    if not parts:
        return _graph_scope_string(cfg)
    return " ".join(parts)


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


def _miro_static_client_credentials(cfg: dict) -> tuple[str, str]:
    settings = get_settings()
    cid = str(cfg.get("oauth_client_id") or settings.miro_oauth_client_id or "").strip()
    sec = str(cfg.get("oauth_client_secret") or settings.miro_oauth_client_secret or "").strip()
    return cid, sec


def _get_or_create_user_connection_row(
    db: Session,
    *,
    organization_id: str,
    user_id: str,
    instance_id: str,
) -> UserConnection:
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
        db.flush()
    return row


def _ensure_miro_oauth_client_credentials(
    db: Session,
    *,
    current_user: User,
    instance: IntegrationInstance,
    cfg: dict,
    settings,
    redirect_uri: str,
) -> tuple[str, str]:
    dcr_enabled = cfg.get("oauth_dynamic_client_registration_enabled", True) is not False
    static_id, static_sec = _miro_static_client_credentials(cfg)
    if static_id and static_sec:
        return static_id, static_sec
    if not dcr_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="miro_oauth_not_configured")
    conn = _get_or_create_user_connection_row(
        db,
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        instance_id=instance.id,
    )
    reg_url = str(cfg.get("oauth_registration_endpoint") or f"{settings.miro_mcp_base.rstrip('/')}/register").strip()
    if not conn.oauth_dcr_client_id or not conn.oauth_dcr_client_secret_encrypted:
        try:
            cid, sec = register_oauth_client_at_endpoint(
                registration_url=reg_url,
                redirect_uri=redirect_uri,
                client_name=f"broker-miro-{current_user.id[:12]}",
            )
        except Exception:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="miro_oauth_registration_failed")
        conn.oauth_dcr_client_id = cid
        conn.oauth_dcr_client_secret_encrypted = encrypt_text(sec)
        db.add(conn)
        db.flush()
    secret_plain = decrypt_text(conn.oauth_dcr_client_secret_encrypted)
    if not conn.oauth_dcr_client_id or not secret_plain or not str(secret_plain).strip():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="miro_oauth_not_configured")
    return conn.oauth_dcr_client_id, str(secret_plain).strip()


def _miro_resolve_client_for_token_exchange(
    db: Session,
    *,
    user: User,
    instance: IntegrationInstance,
    cfg: dict,
    settings,
) -> tuple[str, str] | tuple[None, None]:
    static_id, static_sec = _miro_static_client_credentials(cfg)
    if static_id and static_sec:
        return static_id, static_sec
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == user.id,
            UserConnection.integration_instance_id == instance.id,
        )
    )
    if not conn or not conn.oauth_dcr_client_id or not conn.oauth_dcr_client_secret_encrypted:
        return None, None
    sec = decrypt_text(conn.oauth_dcr_client_secret_encrypted)
    if not sec or not str(sec).strip():
        return None, None
    return conn.oauth_dcr_client_id, str(sec).strip()


def _upsert_user_connection(
    db: Session,
    *,
    organization_id: str,
    user_id: str,
    instance_id: str,
    access_token: str,
    refresh_token: str | None,
    profile_metadata: dict[str, Any] | None = None,
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
    if profile_metadata:
        existing = loads_json(row.metadata_json, {})
        if not isinstance(existing, dict):
            existing = {}
        merged = {**existing, **profile_metadata}
        row.metadata_json = dumps_json(merged)
    db.flush()


async def _profile_metadata_for_oauth(
    *,
    kind: str,
    token_data: dict[str, Any],
    access_token: str,
) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    scope_raw = token_data.get("scope")
    if isinstance(scope_raw, str) and scope_raw.strip():
        meta["scopes_granted"] = scope_raw.strip()
    if kind == KIND_MICROSOFT_GRAPH:
        meta["provider"] = "microsoft_graph"
        # Primary: Graph user profile (works with User.Read; id_token is often absent or sparse in token responses).
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    "https://graph.microsoft.com/v1.0/me",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            if response.status_code == 200:
                body = response.json()
                if isinstance(body, dict):
                    dn = str(body.get("displayName") or "").strip()
                    if dn:
                        meta["display_name"] = dn
                    mail = str(body.get("mail") or "").strip()
                    upn = str(body.get("userPrincipalName") or "").strip()
                    if mail:
                        meta["email"] = mail
                    elif upn and "@" in upn:
                        meta["email"] = upn
                    if upn:
                        meta["username"] = upn
                    given = str(body.get("givenName") or "").strip()
                    if given:
                        meta["given_name"] = given
                    surname = str(body.get("surname") or "").strip()
                    if surname:
                        meta["surname"] = surname
                    job = str(body.get("jobTitle") or "").strip()
                    if job:
                        meta["job_title"] = job
        except Exception:
            pass

        claims = decode_jwt_payload_unverified(token_data.get("id_token"))
        if isinstance(claims, dict):
            tid = str(claims.get("tid") or "").strip()
            if tid:
                meta["tenant_id"] = tid
            if not meta.get("display_name"):
                name = str(claims.get("name") or "").strip()
                given = str(claims.get("given_name") or "").strip()
                family = str(claims.get("family_name") or "").strip()
                display = name or (f"{given} {family}".strip() if given or family else "")
                if display:
                    meta["display_name"] = display
            if not meta.get("email"):
                email = str(claims.get("email") or "").strip()
                preferred = str(claims.get("preferred_username") or "").strip()
                if email:
                    meta["email"] = email
                elif preferred and "@" in preferred:
                    meta["email"] = preferred
            if not meta.get("username"):
                preferred = str(claims.get("preferred_username") or "").strip()
                if preferred:
                    meta["username"] = preferred
        return meta

    meta["provider"] = "miro"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.miro.com/v1/users/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if response.status_code == 200:
            body = response.json()
            if isinstance(body, dict):
                if body.get("name"):
                    meta["display_name"] = str(body.get("name"))
                if body.get("email"):
                    meta["email"] = str(body.get("email"))
    except Exception:
        pass
    return meta


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
            IntegrationInstance.deleted_at.is_(None),
        )
    )
    if not instance or instance.auth_mode != AuthMode.OAUTH.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")

    cfg = loads_json(integration.config_json, {})
    template = str(cfg.get("template_key") or "").strip()
    redirect_uri = integration_oauth_redirect_uri()

    if template == TEMPLATE_GRAPH:
        graph_redirect_uri = microsoft_graph_oauth_redirect_uri(settings, cfg)
        resolved = resolve_microsoft_oauth_for_graph_integration(db, integration, settings)
        if not resolved:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="microsoft_oauth_not_configured")
        verifier, challenge = _make_pkce()
        state = _make_state()
        scope_str = _graph_scope_for_authorize(cfg, resolved)
        put_oauth_pending(
            db,
            state,
            FLOW_KEY,
            {
                "kind": KIND_MICROSOFT_GRAPH,
                "user_id": current_user.id,
                "instance_id": instance.id,
                "verifier": verifier,
                "graph_redirect_uri": graph_redirect_uri,
            },
        )
        params = {
            "client_id": resolved.client_id,
            "response_type": "code",
            "redirect_uri": graph_redirect_uri,
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
        client_id, _client_secret_unused = _ensure_miro_oauth_client_credentials(
            db,
            current_user=current_user,
            instance=instance,
            cfg=cfg,
            settings=settings,
            redirect_uri=redirect_uri,
        )
        verifier, challenge = _make_pkce()
        state = _make_state()
        scope_parts = cfg.get("oauth_scope")
        if isinstance(scope_parts, list) and scope_parts:
            scope_str = " ".join(str(x).strip() for x in scope_parts if str(x).strip())
        else:
            scope_str = " ".join(settings.miro_scope_list)
        put_oauth_pending(
            db,
            state,
            FLOW_KEY,
            {
                "kind": KIND_MIRO,
                "user_id": current_user.id,
                "instance_id": instance.id,
                "verifier": verifier,
                "miro_use_pkce": True,
            },
        )
        mcp_base = settings.miro_mcp_base.rstrip("/")
        auth_ep = str(cfg.get("oauth_authorization_endpoint") or f"{mcp_base}/authorize").strip()
        params = {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": scope_str,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        db.commit()
        return AuthFlowStartResponse(auth_url=f"{auth_ep}?{httpx.QueryParams(params)}", state=state)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_oauth_template_unsupported")


async def _integration_oauth_callback_impl(
    *,
    code: str | None,
    state: str | None,
    error: str | None,
    db: Session,
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
    if (
        not user
        or not instance
        or instance.organization_id != user.organization_id
        or instance.deleted_at is not None
    ):
        db.commit()
        return _redirect_workspace(ok=False, message="invalid_connection_target")

    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        db.commit()
        return _redirect_workspace(ok=False, message="integration_not_found")

    cfg = loads_json(integration.config_json, {})
    miro_redirect_uri = integration_oauth_redirect_uri()
    graph_redirect_uri = str(raw.get("graph_redirect_uri") or "").strip() or microsoft_graph_oauth_redirect_uri(settings, cfg)

    try:
        if kind == KIND_MICROSOFT_GRAPH:
            resolved = resolve_microsoft_oauth_for_graph_integration(db, integration, settings)
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
                        "redirect_uri": graph_redirect_uri,
                        "code_verifier": verifier,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            if response.status_code >= 400:
                _log_upstream_token_error(provider="microsoft_graph", endpoint=token_endpoint, response=response)
                db.commit()
                return _redirect_workspace(ok=False, message="token_exchange_failed")
            raw_td = response.json()
            token_data = raw_td if isinstance(raw_td, dict) else {}
            access_token = str(token_data.get("access_token") or "").strip()
            refresh_token = str(token_data.get("refresh_token") or "").strip() or None
            if not access_token:
                db.commit()
                return _redirect_workspace(ok=False, message="missing_access_token")

        else:
            client_id, client_secret = _miro_resolve_client_for_token_exchange(
                db,
                user=user,
                instance=instance,
                cfg=cfg,
                settings=settings,
            )
            mcp_token_default = f"{settings.miro_mcp_base.rstrip('/')}/token"
            token_ep = str(cfg.get("oauth_token_endpoint") or mcp_token_default).strip()
            if not client_id or not client_secret:
                db.commit()
                return _redirect_workspace(ok=False, message="miro_oauth_not_configured")
            verifier = str(raw.get("verifier") or "") if raw.get("miro_use_pkce") else ""
            token_body: dict[str, str] = {
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": miro_redirect_uri,
            }
            if verifier:
                token_body["code_verifier"] = verifier
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    token_ep,
                    data=token_body,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            if response.status_code >= 400:
                _log_upstream_token_error(provider="miro", endpoint=token_ep, response=response)
                db.commit()
                return _redirect_workspace(ok=False, message="token_exchange_failed")
            raw_td = response.json()
            token_data = raw_td if isinstance(raw_td, dict) else {}
            access_token = str(token_data.get("access_token") or "").strip()
            refresh_token = str(token_data.get("refresh_token") or "").strip() or None
            if not access_token:
                db.commit()
                return _redirect_workspace(ok=False, message="missing_access_token")

        profile_meta = await _profile_metadata_for_oauth(kind=kind, token_data=token_data, access_token=access_token)
        _upsert_user_connection(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            instance_id=instance.id,
            access_token=access_token,
            refresh_token=refresh_token,
            profile_metadata=profile_meta,
        )
        db.commit()
        return _redirect_workspace(ok=True)
    except Exception as exc:
        db.rollback()
        return _redirect_workspace(ok=False, message=str(exc)[:200])


@router.get("/integration-instances/oauth/callback")
async def integration_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    return await _integration_oauth_callback_impl(code=code, state=state, error=error, db=db)


@router.get("/connections/microsoft-graph/callback")
async def microsoft_graph_connection_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    return await _integration_oauth_callback_impl(code=code, state=state, error=error, db=db)


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
            IntegrationInstance.deleted_at.is_(None),
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
        conn.oauth_dcr_client_id = None
        conn.oauth_dcr_client_secret_encrypted = None
        conn.metadata_json = dumps_json({})
        conn.status = UserConnectionStatus.DISCONNECTED.value
        db.add(conn)
    db.commit()
    return {"ok": True}
