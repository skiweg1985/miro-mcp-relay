from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import Base, engine
from app.default_integrations import ensure_default_integrations
from app.models import Organization, User
from app.security import hash_secret


def reconcile_schema() -> None:
    from sqlalchemy import inspect, text

    # SQLite uses DATETIME; PostgreSQL has no DATETIME type (use TIMESTAMP).
    dt_sql = "TIMESTAMP" if engine.dialect.name == "postgresql" else "DATETIME"

    insp = inspect(engine)
    if insp.has_table("integrations"):
        cols = {c["name"] for c in insp.get_columns("integrations")}
        if "oauth_client_secret_encrypted" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE integrations ADD COLUMN oauth_client_secret_encrypted TEXT"))
        if "deleted_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE integrations ADD COLUMN deleted_at {dt_sql}"))
    if insp.has_table("integration_instances"):
        cols_i = {c["name"] for c in insp.get_columns("integration_instances")}
        if "deleted_at" not in cols_i:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE integration_instances ADD COLUMN deleted_at {dt_sql}"))
    if insp.has_table("access_grants"):
        cols_g = {c["name"] for c in insp.get_columns("access_grants")}
        if "invalidated_at" not in cols_g:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE access_grants ADD COLUMN invalidated_at {dt_sql}"))
        if "direct_token_access_enabled" not in cols_g:
            with engine.begin() as conn:
                if engine.dialect.name == "postgresql":
                    conn.execute(
                        text("ALTER TABLE access_grants ADD COLUMN direct_token_access_enabled BOOLEAN NOT NULL DEFAULT FALSE")
                    )
                else:
                    conn.execute(text("ALTER TABLE access_grants ADD COLUMN direct_token_access_enabled BOOLEAN DEFAULT 0"))
    if not insp.has_table("user_connections"):
        return
    cols = {c["name"] for c in insp.get_columns("user_connections")}
    if "oauth_refresh_token_encrypted" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE user_connections ADD COLUMN oauth_refresh_token_encrypted TEXT"))
    if "oauth_dcr_client_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE user_connections ADD COLUMN oauth_dcr_client_id VARCHAR(512)"))
    if "oauth_dcr_client_secret_encrypted" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE user_connections ADD COLUMN oauth_dcr_client_secret_encrypted TEXT"))
    if insp.has_table("users"):
        ucols = {c["name"] for c in insp.get_columns("users")}
        if "deleted_at" not in ucols:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN deleted_at {dt_sql}"))
        if "last_login_at" not in ucols:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN last_login_at {dt_sql}"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    reconcile_schema()
    settings = get_settings()
    with Session(engine) as db:
        org = db.scalar(select(Organization).where(Organization.slug == settings.default_org_slug))
        if not org:
            org = Organization(slug=settings.default_org_slug, name=settings.default_org_name)
            db.add(org)
            db.flush()

        bootstrap_email = str(settings.bootstrap_admin_email or "").strip().lower()
        admin = db.scalar(select(User).where(User.organization_id == org.id, User.email == bootstrap_email))
        if not admin:
            admin = User(
                organization_id=org.id,
                email=bootstrap_email,
                display_name=settings.bootstrap_admin_display_name,
                password_hash=hash_secret(settings.bootstrap_admin_password),
                is_admin=True,
                is_active=True,
            )
            db.add(admin)
            db.flush()

        ensure_default_integrations(db, org.id, admin.id if admin else None)

        db.commit()
