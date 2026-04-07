from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccessGrant, AccessGrantStatus, IntegrationInstance, UserConnection
from app.security import dumps_json, loads_json, utcnow

INVALIDATION_CONNECTION_DELETED = "connection_deleted"
INVALIDATION_INTEGRATION_DELETED = "integration_deleted"
INVALIDATION_CRITICAL_SETTINGS = "critical_settings_changed"
INVALIDATION_INTEGRATION_CONFIG = "integration_config_changed"


def _invalidate_row(grant: AccessGrant, reason: str) -> None:
    if grant.status != AccessGrantStatus.ACTIVE.value:
        return
    grant.status = AccessGrantStatus.INVALID.value
    grant.invalidated_at = utcnow()
    meta = loads_json(grant.metadata_json, {})
    if not isinstance(meta, dict):
        meta = {}
    meta["invalidation_reason"] = reason
    grant.metadata_json = dumps_json(meta)


def invalidate_grants_for_instance(db: Session, *, organization_id: str, instance_id: str, reason: str) -> int:
    rows = db.scalars(
        select(AccessGrant).where(
            AccessGrant.organization_id == organization_id,
            AccessGrant.integration_instance_id == instance_id,
        )
    ).all()
    n = 0
    for row in rows:
        if row.status == AccessGrantStatus.ACTIVE.value:
            _invalidate_row(row, reason)
            db.add(row)
            n += 1
    return n


def invalidate_grants_for_integration_instances(
    db: Session, *, organization_id: str, integration_id: str, reason: str
) -> int:
    inst_ids = [
        r.id
        for r in db.scalars(
            select(IntegrationInstance).where(
                IntegrationInstance.organization_id == organization_id,
                IntegrationInstance.integration_id == integration_id,
                IntegrationInstance.deleted_at.is_(None),
            )
        ).all()
    ]
    total = 0
    for iid in inst_ids:
        total += invalidate_grants_for_instance(db, organization_id=organization_id, instance_id=iid, reason=reason)
    return total


def critical_instance_settings_snapshot(instance: IntegrationInstance) -> tuple[str, str, str, str]:
    return (
        instance.auth_mode,
        instance.auth_config_json,
        instance.access_mode,
        instance.access_config_json,
    )


def instance_critical_settings_changed(before: IntegrationInstance, after: IntegrationInstance) -> bool:
    return critical_instance_settings_snapshot(before) != critical_instance_settings_snapshot(after)


def soft_delete_integration_instance(db: Session, instance: IntegrationInstance, reason: str) -> int:
    n = invalidate_grants_for_instance(db, organization_id=instance.organization_id, instance_id=instance.id, reason=reason)
    for uc in db.scalars(select(UserConnection).where(UserConnection.integration_instance_id == instance.id)).all():
        db.delete(uc)
    instance.deleted_at = utcnow()
    db.add(instance)
    return n


def critical_integration_config_changed(before: dict, after: dict) -> bool:
    keys = set(before.keys()) | set(after.keys())
    wire_keys = {
        k
        for k in keys
        if k
        in (
            "endpoint",
            "oauth_token_endpoint",
            "oauth_authorization_endpoint",
            "oauth_registration_endpoint",
            "graph_base_url",
        )
        or k.startswith("oauth_")
        or k.startswith("graph_oauth_")
    }
    for k in wire_keys:
        if before.get(k) != after.get(k):
            return True
    return False
