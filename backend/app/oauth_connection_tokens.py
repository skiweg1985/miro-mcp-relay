from __future__ import annotations

from datetime import timedelta

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, ProviderApp, ProviderInstance, TokenMaterial
from app.relay_config import effective_relay_config
from app.security import decrypt_text, dumps_json, encrypt_text, ensure_utc, utcnow


async def refresh_oauth_tokens(
    db: Session,
    *,
    provider_app: ProviderApp,
    provider_instance: ProviderInstance,
    connected_account: ConnectedAccount,
) -> TokenMaterial:
    cfg = effective_relay_config(provider_app)
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token not available")
    if not provider_instance.token_endpoint:
        raise HTTPException(status_code=503, detail="Token endpoint not configured")

    refresh_token = decrypt_text(token_material.encrypted_refresh_token)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token not available")

    if cfg.oauth_refresh_client_credential_source == "provider_app":
        client_id = provider_app.client_id
        client_secret = decrypt_text(provider_app.encrypted_client_secret)
    else:
        client_id = connected_account.oauth_client_id
        client_secret = decrypt_text(connected_account.encrypted_oauth_client_secret)

    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="OAuth client credentials missing for connected account")

    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            provider_instance.token_endpoint,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code >= 400:
        connected_account.last_error = f"oauth_refresh_failed:{response.status_code}"
        db.commit()
        raise HTTPException(status_code=502, detail=f"oauth_refresh_failed:{response.status_code}")

    data = response.json()
    token_material.encrypted_access_token = encrypt_text(data.get("access_token"))
    if data.get("refresh_token"):
        token_material.encrypted_refresh_token = encrypt_text(data.get("refresh_token"))
    elif token_material.encrypted_refresh_token:
        token_material.encrypted_refresh_token = encrypt_text(refresh_token)
    token_material.token_type = data.get("token_type")
    token_material.scopes_json = dumps_json(str(data.get("scope") or "").split())
    expires_in = int(data.get("expires_in") or 3600)
    token_material.expires_at = utcnow().replace(microsecond=0) + timedelta(seconds=expires_in)
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


async def ensure_access_token(
    db: Session,
    *,
    provider_app: ProviderApp,
    provider_instance: ProviderInstance | None,
    connected_account: ConnectedAccount,
) -> str:
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_access_token:
        raise HTTPException(status_code=404, detail="Connected account has no access token")
    exp = ensure_utc(token_material.expires_at)
    if exp is not None and exp <= utcnow():
        if not provider_instance:
            raise HTTPException(status_code=503, detail="Provider instance not found")
        token_material = await refresh_oauth_tokens(
            db,
            provider_app=provider_app,
            provider_instance=provider_instance,
            connected_account=connected_account,
        )
    token = decrypt_text(token_material.encrypted_access_token)
    if not token:
        raise HTTPException(status_code=500, detail="Unable to decrypt access token")
    return token
