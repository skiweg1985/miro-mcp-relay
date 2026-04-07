from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccessGrant, Integration, IntegrationInstance
from app.services.access_grants import get_grant_by_presented_key, is_grant_usable


def resolve_consumer_grant_context(
    db: Session,
    *,
    raw_key: str,
    instance_id: str,
) -> tuple[AccessGrant, IntegrationInstance, Integration]:
    """Load grant, instance, and integration for a consumer access key scoped to one instance."""
    grant = get_grant_by_presented_key(db, raw_key)
    if not grant or not is_grant_usable(grant):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_access_key")
    if grant.integration_instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="grant_instance_mismatch")

    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == grant.organization_id,
        )
    )
    if not instance or instance.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="access_grant_context_invalid")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == grant.organization_id,
        )
    )
    if not integration or integration.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="access_grant_context_invalid")

    return grant, instance, integration
