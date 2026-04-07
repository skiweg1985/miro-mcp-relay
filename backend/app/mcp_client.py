from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status


class GenericMcpClient:
    def __init__(self, *, base_url: str, timeout_seconds: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def discover_tools(self, *, headers: dict[str, str] | None = None) -> list[dict[str, Any]]:
        url = f"{self.base_url}/tools"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(url, headers=headers or {})
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"mcp_discover_failed: {str(exc)}",
            ) from exc
        data = response.json()
        if isinstance(data, dict) and isinstance(data.get("tools"), list):
            return data["tools"]
        if isinstance(data, list):
            return data
        return []

    async def call_tool(
        self,
        *,
        tool_name: str,
        arguments: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}/tools/{tool_name}/call"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(url, headers=headers or {}, json={"arguments": arguments})
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"mcp_call_failed: {str(exc)}",
            ) from exc
        payload = response.json()
        if isinstance(payload, dict):
            return payload
        return {"data": payload}
