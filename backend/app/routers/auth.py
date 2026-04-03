from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.deps import clear_session_cookie, get_current_session, get_current_user, record_audit, refresh_csrf_token
from app.models import Session as SessionModel
from app.models import User
from app.schemas import LoginRequest, SessionResponse, UserOut
from app.security import hash_secret, issue_plain_secret, session_expiry, utcnow, verify_secret

router = APIRouter(tags=["auth"])


def _lookup_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@router.post("/auth/login", response_model=SessionResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if not user or not user.password_hash or not verify_secret(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    settings = get_settings()
    session_token = issue_plain_secret()
    csrf_token = issue_plain_secret(16)
    expires_at = session_expiry(settings.session_ttl_hours)
    db_session = SessionModel(
        user_id=user.id,
        session_token_hash=_lookup_hash(session_token),
        csrf_token_hash=hash_secret(csrf_token),
        expires_at=expires_at,
    )
    db.add(db_session)
    record_audit(
        db,
        action="auth.login.success",
        actor_type="user",
        actor_id=user.id,
        organization_id=user.organization_id,
        metadata={"email": user.email},
    )
    db.commit()

    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_token,
        httponly=True,
        secure=settings.session_secure_cookie,
        samesite="strict",
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )
    return SessionResponse(user=UserOut.model_validate(user), csrf_token=csrf_token)


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
