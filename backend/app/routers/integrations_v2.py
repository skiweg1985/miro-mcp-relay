from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter, Body, Depends, Header, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import get_db
from app.deps import get_current_user, require_admin, require_csrf
from app.default_integrations import INTEGRATION_GRAPH_DEFAULT_ID, INTEGRATION_MIRO_DEFAULT_ID, TEMPLATE_KEY_MIRO_DEFAULT
from app.generic_integration_oauth import first_generic_oauth_config_error, is_generic_oauth_template
from app.execution_engine_v2 import execute_instance_action
from app.models import (
    AccessGrant,
    AccessGrantStatus,
    AuthMode,
    Integration,
    IntegrationAccessMode,
    IntegrationInstance,
    IntegrationTool,
    IntegrationType,
    User,
    UserConnection,
)
from app.schemas import (
    IntegrationCreate,
    IntegrationDeleteResult,
    IntegrationExecuteRequest,
    IntegrationExecuteResponse,
    IntegrationInstanceCreate,
    IntegrationInstanceDeleteResult,
    IntegrationInstanceInspectOut,
    IntegrationInstanceOut,
    IntegrationInstanceUpdate,
    IntegrationOut,
    IntegrationToolOut,
    IntegrationUpdate,
    UserConnectionSummaryOut,
)
from app.security import dumps_json, encrypt_text, loads_json, utcnow
from app.microsoft_oauth_resolver import microsoft_graph_oauth_redirect_uri
from app.services.access_grant_lifecycle import (
    INVALIDATION_CONNECTION_DELETED,
    INVALIDATION_CRITICAL_SETTINGS,
    INVALIDATION_INTEGRATION_CONFIG,
    INVALIDATION_INTEGRATION_DELETED,
    critical_integration_config_changed,
    critical_instance_settings_snapshot,
    instance_critical_settings_changed,
    invalidate_grants_for_instance,
    invalidate_grants_for_integration_instances,
    soft_delete_integration_instance,
)
from app.upstream_oauth import get_upstream_oauth_token_for_session, user_has_oauth_connection

router = APIRouter(tags=["integrations-v2"])


def _integration_out(item: Integration) -> IntegrationOut:
    settings = get_settings()
    cfg = loads_json(item.config_json, {})
    if str(cfg.get("template_key") or "") == "microsoft_graph_default":
        callback = microsoft_graph_oauth_redirect_uri(settings, cfg)
    else:
        callback = f"{settings.broker_public_base_url.rstrip('/')}{settings.api_v1_prefix}/integration-instances/oauth/callback"
    return IntegrationOut(
        id=item.id,
        name=item.name,
        type=item.type,
        config=loads_json(item.config_json, {}),
        mcp_enabled=item.mcp_enabled,
        created_at=item.created_at,
        updated_at=item.updated_at,
        oauth_client_secret_configured=bool(item.oauth_client_secret_encrypted),
        integration_oauth_callback_url=callback,
    )


def _instance_out(db: Session, item: IntegrationInstance, user: User) -> IntegrationInstanceOut:
    connected = False
    if item.auth_mode == AuthMode.OAUTH.value:
        connected = user_has_oauth_connection(
            db,
            user_id=user.id,
            organization_id=user.organization_id,
            instance_id=item.id,
        )
    return IntegrationInstanceOut(
        id=item.id,
        name=item.name,
        integration_id=item.integration_id,
        auth_mode=item.auth_mode,
        auth_config=loads_json(item.auth_config_json, {}),
        access_mode=item.access_mode,
        access_config=loads_json(item.access_config_json, {}),
        created_at=item.created_at,
        updated_at=item.updated_at,
        oauth_connected=connected,
    )


def _validate_integration(payload: IntegrationCreate) -> None:
    if payload.type not in {value.value for value in IntegrationType}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_integration_type")
    if payload.type == IntegrationType.MCP_SERVER.value and not payload.mcp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mcp_server_requires_mcp_enabled")
    if payload.type == IntegrationType.OAUTH_PROVIDER.value and is_generic_oauth_template(payload.config or {}):
        secret_plain = str(payload.oauth_integration_client_secret or "").strip()
        probe = SimpleNamespace(
            oauth_client_secret_encrypted=encrypt_text(secret_plain) if secret_plain else None,
        )
        err = first_generic_oauth_config_error(payload.config or {}, probe)
        if err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)


def _integration_protected(integration: Integration) -> bool:
    if integration.id in (INTEGRATION_MIRO_DEFAULT_ID, INTEGRATION_GRAPH_DEFAULT_ID):
        return True
    cfg = loads_json(integration.config_json, {})
    tk = str(cfg.get("template_key") or "").strip()
    if tk in (TEMPLATE_KEY_MIRO_DEFAULT, "microsoft_graph_default"):
        return True
    return False


def _count_active_grants_for_instance(db: Session, organization_id: str, instance_id: str) -> int:
    n = db.scalar(
        select(func.count())
        .select_from(AccessGrant)
        .where(
            AccessGrant.organization_id == organization_id,
            AccessGrant.integration_instance_id == instance_id,
            AccessGrant.status == AccessGrantStatus.ACTIVE.value,
        )
    )
    return int(n or 0)


