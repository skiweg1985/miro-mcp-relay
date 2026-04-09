from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import AccessGrant, AccessUsageEvent, User
from app.schemas import AccessUsageEventListOut, AccessUsageEventOut
from app.security import ensure_utc, loads_json, utcnow
from app.services.access_usage_audit import human_summary

router = APIRouter(tags=["access-usage"])


def _event_out(row: AccessUsageEvent) -> AccessUsageEventOut:
    meta = loads_json(row.metadata_json, {})
    meta_d = meta if isinstance(meta, dict) else {}
    return AccessUsageEventOut(
        id=row.id,
        created_at=row.created_at,
        access_grant_id=row.access_grant_id,
        user_id=row.user_id,
        integration_instance_id=row.integration_instance_id,
        integration_id=row.integration_id,
        event_type=row.event_type,
        usage_type=row.usage_type,
        outcome=row.outcome,
        status_code=row.status_code,
        denied_reason=row.denied_reason,
        summary=human_summary(
            event_type=row.event_type,
            outcome=row.outcome,
            usage_type=row.usage_type,
            denied_reason=row.denied_reason,
            metadata=meta_d,
        ),
        request_id=row.request_id,
    )


@router.get("/access-grants/{grant_id}/usage-events", response_model=AccessUsageEventListOut)
def list_my_grant_usage_events(
    grant_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    outcome: str | None = Query(None, description="success|denied|error"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    grant = db.scalar(
        select(AccessGrant).where(
            AccessGrant.id == grant_id,
            AccessGrant.organization_id == current_user.organization_id,
            AccessGrant.user_id == current_user.id,
        )
    )
    if not grant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="grant_not_found")

    stmt = select(AccessUsageEvent).where(AccessUsageEvent.access_grant_id == grant_id)
    count_stmt = select(func.count()).select_from(AccessUsageEvent).where(AccessUsageEvent.access_grant_id == grant_id)
    if outcome and outcome.strip():
        o = outcome.strip().lower()
        if o not in ("success", "denied", "error"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_outcome_filter")
        stmt = stmt.where(AccessUsageEvent.outcome == o)
        count_stmt = count_stmt.where(AccessUsageEvent.outcome == o)

    total = int(db.scalar(count_stmt) or 0)
    rows = db.scalars(stmt.order_by(AccessUsageEvent.created_at.desc()).offset(offset).limit(limit)).all()
    return AccessUsageEventListOut(
        events=[_event_out(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def _parse_dt(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    try:
        return ensure_utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_datetime") from None


@router.get("/admin/access-usage/events", response_model=AccessUsageEventListOut)
def list_admin_access_usage_events(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
    user_id: str | None = Query(None),
    integration_id: str | None = Query(None),
    access_grant_id: str | None = Query(None),
    usage_type: str | None = Query(None),
    outcome: str | None = Query(None),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    t_to = _parse_dt(to_time) or utcnow()
    t_from = _parse_dt(from_time) or (t_to - timedelta(days=7))

    stmt = select(AccessUsageEvent).where(AccessUsageEvent.created_at >= t_from, AccessUsageEvent.created_at <= t_to)
    count_stmt = select(func.count()).select_from(AccessUsageEvent).where(
        AccessUsageEvent.created_at >= t_from, AccessUsageEvent.created_at <= t_to
    )

    if user_id and user_id.strip():
        uid = user_id.strip()
        stmt = stmt.where(AccessUsageEvent.user_id == uid)
        count_stmt = count_stmt.where(AccessUsageEvent.user_id == uid)
    if integration_id and integration_id.strip():
        iid = integration_id.strip()
        stmt = stmt.where(AccessUsageEvent.integration_id == iid)
        count_stmt = count_stmt.where(AccessUsageEvent.integration_id == iid)
    if access_grant_id and access_grant_id.strip():
        gid = access_grant_id.strip()
        stmt = stmt.where(AccessUsageEvent.access_grant_id == gid)
        count_stmt = count_stmt.where(AccessUsageEvent.access_grant_id == gid)
    if usage_type and usage_type.strip():
        ut = usage_type.strip()
        stmt = stmt.where(AccessUsageEvent.usage_type == ut)
        count_stmt = count_stmt.where(AccessUsageEvent.usage_type == ut)
    if outcome and outcome.strip():
        o = outcome.strip().lower()
        if o not in ("success", "denied", "error"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_outcome_filter")
        stmt = stmt.where(AccessUsageEvent.outcome == o)
        count_stmt = count_stmt.where(AccessUsageEvent.outcome == o)

    total = int(db.scalar(count_stmt) or 0)
    rows = db.scalars(stmt.order_by(AccessUsageEvent.created_at.desc()).offset(offset).limit(limit)).all()
    return AccessUsageEventListOut(
        events=[_event_out(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
