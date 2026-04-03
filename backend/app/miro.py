from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.responses import RedirectResponse, StreamingResponse

from app.core.config import get_settings
from app.models import AccessMode, ConnectedAccount, Organization, ProviderApp, TokenMaterial, User
from app.provider_templates import MIRO_RELAY_TEMPLATE, get_provider_app_by_template
from app.security import decrypt_text, dumps_json, encrypt_text, loads_json, lookup_secret_hash, utcnow, verify_lookup_secret


@dataclass
class PendingMiroAuth:
    user_id: str
    provider_app_id: str
    verifier: str
    email_hint: str | None
    connected_account_id: str | None
    oauth_client_id: str
    oauth_client_secret: str
    redirect_uri: str
    created_at: float


PENDING_AUTH: dict[str, PendingMiroAuth] = {}
BREAKER = {"consecutive_fails": 0, "open_until": 0.0}
PENDING_SETUP: dict[str, dict[str, Any]] = {}


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def make_pkce() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(64))
    challenge = b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def make_state() -> str:
    return b64url(secrets.token_bytes(24))


def token_context_url() -> str:
    settings = get_settings()
    return f"{settings.miro_api_base.rstrip('/')}/v1/oauth-token"


def miro_authorize_url() -> str:
    settings = get_settings()
    return f"{settings.miro_mcp_base.rstrip('/')}/authorize"


def miro_token_url() -> str:
    settings = get_settings()
    return f"{settings.miro_mcp_base.rstrip('/')}/token"


def miro_register_url() -> str:
    settings = get_settings()
    return f"{settings.miro_mcp_base.rstrip('/')}/register"


def miro_proxy_url() -> str:
    settings = get_settings()
    return f"{settings.miro_mcp_base.rstrip('/')}/"


def miro_ready_url() -> str:
    settings = get_settings()
    return f"{settings.miro_mcp_base.rstrip('/')}/.well-known/oauth-protected-resource"


def callback_url() -> str:
    settings = get_settings()
    return f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/connections/miro/callback"


def public_miro_mcp_url(profile_id: str) -> str:
    settings = get_settings()
    return f"{settings.broker_public_base_url.rstrip('/')}/miro/mcp/{quote(profile_id, safe='')}"


def cleanup_pending_auth(max_age_seconds: int = 900) -> None:
    now = time.time()
    expired = [state for state, payload in PENDING_AUTH.items() if now - payload.created_at > max_age_seconds]
    for state in expired:
        PENDING_AUTH.pop(state, None)


def cleanup_pending_setup(max_age_seconds: int = 900) -> None:
    now = time.time()
    expired = [token for token, payload in PENDING_SETUP.items() if now - float(payload.get("created_at") or 0.0) > max_age_seconds]
    for token in expired:
        PENDING_SETUP.pop(token, None)


def parse_email_like(value: str | None) -> str | None:
    raw = str(value or "").strip().lower()
    if raw and "@" in raw and "." in raw.rsplit("@", 1)[-1]:
        return raw
    return None


def canonical_profile_id(value: str | None) -> str:
    return str(value or "").strip().lower().replace("@", "_")


def decode_jwt_payload(token: str | None) -> dict[str, Any] | None:
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


def extract_identity_from_token_response(token_data: dict[str, Any]) -> dict[str, Any]:
    claims = decode_jwt_payload(token_data.get("id_token"))
    claims = claims if isinstance(claims, dict) else {}
    email = parse_email_like(claims.get("email") or claims.get("upn") or claims.get("preferred_username"))
    email_verified_raw = claims.get("email_verified")
    email_verified = email_verified_raw if isinstance(email_verified_raw, bool) else None
    user_id = str(claims.get("sub") or "").strip() or None
    user_name = str(claims.get("name") or claims.get("preferred_username") or "").strip() or None
    return {
        "email": email,
        "email_verified": email_verified,
        "user_id": user_id,
        "user_name": user_name,
    }


