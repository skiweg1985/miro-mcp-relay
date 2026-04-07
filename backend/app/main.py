from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import access_grants, admin_microsoft_oauth, auth, consumer_execution, public
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
    def startup():
        init_db()

    app.include_router(public.router, prefix=settings.api_v1_prefix)
    app.include_router(auth.router, prefix=settings.api_v1_prefix)
    app.include_router(integrations_v2.router, prefix=settings.api_v1_prefix)
    app.include_router(access_grants.router, prefix=settings.api_v1_prefix)
    app.include_router(consumer_execution.router, prefix=settings.api_v1_prefix)
    app.include_router(admin_microsoft_oauth.router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