def _validate_instance(payload: IntegrationInstanceCreate, integration: Integration) -> None:
    if payload.auth_mode not in {value.value for value in AuthMode}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_auth_mode")
    if payload.access_mode not in {value.value for value in IntegrationAccessMode}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_access_mode")
    if integration.type == IntegrationType.MCP_SERVER.value and payload.access_mode != IntegrationAccessMode.RELAY.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mcp_requires_relay_access")
    if integration.type == IntegrationType.OAUTH_PROVIDER.value and payload.auth_mode != AuthMode.OAUTH.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="oauth_provider_requires_oauth_mode")
    if payload.auth_mode == AuthMode.NONE.value and payload.auth_config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="auth_none_forbids_credentials")


@router.get("/integrations", response_model=list[IntegrationOut])
def list_integrations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(Integration)
        .where(Integration.organization_id == current_user.organization_id, Integration.deleted_at.is_(None))
        .order_by(Integration.name.asc())
    ).all()
    return [_integration_out(row) for row in rows]


@router.patch("/integrations/{integration_id}", response_model=IntegrationOut)
def patch_integration(
    integration_id: str,
    payload: IntegrationUpdate = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    row = db.scalar(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == current_user.organization_id,
        )
    )
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")
    if payload.config is not None:
        base_cfg = loads_json(row.config_json, {})
        merged = {**base_cfg, **payload.config}
        if critical_integration_config_changed(base_cfg, merged):
            invalidate_grants_for_integration_instances(
                db,
                organization_id=current_user.organization_id,
                integration_id=row.id,
                reason=INVALIDATION_INTEGRATION_CONFIG,
            )
        row.config_json = dumps_json(merged)
    if payload.clear_graph_oauth_client_secret or payload.clear_oauth_integration_client_secret:
        row.oauth_client_secret_encrypted = None
    elif payload.graph_oauth_client_secret is not None:
        secret_raw = str(payload.graph_oauth_client_secret).strip()
        if secret_raw:
            row.oauth_client_secret_encrypted = encrypt_text(secret_raw)
        else:
            row.oauth_client_secret_encrypted = None
    elif payload.oauth_integration_client_secret is not None:
        secret_raw = str(payload.oauth_integration_client_secret).strip()
        if secret_raw:
            row.oauth_client_secret_encrypted = encrypt_text(secret_raw)
        else:
            row.oauth_client_secret_encrypted = None
    db.commit()
    db.refresh(row)
    return _integration_out(row)


