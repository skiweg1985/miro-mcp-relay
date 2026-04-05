from __future__ import annotations

import json
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
from app.deps import record_audit
from app.miro import decode_jwt_payload, make_pkce, make_state, parse_email_like
from app.models import ConnectedAccount, ProviderApp, ProviderInstance, TokenMaterial, User
from app.oauth_dcr import register_oauth_client_rfc7591
from app.oauth_integration_status import oauth_integration_configured
from app.oauth_pending_store import pop_oauth_pending_payload, put_oauth_pending
from app.security import decrypt_text, dumps_json, encrypt_text, loads_json, utcnow


FLOW_GENERIC = "generic_provider_connect"


@dataclass
class PendingGenericProviderConnect:
    user_id: str
    provider_app_id: str
    connected_account_id: str | None
    redirect_uri: str
    code_verifier: str | None
    dynamic_client_id: str | None = None
    encrypted_dynamic_client_secret: str | None = None


def _pending_generic_from_raw(raw: dict[str, Any]) -> PendingGenericProviderConnect:
    return PendingGenericProviderConnect(
        user_id=str(raw["user_id"]),
        provider_app_id=str(raw["provider_app_id"]),
        connected_account_id=raw.get("connected_account_id"),
        redirect_uri=str(raw["redirect_uri"]),
        code_verifier=raw.get("code_verifier"),
        dynamic_client_id=raw.get("dynamic_client_id"),
        encrypted_dynamic_client_secret=raw.get("encrypted_dynamic_client_secret"),
    )


def generic_provider_oauth_callback_url() -> str:
    settings = get_settings()
    return f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/connections/provider-oauth/callback"


def _instance_settings(instance: ProviderInstance) -> dict[str, Any]:
    return loads_json(instance.settings_json, {})


def _use_pkce(instance: ProviderInstance) -> bool:
    return bool(_instance_settings(instance).get("use_pkce"))


def assert_canonical_redirect_registered(provider_app: ProviderApp, canonical: str) -> None:
    uris = loads_json(provider_app.redirect_uris_json, [])
    c = canonical.strip()
    for u in uris:
        if str(u).strip() == c:
            return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "OAuth redirect URI is not registered on this integration. "
            f"Add this exact URL to the provider app's redirect URIs: {canonical}"
        ),
    )


def validate_generic_provider_ready_for_connect(provider_app: ProviderApp, instance: ProviderInstance) -> None:
    if not instance.is_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider instance is disabled")
    ok, reason = oauth_integration_configured(
        provider_app=provider_app,
        provider_instance=instance,
        needs_tenant=False,
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason or "Integration is not configured")


async def start_generic_provider_connection(
    *,
    db: Session,
    user: User,
    provider_app: ProviderApp,
    connected_account: ConnectedAccount | None,
) -> tuple[str, str]:
    if provider_app.deleted_at is not None or not provider_app.is_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider app is not available")
    if provider_app.template_key is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a custom provider app")
    instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider instance not found")

    validate_generic_provider_ready_for_connect(provider_app, instance)

    canonical = generic_provider_oauth_callback_url()
    assert_canonical_redirect_registered(provider_app, canonical)

    state = make_state()
    pkce = _use_pkce(instance)
    code_verifier: str | None
    challenge: str | None
    if pkce:
        code_verifier, challenge = make_pkce()
    else:
        code_verifier, challenge = None, None

    dynamic_client_id: str | None = None
    encrypted_dynamic_client_secret: str | None = None
    if provider_app.oauth_dynamic_client_registration_enabled:
        reg_data = await register_oauth_client_rfc7591(
            registration_endpoint=str(provider_app.oauth_registration_endpoint or "").strip(),
            redirect_uri=canonical,
            auth_method=str(provider_app.oauth_registration_auth_method or "none"),
            client_name_prefix="broker-generic",
        )
        dynamic_client_id = str(reg_data.get("client_id") or "").strip()
        sec_raw = reg_data.get("client_secret")
        if sec_raw:
            encrypted_dynamic_client_secret = encrypt_text(str(sec_raw))
        elif not pkce:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dynamic registration did not return a client secret; enable PKCE on the provider instance",
            )

    put_oauth_pending(
        db,
        state,
        FLOW_GENERIC,
        asdict(
            PendingGenericProviderConnect(
                user_id=user.id,
                provider_app_id=provider_app.id,
                connected_account_id=connected_account.id if connected_account else None,
                redirect_uri=canonical,
                code_verifier=code_verifier,
                dynamic_client_id=dynamic_client_id,
                encrypted_dynamic_client_secret=encrypted_dynamic_client_secret,
            )
        ),
    )

    scopes = loads_json(provider_app.default_scopes_json, [])
    scope_str = " ".join(str(s) for s in scopes if str(s).strip())

    effective_client_id = (
        dynamic_client_id if dynamic_client_id else str(provider_app.client_id or "").strip()
    )
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": effective_client_id,
        "redirect_uri": canonical,
        "scope": scope_str,
        "state": state,
    }
    if pkce and challenge:
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"

    auth_url = f"{instance.authorization_endpoint.strip()}?{httpx.QueryParams(params)}"
    return state, auth_url


