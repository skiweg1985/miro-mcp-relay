from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class GenericOidcLoginConfig(BaseModel):
    """Declarative OIDC/OAuth2 login endpoints and claim mapping (admin-configured)."""

    issuer: str = ""
    authorization_endpoint: str = Field(min_length=1)
    token_endpoint: str = Field(min_length=1)
    userinfo_endpoint: str | None = None
    jwks_uri: str | None = None
    scopes: list[str] = Field(default_factory=lambda: ["openid", "profile", "email"])
    claim_mapping: dict[str, str] = Field(
        default_factory=lambda: {
            "subject": "sub",
            "email": "email",
            "display_name": "name",
            "preferred_username": "preferred_username",
            "locale": "locale",
            "zoneinfo": "zoneinfo",
        }
    )

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes(cls, v: object) -> list[str]:
        if v is None:
            return ["openid", "profile", "email"]
        if isinstance(v, str):
            return [p.strip() for p in v.split() if p.strip()]
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return ["openid", "profile", "email"]
