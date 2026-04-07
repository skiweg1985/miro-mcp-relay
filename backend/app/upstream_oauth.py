"""Resolve upstream OAuth bearer tokens for IntegrationInstance (session and grants)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuthMode, IntegrationInstance, User, UserConnection, UserConnectionStatus
from app.security import decrypt_text


def oauth_token_from_connection_row(conn: UserConnection | None) -> str | None:
    if not conn or conn.status != UserConnectionStatus.ACTIVE.value:
        return None
    token = decrypt_text(conn.oauth_access_token_encrypted)
    if token and token.strip():
        return token.strip()
    return None


def get_upstream_oauth_token_for_session(
    db: Session,
    *,
    user: User,
    instance: IntegrationInstance,
    x_user_token: str | None,
) -> str | None:
    """Prefer X-User-Token header, else stored UserConnection for this user+instance."""
    if instance.auth_mode != AuthMode.OAUTH.value:
        return None
    if x_user_token and x_user_token.strip():
        return x_user_token.strip()
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == user.id,
            UserConnection.integration_instance_id == instance.id,
            UserConnection.organization_id == user.organization_id,
            UserConnection.status == UserConnectionStatus.ACTIVE.value,
        )
    )
    return oauth_token_from_connection_row(conn)


def user_has_oauth_connection(db: Session, *, user_id: str, organization_id: str, instance_id: str) -> bool:
    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == user_id,
            UserConnection.integration_instance_id == instance_id,
            UserConnection.organization_id == organization_id,
            UserConnection.status == UserConnectionStatus.ACTIVE.value,
        )
    )
    return oauth_token_from_connection_row(conn) is not None
