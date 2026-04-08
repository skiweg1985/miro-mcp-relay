from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_csrf
from app.models import AccessGrant, AccessGrantStatus, AuthMode, Integration, IntegrationInstance, User, UserConnection
from app.schemas import (
    AccessGrantCreate,
    AccessGrantCreatedOut,
    AccessGrantDeleteResult,
    AccessGrantOut,
    AccessGrantValidateRequest,
    AccessGrantValidateResponse,
)
from app.security import ensure_utc, loads_json, utcnow
from app.services.access_grants import (
    create_access_grant,
    effective_grant_display_status,
    get_grant_by_presented_key,
    is_grant_usable,
)

router = APIRouter(tags=["access-grants"])


def _invalidation_reason_from_row(row: AccessGrant) -> str | None:
    meta = loads_json(row.metadata_json, {})
    if isinstance(meta, dict):
        r = meta.get("invalidation_reason")
        return str(r) if r else None
    return None


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
        effective_status=effective_grant_display_status(row),
        allowed_tools=tools,
        direct_token_access=bool(row.direct_token_access_enabled),
        policy_ref=row.policy_ref,
        notes=row.notes,
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        invalidated_at=row.invalidated_at,
        invalidation_reason=_invalidation_reason_from_row(row),
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
    if not instance or instance.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.get(Integration, instance.integration_id)
    if not integration or integration.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")
    if payload.user_connection_id:
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
    if payload.direct_token_access and instance.auth_mode != AuthMode.OAUTH.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="direct_token_access_requires_oauth_connection",
        )
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
        direct_token_access_enabled=payload.direct_token_access,
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
    if row.status == AccessGrantStatus.INVALID.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="grant_not_revokable_invalid")
    if row.status == AccessGrantStatus.REVOKED.value:
        inst = db.get(IntegrationInstance, row.integration_instance_id)
        name = inst.name if inst else row.integration_instance_id
        return _grant_out(row, name)
    row.status = AccessGrantStatus.REVOKED.value
    row.revoked_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    inst = db.get(IntegrationInstance, row.integration_instance_id)
    name = inst.name if inst else row.integration_instance_id
    return _grant_out(row, name)


@router.delete("/access-grants/{grant_id}", response_model=AccessGrantDeleteResult)
def delete_grant(
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
    if row.status == AccessGrantStatus.ACTIVE.value:
        t = utcnow()
        if row.expires_at is None or row.expires_at > t:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="grant_delete_requires_terminal_state")
    db.delete(row)
    db.commit()
    return AccessGrantDeleteResult(id=grant_id)
