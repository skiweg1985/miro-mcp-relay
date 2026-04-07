from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_csrf
from app.models import AccessGrant, AccessGrantStatus, IntegrationInstance, User
from app.schemas import (
    AccessGrantCreate,
    AccessGrantCreatedOut,
    AccessGrantOut,
    AccessGrantValidateRequest,
    AccessGrantValidateResponse,
)
from app.security import ensure_utc, loads_json, utcnow
from app.services.access_grants import create_access_grant, get_grant_by_presented_key, is_grant_usable

router = APIRouter(tags=["access-grants"])


def _grant_out(row: AccessGrant, instance_name: str) -> AccessGrantOut:
    allowed = loads_json(row.allowed_tools_json, [])
    tools = [str(x) for x in allowed] if isinstance(allowed, list) else []
    return AccessGrantOut(
        id=row.id,
        user_id=row.user_id,
        integration_instance_id=row.integration_instance_id,
        integration_instance_name=instance_name,
        user_connection_id=row.user_connection_id,
        name=row.name,
        key_prefix=row.key_prefix,
        status=row.status,
        allowed_tools=tools,
        policy_ref=row.policy_ref,
        notes=row.notes,
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
    )


@router.get("/access-grants", response_model=list[AccessGrantOut])
def list_access_grants(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(AccessGrant)
        .where(AccessGrant.organization_id == current_user.organization_id, AccessGrant.user_id == current_user.id)
        .order_by(AccessGrant.created_at.desc())
    ).all()
    out: list[AccessGrantOut] = []
    for row in rows:
        inst = db.get(IntegrationInstance, row.integration_instance_id)
        name = inst.name if inst else row.integration_instance_id
        out.append(_grant_out(row, name))
    return out


@router.post("/access-grants", response_model=AccessGrantCreatedOut)
def create_grant(
    payload: AccessGrantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == payload.integration_instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    if payload.user_connection_id:
        from app.models import UserConnection

        conn = db.scalar(
            select(UserConnection).where(
                UserConnection.id == payload.user_connection_id,
                UserConnection.organization_id == current_user.organization_id,
                UserConnection.user_id == current_user.id,
                UserConnection.integration_instance_id == instance.id,
            )
        )
        if not conn:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_connection_not_found")
    expires = ensure_utc(payload.expires_at) if payload.expires_at else None
    row, raw = create_access_grant(
        db,
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        integration_instance_id=instance.id,
        name=payload.name,
        created_by_user_id=current_user.id,
        expires_at=expires,
        allowed_tools=payload.allowed_tools or None,
        user_connection_id=payload.user_connection_id,
        notes=payload.notes,
        policy_ref=payload.policy_ref,
    )
    db.commit()
    db.refresh(row)
    return AccessGrantCreatedOut(grant=_grant_out(row, instance.name), access_key=raw)


@router.post("/access-grants/validate", response_model=AccessGrantValidateResponse)
def validate_grant(payload: AccessGrantValidateRequest, db: Session = Depends(get_db)):
    row = get_grant_by_presented_key(db, payload.token)
    if not row or not is_grant_usable(row):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_access_key")
    return AccessGrantValidateResponse(
        grant_id=row.id,
        user_id=row.user_id,
        integration_instance_id=row.integration_instance_id,
        status=row.status,
    )


@router.get("/access-grants/{grant_id}", response_model=AccessGrantOut)
def get_grant(grant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.scalar(
        select(AccessGrant).where(
            AccessGrant.id == grant_id,
            AccessGrant.organization_id == current_user.organization_id,
            AccessGrant.user_id == current_user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="grant_not_found")
    inst = db.get(IntegrationInstance, row.integration_instance_id)
    name = inst.name if inst else row.integration_instance_id
    return _grant_out(row, name)


@router.post("/access-grants/{grant_id}/revoke", response_model=AccessGrantOut)
def revoke_grant(
    grant_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
):
    row = db.scalar(
        select(AccessGrant).where(
            AccessGrant.id == grant_id,
            AccessGrant.organization_id == current_user.organization_id,
            AccessGrant.user_id == current_user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="grant_not_found")
    row.status = AccessGrantStatus.REVOKED.value
    row.revoked_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    inst = db.get(IntegrationInstance, row.integration_instance_id)
    name = inst.name if inst else row.integration_instance_id
    return _grant_out(row, name)
