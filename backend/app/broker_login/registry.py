from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.broker_login.base import BrokerLoginAuthProvider
from app.broker_login.generic_oidc import GenericOidcLoginProvider
from app.broker_login.microsoft_entra import MicrosoftEntraLoginProvider
from app.broker_login.oidc_config import GenericOidcLoginConfig
from app.core.config import Settings
from app.microsoft_oauth_resolver import resolve_microsoft_oauth
from app.models import BrokerLoginProvider, Organization
from app.security import decrypt_text, loads_json

_PROVIDER_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def is_safe_provider_key(provider_id: str) -> bool:
    return bool(_PROVIDER_KEY_RE.match(provider_id or ""))


def resolve_broker_login_provider(db: Session, settings: Settings, provider_id: str) -> BrokerLoginAuthProvider | None:
    if not is_safe_provider_key(provider_id):
        return None
    if provider_id == "microsoft":
        resolved = resolve_microsoft_oauth(db, settings)
        if not resolved:
            return None
        return MicrosoftEntraLoginProvider(resolved)

    row = db.scalar(select(BrokerLoginProvider).where(BrokerLoginProvider.provider_key == provider_id))
    if not row or not row.enabled:
        return None
    secret = decrypt_text(row.encrypted_client_secret) if row.encrypted_client_secret else None
    if not str(row.client_id or "").strip() or not (secret and str(secret).strip()):
        return None
    cfg = GenericOidcLoginConfig.model_validate(loads_json(row.oidc_config_json, {}))
    return GenericOidcLoginProvider(
        provider_key=row.provider_key,
        client_id=str(row.client_id).strip(),
        client_secret=str(secret).strip(),
        config=cfg,
    )


def list_available_login_providers(db: Session, settings: Settings) -> list[tuple[str, str]]:
    """Return ``(provider_id, display_name)`` for enabled providers."""
    out: list[tuple[str, str]] = []
    if resolve_microsoft_oauth(db, settings):
        out.append(("microsoft", "Microsoft"))

    org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
    if org:
        rows = db.scalars(
            select(BrokerLoginProvider)
            .where(BrokerLoginProvider.organization_id == org.id, BrokerLoginProvider.enabled.is_(True))
            .order_by(BrokerLoginProvider.provider_key.asc())
        ).all()
        for row in rows:
            if resolve_broker_login_provider(db, settings, row.provider_key):
                out.append((row.provider_key, row.display_name or row.provider_key))
    return out
