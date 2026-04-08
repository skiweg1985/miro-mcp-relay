from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator


def _require_http_url(value: str, label: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"{label} is required")
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise ValueError(f"{label} must be a valid http(s) URL")
    return raw


class GenericOidcLoginConfig(BaseModel):
    """Declarative OIDC/OAuth2 login endpoints and claim mapping (admin-configured)."""

    issuer: str = Field(default="")
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

    @field_validator("issuer", mode="before")
    @classmethod
    def _issuer_opt(cls, v: object) -> str:
        s = str(v or "").strip()
        if not s:
            return ""
        return _require_http_url(s, "Issuer")

    @field_validator("authorization_endpoint", "token_endpoint", mode="before")
    @classmethod
    def _core_urls(cls, v: object) -> str:
        return _require_http_url(str(v or ""), "Endpoint URL")

    @field_validator("userinfo_endpoint", "jwks_uri", mode="before")
    @classmethod
    def _optional_urls(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        return _require_http_url(s, "URL")

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes(cls, v: object) -> list[str]:
        if v is None:
            return ["openid", "profile", "email"]
        if isinstance(v, str):
            parts = [p.strip() for p in v.split() if p.strip()]
            return parts if parts else ["openid", "profile", "email"]
        if isinstance(v, list):
            parts = [str(x).strip() for x in v if str(x).strip()]
            return parts if parts else ["openid", "profile", "email"]
        return ["openid", "profile", "email"]

    @model_validator(mode="after")
    def _mapping_subject_email(self) -> GenericOidcLoginConfig:
        m = self.claim_mapping or {}
        if not str(m.get("subject") or "").strip():
            raise ValueError("claim_mapping.subject must be set")
        if not str(m.get("email") or "").strip():
            raise ValueError("claim_mapping.email must be set")
        return self
