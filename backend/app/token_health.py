"""Periodic upstream OAuth refresh and connection health labels."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import SessionLocal
from app.deps import record_audit
from app.models import IntegrationInstance, User, UserConnection, UserConnectionStatus
from app.security import decrypt_text, loads_json, utcnow
from app.upstream_oauth import _refresh_token_for_connection, oauth_expires_at_from_connection

logger = logging.getLogger(__name__)


def oauth_has_refresh_token(conn: UserConnection) -> bool:
    rt = decrypt_text(conn.oauth_refresh_token_encrypted)
    return bool(rt and rt.strip())


def compute_oauth_connection_health(
    conn: UserConnection,
    *,
    expiring_soon_seconds: int | None = None,
) -> str:
    settings = get_settings()
    sec = expiring_soon_seconds if expiring_soon_seconds is not None else settings.token_health_expiring_soon_seconds
    meta = loads_json(conn.metadata_json, {})
    if isinstance(meta, dict) and meta.get("oauth_refresh_error"):
        return "refresh_failed"
    exp = oauth_expires_at_from_connection(conn)
    now = utcnow()
    if exp is not None and exp <= now:
        return "expired"
    if not oauth_has_refresh_token(conn):
        return "no_refresh_token"
    if exp is not None and exp <= now + timedelta(seconds=sec):
        return "expiring_soon"
    return "healthy"


def run_token_refresh_cycle(db: Session) -> int:
    """Refresh connections whose access token expires within lookahead (or legacy unknown expiry). Returns success count."""
    settings = get_settings()
    if not settings.token_refresh_enabled:
        return 0
    lookahead = timedelta(seconds=settings.token_refresh_lookahead_seconds)
    now = utcnow()
    refreshed = 0
    rows = db.scalars(select(UserConnection).where(UserConnection.status == UserConnectionStatus.ACTIVE.value)).all()
    for conn in rows:
        if not oauth_has_refresh_token(conn):
            continue
        exp = oauth_expires_at_from_connection(conn)
        if exp is not None and exp > now + lookahead:
            continue
        user = db.get(User, conn.user_id)
        instance = db.get(IntegrationInstance, conn.integration_instance_id)
        if not user or not instance:
            continue
        if _refresh_token_for_connection(db, user=user, instance=instance, conn=conn):
            refreshed += 1
    return refreshed


def run_token_refresh_cycle_standalone() -> int:
    db = SessionLocal()
    try:
        n = run_token_refresh_cycle(db)
        if n:
            org_for_audit: str | None = None
            any_conn = db.scalar(select(UserConnection).where(UserConnection.status == UserConnectionStatus.ACTIVE.value).limit(1))
            if any_conn is not None:
                org_for_audit = any_conn.organization_id
            record_audit(
                db,
                action="token_refresh_cycle",
                actor_type="system",
                actor_id=None,
                organization_id=org_for_audit,
                metadata={"refreshed": n},
            )
            logger.info("token_health_cycle_ok refreshed=%s", n)
        db.commit()
        return n
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def token_refresh_background_loop() -> None:
    settings = get_settings()
    interval = max(30, settings.token_refresh_interval_seconds)
    while True:
        try:
            await asyncio.to_thread(run_token_refresh_cycle_standalone)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("token_health_cycle_failed")
        await asyncio.sleep(interval)
