from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.database import get_db
from app.deps import clear_session_cookie, get_current_session, get_current_user, record_audit, refresh_csrf_token
from app.models import ProviderApp, ProviderInstance, Session as SessionModel, User, UserAuthIdentity
from app.schemas import AuthFlowStartResponse, LoginRequest, SessionResponse, UserOut
from app.security import decrypt_text, dumps_json, hash_secret, issue_plain_secret, loads_json, session_expiry, utcnow, verify_secret

router = APIRouter(tags=["auth"])


@dataclass
class PendingMicrosoftAuth:
    verifier: str
    nonce: str
    created_at: float


PENDING_MICROSOFT_AUTH: dict[str, PendingMicrosoftAuth] = {}


def _lookup_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _make_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(64))
    challenge = _b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def _make_state() -> str:
    return _b64url(secrets.token_bytes(24))


def _cleanup_pending_auth(max_age_seconds: int = 900) -> None:
    now = time.time()
    expired = [state for state, payload in PENDING_MICROSOFT_AUTH.items() if now - payload.created_at > max_age_seconds]
    for state in expired:
        PENDING_MICROSOFT_AUTH.pop(state, None)


def _parse_email_like(value: str | None) -> str | None:
    raw = str(value or "").strip().lower()
    if raw and "@" in raw and "." in raw.rsplit("@", 1)[-1]:
        return raw
    return None


def _decode_jwt_payload(token: str | None) -> dict[str, object] | None:
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


def _microsoft_redirect_uri(settings) -> str:
    return f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/auth/microsoft/callback"


def _get_microsoft_broker_config(db: Session) -> tuple[ProviderInstance, ProviderApp]:
    provider_instance = db.scalar(select(ProviderInstance).where(ProviderInstance.key == "microsoft-broker-auth"))
    provider_app = db.scalar(select(ProviderApp).where(ProviderApp.key == "microsoft-broker-default"))
    if not provider_instance or not provider_app:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft broker auth is not configured")
    client_secret = decrypt_text(provider_app.encrypted_client_secret)
    if not provider_instance.authorization_endpoint or not provider_instance.token_endpoint or not provider_app.client_id or not client_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft broker auth is not configured")
    return provider_instance, provider_app


def _set_session_cookie(response: Response, session_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_token,
        httponly=True,
        secure=settings.session_secure_cookie,
        samesite="strict",
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )


def _issue_session(db: Session, user: User) -> tuple[str, str]:
    settings = get_settings()
    session_token = issue_plain_secret()
    csrf_token = issue_plain_secret(16)
    db_session = SessionModel(
        user_id=user.id,
        session_token_hash=_lookup_hash(session_token),
        csrf_token_hash=hash_secret(csrf_token),
        expires_at=session_expiry(settings.session_ttl_hours),
    )
    db.add(db_session)
    return session_token, csrf_token


def _session_response(db: Session, user: User, response: Response) -> SessionResponse:
    session_token, csrf_token = _issue_session(db, user)
    _set_session_cookie(response, session_token)
    return SessionResponse(user=UserOut.model_validate(user), csrf_token=csrf_token)


def _login_error_redirect(message: str) -> RedirectResponse:
    settings = get_settings()
    return RedirectResponse(
        url=f"{settings.frontend_base_url.rstrip('/')}/login?login_status=error&message={quote(message)}",
        status_code=302,
    )


