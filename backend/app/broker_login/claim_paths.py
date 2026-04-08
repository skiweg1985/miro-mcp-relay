from __future__ import annotations

from typing import Any


def get_by_path(claims: dict[str, Any], path: str) -> Any:
    """Resolve dotted paths such as ``profile.email`` from a nested dict."""
    cur: Any = claims
    for part in str(path or "").strip().split("."):
        if part == "":
            continue
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def stringify_claim(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()
