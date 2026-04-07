from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.execution_engine_v2 import enforce_consumer_tool_policy, execute_instance_action
from app.models import AuthMode, Integration, IntegrationInstance, IntegrationTool
from app.schemas import IntegrationExecuteRequest, IntegrationExecuteResponse, IntegrationToolOut
from app.security import dumps_json, loads_json
from app.services.access_grants import (
    BROKER_ACCESS_KEY_PREFIX,
    get_grant_by_presented_key,
    is_grant_usable,
    resolve_upstream_oauth_token_for_grant,
    touch_grant_used,
)

router = APIRouter(tags=["consumer-execution"])


def _extract_broker_access_key(authorization: str | None, x_broker_access_key: str | None) -> str | None:
    if x_broker_access_key and x_broker_access_key.strip():
        return x_broker_access_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token.startswith(BROKER_ACCESS_KEY_PREFIX):
            return token
    return None


@router.post("/consumer/integration-instances/{instance_id}/execute", response_model=IntegrationExecuteResponse)
async def consumer_execute(
    instance_id: str,
    payload: IntegrationExecuteRequest,
    authorization: str | None = Header(default=None),
    x_broker_access_key: str | None = Header(default=None, alias="X-Broker-Access-Key"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
    db: Session = Depends(get_db),
):
    raw = _extract_broker_access_key(authorization, x_broker_access_key)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_broker_access_key")
    grant = get_grant_by_presented_key(db, raw)
    if not grant or not is_grant_usable(grant):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_access_key")
    if grant.integration_instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="grant_instance_mismatch")

    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == grant.organization_id,
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(Integration.id == instance.integration_id, Integration.organization_id == grant.organization_id)
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")

    allowed = loads_json(grant.allowed_tools_json, [])
    grant_tools = [str(x) for x in allowed] if isinstance(allowed, list) else []
    enforce_consumer_tool_policy(
        db,
        organization_id=grant.organization_id,
        integration_id=integration.id,
        action=payload.action,
        tool_name=payload.tool_name,
        grant_allowed_tools=grant_tools,
    )

    upstream_token = resolve_upstream_oauth_token_for_grant(
        db, grant=grant, instance=instance, x_user_token=x_user_token
    )
    if instance.auth_mode == AuthMode.OAUTH.value and not upstream_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_missing")

    result = await execute_instance_action(
        instance,
        integration_config=loads_json(integration.config_json, {}),
        action=payload.action,
        tool_name=payload.tool_name,
        arguments=payload.arguments,
        x_user_token=upstream_token,
    )
    touch_grant_used(db, grant)
    db.commit()
    return IntegrationExecuteResponse(result=result)


@router.post("/consumer/integration-instances/{instance_id}/discover-tools", response_model=list[IntegrationToolOut])
async def consumer_discover_tools(
    instance_id: str,
    authorization: str | None = Header(default=None),
    x_broker_access_key: str | None = Header(default=None, alias="X-Broker-Access-Key"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
    db: Session = Depends(get_db),
):
    raw = _extract_broker_access_key(authorization, x_broker_access_key)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_broker_access_key")
    grant = get_grant_by_presented_key(db, raw)
    if not grant or not is_grant_usable(grant):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_access_key")
    if grant.integration_instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="grant_instance_mismatch")

    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == grant.organization_id,
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(Integration.id == instance.integration_id, Integration.organization_id == grant.organization_id)
    )
    if not integration or not integration.mcp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_not_mcp_enabled")

    allowed = loads_json(grant.allowed_tools_json, [])
    grant_tools = [str(x) for x in allowed] if isinstance(allowed, list) else []
    enforce_consumer_tool_policy(
        db,
        organization_id=grant.organization_id,
        integration_id=integration.id,
        action="discover_tools",
        tool_name=None,
        grant_allowed_tools=grant_tools,
    )

    upstream_token = resolve_upstream_oauth_token_for_grant(
        db, grant=grant, instance=instance, x_user_token=x_user_token
    )
    if instance.auth_mode == AuthMode.OAUTH.value and not upstream_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_missing")

    result = await execute_instance_action(
        instance,
        integration_config=loads_json(integration.config_json, {}),
        action="discover_tools",
        tool_name=None,
        arguments={},
        x_user_token=upstream_token,
    )
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
    touch_grant_used(db, grant)
    db.commit()
    return saved
