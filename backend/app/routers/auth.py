from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.broker_login.base import BrokerLoginAuthProvider
from app.broker_login.errors import AuthFlowFailure, AuthFlowFailureCode
from app.broker_login.registry import is_safe_provider_key, list_available_login_providers, resolve_broker_login_provider
from app.broker_login.user_resolution import upsert_user_and_oauth_identity
from app.core.config import get_settings
from app.database import get_db
from app.deps import clear_session_cookie, get_current_session, get_current_user, record_audit, refresh_csrf_token
from app.models import Organization, Session as SessionModel, User
from app.oauth_pending_store import pop_oauth_pending_payload, put_oauth_pending
from app.schemas import AuthFlowStartResponse, LoginRequest, SessionResponse, UserOut
from app.security import (
    hash_secret,
    issue_plain_secret,
    session_expiry,
    utcnow,
    verify_secret,
)

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)

FLOW_BROKER_LOGIN = "broker_login"


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


def _failure_redirect(exc: AuthFlowFailure) -> RedirectResponse:
    return _login_error_redirect(exc.message)


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


def _start_broker_login(provider_id: str, db: Session) -> AuthFlowStartResponse:
    settings = get_settings()
    if not is_safe_provider_key(provider_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid login provider")
    provider = resolve_broker_login_provider(db, settings, provider_id)
    if not provider:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Login provider is not available")

    verifier, challenge = _make_pkce()
    state = _make_state()
    nonce = _make_state()
    correlation_id = secrets.token_hex(8)
    put_oauth_pending(
        db,
        state,
        FLOW_BROKER_LOGIN,
        {
            "provider_id": provider_id,
            "verifier": verifier,
            "nonce": nonce,
            "correlation_id": correlation_id,
        },
    )
    db.commit()
    redirect_uri = provider.redirect_uri(settings)
    auth_url = provider.authorize_url(
        settings=settings,
        redirect_uri=redirect_uri,
        state=state,
        nonce=nonce,
        code_challenge=challenge,
    )
    logger.info(
        "broker_login.start",
        extra={
            "auth_step": "start",
            "auth_provider": provider_id,
            "auth_correlation_id": correlation_id,
        },
    )
    return AuthFlowStartResponse(auth_url=auth_url, state=state)


@router.post("/auth/{provider_id}/start", response_model=AuthFlowStartResponse)
def start_broker_login(provider_id: str, db: Session = Depends(get_db)):
    return _start_broker_login(provider_id, db)


async def _run_broker_login_callback(
    *,
    provider_id: str,
    code: str | None,
    state: str | None,
    oauth_error: str | None,
    db: Session,
) -> RedirectResponse:
    settings = get_settings()
    if oauth_error:
        raise AuthFlowFailure(AuthFlowFailureCode.UPSTREAM_ERROR, f"Sign-in failed: {oauth_error}")
    if not code or not state:
        raise AuthFlowFailure(AuthFlowFailureCode.INVALID_CALLBACK, "Missing sign-in callback parameters")

    raw = pop_oauth_pending_payload(db, state)
    if not raw:
        raise AuthFlowFailure(AuthFlowFailureCode.INVALID_STATE, "Invalid or expired sign-in state")

    pending_provider = str(raw.get("provider_id") or "").strip()
    pending_verifier = str(raw.get("verifier") or "")
    pending_nonce = str(raw.get("nonce") or "")
    correlation_id = str(raw.get("correlation_id") or "").strip() or None

    if pending_provider != provider_id:
        raise AuthFlowFailure(AuthFlowFailureCode.PROVIDER_MISMATCH, "Sign-in provider mismatch")

    provider = resolve_broker_login_provider(db, settings, provider_id)
    if not provider:
        raise AuthFlowFailure(AuthFlowFailureCode.PROVIDER_NOT_CONFIGURED, "Login provider is not available")

    redirect_uri = provider.redirect_uri(settings)

    log_extra = {
        "auth_step": "callback",
        "auth_provider": provider_id,
        "auth_correlation_id": correlation_id,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        bundle = await provider.exchange_code(
            client,
            code=code,
            redirect_uri=redirect_uri,
            code_verifier=pending_verifier,
        )

        status = bundle.raw_token_response.get("_http_status")
        if isinstance(status, int) and status >= 400:
            logger.warning("broker_login.token_exchange_http_error", extra={**log_extra, "http_status": status})
            raise AuthFlowFailure(
                AuthFlowFailureCode.TOKEN_EXCHANGE_FAILED,
                f"Token exchange failed ({status})",
            )

        id_claims = provider.id_token_claims(bundle)
        if id_claims and not provider.validate_nonce(id_token_claims=id_claims, expected_nonce=pending_nonce):
            logger.warning("broker_login.nonce_mismatch", extra=log_extra)
            raise AuthFlowFailure(AuthFlowFailureCode.NONCE_MISMATCH, "Sign-in nonce validation failed")

        userinfo = await provider.fetch_userinfo(client, bundle)
        if userinfo is not None:
            logger.info("broker_login.userinfo_ok", extra=log_extra)

    try:
        canonical = provider.map_claims(id_token_claims=id_claims, userinfo=userinfo)
    except Exception as exc:
        logger.warning("broker_login.map_claims_failed", extra=log_extra)
        raise AuthFlowFailure(AuthFlowFailureCode.MISSING_IDENTITY, "Sign-in did not provide a usable identity") from exc

    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise AuthFlowFailure(AuthFlowFailureCode.INTERNAL, "Organization not bootstrapped")

    raw_storage: dict = dict(id_claims)
    if userinfo is not None:
        raw_storage = {"id_token_claims": id_claims, "userinfo": userinfo}

    logger.info("broker_login.session_create", extra=log_extra)

    user = upsert_user_and_oauth_identity(
        db,
        org=org,
        provider_key=provider_id,
        canonical=canonical,
        raw_claims=raw_storage if isinstance(raw_storage, dict) else {},
    )

    redirect = RedirectResponse(
        url=f"{settings.frontend_base_url.rstrip('/')}/workspace/integrations-v2?login_status=success",
        status_code=302,
    )
    session_token, _csrf_token = _issue_session(db, user)
    _set_session_cookie(redirect, session_token)
    record_audit(
        db,
        action="auth.broker_login.success",
        actor_type="user",
        actor_id=user.id,
        organization_id=user.organization_id,
        metadata={"email": user.email, "provider": provider_id, "correlation_id": correlation_id},
    )
    db.commit()
    logger.info("broker_login.complete", extra=log_extra)
    return redirect


@router.get("/auth/{provider_id}/callback")
async def broker_login_callback(
    provider_id: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    log_extra = {"auth_step": "callback", "auth_provider": provider_id}
    try:
        return await _run_broker_login_callback(
            provider_id=provider_id,
            code=code,
            state=state,
            oauth_error=error,
            db=db,
        )
    except AuthFlowFailure as exc:
        logger.warning("broker_login.failure", extra={**log_extra, "failure_code": exc.code.value})
        return _failure_redirect(exc)
    except HTTPException as exc:
        return _login_error_redirect(str(exc.detail))
    except Exception as exc:
        logger.exception("broker_login.unexpected", extra=log_extra)
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
