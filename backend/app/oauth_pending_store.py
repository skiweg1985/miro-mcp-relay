from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import OAuthPendingState
from app.security import dumps_json, ensure_utc, loads_json, utcnow

_MAX_PENDING_ROWS = 500


def cleanup_expired_oauth_pending(db: Session) -> None:
    db.execute(delete(OAuthPendingState).where(OAuthPendingState.expires_at < utcnow()))
    db.flush()


def put_oauth_pending(db: Session, state_key: str, flow: str, payload: dict, ttl_seconds: int = 900) -> None:
    cleanup_expired_oauth_pending(db)
    count = db.scalar(select(func.count()).select_from(OAuthPendingState)) or 0
    if count >= _MAX_PENDING_ROWS:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Too many pending OAuth flows")
    existing = db.get(OAuthPendingState, state_key)
    if existing:
        db.delete(existing)
        db.flush()
    row = OAuthPendingState(
        state_key=state_key,
        flow=flow,
        payload_json=dumps_json(payload),
        expires_at=utcnow() + timedelta(seconds=ttl_seconds),
    )
    db.add(row)
    db.flush()


def pop_oauth_pending_payload(db: Session, state_key: str) -> dict | None:
    cleanup_expired_oauth_pending(db)
    row = db.get(OAuthPendingState, state_key)
    if not row:
        return None
    exp = ensure_utc(row.expires_at)
    if exp is None or exp <= utcnow():
        db.delete(row)
        db.flush()
        return None
    payload = loads_json(row.payload_json, {})
    db.delete(row)
    db.flush()
    return payload
