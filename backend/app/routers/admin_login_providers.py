from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.broker_login.oidc_config import GenericOidcLoginConfig
from app.broker_login.registry import is_safe_provider_key
from app.core.config import get_settings
from app.database import get_db
from app.deps import record_audit, require_admin, require_csrf
from app.models import BrokerLoginProvider, Organization, User
from app.schemas import (
    BrokerLoginOIDCConfigIn,
    BrokerLoginProviderCreate,
    BrokerLoginProviderOut,
    BrokerLoginProviderUpdate,
)
from app.security import dumps_json, encrypt_text, loads_json

router = APIRouter(tags=["admin"])


def _callback_uri(provider_key: str) -> str:
    settings = get_settings()
    base = settings.broker_public_base_url.rstrip("/")
    api = str(settings.api_v1_prefix or "").strip()
    if not api.startswith("/"):
        api = "/" + api
    return f"{base}{api}/auth/{provider_key}/callback"


def _row_to_out(row: BrokerLoginProvider) -> BrokerLoginProviderOut:
    cfg = loads_json(row.oidc_config_json, {})
    oidc = GenericOidcLoginConfig.model_validate(cfg)
    return BrokerLoginProviderOut(
        provider_key=row.provider_key,
        display_name=row.display_name,
        enabled=row.enabled,
        client_id=row.client_id,
        has_client_secret=bool(row.encrypted_client_secret),
        oidc=BrokerLoginOIDCConfigIn.model_validate(oidc.model_dump()),
        callback_redirect_uri=_callback_uri(row.provider_key),
    )


@router.get("/admin/broker-login-providers", response_model=list[BrokerLoginProviderOut])
def list_broker_login_providers(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")
    rows = db.scalars(
        select(BrokerLoginProvider).where(BrokerLoginProvider.organization_id == org.id).order_by(BrokerLoginProvider.provider_key.asc())
    ).all()
    return [_row_to_out(r) for r in rows]


@router.post("/admin/broker-login-providers", response_model=BrokerLoginProviderOut)
def create_broker_login_provider(
    payload: BrokerLoginProviderCreate,
    db: Session = Depends(get_db),
    _csrf: str = Depends(require_csrf),
    admin: User = Depends(require_admin),
):
    if payload.provider_key == "microsoft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reserved provider id; configure Microsoft under Microsoft sign-in",
        )
    if not is_safe_provider_key(payload.provider_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid provider id")

    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")

    existing = db.scalar(select(BrokerLoginProvider).where(BrokerLoginProvider.provider_key == payload.provider_key))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Provider id already exists")

    secret = (payload.client_secret or "").strip()
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="client_secret is required")

    oidc = GenericOidcLoginConfig.model_validate(payload.oidc.model_dump())
    row = BrokerLoginProvider(
        organization_id=org.id,
        provider_key=payload.provider_key.strip(),
        display_name=payload.display_name.strip(),
        enabled=payload.enabled,
        client_id=payload.client_id.strip(),
        encrypted_client_secret=encrypt_text(secret),
        oidc_config_json=dumps_json(oidc.model_dump()),
    )
    db.add(row)
    record_audit(
        db,
        action="admin.broker_login_provider.create",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"provider_key": row.provider_key},
    )
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.patch("/admin/broker-login-providers/{provider_key}", response_model=BrokerLoginProviderOut)
def update_broker_login_provider(
    provider_key: str,
    payload: BrokerLoginProviderUpdate,
    db: Session = Depends(get_db),
    _csrf: str = Depends(require_csrf),
    admin: User = Depends(require_admin),
):
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")

    row = db.scalar(
        select(BrokerLoginProvider).where(
            BrokerLoginProvider.organization_id == org.id,
            BrokerLoginProvider.provider_key == provider_key,
        )
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found")

    if payload.display_name is not None:
        row.display_name = payload.display_name.strip()
    if payload.enabled is not None:
        row.enabled = payload.enabled
    if payload.client_id is not None:
        row.client_id = payload.client_id.strip()

    if payload.client_secret is not None:
        stripped = payload.client_secret.strip()
        if not stripped:
            row.encrypted_client_secret = None
        else:
            row.encrypted_client_secret = encrypt_text(stripped)

    if payload.oidc is not None:
        oidc = GenericOidcLoginConfig.model_validate(payload.oidc.model_dump())
        row.oidc_config_json = dumps_json(oidc.model_dump())

    record_audit(
        db,
        action="admin.broker_login_provider.update",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"provider_key": provider_key},
    )
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.delete("/admin/broker-login-providers/{provider_key}")
def delete_broker_login_provider(
    provider_key: str,
    db: Session = Depends(get_db),
    _csrf: str = Depends(require_csrf),
    admin: User = Depends(require_admin),
):
    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not bootstrapped")

    row = db.scalar(
        select(BrokerLoginProvider).where(
            BrokerLoginProvider.organization_id == org.id,
            BrokerLoginProvider.provider_key == provider_key,
        )
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found")

    db.delete(row)
    record_audit(
        db,
        action="admin.broker_login_provider.delete",
        actor_type="user",
        actor_id=admin.id,
        organization_id=org.id,
        metadata={"provider_key": provider_key},
    )
    db.commit()
    return {"ok": True}
