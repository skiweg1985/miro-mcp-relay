from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.microsoft_oauth_resolver import resolve_microsoft_oauth
from app.schemas import BrokerCallbackUrlsOut, LoginOptionsResponse

router = APIRouter(tags=["public"])


@router.get("/health")
def health():
    return {"ok": True, "service": "oauth-broker-backend"}


@router.get("/broker-callback-urls", response_model=BrokerCallbackUrlsOut)
def broker_callback_urls():
    settings = get_settings()
    base = settings.broker_public_base_url.rstrip("/")
    api = settings.api_v1_prefix
    return BrokerCallbackUrlsOut(
        microsoft_login=f"{base}{api}/auth/microsoft/callback",
        microsoft_graph="",
        miro="",
        custom_oauth="",
    )


@router.get("/auth/login-options", response_model=LoginOptionsResponse)
def login_options(db: Session = Depends(get_db)):
    settings = get_settings()
    resolved = resolve_microsoft_oauth(db, settings)
    return LoginOptionsResponse(microsoft_enabled=resolved is not None, microsoft_display_name="Microsoft")
