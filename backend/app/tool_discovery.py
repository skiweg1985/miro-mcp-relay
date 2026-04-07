from __future__ import annotations

from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, DiscoveredTool, ProviderApp, ProviderInstance, ToolAccessPolicy, ToolStatus
from app.oauth_connection_tokens import ensure_access_token
from app.relay_config import RelayConfig, effective_relay_config, resolve_upstream_base_url
from app.security import dumps_json, loads_json


async def discover_tools(
    db: Session,
    *,
    provider_app: ProviderApp,
    provider_instance: ProviderInstance,
    connected_account: ConnectedAccount,
) -> dict[str, int]:
    config = effective_relay_config(provider_app)
    upstream_tools = await _fetch_tools_list(
        db,
        provider_app=provider_app,
        provider_instance=provider_instance,
        connected_account=connected_account,
        config=config,
    )

    existing = {
        t.tool_name: t
        for t in db.scalars(
            select(DiscoveredTool).where(
                DiscoveredTool.provider_app_id == provider_app.id,
                DiscoveredTool.organization_id == provider_app.organization_id,
            )
        ).all()
    }

    seen_names: set[str] = set()
    added = 0
    updated = 0

    from app.models import utc_now

    for tool in upstream_tools:
        name = str(tool.get("name", "")).strip()
        if not name:
            continue
        seen_names.add(name)

        display = str(tool.get("name", name))
        desc = tool.get("description")
        schema = tool.get("inputSchema") or tool.get("input_schema") or {}

        if name in existing:
            row = existing[name]
            row.display_name = display
            row.description = desc
            row.input_schema_json = dumps_json(schema)
            row.last_seen_at = utc_now()
            if row.status == ToolStatus.REMOVED.value:
                row.status = ToolStatus.ACTIVE.value
            updated += 1
        else:
            row = DiscoveredTool(
                organization_id=provider_app.organization_id,
                provider_app_id=provider_app.id,
                tool_name=name,
                display_name=display,
                description=desc,
                input_schema_json=dumps_json(schema),
                status=ToolStatus.ACTIVE.value,
            )
            db.add(row)
            db.flush()
            _ensure_default_policy(db, row)
            added += 1

    removed = 0
    for name, row in existing.items():
        if name not in seen_names and row.status == ToolStatus.ACTIVE.value:
            row.status = ToolStatus.REMOVED.value
            removed += 1

    return {
        "tools_found": len(upstream_tools),
        "tools_added": added,
        "tools_updated": updated,
        "tools_removed": removed,
    }


def _ensure_default_policy(db: Session, tool: DiscoveredTool) -> ToolAccessPolicy:
    existing = db.scalar(
        select(ToolAccessPolicy).where(ToolAccessPolicy.discovered_tool_id == tool.id)
    )
    if existing:
        return existing
    policy = ToolAccessPolicy(
        organization_id=tool.organization_id,
        discovered_tool_id=tool.id,
        visible=True,
        allowed_with_personal=True,
        allowed_with_shared=False,
    )
    db.add(policy)
    db.flush()
    return policy


async def _fetch_tools_list(
    db: Session,
    *,
    provider_app: ProviderApp,
    provider_instance: ProviderInstance,
    connected_account: ConnectedAccount,
    config: RelayConfig,
) -> list[dict[str, Any]]:
    access_token = await ensure_access_token(
        db,
        provider_app=provider_app,
        provider_instance=provider_instance,
        connected_account=connected_account,
    )

    base = resolve_upstream_base_url(provider_app, config).rstrip("/")
    if not base:
        return []

    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
    }

    headers: dict[str, str] = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(base, json=body, headers=headers)

    if response.status_code != 200:
        return []

    return _parse_tools_response(response)


def _parse_tools_response(response: httpx.Response) -> list[dict[str, Any]]:
    ct = response.headers.get("content-type", "")

    if "text/event-stream" in ct:
        return _parse_sse_tools(response.text)

    try:
        data = response.json()
    except Exception:
        return []

    if isinstance(data, dict):
        result = data.get("result")
        if isinstance(result, dict):
            tools = result.get("tools")
            if isinstance(tools, list):
                return tools
        tools = data.get("tools")
        if isinstance(tools, list):
            return tools

    return []


def _parse_sse_tools(text: str) -> list[dict[str, Any]]:
    import json

    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload:
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            result = data.get("result")
            if isinstance(result, dict):
                tools = result.get("tools")
                if isinstance(tools, list):
                    return tools
    return []
