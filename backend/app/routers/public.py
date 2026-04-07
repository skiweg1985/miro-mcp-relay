from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
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
def login_options():
    settings = get_settings()
    enabled = bool(
        str(settings.microsoft_broker_client_id or "").strip()
        and str(settings.microsoft_broker_client_secret or "").strip()
    )
    return LoginOptionsResponse(microsoft_enabled=enabled, microsoft_display_name="Microsoft")