async def fetch_miro_token_context(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            token_context_url(),
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if response.status_code != 200:
        return {"ok": False, "error": f"token_context_{response.status_code}"}
    data = response.json()
    return {
        "ok": True,
        "user_id": data.get("user", {}).get("id"),
        "user_name": data.get("user", {}).get("name"),
    }


async def register_dynamic_client() -> dict[str, str]:
    redirect_uri = callback_url()
    payload = {
        "client_name": f"oauth-broker-miro-{make_state()}",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "client_secret_post",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(miro_register_url(), json=payload)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"miro_client_registration_failed:{response.status_code}")
    data = response.json()
    return {
        "client_id": data["client_id"],
        "client_secret": data["client_secret"],
        "redirect_uri": redirect_uri,
    }


def get_miro_provider_app(db: Session) -> ProviderApp:
    organization = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not organization:
        raise HTTPException(status_code=404, detail="Miro provider app not found")
    provider_app = get_provider_app_by_template(
        db,
        organization_id=organization.id,
        template_key=MIRO_RELAY_TEMPLATE,
    )
    if not provider_app:
        raise HTTPException(status_code=404, detail="Miro provider app not found")
    return provider_app


async def start_miro_connection(
    *,
    db: Session,
    user: User,
    target_user: User,
    connected_account: ConnectedAccount | None = None,
) -> tuple[str, str]:
    cleanup_pending_auth()
    provider_app = get_miro_provider_app(db)
    verifier, challenge = make_pkce()
    state = make_state()

    if connected_account and connected_account.oauth_client_id and connected_account.encrypted_oauth_client_secret and connected_account.oauth_redirect_uri:
        client_id = connected_account.oauth_client_id
        client_secret = decrypt_text(connected_account.encrypted_oauth_client_secret) or ""
        redirect_uri = connected_account.oauth_redirect_uri
    else:
        registration = await register_dynamic_client()
        client_id = registration["client_id"]
        client_secret = registration["client_secret"]
        redirect_uri = registration["redirect_uri"]

    PENDING_AUTH[state] = PendingMiroAuth(
        user_id=target_user.id,
        provider_app_id=provider_app.id,
        verifier=verifier,
        email_hint=parse_email_like(target_user.email),
        connected_account_id=connected_account.id if connected_account else None,
        oauth_client_id=client_id,
        oauth_client_secret=client_secret,
        redirect_uri=redirect_uri,
        created_at=time.time(),
    )

    settings = get_settings()
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(loads_json(provider_app.default_scopes_json, settings.miro_scope_list)),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{miro_authorize_url()}?{httpx.QueryParams(params)}"
    return state, auth_url


async def exchange_code_for_tokens(payload: PendingMiroAuth, code: str) -> dict[str, Any]:
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": payload.redirect_uri,
        "client_id": payload.oauth_client_id,
        "client_secret": payload.oauth_client_secret,
        "code_verifier": payload.verifier,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(miro_token_url(), data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"miro_token_exchange_failed:{response.status_code}")
    return response.json()


def email_check_status(expected_email: str | None, detected_email: str | None) -> tuple[str, bool | None]:
    if expected_email and detected_email:
        matched = expected_email == detected_email
        return ("match" if matched else "mismatch"), matched
    if not expected_email:
        return "expected_missing", None
    return "unavailable", None


def issue_relay_token() -> str:
    return secrets.token_urlsafe(24)


def reserve_legacy_profile_id(db: Session, user: User, connected_account_id: str | None = None) -> str:
    base_email = parse_email_like(user.email) or parse_email_like(user.display_name) or user.id
    base = canonical_profile_id(base_email)
    candidate = base
    suffix = 1
    while True:
        existing = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.organization_id == user.organization_id,
                ConnectedAccount.legacy_profile_id == candidate,
            )
        )
        if not existing or existing.id == connected_account_id:
            return candidate
        suffix += 1
        candidate = f"{base}-{suffix}"


def ensure_legacy_miro_identity(db: Session, *, user: User, connected_account: ConnectedAccount) -> str | None:
    relay_token: str | None = None
    if not connected_account.legacy_profile_id:
        connected_account.legacy_profile_id = reserve_legacy_profile_id(db, user, connected_account.id)
    if not connected_account.legacy_relay_token_hash:
        relay_token = issue_relay_token()
        connected_account.legacy_relay_token_hash = lookup_secret_hash(relay_token)
    return relay_token


