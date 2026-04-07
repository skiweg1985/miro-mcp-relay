from __future__ import annotations

import base64
import hashlib
import json
import secrets
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.database import get_db
from app.microsoft_oauth_resolver import microsoft_authorize_url, microsoft_token_url, resolve_microsoft_oauth
from app.deps import clear_session_cookie, get_current_session, get_current_user, record_audit, refresh_csrf_token
from app.models import OAuthIdentity, Organization, Session as SessionModel, User
from app.oauth_pending_store import pop_oauth_pending_payload, put_oauth_pending
from app.schemas import AuthFlowStartResponse, LoginRequest, SessionResponse, UserOut
from app.security import dumps_json, hash_secret, issue_plain_secret, loads_json, session_expiry, utcnow, verify_secret

router = APIRouter(tags=["auth"])

MICROSOFT_PROVIDER_KEY = "microsoft"


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
    email_norm = str(payload.email or "").strip().lower()
    user = db.scalar(select(User).where(User.email == email_norm, User.is_active.is_(True)))
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
    settings = get_settings()
    resolved = resolve_microsoft_oauth(db, settings)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft login is not configured")

    verifier, challenge = _make_pkce()
    state = _make_state()
    nonce = _make_state()
    put_oauth_pending(db, state, "microsoft_login", {"verifier": verifier, "nonce": nonce})
    db.commit()
    params = {
        "client_id": resolved.client_id,
        "response_type": "code",
        "redirect_uri": _microsoft_redirect_uri(settings),
        "response_mode": "query",
        "scope": " ".join(resolved.scope_list),
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    auth_base = microsoft_authorize_url(resolved.authority_base, resolved.tenant_id)
    return AuthFlowStartResponse(auth_url=f"{auth_base}?{httpx.QueryParams(params)}", state=state)


@router.get("/auth/microsoft/callback")
async def microsoft_callback(code: str | None = None, state: str | None = None, error: str | None = None, db: Session = Depends(get_db)):
    if error:
        return _login_error_redirect(f"Microsoft login failed: {error}")
    if not code or not state:
        return _login_error_redirect("Missing Microsoft login callback parameters")

    raw = pop_oauth_pending_payload(db, state)
    if not raw:
        return _login_error_redirect("Invalid or expired Microsoft login state")
    pending_verifier = str(raw.get("verifier") or "")
    pending_nonce = str(raw.get("nonce") or "")

    try:
        settings = get_settings()
        resolved = resolve_microsoft_oauth(db, settings)
        if not resolved:
            return _login_error_redirect("Microsoft login is not configured")

        token_endpoint = microsoft_token_url(resolved.authority_base, resolved.tenant_id)
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "client_id": resolved.client_id,
                    "client_secret": resolved.client_secret,
                    "code": code,
                    "redirect_uri": _microsoft_redirect_uri(settings),
                    "code_verifier": pending_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if response.status_code >= 400:
            return _login_error_redirect(f"Microsoft token exchange failed ({response.status_code})")

        token_data = response.json()
        claims = _decode_jwt_payload(token_data.get("id_token")) or {}
        nonce = str(claims.get("nonce") or "").strip()
        if not nonce or nonce != pending_nonce:
            return _login_error_redirect("Microsoft login nonce validation failed")
        subject = str(claims.get("sub") or "").strip()
        email = _parse_email_like(
            str(claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip()
        )
        if not subject or not email:
            return _login_error_redirect("Microsoft login did not provide a usable identity")

        display_name = str(claims.get("name") or claims.get("preferred_username") or email).strip() or email
        issuer = str(claims.get("iss") or "").strip() or None

        org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
        if not org:
            return _login_error_redirect("Organization not bootstrapped")

        identity = db.scalar(
            select(OAuthIdentity).where(
                OAuthIdentity.provider_key == MICROSOFT_PROVIDER_KEY,
                OAuthIdentity.subject == subject,
            )
        )
        user = db.get(User, identity.user_id) if identity else None
        if not user:
            user = db.scalar(select(User).where(User.organization_id == org.id, User.email == email))
        if not user:
            user = User(
                organization_id=org.id,
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
            identity = OAuthIdentity(
                organization_id=user.organization_id,
                user_id=user.id,
                provider_key=MICROSOFT_PROVIDER_KEY,
                subject=subject,
                issuer=issuer,
                email=email,
                display_name=display_name,
                claims_json=dumps_json(claims),
            )
            db.add(identity)
        else:
            identity.user_id = user.id
            identity.organization_id = user.organization_id
            identity.issuer = issuer
            identity.email = email
            identity.display_name = display_name
            identity.claims_json = dumps_json(claims)

        redirect = RedirectResponse(
            url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations-v2?login_status=success",
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
            metadata={"email": user.email, "provider": MICROSOFT_PROVIDER_KEY},
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
