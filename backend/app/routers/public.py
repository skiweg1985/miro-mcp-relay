from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ProviderDefinition
from app.schemas import ProviderDefinitionOut

router = APIRouter(tags=["public"])


@router.get("/health")
def health():
    return {"ok": True, "service": "oauth-broker-backend"}


@router.get("/provider-definitions", response_model=list[ProviderDefinitionOut])
def list_provider_definitions(db: Session = Depends(get_db)):
    return db.scalars(select(ProviderDefinition).order_by(ProviderDefinition.display_name.asc())).all()
