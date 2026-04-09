from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.execution_engine_v2 import enforce_consumer_tool_policy, execute_instance_action
from app.models import AuthMode, IntegrationInstance, IntegrationTool
from app.schemas import IntegrationExecuteRequest, IntegrationExecuteResponse, IntegrationToolOut
from app.security import dumps_json, loads_json
from app.services.access_grants import (
    BROKER_ACCESS_KEY_PREFIX,
    resolve_upstream_oauth_token_for_grant,
)
from app.services.access_usage_audit import (
    AccessUsageEventType,
    AccessUsageOutcome,
    AccessUsageType,
    RequestAuditInfo,
    record_access_usage_event,
)
from app.services.consumer_access import resolve_consumer_grant_context

router = APIRouter(tags=["consumer-execution"])


def _extract_broker_access_key(authorization: str | None, x_broker_access_key: str | None) -> str | None:
    if x_broker_access_key and x_broker_access_key.strip():
        return x_broker_access_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token.startswith(BROKER_ACCESS_KEY_PREFIX):
            return token
    return None


def _audit(request: Request) -> RequestAuditInfo:
    return RequestAuditInfo(
        request_id=(request.headers.get("x-request-id") or "").strip() or None,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


def _http_detail(exc: HTTPException) -> str:
    d = exc.detail
    if isinstance(d, str):
        return d[:128]
    return "error"


def _record_tool_http_exception(
    db,
    *,
    grant,
    instance,
    integration,
    exc: HTTPException,
    audit: RequestAuditInfo,
    action: str,
    tool_name: str | None,
) -> None:
    detail = _http_detail(exc)
    outcome = AccessUsageOutcome.DENIED if exc.status_code in (401, 403) else AccessUsageOutcome.ERROR
    event_t = (
        AccessUsageEventType.REQUEST_DENIED
        if exc.status_code in (401, 403)
        else AccessUsageEventType.TOOL_EXECUTED
    )
    record_access_usage_event(
        db,
        grant=grant,
        integration_instance_id=instance.id,
        integration_id=integration.id,
        event_type=event_t,
        usage_type=AccessUsageType.TOOL_EXECUTION,
        outcome=outcome,
        status_code=exc.status_code,
        denied_reason=detail,
        request=audit,
        metadata={"action": action, "tool_name": tool_name},
    )
    db.commit()


@router.post("/consumer/integration-instances/{instance_id}/execute", response_model=IntegrationExecuteResponse)
async def consumer_execute(
    request: Request,
    instance_id: str,
    payload: IntegrationExecuteRequest,
    authorization: str | None = Header(default=None),
    x_broker_access_key: str | None = Header(default=None, alias="X-Broker-Access-Key"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
    db: Session = Depends(get_db),
):
    audit = _audit(request)
    raw = _extract_broker_access_key(authorization, x_broker_access_key)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_broker_access_key")
    grant, instance, integration = resolve_consumer_grant_context(
        db,
        raw_key=raw,
        instance_id=instance_id,
        usage_type=AccessUsageType.TOOL_EXECUTION,
        request=audit,
    )

    allowed = loads_json(grant.allowed_tools_json, [])
    grant_tools = [str(x) for x in allowed] if isinstance(allowed, list) else []
    try:
        enforce_consumer_tool_policy(
            db,
            organization_id=grant.organization_id,
            integration_id=integration.id,
            action=payload.action,
            tool_name=payload.tool_name,
            grant_allowed_tools=grant_tools,
        )
    except HTTPException as exc:
        _record_tool_http_exception(
            db,
            grant=grant,
            instance=instance,
            integration=integration,
            exc=exc,
            audit=audit,
            action=payload.action,
            tool_name=payload.tool_name,
        )
        raise

    upstream_token = resolve_upstream_oauth_token_for_grant(
        db, grant=grant, instance=instance, x_user_token=x_user_token
    )
    if instance.auth_mode == AuthMode.OAUTH.value and not upstream_token:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance.id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.TOOL_EXECUTION,
            outcome=AccessUsageOutcome.DENIED,
            status_code=401,
            denied_reason="oauth_upstream_token_missing",
            request=audit,
            metadata={"action": payload.action, "tool_name": payload.tool_name},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_missing")

    try:
        result = await execute_instance_action(
            instance,
            integration_config=loads_json(integration.config_json, {}),
            action=payload.action,
            tool_name=payload.tool_name,
            arguments=payload.arguments,
            x_user_token=upstream_token,
        )
    except HTTPException as exc:
        _record_tool_http_exception(
            db,
            grant=grant,
            instance=instance,
            integration=integration,
            exc=exc,
            audit=audit,
            action=payload.action,
            tool_name=payload.tool_name,
        )
        raise

    record_access_usage_event(
        db,
        grant=grant,
        integration_instance_id=instance.id,
        integration_id=integration.id,
        event_type=AccessUsageEventType.TOOL_EXECUTED,
        usage_type=AccessUsageType.TOOL_EXECUTION,
        outcome=AccessUsageOutcome.SUCCESS,
        status_code=200,
        request=audit,
        metadata={"action": payload.action, "tool_name": payload.tool_name},
    )
    db.commit()
    return IntegrationExecuteResponse(result=result)


@router.post("/consumer/integration-instances/{instance_id}/discover-tools", response_model=list[IntegrationToolOut])
async def consumer_discover_tools(
    request: Request,
    instance_id: str,
    authorization: str | None = Header(default=None),
    x_broker_access_key: str | None = Header(default=None, alias="X-Broker-Access-Key"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
    db: Session = Depends(get_db),
):
    audit = _audit(request)
    raw = _extract_broker_access_key(authorization, x_broker_access_key)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_broker_access_key")
    grant, instance, integration = resolve_consumer_grant_context(
        db,
        raw_key=raw,
        instance_id=instance_id,
        usage_type=AccessUsageType.TOOL_EXECUTION,
        request=audit,
    )
    if not integration.mcp_enabled:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance.id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.TOOL_EXECUTION,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="integration_not_mcp_enabled",
            request=audit,
            metadata={"action": "discover_tools"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_not_mcp_enabled")

    allowed = loads_json(grant.allowed_tools_json, [])
    grant_tools = [str(x) for x in allowed] if isinstance(allowed, list) else []
    try:
        enforce_consumer_tool_policy(
            db,
            organization_id=grant.organization_id,
            integration_id=integration.id,
            action="discover_tools",
            tool_name=None,
            grant_allowed_tools=grant_tools,
        )
    except HTTPException as exc:
        _record_tool_http_exception(
            db,
            grant=grant,
            instance=instance,
            integration=integration,
            exc=exc,
            audit=audit,
            action="discover_tools",
            tool_name=None,
        )
        raise

    upstream_token = resolve_upstream_oauth_token_for_grant(
        db, grant=grant, instance=instance, x_user_token=x_user_token
    )
    if instance.auth_mode == AuthMode.OAUTH.value and not upstream_token:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance.id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.TOOL_EXECUTION,
            outcome=AccessUsageOutcome.DENIED,
            status_code=401,
            denied_reason="oauth_upstream_token_missing",
            request=audit,
            metadata={"action": "discover_tools"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_missing")

    try:
        result = await execute_instance_action(
            instance,
            integration_config=loads_json(integration.config_json, {}),
            action="discover_tools",
            tool_name=None,
            arguments={},
            x_user_token=upstream_token,
        )
    except HTTPException as exc:
        _record_tool_http_exception(
            db,
            grant=grant,
            instance=instance,
            integration=integration,
            exc=exc,
            audit=audit,
            action="discover_tools",
            tool_name=None,
        )
        raise

    tools = result.get("tools") if isinstance(result, dict) else []
    if not isinstance(tools, list):
        tools = []
    saved: list[IntegrationToolOut] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "").strip()
        if not name:
            continue
        row = db.scalar(
            select(IntegrationTool).where(
                IntegrationTool.organization_id == grant.organization_id,
                IntegrationTool.integration_id == integration.id,
                IntegrationTool.tool_name == name,
            )
        )
        if not row:
            row = IntegrationTool(
                organization_id=grant.organization_id,
                integration_id=integration.id,
                tool_name=name,
            )
            db.add(row)
            db.flush()
        row.description = str(tool.get("description") or "") or None
        row.input_schema_json = dumps_json(tool.get("input_schema") or {})
        saved.append(
            IntegrationToolOut(
                id=row.id,
                name=row.tool_name,
                description=row.description,
                input_schema=loads_json(row.input_schema_json, {}),
                visible=row.visible,
                allowed=row.allowed,
            )
        )
    record_access_usage_event(
        db,
        grant=grant,
        integration_instance_id=instance.id,
        integration_id=integration.id,
        event_type=AccessUsageEventType.TOOL_EXECUTED,
        usage_type=AccessUsageType.TOOL_EXECUTION,
        outcome=AccessUsageOutcome.SUCCESS,
        status_code=200,
        request=audit,
        metadata={"action": "discover_tools"},
    )
    db.commit()
    return saved
