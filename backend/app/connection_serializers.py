from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, TokenMaterial
from app.schemas import ConnectedAccountOut


def serialize_connected_account(db: Session, connection: ConnectedAccount) -> ConnectedAccountOut:
    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connection.id))
    return ConnectedAccountOut(
        id=connection.id,
        user_id=connection.user_id,
        provider_app_id=connection.provider_app_id,
        external_account_ref=connection.external_account_ref,
        external_email=connection.external_email,
        display_name=connection.display_name,
        status=connection.status,
        last_error=connection.last_error,
        connected_at=connection.connected_at,
        access_token_expires_at=token_material.expires_at if token_material else None,
        refresh_token_expires_at=token_material.refresh_expires_at if token_material else None,
        refresh_token_available=bool(token_material and token_material.encrypted_refresh_token),
        token_material_updated_at=token_material.updated_at if token_material else None,
    )
