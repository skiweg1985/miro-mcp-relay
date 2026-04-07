"""Dynamic client registration (RFC 7591-style) for upstream OAuth — used by Miro MCP."""

from __future__ import annotations

import httpx


def register_oauth_client_at_endpoint(
    *,
    registration_url: str,
    redirect_uri: str,
    client_name: str,
    timeout_seconds: float = 30.0,
) -> tuple[str, str]:
    """POST registration; returns (client_id, client_secret)."""
    payload = {
        "client_name": client_name,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "client_secret_post",
    }
    with httpx.Client(timeout=timeout_seconds) as client:
        response = client.post(
            registration_url,
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
    if response.status_code >= 400:
        raise RuntimeError(f"oauth_registration_failed_{response.status_code}")
    data = response.json()
    cid = str(data.get("client_id") or "").strip()
    sec = str(data.get("client_secret") or "").strip()
    if not cid or not sec:
        raise RuntimeError("oauth_registration_missing_credentials")
    return cid, sec
