from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.broker_login.canonical import CanonicalUserClaims
from app.broker_login.errors import AuthFlowFailure, AuthFlowFailureCode
from app.models import OAuthIdentity, Organization, User
from app.security import dumps_json


def parse_email_like(value: str | None) -> str | None:
    raw = str(value or "").strip().lower()
    if raw and "@" in raw and "." in raw.rsplit("@", 1)[-1]:
        return raw
    return None


def upsert_user_and_oauth_identity(
    db: Session,
    *,
    org: Organization,
    provider_key: str,
    canonical: CanonicalUserClaims,
    raw_claims: dict,
) -> User:
    """Create or update User + OAuthIdentity from canonical claims (provider-agnostic)."""
    subject = canonical.subject
    email = canonical.email
    display_name = canonical.display_name

    identity = db.scalar(
        select(OAuthIdentity).where(
            OAuthIdentity.provider_key == provider_key,
            OAuthIdentity.subject == subject,
        )
    )
    user = db.get(User, identity.user_id) if identity else None
    if not user:
        user = db.scalar(select(User).where(User.organization_id == org.id, User.email == email))
    if not user:
        user = User(
            organization_id=org.id,
            email=email,
            display_name=display_name,
            password_hash=None,
            is_admin=False,
            is_active=True,
        )
        db.add(user)
        db.flush()
    else:
        if user.deleted_at is not None:
            raise AuthFlowFailure(AuthFlowFailureCode.ACCOUNT_DISABLED, "This account is no longer available.")
        if not user.is_active:
            raise AuthFlowFailure(AuthFlowFailureCode.ACCOUNT_DISABLED, "This account has been deactivated.")
        user.display_name = display_name or user.display_name

    issuer = canonical.issuer
    if not identity:
        identity = OAuthIdentity(
            organization_id=user.organization_id,
            user_id=user.id,
            provider_key=provider_key,
            subject=subject,
            issuer=issuer,
            email=email,
            display_name=display_name,
            claims_json=dumps_json(raw_claims),
        )
        db.add(identity)
    else:
        identity.user_id = user.id
        identity.organization_id = user.organization_id
        identity.issuer = issuer
        identity.email = email
        identity.display_name = display_name
        identity.claims_json = dumps_json(raw_claims)

    return user
