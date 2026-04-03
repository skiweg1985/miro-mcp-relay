from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import asdict, dataclass
from datetime import timedelta
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.oauth_pending_store import pop_oauth_pending_payload, put_oauth_pending
from app.models import ConnectedAccount, ProviderApp, ProviderInstance, TokenMaterial, User
from app.provider_templates import MICROSOFT_GRAPH_DIRECT_TEMPLATE, get_provider_app_by_template
from app.security import decrypt_text, dumps_json, encrypt_text, loads_json, utcnow


@dataclass
class PendingMicrosoftGraphAuth:
    user_id: str
    provider_app_id: str
    verifier: str
    nonce: str
    connected_account_id: str | None
    redirect_uri: str


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _make_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(64))
    challenge = _b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def _make_state() -> str:
    return _b64url(secrets.token_bytes(24))


def _parse_email_like(value: str | None) -> str | None:
    raw = str(value or "").strip().lower()
    if raw and "@" in raw and "." in raw.rsplit("@", 1)[-1]:
        return raw
    return None


def _decode_jwt_payload(token: str | None) -> dict[str, Any] | None:
    try:
        raw = str(token or "")
        parts = raw.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1].replace("-", "+").replace("_", "/")
        padded = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
        return json.loads(base64.b64decode(padded).decode("utf-8"))
    except Exception:
        return None


def _expires_at_from_token_data(token_data: dict[str, Any]) -> Any:
    expires_in = token_data.get("expires_in")
    try:
        seconds = int(expires_in)
    except Exception:
        return None
    return utcnow() + timedelta(seconds=max(0, seconds))


def microsoft_graph_callback_url() -> str:
    settings = get_settings()
    return f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/connections/microsoft-graph/callback"


def _configured_redirect_uri(provider_app: ProviderApp) -> str:
    redirect_uris = loads_json(provider_app.redirect_uris_json, [])
    return str(redirect_uris[0]).strip() if redirect_uris else microsoft_graph_callback_url()


def get_microsoft_graph_provider_app(db: Session, organization_id: str) -> ProviderApp:
    provider_app = get_provider_app_by_template(
        db,
        organization_id=organization_id,
        template_key=MICROSOFT_GRAPH_DIRECT_TEMPLATE,
    )
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Microsoft Graph provider app not found")
    if not provider_app.client_id or not provider_app.encrypted_client_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft Graph provider app is incomplete")
    return provider_app


