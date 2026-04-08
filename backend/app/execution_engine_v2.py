from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.mcp_client import GenericMcpClient
from app.models import AuthMode, IntegrationInstance, IntegrationTool


def resolve_outbound_headers(
    instance: IntegrationInstance,
    *,
    x_user_token: str | None = None,
) -> dict[str, str]:
    auth_config = _safe_json(instance.auth_config_json)
    headers: dict[str, str] = {}

    if instance.auth_mode == AuthMode.NONE.value:
        return headers
    if instance.auth_mode == AuthMode.SHARED_CREDENTIALS.value:
        shared_headers = auth_config.get("headers")
        if isinstance(shared_headers, dict):
            for key, value in shared_headers.items():
                if isinstance(key, str) and isinstance(value, str):
                    headers[key] = value
        return headers
    if instance.auth_mode == AuthMode.API_KEY.value:
        header_name = str(auth_config.get("header_name") or "Authorization")
        api_key = str(auth_config.get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="api_key_missing")
        headers[header_name] = api_key
        return headers
    if instance.auth_mode == AuthMode.OAUTH.value:
        if not x_user_token or not x_user_token.strip():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_user_token")
        token_header = str(auth_config.get("header_name") or "Authorization")
        token_prefix = str(auth_config.get("prefix") or "Bearer").strip()
        headers[token_header] = f"{token_prefix} {x_user_token.strip()}".strip()
        return headers

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported_auth_mode")


async def execute_instance_action(
    instance: IntegrationInstance,
    *,
    integration_config: dict[str, Any],
    action: str,
    tool_name: str | None,
    arguments: dict[str, Any],
    x_user_token: str | None = None,
) -> dict[str, Any]:
    endpoint = str(
        integration_config.get("endpoint") or integration_config.get("resource_api_base_url") or ""
    ).strip()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_endpoint_missing")
    headers = resolve_outbound_headers(instance, x_user_token=x_user_token)
    client = GenericMcpClient(base_url=endpoint)

    if action == "discover_tools":
        tools = await client.discover_tools(headers=headers)
        return {"tools": tools}
    if action == "call_tool":
        if not tool_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tool_name_required")
        result = await client.call_tool(tool_name=tool_name, arguments=arguments, headers=headers)
        return {"tool_name": tool_name, "payload": result}

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported_action")


def enforce_consumer_tool_policy(
    db: Session,
    *,
    organization_id: str,
    integration_id: str,
    action: str,
    tool_name: str | None,
    grant_allowed_tools: list[str],
) -> None:
    if action == "discover_tools":
        return
    if action != "call_tool":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported_action")
    name = str(tool_name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tool_name_required")
    row = db.scalar(
        select(IntegrationTool).where(
            IntegrationTool.organization_id == organization_id,
            IntegrationTool.integration_id == integration_id,
            IntegrationTool.tool_name == name,
        )
    )
    if not row or not row.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="tool_not_allowed")
    if grant_allowed_tools and name not in grant_allowed_tools:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="tool_not_allowed_by_grant")


def _safe_json(value: str) -> dict[str, Any]:
    from app.security import loads_json

    payload = loads_json(value or "{}", {})
    return payload if isinstance(payload, dict) else {}