def _expires_at_from_token_data(token_data: dict[str, Any]) -> Any:
    try:
        seconds = int(token_data.get("expires_in") or 0)
    except Exception:
        return None
    if seconds <= 0:
        return None
    return utcnow() + timedelta(seconds=seconds)


async def _exchange_authorization_code(
    *,
    token_endpoint: str,
    code: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str | None,
    code_verifier: str | None,
) -> dict[str, Any]:
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
    }
    if code_verifier:
        data["code_verifier"] = code_verifier
    if client_secret:
        data["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            token_endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Token exchange failed ({response.status_code})",
        )
    try:
        return response.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Token exchange returned invalid JSON")


async def _fetch_userinfo(access_token: str, userinfo_url: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            userinfo_url.strip(),
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if response.status_code != 200:
        return None
    try:
        body = response.json()
        return body if isinstance(body, dict) else None
    except json.JSONDecodeError:
        return None


def _identity_from_userinfo_or_token(
    userinfo: dict[str, Any] | None,
    id_token_claims: dict[str, Any],
) -> tuple[str | None, str | None, str | None]:
    if userinfo:
        ref = str(userinfo.get("sub") or userinfo.get("id") or "").strip() or None
        email = parse_email_like(str(userinfo.get("email") or ""))
        name = str(userinfo.get("name") or userinfo.get("preferred_username") or email or "").strip() or None
        return ref, email, name
    claims = id_token_claims or {}
    ref = str(claims.get("sub") or "").strip() or None
    email = parse_email_like(str(claims.get("email") or claims.get("preferred_username") or ""))
    name = str(claims.get("name") or claims.get("preferred_username") or email or "").strip() or None
    return ref, email, name


async def finalize_generic_provider_callback(db: Session, state: str, code: str) -> RedirectResponse:
    settings = get_settings()
    fe = settings.frontend_base_url.rstrip("/")

    raw = pop_oauth_pending_payload(db, state)
    if not raw:
        return RedirectResponse(
            url=f"{fe}/workspace/integrations?provider_status=error&message={quote('Invalid or expired OAuth state')}",
            status_code=302,
        )

    pending = _pending_generic_from_raw(raw)
    provider_app = db.get(ProviderApp, pending.provider_app_id)
    user = db.get(User, pending.user_id)
    if not provider_app or not user:
        return RedirectResponse(
            url=f"{fe}/workspace/integrations?provider_status=error&message={quote('Connection data is no longer valid')}",
            status_code=302,
        )

    instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not instance or not instance.token_endpoint:
        return RedirectResponse(
            url=f"{fe}/workspace/integrations?provider_status=error&message={quote('Provider is not configured')}",
            status_code=302,
        )

    pkce = _use_pkce(instance)
    eff_client_id = (
        str(pending.dynamic_client_id or "").strip()
        or str(provider_app.client_id or "").strip()
    )
    if pending.encrypted_dynamic_client_secret:
        client_secret = decrypt_text(pending.encrypted_dynamic_client_secret)
    else:
        client_secret = decrypt_text(provider_app.encrypted_client_secret) if provider_app.encrypted_client_secret else None
    if not pkce and not client_secret:
        return RedirectResponse(
            url=f"{fe}/workspace/integrations?provider_status=error&message={quote('Client secret is missing for this integration')}",
            status_code=302,
        )

    try:
        token_data = await _exchange_authorization_code(
            token_endpoint=instance.token_endpoint.strip(),
            code=code,
            redirect_uri=pending.redirect_uri,
            client_id=eff_client_id,
            client_secret=client_secret,
            code_verifier=pending.code_verifier,
        )
    except HTTPException as exc:
        return RedirectResponse(
            url=f"{fe}/workspace/integrations?provider_status=error&message={quote(str(exc.detail))}",
            status_code=302,
        )

    access_token = str(token_data.get("access_token") or "")
    raw_id = decode_jwt_payload(token_data.get("id_token"))
    id_claims: dict[str, Any] = raw_id if isinstance(raw_id, dict) else {}

    userinfo: dict[str, Any] | None = None
    ui = (instance.userinfo_endpoint or "").strip()
    if ui and access_token:
        userinfo = await _fetch_userinfo(access_token, ui)

    ext_ref, email, display_name = _identity_from_userinfo_or_token(userinfo, id_claims)
    if not ext_ref:
        ext_ref = str(id_claims.get("sub") or "").strip() or None
    if not display_name:
        display_name = user.display_name

    connected_account: ConnectedAccount | None = None
    if pending.connected_account_id:
        connected_account = db.get(ConnectedAccount, pending.connected_account_id)
        if (
            not connected_account
            or connected_account.user_id != user.id
            or connected_account.provider_app_id != provider_app.id
        ):
            return RedirectResponse(
                url=f"{fe}/workspace/integrations?provider_status=error&message={quote('Reconnect target not found')}",
                status_code=302,
            )
    if not connected_account:
        connected_account = ConnectedAccount(
            organization_id=user.organization_id,
            user_id=user.id,
            provider_app_id=provider_app.id,
        )
        db.add(connected_account)
        db.flush()

    connected_account.external_account_ref = ext_ref
    connected_account.external_email = email
    connected_account.display_name = display_name
    if pending.dynamic_client_id:
        connected_account.oauth_client_id = pending.dynamic_client_id
        connected_account.encrypted_oauth_client_secret = pending.encrypted_dynamic_client_secret
    else:
        connected_account.oauth_client_id = provider_app.client_id
        connected_account.encrypted_oauth_client_secret = provider_app.encrypted_client_secret
    connected_account.oauth_redirect_uri = pending.redirect_uri
    connected_account.consented_scopes_json = dumps_json(str(token_data.get("scope") or "").split())
    connected_account.status = "connected"
    connected_account.last_error = None
    connected_account.revoked_at = None

    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material:
        token_material = TokenMaterial(organization_id=user.organization_id, connected_account_id=connected_account.id)
        db.add(token_material)

    token_material.encrypted_access_token = encrypt_text(access_token)
    token_material.encrypted_refresh_token = (
        encrypt_text(str(token_data.get("refresh_token"))) if token_data.get("refresh_token") else None
    )
    token_material.token_type = str(token_data.get("token_type") or "Bearer")
    token_material.scopes_json = connected_account.consented_scopes_json
    token_material.expires_at = _expires_at_from_token_data(token_data)
    if token_data.get("refresh_token_expires_in"):
        try:
            token_material.refresh_expires_at = utcnow() + timedelta(seconds=int(token_data.get("refresh_token_expires_in")))
        except Exception:
            token_material.refresh_expires_at = None

    record_audit(
        db,
        action="generic_provider.connection.connected",
        actor_type="user",
        actor_id=user.id,
        organization_id=user.organization_id,
        metadata={
            "provider_app_id": provider_app.id,
            "connected_account_id": connected_account.id,
            "external_account_ref": ext_ref,
        },
    )
    db.commit()

    return RedirectResponse(
        url=f"{fe}/workspace/integrations?provider_status=connected&connected_account_id={connected_account.id}",
        status_code=302,
    )


async def refresh_generic_provider_connection(db: Session, connected_account: ConnectedAccount) -> TokenMaterial:
    provider_app = db.get(ProviderApp, connected_account.provider_app_id)
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Provider app not found")
    instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not instance or not instance.token_endpoint:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Token endpoint not configured")

    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token not available")

    refresh_token = decrypt_text(token_material.encrypted_refresh_token)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token not available")

    pkce = _use_pkce(instance)
    client_id = str((connected_account.oauth_client_id or provider_app.client_id or "")).strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="OAuth client ID missing for refresh")
    if connected_account.encrypted_oauth_client_secret:
        client_secret = decrypt_text(connected_account.encrypted_oauth_client_secret)
    else:
        client_secret = decrypt_text(provider_app.encrypted_client_secret) if provider_app.encrypted_client_secret else None

    form: dict[str, str] = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    if not pkce:
        if not client_secret:
            raise HTTPException(status_code=400, detail="Client secret missing for refresh")
        form["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            instance.token_endpoint.strip(),
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code >= 400:
        connected_account.last_error = f"oauth_refresh_failed:{response.status_code}"
        db.commit()
        raise HTTPException(status_code=502, detail=f"oauth_refresh_failed:{response.status_code}")

    data = response.json()
    token_material.encrypted_access_token = encrypt_text(str(data.get("access_token") or ""))
    if data.get("refresh_token"):
        token_material.encrypted_refresh_token = encrypt_text(str(data.get("refresh_token")))
    token_material.token_type = str(data.get("token_type") or "Bearer")
    token_material.scopes_json = dumps_json(str(data.get("scope") or "").split())
    exp = _expires_at_from_token_data(data)
    if exp:
        token_material.expires_at = exp
    if data.get("refresh_token_expires_in"):
        try:
            token_material.refresh_expires_at = utcnow() + timedelta(seconds=int(data.get("refresh_token_expires_in")))
        except Exception:
            pass
    connected_account.status = "connected"
    connected_account.last_error = None
    db.commit()
    db.refresh(token_material)
    return token_material


async def probe_generic_connection(
    *,
    connected_account: ConnectedAccount,
    access_token: str,
    provider_instance: ProviderInstance,
) -> dict[str, Any]:
    ui = (provider_instance.userinfo_endpoint or "").strip()
    if ui:
        info = await _fetch_userinfo(access_token, ui)
        if info:
            ref, _email, name = _identity_from_userinfo_or_token(info, {})
            return {
                "ok": True,
                "external_user_id": ref or connected_account.external_account_ref,
                "external_user_name": name or connected_account.display_name,
            }
    return {
        "ok": True,
        "external_user_id": connected_account.external_account_ref,
        "external_user_name": connected_account.display_name,
    }


