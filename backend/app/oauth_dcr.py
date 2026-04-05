from __future__ import annotations

import json
import secrets
from typing import Any

import httpx
from fastapi import HTTPException, status


def _registration_headers(auth_method: str) -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json", "Accept": "application/json"}
    if auth_method == "bearer":
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Registration auth method bearer is not implemented",
        )
    if auth_method == "basic":
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Registration auth method basic is not implemented",
        )
    return h


async def register_oauth_client_rfc7591(
    *,
    registration_endpoint: str,
    redirect_uri: str,
    auth_method: str = "none",
    client_name_prefix: str = "oauth-broker",
    token_endpoint_auth_method: str = "client_secret_post",
) -> dict[str, Any]:
    """POST client registration; returns parsed JSON (must include client_id)."""
    ep = registration_endpoint.strip()
    if not ep:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Registration endpoint is not configured")
    payload: dict[str, Any] = {
        "client_name": f"{client_name_prefix}-{secrets.token_hex(8)}",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": token_endpoint_auth_method,
    }
    headers = _registration_headers((auth_method or "none").strip().lower())

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(ep, json=payload, headers=headers)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"oauth_client_registration_failed:{response.status_code}",
        )
    try:
        data = response.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Registration endpoint returned invalid JSON")
    if not isinstance(data, dict) or not str(data.get("client_id") or "").strip():
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Registration response missing client_id")
    return data
