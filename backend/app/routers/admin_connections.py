from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import record_audit, require_admin, require_csrf
from app.models import IntegrationInstance, User, UserConnection
from app.schemas import AdminConnectionHealthListOut, AdminConnectionHealthRowOut, AdminConnectionRefreshOut
from app.security import loads_json
from app.token_health import compute_oauth_connection_health
from app.upstream_oauth import force_refresh_user_connection_for_org, oauth_expires_at_from_connection

router = APIRouter(tags=["admin-connections"])


@router.get("/admin/connection-health", response_model=AdminConnectionHealthListOut)
def list_connection_health(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rows = db.scalars(
        select(UserConnection)
        .where(UserConnection.organization_id == admin.organization_id)
        .order_by(UserConnection.updated_at.desc())
    ).all()
    out: list[AdminConnectionHealthRowOut] = []
    for c in rows:
        user = db.get(User, c.user_id)
        inst = db.get(IntegrationInstance, c.integration_instance_id)
        meta = loads_json(c.metadata_json, {})
        last_ref = str(meta.get("oauth_last_refresh_at") or "").strip() or None if isinstance(meta, dict) else None
        err = str(meta.get("oauth_refresh_error") or "").strip() or None if isinstance(meta, dict) else None
        out.append(
            AdminConnectionHealthRowOut(
                connection_id=c.id,
                user_id=c.user_id,
                user_email=user.email if user else "",
                integration_instance_id=c.integration_instance_id,
                integration_instance_name=inst.name if inst else c.integration_instance_id,
                status=c.status,
                oauth_health=compute_oauth_connection_health(c),
                oauth_expires_at=oauth_expires_at_from_connection(c),
                oauth_last_refresh_at=last_ref,
                oauth_refresh_error=err,
            )
        )
    return AdminConnectionHealthListOut(connections=out)


@router.post("/admin/connections/{connection_id}/refresh", response_model=AdminConnectionRefreshOut)
def refresh_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    ok, err, exp_iso = force_refresh_user_connection_for_org(db, connection_id=connection_id, organization_id=admin.organization_id)
    if not ok and err == "connection_not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=err)
    if not ok and err == "connection_not_active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)
    if not ok and err == "instance_not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=err)
    if not ok and err == "user_not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=err)
    record_audit(
        db,
        action="admin.connection_refresh",
        actor_type="user",
        actor_id=admin.id,
        organization_id=admin.organization_id,
        metadata={"connection_id": connection_id, "ok": ok, "error": err},
    )
    db.commit()
    return AdminConnectionRefreshOut(ok=ok, connection_id=connection_id, oauth_expires_at=exp_iso, error=err if not ok else None)