def build_miro_access_payload(connected_account: ConnectedAccount, relay_token: str | None = None) -> dict[str, Any]:
    profile_id = connected_account.legacy_profile_id or ""
    mcp_url = public_miro_mcp_url(profile_id)
    mcp_config_json = None
    credentials_bundle_json = None
    if relay_token:
        mcp_config_json = json.dumps(
            {
                "mcpServers": {
                    "miro_personal": {
                        "type": "streamable-http",
                        "url": mcp_url,
                        "headers": {
                            "X-Relay-Key": relay_token,
                        },
                    }
                }
            },
            indent=2,
        )
        credentials_bundle_json = json.dumps(
            {
                "profile_id": profile_id,
                "relay_token": relay_token,
                "mcp_url": mcp_url,
            },
            indent=2,
        )
    return {
        "connected_account_id": connected_account.id,
        "profile_id": profile_id,
        "mcp_url": mcp_url,
        "has_relay_token": bool(connected_account.legacy_relay_token_hash),
        "relay_token": relay_token,
        "mcp_config_json": mcp_config_json,
        "credentials_bundle_json": credentials_bundle_json,
        "connection_status": connected_account.status,
        "display_name": connected_account.display_name,
        "external_email": connected_account.external_email,
    }


def issue_miro_setup_token(*, connected_account_id: str, relay_token: str) -> str:
    cleanup_pending_setup()
    setup_token = b64url(secrets.token_bytes(24))
    PENDING_SETUP[setup_token] = {
        "connected_account_id": connected_account_id,
        "relay_token": relay_token,
        "created_at": time.time(),
    }
    return setup_token


def consume_miro_setup_token(setup_token: str) -> dict[str, Any] | None:
    cleanup_pending_setup()
    return PENDING_SETUP.pop(setup_token, None)


def resolve_legacy_miro_connection(db: Session, profile_id: str) -> ConnectedAccount | None:
    return db.scalar(select(ConnectedAccount).where(ConnectedAccount.legacy_profile_id == profile_id))


def validate_relay_token(connected_account: ConnectedAccount, supplied_token: str | None) -> bool:
    raw = str(supplied_token or "").strip()
    if not raw:
        return False
    return verify_lookup_secret(raw, connected_account.legacy_relay_token_hash)


