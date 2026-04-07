from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.deps import record_audit, require_admin, require_csrf
from app.models import MicrosoftOAuthSettings, Organization, User
from app.microsoft_oauth_resolver import effective_microsoft_oauth_source, resolve_microsoft_oauth
from app.schemas import MicrosoftOAuthAdminOut, MicrosoftOAuthAdminUpdate
from app.security import encrypt_text

router = APIRouter(tags=["admin"])


def _redirect_uri(settings) -> str:
    return f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/auth/microsoft/callback"


def _row_to_out(db: Session, row: MicrosoftOAuthSettings | None, settings) -> MicrosoftOAuthAdminOut:
    resolved = resolve_microsoft_oauth(db, settings)
    return MicrosoftOAuthAdminOut(
        authority_base=(row.authority_base or "").strip() if row else "",
        tenant_id=(row.tenant_id or "").strip() if row else "",
        client_id=(row.client_id or "").strip() if row else "",
        scope=(row.scope or "").strip() if row else "",
        has_client_secret=bool(row and row.encrypted_client_secret),
        effective_source=effective_microsoft_oauth_source(db, settings),
        microsoft_login_enabled=resolved is not None,
        redirect_uri=_redirect_uri(settings),
    )


@router.get("/admin/microsoft-oauth", response_model=MicrosoftOAuthAdminOut)
def get_microsoft_oauth_admin(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    settings = get_settings()
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")
    row = db.scalar(select(MicrosoftOAuthSettings).where(MicrosoftOAuthSettings.organization_id == org.id))
    return _row_to_out(db, row, settings)


@router.put("/admin/microsoft-oauth", response_model=MicrosoftOAuthAdminOut)
def put_microsoft_oauth_admin(
    payload: MicrosoftOAuthAdminUpdate,
    db: Session = Depends(get_db),
    _csrf: str = Depends(require_csrf),
    admin: User = Depends(require_admin),
):
    settings = get_settings()
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")

    row = db.scalar(select(MicrosoftOAuthSettings).where(MicrosoftOAuthSettings.organization_id == org.id))
    if not row:
        row = MicrosoftOAuthSettings(organization_id=org.id)
        db.add(row)
        db.flush()

    row.authority_base = payload.authority_base.strip() or None
    row.tenant_id = payload.tenant_id.strip() or None
    row.client_id = payload.client_id.strip() or None
    row.scope = payload.scope.strip() or None

    if payload.client_secret is not None:
        stripped = payload.client_secret.strip()
        if not stripped:
            row.encrypted_client_secret = None
        else:
            row.encrypted_client_secret = encrypt_text(stripped)

    record_audit(
        db,
        action="admin.microsoft_oauth.update",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"effective_source": effective_microsoft_oauth_source(db, settings)},
    )
    db.commit()
    db.refresh(row)
    return _row_to_out(db, row, settings)