async def start_microsoft_graph_connection(
    *,
    db: Session,
    user: User,
    connected_account: ConnectedAccount | None = None,
) -> tuple[str, str, ProviderApp]:
    provider_app = get_microsoft_graph_provider_app(db, user.organization_id)
    verifier, challenge = _make_pkce()
    state = _make_state()
    nonce = _make_state()
    redirect_uri = _configured_redirect_uri(provider_app)
    put_oauth_pending(
        db,
        state,
        "microsoft_graph_connect",
        asdict(
            PendingMicrosoftGraphAuth(
                user_id=user.id,
                provider_app_id=provider_app.id,
                verifier=verifier,
                nonce=nonce,
                connected_account_id=connected_account.id if connected_account else None,
                redirect_uri=redirect_uri,
            )
        ),
    )
    instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not instance or not instance.authorization_endpoint:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft Graph provider instance is incomplete")
    params = {
        "client_id": provider_app.client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": " ".join(loads_json(provider_app.default_scopes_json, [])),
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return state, f"{instance.authorization_endpoint}?{httpx.QueryParams(params)}", provider_app


async def finalize_microsoft_graph_callback(db: Session, state: str, code: str) -> RedirectResponse:
    raw = pop_oauth_pending_payload(db, state)
    settings = get_settings()
    if not raw:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=error&message={quote('Invalid or expired Microsoft Graph state')}",
            status_code=302,
        )
    pending = PendingMicrosoftGraphAuth(**raw)
    provider_app = db.get(ProviderApp, pending.provider_app_id)
    if not provider_app or not provider_app.client_id or not provider_app.encrypted_client_secret:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=error&message={quote('Microsoft Graph is not configured')}",
            status_code=302,
        )
    provider_instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not provider_instance or not provider_instance.token_endpoint:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=error&message={quote('Microsoft Graph is not configured')}",
            status_code=302,
        )

    client_secret = decrypt_text(provider_app.encrypted_client_secret)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            provider_instance.token_endpoint,
            data={
                "grant_type": "authorization_code",
                "client_id": provider_app.client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": pending.redirect_uri,
                "code_verifier": pending.verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code >= 400:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=error&message={quote(f'Microsoft Graph token exchange failed ({response.status_code})')}",
            status_code=302,
        )

    token_data = response.json()
    claims = _decode_jwt_payload(token_data.get("id_token")) or {}
    nonce = str(claims.get("nonce") or "").strip()
    if not nonce or nonce != pending.nonce:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=error&message={quote('Microsoft Graph nonce validation failed')}",
            status_code=302,
        )

    user = db.get(User, pending.user_id)
    if not user:
        return RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=error&message={quote('User not found')}",
            status_code=302,
        )

    graph_me = await fetch_graph_me(str(token_data.get("access_token") or ""))
    email = _parse_email_like(
        str(
            graph_me.get("mail")
            or graph_me.get("userPrincipalName")
            or claims.get("email")
            or claims.get("preferred_username")
            or ""
        )
    )
    display_name = str(graph_me.get("displayName") or claims.get("name") or email or user.display_name).strip() or user.display_name
    external_account_ref = str(graph_me.get("id") or claims.get("oid") or claims.get("sub") or "").strip() or None
    redirect_uri = pending.redirect_uri

    connected_account = db.get(ConnectedAccount, pending.connected_account_id) if pending.connected_account_id else None
    if not connected_account:
        connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider_app_id == provider_app.id,
            )
        )
    if not connected_account:
        connected_account = ConnectedAccount(
            organization_id=user.organization_id,
            user_id=user.id,
            provider_app_id=provider_app.id,
        )
        db.add(connected_account)
        db.flush()

    connected_account.external_account_ref = external_account_ref
    connected_account.external_email = email
    connected_account.display_name = display_name
    connected_account.oauth_client_id = provider_app.client_id
    connected_account.encrypted_oauth_client_secret = provider_app.encrypted_client_secret
    connected_account.oauth_redirect_uri = redirect_uri
    connected_account.consented_scopes_json = dumps_json(str(token_data.get("scope") or "").split())
    connected_account.status = "connected"
    connected_account.last_error = None
    connected_account.revoked_at = None

    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material:
        token_material = TokenMaterial(organization_id=user.organization_id, connected_account_id=connected_account.id)
        db.add(token_material)

    token_material.encrypted_access_token = encrypt_text(str(token_data.get("access_token") or ""))
    token_material.encrypted_refresh_token = (
        encrypt_text(str(token_data.get("refresh_token") or "")) if token_data.get("refresh_token") else None
    )
    token_material.token_type = str(token_data.get("token_type") or "Bearer")
    token_material.scopes_json = dumps_json(str(token_data.get("scope") or "").split())
    token_material.expires_at = _expires_at_from_token_data(token_data)
    if token_data.get("refresh_token_expires_in"):
        try:
            token_material.refresh_expires_at = utcnow() + timedelta(seconds=int(token_data.get("refresh_token_expires_in")))
        except Exception:
            token_material.refresh_expires_at = None

    db.commit()
    return RedirectResponse(
        url=f"{settings.frontend_base_url.rstrip('/')}/connect/microsoft-graph?provider_status=connected&connected_account_id={connected_account.id}",
        status_code=302,
    )


async def refresh_microsoft_graph_connection(db: Session, connected_account: ConnectedAccount) -> TokenMaterial:
    provider_app = db.get(ProviderApp, connected_account.provider_app_id)
    if not provider_app or not provider_app.client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft Graph provider app not found")
    provider_instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not provider_instance or not provider_instance.token_endpoint:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft Graph provider instance not found")
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_refresh_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No refresh token stored")

    client_secret = decrypt_text(connected_account.encrypted_oauth_client_secret or provider_app.encrypted_client_secret)
    refresh_token = decrypt_text(token_material.encrypted_refresh_token)
    if not client_secret or not refresh_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stored Microsoft Graph credentials are incomplete")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            provider_instance.token_endpoint,
            data={
                "grant_type": "refresh_token",
                "client_id": connected_account.oauth_client_id or provider_app.client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code >= 400:
        connected_account.last_error = f"microsoft_graph_refresh_failed:{response.status_code}"
        db.commit()
        raise HTTPException(status_code=502, detail=connected_account.last_error)

    token_data = response.json()
    token_material.encrypted_access_token = encrypt_text(str(token_data.get("access_token") or ""))
    if token_data.get("refresh_token"):
        token_material.encrypted_refresh_token = encrypt_text(str(token_data.get("refresh_token") or ""))
    token_material.token_type = str(token_data.get("token_type") or token_material.token_type or "Bearer")
    token_material.scopes_json = dumps_json(str(token_data.get("scope") or "").split())
    token_material.expires_at = _expires_at_from_token_data(token_data)
    connected_account.status = "connected"
    connected_account.last_error = None
    db.commit()
    db.refresh(token_material)
    return token_material


async def fetch_graph_me(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if response.status_code != 200:
        return {"ok": False, "error": f"graph_me_{response.status_code}"}
    data = response.json()
    data["ok"] = True
    return data
