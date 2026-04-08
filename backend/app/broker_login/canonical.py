from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class CanonicalUserClaims(BaseModel):
    """Normalized identity after provider-specific mapping (broker session creation uses only this)."""

    subject: str = Field(min_length=1)
    email: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    issuer: str | None = None
    preferred_username: str | None = None
    locale: str | None = None
    zoneinfo: str | None = None

    @field_validator("email", mode="before")
    @classmethod
    def _norm_email(cls, v: object) -> str:
        s = str(v or "").strip().lower()
        return s