@router.post("/integrations", response_model=IntegrationOut)
def create_integration(
    payload: IntegrationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    _validate_integration(payload)
    row = Integration(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        type=payload.type,
        config_json=dumps_json(payload.config),
        mcp_enabled=bool(payload.mcp_enabled),
    )
    secret_in = str(payload.oauth_integration_client_secret or "").strip()
    if secret_in:
        row.oauth_client_secret_encrypted = encrypt_text(secret_in)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _integration_out(row)


@router.get("/integration-instances", response_model=list[IntegrationInstanceOut])
def list_instances(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(IntegrationInstance)
        .where(
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
        .order_by(IntegrationInstance.created_at.desc())
    ).all()
    visible: list[IntegrationInstance] = []
    for row in rows:
        integ = db.get(Integration, row.integration_id)
        if integ and integ.deleted_at is None:
            visible.append(row)
    return [_instance_out(db, row, current_user) for row in visible]


@router.get("/integration-instances/{instance_id}/inspect", response_model=IntegrationInstanceInspectOut)
def inspect_integration_instance(
    instance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")

    conn = db.scalar(
        select(UserConnection).where(
            UserConnection.user_id == current_user.id,
            UserConnection.integration_instance_id == instance_id,
        )
    )
    uc_out: UserConnectionSummaryOut | None = None
    if conn:
        profile = loads_json(conn.metadata_json, {})
        if not isinstance(profile, dict):
            profile = {}
        uc_out = UserConnectionSummaryOut(
            id=conn.id,
            status=conn.status,
            created_at=conn.created_at,
            updated_at=conn.updated_at,
            profile=profile,
        )

    return IntegrationInstanceInspectOut(
        instance=_instance_out(db, instance, current_user),
        integration=_integration_out(integration),
        user_connection=uc_out,
    )


@router.post("/integration-instances", response_model=IntegrationInstanceOut)
def create_instance(
    payload: IntegrationInstanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    integration = db.scalar(
        select(Integration).where(
            Integration.id == payload.integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")
    _validate_instance(payload, integration)
    row = IntegrationInstance(
        organization_id=current_user.organization_id,
        integration_id=integration.id,
        name=payload.name.strip(),
        auth_mode=payload.auth_mode,
        auth_config_json=dumps_json(payload.auth_config),
        access_mode=payload.access_mode,
        access_config_json=dumps_json(payload.access_config),
        created_by_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _instance_out(db, row, current_user)


@router.patch("/integration-instances/{instance_id}", response_model=IntegrationInstanceOut)
def patch_instance(
    instance_id: str,
    payload: IntegrationInstanceUpdate = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")

    old_snap = critical_instance_settings_snapshot(instance)
    proposed_name = payload.name.strip() if payload.name is not None else instance.name
    proposed_auth_mode = payload.auth_mode if payload.auth_mode is not None else instance.auth_mode
    proposed_auth_json = dumps_json(payload.auth_config) if payload.auth_config is not None else instance.auth_config_json
    proposed_access_mode = payload.access_mode if payload.access_mode is not None else instance.access_mode
    proposed_access_json = dumps_json(payload.access_config) if payload.access_config is not None else instance.access_config_json

    if old_snap != (proposed_auth_mode, proposed_auth_json, proposed_access_mode, proposed_access_json):
        n = _count_active_grants_for_instance(db, current_user.organization_id, instance.id)
        if n > 0 and not payload.acknowledge_critical_change:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="critical_change_requires_confirmation")

    instance.name = proposed_name
    instance.auth_mode = proposed_auth_mode
    instance.auth_config_json = proposed_auth_json
    instance.access_mode = proposed_access_mode
    instance.access_config_json = proposed_access_json

    _validate_instance(
        IntegrationInstanceCreate(
            name=instance.name,
            integration_id=instance.integration_id,
            auth_mode=instance.auth_mode,
            auth_config=loads_json(instance.auth_config_json, {}),
            access_mode=instance.access_mode,
            access_config=loads_json(instance.access_config_json, {}),
        ),
        integration,
    )

    before = SimpleNamespace(
        auth_mode=old_snap[0],
        auth_config_json=old_snap[1],
        access_mode=old_snap[2],
        access_config_json=old_snap[3],
    )
    if instance_critical_settings_changed(before, instance):
        invalidate_grants_for_instance(
            db,
            organization_id=current_user.organization_id,
            instance_id=instance.id,
            reason=INVALIDATION_CRITICAL_SETTINGS,
        )

    db.add(instance)
    db.commit()
    db.refresh(instance)
    return _instance_out(db, instance, current_user)


@router.delete("/integration-instances/{instance_id}", response_model=IntegrationInstanceDeleteResult)
def delete_instance(
    instance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    n = soft_delete_integration_instance(db, instance, INVALIDATION_CONNECTION_DELETED)
    db.commit()
    return IntegrationInstanceDeleteResult(id=instance_id, grants_invalidated=n)


@router.delete("/integrations/{integration_id}", response_model=IntegrationDeleteResult)
def delete_integration(
    integration_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    _csrf: str = Depends(require_csrf),
):
    row = db.scalar(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")
    if _integration_protected(row):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_protected")
    total = 0
    n_inst = 0
    for inst in db.scalars(
        select(IntegrationInstance).where(
            IntegrationInstance.integration_id == row.id,
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
    ).all():
        total += soft_delete_integration_instance(db, inst, INVALIDATION_INTEGRATION_DELETED)
        n_inst += 1
    row.deleted_at = utcnow()
    db.add(row)
    db.commit()
    return IntegrationDeleteResult(id=integration_id, grants_invalidated=total, connections_removed=n_inst)


@router.post("/integration-instances/{instance_id}/execute", response_model=IntegrationExecuteResponse)
async def execute_instance(
    instance_id: str,
    payload: IntegrationExecuteRequest,
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration_not_found")
    upstream_token = get_upstream_oauth_token_for_session(
        db, user=current_user, instance=instance, x_user_token=x_user_token
    )
    result = await execute_instance_action(
        instance,
        integration_config=loads_json(integration.config_json, {}),
        action=payload.action,
        tool_name=payload.tool_name,
        arguments=payload.arguments,
        x_user_token=upstream_token,
    )
    return IntegrationExecuteResponse(result=result)


@router.post("/integration-instances/{instance_id}/discover-tools", response_model=list[IntegrationToolOut])
async def discover_tools(
    instance_id: str,
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instance = db.scalar(
        select(IntegrationInstance).where(
            IntegrationInstance.id == instance_id,
            IntegrationInstance.organization_id == current_user.organization_id,
            IntegrationInstance.deleted_at.is_(None),
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance_not_found")
    integration = db.scalar(
        select(Integration).where(
            Integration.id == instance.integration_id,
            Integration.organization_id == current_user.organization_id,
            Integration.deleted_at.is_(None),
        )
    )
    if not integration or not integration.mcp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_not_mcp_enabled")
    upstream_token = get_upstream_oauth_token_for_session(
        db, user=current_user, instance=instance, x_user_token=x_user_token
    )
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
                IntegrationTool.organization_id == current_user.organization_id,
                IntegrationTool.integration_id == integration.id,
                IntegrationTool.tool_name == name,
            )
        )
        if not row:
            row = IntegrationTool(
                organization_id=current_user.organization_id,
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
    db.commit()
    return saved
