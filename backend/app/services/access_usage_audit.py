from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import AccessGrant, AccessGrantStatus, AccessUsageEvent
from app.security import dumps_json, utcnow


class AccessUsageOutcome:
    SUCCESS = "success"
    DENIED = "denied"
    ERROR = "error"


class AccessUsageType:
    DIRECT_TOKEN = "direct_token"
    MCP = "mcp"
    API_RELAY = "api_relay"
    VALIDATION_ONLY = "validation_only"
    TOOL_EXECUTION = "tool_execution"


class AccessUsageEventType:
    VALIDATED = "access.validated"
    TOKEN_ISSUED = "access.token_issued"
    MCP_REQUEST = "access.mcp_request"
    TOOL_EXECUTED = "access.tool_executed"
    REQUEST_DENIED = "access.request_denied"
    INVALID = "access.invalid"
    REVOKED = "access.revoked"


def truncate_user_agent(value: str | None, *, max_len: int = 400) -> str | None:
    if not value:
        return None
    s = str(value).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


@dataclass(frozen=True)
class RequestAuditInfo:
    request_id: str | None
    client_ip: str | None
    user_agent: str | None


def _rollup_grant_after_event(
    grant: AccessGrant,
    *,
    outcome: str,
    usage_type: str,
    ts,
) -> None:
    grant.last_used_at = ts
    grant.usage_count_total = int(grant.usage_count_total or 0) + 1
    grant.last_usage_type = usage_type
    grant.last_outcome = outcome
    if outcome == AccessUsageOutcome.SUCCESS:
        grant.last_success_at = ts
    elif outcome in (AccessUsageOutcome.DENIED, AccessUsageOutcome.ERROR):
        grant.last_failure_at = ts


def record_access_usage_event(
    db: Session,
    *,
    grant: AccessGrant,
    integration_instance_id: str,
    integration_id: str | None,
    event_type: str,
    usage_type: str,
    outcome: str,
    status_code: int | None = None,
    denied_reason: str | None = None,
    request: RequestAuditInfo | None = None,
    metadata: dict[str, Any] | None = None,
) -> AccessUsageEvent:
    ts = utcnow()
    ev = AccessUsageEvent(
        organization_id=grant.organization_id,
        access_grant_id=grant.id,
        user_id=grant.user_id,
        integration_instance_id=integration_instance_id,
        integration_id=integration_id,
        user_connection_id=grant.user_connection_id,
        event_type=event_type,
        usage_type=usage_type,
        outcome=outcome,
        status_code=status_code,
        denied_reason=(denied_reason[:128] if denied_reason else None),
        request_id=request.request_id if request else None,
        source_ip=request.client_ip if request else None,
        user_agent=truncate_user_agent(request.user_agent if request else None),
        metadata_json=dumps_json(metadata or {}),
    )
    db.add(ev)
    _rollup_grant_after_event(grant, outcome=outcome, usage_type=usage_type, ts=ts)
    db.add(grant)
    db.flush()
    return ev