async def finalize_miro_callback(db: Session, state: str, code: str) -> RedirectResponse:
    payload = PENDING_AUTH.pop(state, None)
    if not payload:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    user = db.get(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found for OAuth state")

    token_data = await exchange_code_for_tokens(payload, code)
    identity = extract_identity_from_token_response(token_data)
    token_context = await fetch_miro_token_context(token_data["access_token"])
    detected_email = identity.get("email")
    expected_email = payload.email_hint or parse_email_like(user.email)
    check_status, email_match = email_check_status(expected_email, detected_email)
    settings = get_settings()
    if settings.miro_oauth_email_mode == "strict" and check_status != "match":
        raise HTTPException(status_code=403, detail="Miro identity did not match expected email")

    connected_account = db.get(ConnectedAccount, payload.connected_account_id) if payload.connected_account_id else None
    provider_app = db.get(ProviderApp, payload.provider_app_id)
    if not provider_app:
        raise HTTPException(status_code=404, detail="Provider app not found")

    if not connected_account:
        connected_account = ConnectedAccount(
            organization_id=user.organization_id,
            user_id=user.id,
            provider_app_id=provider_app.id,
            external_account_ref=str(token_context.get("user_id") or identity.get("user_id") or state),
            external_email=detected_email,
            display_name=str(token_context.get("user_name") or identity.get("user_name") or user.display_name),
            oauth_client_id=payload.oauth_client_id,
            encrypted_oauth_client_secret=encrypt_text(payload.oauth_client_secret),
            oauth_redirect_uri=payload.redirect_uri,
            consented_scopes_json=dumps_json(str(token_data.get("scope") or "").split()),
            status="connected",
        )
        db.add(connected_account)
        db.flush()
    else:
        connected_account.external_account_ref = str(token_context.get("user_id") or identity.get("user_id") or connected_account.external_account_ref or "")
        connected_account.external_email = detected_email or connected_account.external_email
        connected_account.display_name = str(token_context.get("user_name") or identity.get("user_name") or connected_account.display_name or user.display_name)
        connected_account.oauth_client_id = payload.oauth_client_id
        connected_account.encrypted_oauth_client_secret = encrypt_text(payload.oauth_client_secret)
        connected_account.oauth_redirect_uri = payload.redirect_uri
        connected_account.consented_scopes_json = dumps_json(str(token_data.get("scope") or "").split())
        connected_account.status = "connected"
        connected_account.last_error = None
        connected_account.revoked_at = None

    relay_token = ensure_legacy_miro_identity(db, user=user, connected_account=connected_account)

    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    expires_in = int(token_data.get("expires_in") or 3600)
    if token_material is None:
        token_material = TokenMaterial(
            organization_id=user.organization_id,
            connected_account_id=connected_account.id,
        )
        db.add(token_material)
    token_material.encrypted_access_token = encrypt_text(token_data.get("access_token"))
    token_material.encrypted_refresh_token = encrypt_text(token_data.get("refresh_token"))
    token_material.token_type = token_data.get("token_type")
    token_material.scopes_json = dumps_json(str(token_data.get("scope") or "").split())
    token_material.expires_at = utcnow().replace(microsecond=0) + timedelta(seconds=expires_in)
    token_material.refresh_expires_at = None

    metadata = {
        "connected_account_id": connected_account.id,
        "expected_email": expected_email,
        "detected_email": detected_email,
        "email_check_status": check_status,
        "email_match": email_match,
        "token_context_ok": token_context.get("ok", False),
        "token_context_error": token_context.get("error"),
    }
    from app.deps import record_audit

    record_audit(
        db,
        action="miro.connection.connected",
        actor_type="user",
        actor_id=user.id,
        organization_id=user.organization_id,
        metadata=metadata,
    )
    db.commit()
    redirect_url = f"{settings.frontend_base_url.rstrip('/')}/connect/miro?miro_status=connected&connected_account_id={connected_account.id}"
    if relay_token:
        setup_token = issue_miro_setup_token(connected_account_id=connected_account.id, relay_token=relay_token)
        redirect_url = f"{redirect_url}&miro_setup={quote(setup_token, safe='')}"
    return RedirectResponse(url=redirect_url, status_code=302)


async def refresh_connected_account(db: Session, connected_account: ConnectedAccount) -> TokenMaterial:
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token not available")
    if not connected_account.oauth_client_id or not connected_account.encrypted_oauth_client_secret:
        raise HTTPException(status_code=400, detail="OAuth client credentials missing for connected account")
    refresh_token = decrypt_text(token_material.encrypted_refresh_token)
    client_secret = decrypt_text(connected_account.encrypted_oauth_client_secret)
    if not refresh_token or not client_secret:
        raise HTTPException(status_code=400, detail="Refresh secret material unavailable")

    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": connected_account.oauth_client_id,
        "client_secret": client_secret,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(miro_token_url(), data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
    if response.status_code >= 400:
        connected_account.last_error = f"refresh_failed:{response.status_code}"
        db.commit()
        raise HTTPException(status_code=502, detail=f"miro_refresh_failed:{response.status_code}")
    data = response.json()
    token_material.encrypted_access_token = encrypt_text(data.get("access_token"))
    token_material.encrypted_refresh_token = encrypt_text(data.get("refresh_token") or refresh_token)
    token_material.token_type = data.get("token_type")
    token_material.scopes_json = dumps_json(str(data.get("scope") or "").split())
    token_material.expires_at = utcnow().replace(microsecond=0) + timedelta(seconds=int(data.get("expires_in") or 3600))
    connected_account.status = "connected"
    connected_account.last_error = None
    db.commit()
    db.refresh(token_material)
    return token_material


async def current_access_token(db: Session, connected_account: ConnectedAccount) -> str:
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
    if not token_material or not token_material.encrypted_access_token:
        raise HTTPException(status_code=404, detail="Connected account has no access token")
    if token_material.expires_at and token_material.expires_at <= utcnow():
        token_material = await refresh_connected_account(db, connected_account)
    token = decrypt_text(token_material.encrypted_access_token)
    if not token:
        raise HTTPException(status_code=500, detail="Unable to decrypt access token")
    return token


def breaker_open() -> bool:
    return time.time() * 1000 < BREAKER["open_until"]


def breaker_mark_success() -> None:
    BREAKER["consecutive_fails"] = 0


def breaker_mark_failure() -> None:
    settings = get_settings()
    BREAKER["consecutive_fails"] += 1
    if BREAKER["consecutive_fails"] >= settings.miro_breaker_fail_threshold:
        BREAKER["open_until"] = time.time() * 1000 + settings.miro_breaker_open_ms
        BREAKER["consecutive_fails"] = 0


async def relay_miro_request(db: Session, connected_account: ConnectedAccount, request: Request) -> StreamingResponse:
    if breaker_open():
        raise HTTPException(status_code=503, detail="Miro upstream circuit is open")

    settings = get_settings()
    request_body = await request.body()
    access_token = await current_access_token(db, connected_account)
    last_response: httpx.Response | None = None
    client: httpx.AsyncClient | None = None

    try:
        for attempt in range(settings.miro_retry_count + 1):
            client = httpx.AsyncClient(timeout=None)
            upstream_request = client.build_request(
                "POST",
                miro_proxy_url(),
                content=request_body,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": request.headers.get("content-type", "application/json"),
                    "Accept": "application/json, text/event-stream",
                },
            )
            response = await client.send(upstream_request, stream=True)
            if response.status_code == 401:
                await response.aclose()
                await client.aclose()
                refreshed = await refresh_connected_account(db, connected_account)
                access_token = decrypt_text(refreshed.encrypted_access_token) or access_token
                continue
            if response.status_code < 500 or attempt == settings.miro_retry_count:
                last_response = response
                break
            await response.aclose()
            await client.aclose()

        if last_response is None or client is None:
            raise HTTPException(status_code=502, detail="No response from Miro relay upstream")

        if last_response.status_code >= 500:
            breaker_mark_failure()
        else:
            breaker_mark_success()

        async def iterator():
            try:
                async for chunk in last_response.aiter_bytes():
                    yield chunk
            finally:
                await last_response.aclose()
                await client.aclose()

        return StreamingResponse(
            iterator(),
            status_code=last_response.status_code,
            media_type=last_response.headers.get("content-type", "application/json"),
            background=BackgroundTask(lambda: None),
        )
    except HTTPException:
        raise
    except Exception as exc:
        breaker_mark_failure()
        connected_account.last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def read_legacy_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except json.JSONDecodeError:
        return {}


def legacy_file(name: str) -> Path:
    settings = get_settings()
    base = Path(settings.legacy_miro_data_dir)
    if not base.is_absolute():
        base = Path(__file__).resolve().parents[2] / base
    return base / name


def migration_status(db: Session) -> dict[str, Any]:
    profiles = read_legacy_json(legacy_file("profiles.json"))
    provider_app = get_miro_provider_app(db)
    imported_connections = db.scalars(select(ConnectedAccount).where(ConnectedAccount.provider_app_id == provider_app.id)).all()
    return {
        "legacy_profiles": len(profiles),
        "imported_users": len({connection.user_id for connection in imported_connections}),
        "imported_miro_connections": len(imported_connections),
        "migrated_profile_ids": [connection.legacy_profile_id for connection in imported_connections if connection.legacy_profile_id],
    }


def import_legacy_miro_data(db: Session) -> dict[str, Any]:
    profiles = read_legacy_json(legacy_file("profiles.json"))
    tokens = read_legacy_json(legacy_file("tokens.json"))
    oauth_clients = read_legacy_json(legacy_file("oauth-clients.json"))
    provider_app = get_miro_provider_app(db)

    imported_users = 0
    imported_connections = 0
    skipped_profiles: list[str] = []
    migrated_profile_ids: list[str] = []

    for profile_id, profile in profiles.items():
        email = (
            parse_email_like(profile.get("contact"))
            or parse_email_like(profile.get("oauth_email_expected"))
            or parse_email_like(profile.get("oauth_email_detected"))
        )
        if not email:
            skipped_profiles.append(profile_id)
            continue

        user = db.scalar(select(User).where(User.organization_id == provider_app.organization_id, User.email == email))
        if not user:
            user = User(
                organization_id=provider_app.organization_id,
                email=email,
                display_name=str(profile.get("oauth_user_name") or profile.get("display_name") or email),
                password_hash=None,
                is_admin=False,
                is_active=False,
            )
            db.add(user)
            db.flush()
            imported_users += 1

        connected_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider_app_id == provider_app.id,
                ConnectedAccount.external_account_ref == profile_id,
            )
        )
        token = tokens.get(profile_id, {})
        oauth_client = oauth_clients.get(profile_id, {})
        consented_scopes = str(token.get("scope") or "").split()
        if not connected_account:
            connected_account = ConnectedAccount(
                organization_id=provider_app.organization_id,
                user_id=user.id,
                provider_app_id=provider_app.id,
                legacy_profile_id=profile_id,
                legacy_relay_token_hash=profile.get("relay_token_hash"),
                external_account_ref=profile_id,
                external_email=email,
                display_name=str(profile.get("oauth_user_name") or profile.get("display_name") or email),
                oauth_client_id=oauth_client.get("client_id"),
                encrypted_oauth_client_secret=encrypt_text(oauth_client.get("client_secret")),
                oauth_redirect_uri=oauth_client.get("redirect_uri"),
                consented_scopes_json=dumps_json(consented_scopes),
                status=str(profile.get("status") or "connected"),
                last_error=profile.get("oauth_token_context_error"),
            )
            db.add(connected_account)
            db.flush()
            imported_connections += 1
        else:
            connected_account.legacy_profile_id = profile_id
            connected_account.legacy_relay_token_hash = profile.get("relay_token_hash") or connected_account.legacy_relay_token_hash
            connected_account.external_email = email
            connected_account.display_name = str(profile.get("oauth_user_name") or profile.get("display_name") or email)
            connected_account.oauth_client_id = oauth_client.get("client_id") or connected_account.oauth_client_id
            if oauth_client.get("client_secret"):
                connected_account.encrypted_oauth_client_secret = encrypt_text(oauth_client.get("client_secret"))
            connected_account.oauth_redirect_uri = oauth_client.get("redirect_uri") or connected_account.oauth_redirect_uri
            connected_account.consented_scopes_json = dumps_json(consented_scopes)
            connected_account.status = str(profile.get("status") or connected_account.status or "connected")
            connected_account.last_error = profile.get("oauth_token_context_error")

        token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connected_account.id))
        if not token_material:
            token_material = TokenMaterial(
                organization_id=provider_app.organization_id,
                connected_account_id=connected_account.id,
            )
            db.add(token_material)
        if token.get("access_token"):
            token_material.encrypted_access_token = encrypt_text(token.get("access_token"))
        if token.get("refresh_token"):
            token_material.encrypted_refresh_token = encrypt_text(token.get("refresh_token"))
        token_material.token_type = token.get("token_type")
        token_material.scopes_json = dumps_json(consented_scopes)
        expires_at = token.get("expires_at")
        if isinstance(expires_at, (int, float)):
            token_material.expires_at = datetime.fromtimestamp(expires_at / 1000, tz=timezone.utc)

        migrated_profile_ids.append(profile_id)

    db.commit()
    return {
        "imported_users": imported_users,
        "imported_connections": imported_connections,
        "skipped_profiles": skipped_profiles,
        "migrated_profile_ids": migrated_profile_ids,
    }
