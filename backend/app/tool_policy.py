from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from time import monotonic
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DiscoveredTool, ToolAccessPolicy, ToolStatus


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str
    policy_id: str | None = None


_DEFAULT_VISIBLE = True
_DEFAULT_PERSONAL = True
_DEFAULT_SHARED = False


def check_tool_access(
    db: Session,
    *,
    tool_name: str,
    provider_app_id: str,
    credential_scope: str,
) -> PolicyDecision:
    policy = get_effective_policy(db, tool_name=tool_name, provider_app_id=provider_app_id)

    if policy is None:
        if credential_scope == "shared" and not _DEFAULT_SHARED:
            return PolicyDecision(allowed=False, reason="No policy; shared access denied by default")
        return PolicyDecision(allowed=True, reason="No policy; allowed by default")

    if not policy.visible:
        return PolicyDecision(allowed=False, reason="Tool is hidden", policy_id=policy.id)

    if credential_scope == "personal":
        if not policy.allowed_with_personal:
            return PolicyDecision(allowed=False, reason="Personal access denied by policy", policy_id=policy.id)
        return PolicyDecision(allowed=True, reason="Personal access allowed", policy_id=policy.id)

    if credential_scope == "shared":
        if not policy.allowed_with_shared:
            return PolicyDecision(allowed=False, reason="Shared access denied by policy", policy_id=policy.id)
        return PolicyDecision(allowed=True, reason="Shared access allowed", policy_id=policy.id)

    return PolicyDecision(allowed=False, reason=f"Unknown credential scope: {credential_scope}")


def get_effective_policy(
    db: Session,
    *,
    tool_name: str,
    provider_app_id: str,
) -> ToolAccessPolicy | None:
    tool = db.scalar(
        select(DiscoveredTool).where(
            DiscoveredTool.provider_app_id == provider_app_id,
            DiscoveredTool.tool_name == tool_name,
        )
    )
    if not tool:
        return None

    return db.scalar(
        select(ToolAccessPolicy).where(ToolAccessPolicy.discovered_tool_id == tool.id)
    )


def filter_tools_list_response(
    db: Session,
    *,
    provider_app_id: str,
    credential_scope: str,
    tools: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not tools:
        return tools

    tool_rows = db.scalars(
        select(DiscoveredTool).where(
            DiscoveredTool.provider_app_id == provider_app_id,
        )
    ).all()
    tool_map = {t.tool_name: t for t in tool_rows}

    policy_ids = [t.id for t in tool_rows]
    policies = {}
    if policy_ids:
        for p in db.scalars(
            select(ToolAccessPolicy).where(ToolAccessPolicy.discovered_tool_id.in_(policy_ids))
        ).all():
            policies[p.discovered_tool_id] = p

    result: list[dict[str, Any]] = []
    for tool_def in tools:
        name = str(tool_def.get("name", "")).strip()
        if not name:
            result.append(tool_def)
            continue

        discovered = tool_map.get(name)
        if not discovered:
            if credential_scope == "shared" and not _DEFAULT_SHARED:
                continue
            result.append(tool_def)
            continue

        policy = policies.get(discovered.id)
        if not policy:
            if credential_scope == "shared" and not _DEFAULT_SHARED:
                continue
            result.append(tool_def)
            continue

        if not policy.visible:
            continue

        if credential_scope == "personal" and not policy.allowed_with_personal:
            continue
        if credential_scope == "shared" and not policy.allowed_with_shared:
            continue

        result.append(tool_def)

    return result
