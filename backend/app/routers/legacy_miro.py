from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.database import get_db
from app.miro import get_miro_provider_app, resolve_legacy_miro_connection, validate_relay_token
from app.models import ProviderApp, ProviderInstance
from app.relay_config import effective_relay_config, relay_health_check_url
from app.relay_engine import breaker_open_for, execute_relay_request
from app.security import utcnow

router = APIRouter(tags=["legacy-miro"])


def frontend_redirect(path: str) -> RedirectResponse:
    settings = get_settings()
    return RedirectResponse(url=f"{settings.frontend_base_url.rstrip('/')}{path}", status_code=302)


@router.get("/miro")
def miro_root_redirect():
    return frontend_redirect("/workspace/integrations")


@router.get("/start")
def start_redirect():
    return frontend_redirect("/workspace/integrations")


@router.get("/miro/start")
def miro_start_redirect():
    return frontend_redirect("/workspace/integrations")


@router.get("/miro/workspace")
def miro_workspace_redirect():
    return frontend_redirect("/workspace")


@router.get("/miro/admin")
def miro_admin_redirect():
    return frontend_redirect("/app")


@router.post("/miro/mcp/{profile_id}")
async def legacy_miro_mcp_proxy(
    profile_id: str,
    request: Request,
    db: Session = Depends(get_db),
    x_relay_key: str | None = Header(default=None, alias="X-Relay-Key"),
    authorization: str | None = Header(default=None),
):
    bearer = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    supplied_token = x_relay_key or bearer

    connection = resolve_legacy_miro_connection(db, profile_id)
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    if connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profile is not connected")
    if not validate_relay_token(connection, supplied_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid relay token")
    provider_app = db.get(ProviderApp, connection.provider_app_id)
    if not provider_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider app not found")
    provider_instance = db.get(ProviderInstance, provider_app.provider_instance_id)
    if not provider_instance:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Provider instance not found")
    return await execute_relay_request(
        db,
        provider_app=provider_app,
        provider_instance=provider_instance,
        connected_account=connection,
        request=request,
    )


@router.get("/healthz")
def legacy_healthz():
    return {"ok": True, "service": "oauth-broker-backend", "time": utcnow().isoformat()}


@router.get("/readyz")
async def legacy_readyz(db: Session = Depends(get_db)):
    provider_app = get_miro_provider_app(db)
    config = effective_relay_config(provider_app)
    if breaker_open_for(provider_app.id, config):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Upstream circuit is open")
    health_url = relay_health_check_url(provider_app, config)
    if not health_url:
        return {"ok": True, "service": "oauth-broker-backend", "time": utcnow().isoformat()}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(health_url)
    except Exception as exc:  # pragma: no cover - network failure path
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Upstream unreachable: {exc}") from exc

    if response.status_code not in {200, 401}:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Upstream unhealthy: {response.status_code}")
    return {"ok": True, "upstream_status": response.status_code}
