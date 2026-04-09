from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import (
    access_grants,
    admin_connections,
    admin_login_providers,
    admin_microsoft_oauth,
    admin_users,
    auth,
    consumer_execution,
    consumer_mcp_relay,
    consumer_token,
    integration_oauth,
    public,
)
from app.routers import integrations_v2
from app.seed import init_db


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url=f"{settings.api_v1_prefix}/docs",
        redoc_url=f"{settings.api_v1_prefix}/redoc",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    )
    cors_origins = settings.cors_origin_list
    if not cors_origins:
        raise RuntimeError("CORS_ORIGINS must list at least one origin when using credential cookies")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def startup():
        init_db()
        settings = get_settings()
        app.state.token_refresh_task = None
        if settings.token_refresh_enabled:
            from app.token_health import token_refresh_background_loop

            app.state.token_refresh_task = asyncio.create_task(token_refresh_background_loop())

    @app.on_event("shutdown")
    async def shutdown():
        from app.routers.consumer_mcp_relay import shutdown_relay_upstream_clients

        t = getattr(app.state, "token_refresh_task", None)
        if t is not None:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
        await shutdown_relay_upstream_clients()

    app.include_router(public.router, prefix=settings.api_v1_prefix)
    app.include_router(auth.router, prefix=settings.api_v1_prefix)
    app.include_router(integrations_v2.router, prefix=settings.api_v1_prefix)
    app.include_router(integration_oauth.router, prefix=settings.api_v1_prefix)
    app.include_router(access_grants.router, prefix=settings.api_v1_prefix)
    app.include_router(consumer_execution.router, prefix=settings.api_v1_prefix)
    app.include_router(consumer_token.router, prefix=settings.api_v1_prefix)
    app.include_router(consumer_mcp_relay.router, prefix=settings.api_v1_prefix)
    app.include_router(admin_microsoft_oauth.router, prefix=settings.api_v1_prefix)
    app.include_router(admin_login_providers.router, prefix=settings.api_v1_prefix)
    app.include_router(admin_users.router, prefix=settings.api_v1_prefix)
    app.include_router(admin_connections.router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
