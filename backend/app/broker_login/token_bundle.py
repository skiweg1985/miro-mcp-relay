from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TokenBundle:
    access_token: str | None
    id_token: str | None
    raw_token_response: dict[str, Any]