@router.post("/auth/login", response_model=SessionResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if not user or not user.password_hash or not verify_secret(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    session_response = _session_response(db, user, response)
    record_audit(
        db,
        action="auth.login.success",
        actor_type="user",
        actor_id=user.id,
        organization_id=user.organization_id,
        metadata={"email": user.email},
    )
    db.commit()
    return session_response


@router.post("/auth/microsoft/start", response_model=AuthFlowStartResponse)
def start_microsoft_login(db: Session = Depends(get_db)):
    _cleanup_pending_auth()
    provider_instance, provider_app = _get_microsoft_broker_config(db)
    settings = get_settings()
    verifier, challenge = _make_pkce()
    state = _make_state()
    nonce = _make_state()
    PENDING_MICROSOFT_AUTH[state] = PendingMicrosoftAuth(verifier=verifier, nonce=nonce, created_at=time.time())
    params = {
        "client_id": provider_app.client_id,
        "response_type": "code",
        "redirect_uri": _microsoft_redirect_uri(settings),
        "response_mode": "query",
        "scope": " ".join(loads_json(provider_app.default_scopes_json, settings.microsoft_scope_list)),
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return AuthFlowStartResponse(auth_url=f"{provider_instance.authorization_endpoint}?{httpx.QueryParams(params)}", state=state)


@router.get("/auth/microsoft/callback")
async def microsoft_callback(code: str | None = None, state: str | None = None, error: str | None = None, db: Session = Depends(get_db)):
    if error:
        return _login_error_redirect(f"Microsoft login failed: {error}")
    if not code or not state:
        return _login_error_redirect("Missing Microsoft login callback parameters")

    pending = PENDING_MICROSOFT_AUTH.pop(state, None)
    if not pending:
        return _login_error_redirect("Invalid or expired Microsoft login state")

    try:
        provider_instance, provider_app = _get_microsoft_broker_config(db)
        client_secret = decrypt_text(provider_app.encrypted_client_secret)
        settings = get_settings()
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                provider_instance.token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "client_id": provider_app.client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": _microsoft_redirect_uri(settings),
                    "code_verifier": pending.verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if response.status_code >= 400:
            return _login_error_redirect(f"Microsoft token exchange failed ({response.status_code})")

        token_data = response.json()
        claims = _decode_jwt_payload(token_data.get("id_token")) or {}
        nonce = str(claims.get("nonce") or "").strip()
        if nonce and nonce != pending.nonce:
            return _login_error_redirect("Microsoft login nonce validation failed")
        subject = str(claims.get("sub") or "").strip()
        email = _parse_email_like(
            str(claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip()
        )
        if not subject or not email:
            return _login_error_redirect("Microsoft login did not provide a usable identity")

        display_name = str(claims.get("name") or claims.get("preferred_username") or email).strip() or email
        tenant_id = str(claims.get("tid") or "").strip() or None
        object_id = str(claims.get("oid") or "").strip() or None
        issuer = str(claims.get("iss") or provider_instance.issuer or "").strip() or None
        preferred_username = str(claims.get("preferred_username") or email).strip() or email

        identity = db.scalar(
            select(UserAuthIdentity).where(
                UserAuthIdentity.provider_instance_id == provider_instance.id,
                UserAuthIdentity.subject == subject,
            )
        )
        user = db.get(User, identity.user_id) if identity else None
        if not user:
            user = db.scalar(select(User).where(User.organization_id == provider_instance.organization_id, User.email == email))
        if not user:
            user = User(
                organization_id=provider_instance.organization_id,
                email=email,
                display_name=display_name,
                password_hash=None,
                is_admin=False,
                is_active=True,
            )
            db.add(user)
            db.flush()
        else:
            user.is_active = True
            user.display_name = display_name or user.display_name

        if not identity:
            identity = UserAuthIdentity(
                organization_id=user.organization_id,
                user_id=user.id,
                provider_instance_id=provider_instance.id,
                issuer=issuer,
                subject=subject,
                tenant_id=tenant_id,
                object_id=object_id,
                email=email,
                display_name=display_name,
                preferred_username=preferred_username,
                claims_json=dumps_json(claims),
            )
            db.add(identity)
        else:
            identity.user_id = user.id
            identity.issuer = issuer
            identity.tenant_id = tenant_id
            identity.object_id = object_id
            identity.email = email
            identity.display_name = display_name
            identity.preferred_username = preferred_username
            identity.claims_json = dumps_json(claims)

        redirect = RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace?login_status=success",
            status_code=302,
        )
        session_token, _csrf_token = _issue_session(db, user)
        _set_session_cookie(redirect, session_token)
        record_audit(
            db,
            action="auth.microsoft.login.success",
            actor_type="user",
            actor_id=user.id,
            organization_id=user.organization_id,
            metadata={"email": user.email, "tenant_id": tenant_id, "provider_instance_id": provider_instance.id},
        )
        db.commit()
        return redirect
    except HTTPException as exc:
        return _login_error_redirect(str(exc.detail))
    except Exception as exc:
        return _login_error_redirect(str(exc))


@router.post("/auth/logout")
def logout(response: Response, current_session: SessionModel = Depends(get_current_session), db: Session = Depends(get_db)):
    current_session.revoked_at = utcnow()
    record_audit(
        db,
        action="auth.logout",
        actor_type="user",
        actor_id=current_session.user_id,
        organization_id=None,
        metadata={"session_id": current_session.id},
    )
    db.commit()
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/sessions/me", response_model=SessionResponse)
def me(current_user: User = Depends(get_current_user), current_session: SessionModel = Depends(get_current_session), db: Session = Depends(get_db)):
    csrf_token = refresh_csrf_token(db, current_session)
    db.commit()
    return SessionResponse(user=UserOut.model_validate(current_user), csrf_token=csrf_token)