def human_summary(
    *,
    event_type: str,
    outcome: str,
    usage_type: str,
    denied_reason: str | None,
    metadata: dict[str, Any],
) -> str:
    action = str(metadata.get("action") or "").strip()
    tool = str(metadata.get("tool_name") or "").strip()
    method = str(metadata.get("method") or "").strip()
    path_suffix = str(metadata.get("path_suffix") or "").strip()

    if event_type == AccessUsageEventType.TOKEN_ISSUED and outcome == AccessUsageOutcome.SUCCESS:
        return "Token retrieved successfully"
    if event_type == AccessUsageEventType.VALIDATED and outcome == AccessUsageOutcome.SUCCESS:
        return "Access key validated"
    if event_type == AccessUsageEventType.MCP_REQUEST and outcome == AccessUsageOutcome.SUCCESS:
        bits = ["Used in MCP client"]
        if method:
            bits.append(method)
        if path_suffix:
            bits.append(path_suffix)
        return " · ".join(bits)
    if event_type == AccessUsageEventType.MCP_REQUEST and outcome == AccessUsageOutcome.ERROR:
        if denied_reason == "upstream_http_denied":
            return "MCP request failed (upstream denied the call)"
        if denied_reason == "upstream_error":
            return "MCP request failed (upstream error)"
    if event_type == AccessUsageEventType.TOOL_EXECUTED and outcome == AccessUsageOutcome.SUCCESS:
        if action == "call_tool" and tool:
            return f"Tool call succeeded ({tool})"
        if action == "discover_tools":
            return "Tool list retrieved"
        return "Tool request succeeded"
    if outcome == AccessUsageOutcome.DENIED:
        if denied_reason == "grant_instance_mismatch":
            return "Request denied (wrong connection for this key)"
        if denied_reason == "direct_token_access_disabled":
            return "Request denied (token retrieval not enabled for this key)"
        if denied_reason in ("revoked", "access_revoked"):
            return "Request denied because the key was revoked"
        if denied_reason == "expired":
            return "Request denied because the key expired"
        if denied_reason == "tool_not_allowed" or denied_reason == "tool_not_allowed_by_grant":
            return "Request denied (tool not allowed for this key)"
        if denied_reason == "oauth_upstream_token_missing":
            return "Request denied (no upstream token for this connection)"
        if denied_reason:
            return f"Request denied ({denied_reason.replace('_', ' ')})"
        return "Request denied"
    if outcome == AccessUsageOutcome.ERROR:
        if denied_reason == "mcp_relay_upstream_unreachable":
            return "MCP request failed (upstream unreachable)"
        if denied_reason == "oauth_upstream_token_invalid":
            return "MCP request failed (upstream token invalid)"
        if denied_reason == "upstream_error":
            return "Tool call failed with upstream error"
        if denied_reason:
            return f"Request failed ({denied_reason.replace('_', ' ')})"
        return "Request failed"
    if event_type == AccessUsageEventType.INVALID:
        if denied_reason == "expired":
            return "Validation failed (key expired)"
        if denied_reason in ("revoked", "access_revoked"):
            return "Validation failed (key revoked)"
        return "Validation failed"
    if event_type == AccessUsageEventType.REVOKED:
        return "Attempted use of a revoked key"
    return f"{event_type} · {usage_type} · {outcome}"


def unusable_grant_reason(grant: AccessGrant, *, now=None) -> str:
    t = now or utcnow()
    if grant.revoked_at is not None or grant.status == AccessGrantStatus.REVOKED.value:
        return "revoked"
    if grant.expires_at is not None and grant.expires_at <= t:
        return "expired"
    if grant.status == AccessGrantStatus.INVALID.value:
        return "invalid_status"
    if grant.status != AccessGrantStatus.ACTIVE.value:
        return "inactive"
    return "unknown"


def commit_audit_event(db: Session) -> None:
    db.commit()


def window_usage_counts(
    db: Session,
    grant_ids: list[str],
    *,
    now=None,
) -> dict[str, dict[str, int]]:
    """Per-grant event counts for the last 24h / 7d / 30d (UTC)."""
    if not grant_ids:
        return {}
    t = now or utcnow()
    t24 = t - timedelta(hours=24)
    t7 = t - timedelta(days=7)
    t30 = t - timedelta(days=30)

    gid = AccessUsageEvent.access_grant_id
    ca = AccessUsageEvent.created_at

    stmt = (
        select(
            gid,
            func.sum(case((ca >= t24, 1), else_=0)).label("c24"),
            func.sum(case((ca >= t7, 1), else_=0)).label("c7"),
            func.sum(case((ca >= t30, 1), else_=0)).label("c30"),
        )
        .where(gid.in_(grant_ids))
        .group_by(gid)
    )

    out: dict[str, dict[str, int]] = {g: {"24h": 0, "7d": 0, "30d": 0} for g in grant_ids}
    for row in db.execute(stmt):
        gid_v = str(row[0])
        if gid_v in out:
            out[gid_v] = {
                "24h": int(row[1] or 0),
                "7d": int(row[2] or 0),
                "30d": int(row[3] or 0),
            }
    return out
