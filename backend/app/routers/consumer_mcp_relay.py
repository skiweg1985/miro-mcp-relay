from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.database import get_db
from app.deps import record_audit
from app.execution_engine_v2 import resolve_outbound_headers
from app.mcp_relay_engine import (
    assert_integration_endpoint_safe_for_relay,
    filter_client_headers_for_upstream,
    filter_upstream_response_headers,
    join_upstream_url,
    merge_upstream_auth_headers,
    upstream_urls_equivalent,
)
from app.models import AuthMode, IntegrationAccessMode, IntegrationType
from app.security import loads_json
from app.services.access_grants import BROKER_ACCESS_KEY_PREFIX, resolve_upstream_oauth_token_for_grant
from app.services.access_usage_audit import (
    AccessUsageEventType,
    AccessUsageOutcome,
    AccessUsageType,
    RequestAuditInfo,
    record_access_usage_event,
)
from app.services.consumer_access import resolve_consumer_grant_context
from app.upstream_oauth import force_refresh_upstream_oauth_token_for_grant

logger = logging.getLogger(__name__)

router = APIRouter(tags=["consumer-mcp-relay"])

# Streamable-HTTP-Upstreams (z. B. Miro) erwarten oft dieselbe TCP-Verbindung für initialize und Folge-POSTs.
_relay_upstream_clients: OrderedDict[str, httpx.AsyncClient] = OrderedDict()
_relay_upstream_lock = asyncio.Lock()
_RELAY_UPSTREAM_CLIENT_CAP = 256


async def shutdown_relay_upstream_clients() -> None:
    async with _relay_upstream_lock:
        for c in _relay_upstream_clients.values():
            await c.aclose()
        _relay_upstream_clients.clear()


async def _relay_upstream_client(grant_id: str, timeout: httpx.Timeout) -> httpx.AsyncClient:
    async with _relay_upstream_lock:
        if grant_id in _relay_upstream_clients:
            c = _relay_upstream_clients.pop(grant_id)
            _relay_upstream_clients[grant_id] = c
            logger.info("mcp_relay_upstream_client_cache_hit grant_id=%s", grant_id)
            return c
        while len(_relay_upstream_clients) >= _RELAY_UPSTREAM_CLIENT_CAP:
            _evict_id, old = _relay_upstream_clients.popitem(last=False)
            await old.aclose()
            logger.info("mcp_relay_upstream_client_evicted grant_id=%s", _evict_id)
        logger.info("mcp_relay_upstream_client_cache_miss grant_id=%s", grant_id)
        limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)
        c = httpx.AsyncClient(timeout=timeout, follow_redirects=False, limits=limits)
        _relay_upstream_clients[grant_id] = c
        return c

_METHODS_WITH_BODY = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _extract_broker_access_key(authorization: str | None, x_broker_access_key: str | None) -> str | None:
    if x_broker_access_key and x_broker_access_key.strip():
        return x_broker_access_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token.startswith(BROKER_ACCESS_KEY_PREFIX):
            return token
    return None


def _consumer_mcp_relay_enabled(access_config_json: str) -> bool:
    cfg = loads_json(access_config_json or "{}", {})
    if not isinstance(cfg, dict):
        return True
    if "consumer_mcp_relay" in cfg:
        return bool(cfg.get("consumer_mcp_relay"))
    return True


def _audit(request: Request) -> RequestAuditInfo:
    return RequestAuditInfo(
        request_id=(request.headers.get("x-request-id") or "").strip() or None,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


def _http_exc_detail(exc: HTTPException) -> str:
    d = exc.detail
    if isinstance(d, str):
        return d[:128]
    return "error"


def _relay_base_url(integration_config: dict) -> str:
    """MCP relay base URL: prefer explicit `mcp_relay_base_url`, fall back to `endpoint`."""
    explicit = str(integration_config.get("mcp_relay_base_url") or "").strip()
    if explicit:
        return explicit
    return str(integration_config.get("endpoint") or "").strip()


async def _mcp_relay_handler(
    request: Request,
    instance_id: str,
    path: str = "",
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
        usage_type=AccessUsageType.MCP,
        request=audit,
    )

    method = request.method.upper()
    subpath_early = path.strip()

    def _relay_meta() -> dict:
        return {"method": method, "path_suffix": subpath_early or ""}

    if integration.type != IntegrationType.MCP_SERVER.value:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="integration_not_mcp_server",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_not_mcp_server")
    if not integration.mcp_enabled:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="integration_not_mcp_enabled",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_not_mcp_enabled")
    if instance.access_mode != IntegrationAccessMode.RELAY.value:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="mcp_relay_requires_relay_access_mode",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mcp_relay_requires_relay_access_mode")
    if not _consumer_mcp_relay_enabled(instance.access_config_json):
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="consumer_mcp_relay_disabled",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="consumer_mcp_relay_disabled")

    integration_config = loads_json(integration.config_json, {})
    base_endpoint = _relay_base_url(integration_config if isinstance(integration_config, dict) else {})
    if not base_endpoint:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.ERROR,
            denied_reason="integration_endpoint_missing",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_endpoint_missing")

    try:
        assert_integration_endpoint_safe_for_relay(base_endpoint)
    except ValueError as exc:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.ERROR,
            denied_reason="integration_endpoint_invalid",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_endpoint_invalid") from exc

    subpath = subpath_early
    if subpath:
        if "://" in subpath or subpath.startswith("//"):
            record_access_usage_event(
                db,
                grant=grant,
                integration_instance_id=instance_id,
                integration_id=integration.id,
                event_type=AccessUsageEventType.REQUEST_DENIED,
                usage_type=AccessUsageType.MCP,
                outcome=AccessUsageOutcome.DENIED,
                denied_reason="invalid_relay_path",
                request=audit,
                metadata=_relay_meta(),
            )
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_relay_path")
        for segment in subpath.split("/"):
            if segment == "..":
                record_access_usage_event(
                    db,
                    grant=grant,
                    integration_instance_id=instance_id,
                    integration_id=integration.id,
                    event_type=AccessUsageEventType.REQUEST_DENIED,
                    usage_type=AccessUsageType.MCP,
                    outcome=AccessUsageOutcome.DENIED,
                    denied_reason="invalid_relay_path",
                    request=audit,
                    metadata=_relay_meta(),
                )
                db.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_relay_path")
    target_url = join_upstream_url(base_endpoint, subpath or None)
    if not upstream_urls_equivalent(base_endpoint, target_url):
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="upstream_url_not_allowed",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="upstream_url_not_allowed")

    upstream_token = resolve_upstream_oauth_token_for_grant(
        db, grant=grant, instance=instance, x_user_token=x_user_token
    )
    if instance.auth_mode == AuthMode.OAUTH.value and not upstream_token:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="oauth_upstream_token_missing",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_missing")

    timeout = httpx.Timeout(connect=30.0, read=3600.0, write=3600.0, pool=30.0)
    body_bytes: bytes | None = None
    if method in _METHODS_WITH_BODY:
        body_bytes = await request.body()

    client_headers = filter_client_headers_for_upstream(request.headers)

    async def _send_upstream(tok: str | None) -> httpx.Response:
        try:
            outbound = resolve_outbound_headers(instance, x_user_token=tok)
        except HTTPException:
            raise
        merged = merge_upstream_auth_headers(client_headers=client_headers, upstream_auth=outbound)
        c = await _relay_upstream_client(grant.id, timeout)
        req = c.build_request(method, target_url, headers=merged, content=body_bytes)
        return await c.send(req, stream=True)

    try:
        upstream = await _send_upstream(upstream_token)
        client_used_override = bool(x_user_token and x_user_token.strip())
        if (
            upstream.status_code == 401
            and instance.auth_mode == AuthMode.OAUTH.value
            and not client_used_override
        ):
            await upstream.aclose()
            new_tok = force_refresh_upstream_oauth_token_for_grant(
                db,
                grant_user_id=grant.user_id,
                organization_id=grant.organization_id,
                instance=instance,
                user_connection_id=grant.user_connection_id,
            )
            if new_tok:
                db.commit()
                upstream = await _send_upstream(new_tok)
            else:
                db.commit()
                record_access_usage_event(
                    db,
                    grant=grant,
                    integration_instance_id=instance_id,
                    integration_id=integration.id,
                    event_type=AccessUsageEventType.MCP_REQUEST,
                    usage_type=AccessUsageType.MCP,
                    outcome=AccessUsageOutcome.ERROR,
                    status_code=401,
                    denied_reason="oauth_upstream_token_invalid",
                    request=audit,
                    metadata=_relay_meta(),
                )
                db.commit()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="oauth_upstream_token_invalid")
        upstream_ct = upstream.headers.get("content-type") or "none"
        upstream_host = urlparse(target_url).hostname or ""
        logger.info(
            "mcp_relay_upstream_response_start instance_id=%s grant_id=%s method=%s path_suffix=%s upstream_status=%s upstream_content_type=%s upstream_host=%s",
            instance_id,
            grant.id,
            method,
            subpath or "",
            upstream.status_code,
            upstream_ct,
            upstream_host,
        )
    except HTTPException as exc:
        detail_code = _http_exc_detail(exc)
        if detail_code != "oauth_upstream_token_invalid":
            record_access_usage_event(
                db,
                grant=grant,
                integration_instance_id=instance_id,
                integration_id=integration.id,
                event_type=AccessUsageEventType.MCP_REQUEST,
                usage_type=AccessUsageType.MCP,
                outcome=AccessUsageOutcome.ERROR,
                status_code=exc.status_code,
                denied_reason=detail_code,
                request=audit,
                metadata=_relay_meta(),
            )
            db.commit()
        raise
    except httpx.RequestError as exc:
        logger.warning("mcp_relay_upstream_error instance_id=%s detail=%s", instance_id, type(exc).__name__)
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.MCP_REQUEST,
            usage_type=AccessUsageType.MCP,
            outcome=AccessUsageOutcome.ERROR,
            denied_reason="mcp_relay_upstream_unreachable",
            request=audit,
            metadata=_relay_meta(),
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="mcp_relay_upstream_unreachable") from exc

    sc = upstream.status_code
    if 200 <= sc < 300:
        mcp_outcome = AccessUsageOutcome.SUCCESS
        mcp_denied = None
    elif sc in (401, 403):
        mcp_outcome = AccessUsageOutcome.ERROR
        mcp_denied = "upstream_http_denied"
    else:
        mcp_outcome = AccessUsageOutcome.ERROR
        mcp_denied = "upstream_error"

    record_audit(
        db,
        action="consumer_mcp_relay",
        actor_type="access_grant",
        actor_id=grant.id,
        organization_id=grant.organization_id,
        metadata={
            "integration_instance_id": instance_id,
            "method": method,
            "path_suffix": subpath or "",
        },
    )
    record_access_usage_event(
        db,
        grant=grant,
        integration_instance_id=instance_id,
        integration_id=integration.id,
        event_type=AccessUsageEventType.MCP_REQUEST,
        usage_type=AccessUsageType.MCP,
        outcome=mcp_outcome,
        status_code=sc,
        denied_reason=mcp_denied,
        request=audit,
        metadata=_relay_meta(),
    )
    db.commit()

    resp_headers = filter_upstream_response_headers(upstream.headers)

    async def passthrough():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        except httpx.ReadError as exc:
            logger.warning(
                "mcp_relay_upstream_stream_closed instance_id=%s detail=%s",
                instance_id,
                type(exc).__name__,
            )
        finally:
            await upstream.aclose()

    return StreamingResponse(
        passthrough(),
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=None,
    )


@router.get("/consumer/integration-instances/{instance_id}/mcp-connection-info")
def consumer_mcp_connection_info(
    request: Request,
    instance_id: str,
    authorization: str | None = Header(default=None),
    x_broker_access_key: str | None = Header(default=None, alias="X-Broker-Access-Key"),
    db: Session = Depends(get_db),
):
    """Lightweight JSON for clients that fetch connection metadata with the same access key."""
    audit = _audit(request)
    raw = _extract_broker_access_key(authorization, x_broker_access_key)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_broker_access_key")
    grant, instance, integration = resolve_consumer_grant_context(
        db,
        raw_key=raw,
        instance_id=instance_id,
        usage_type=AccessUsageType.VALIDATION_ONLY,
        request=audit,
    )
    if integration.type != IntegrationType.MCP_SERVER.value or not integration.mcp_enabled:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.VALIDATION_ONLY,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="integration_not_mcp_enabled",
            request=audit,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="integration_not_mcp_enabled")
    if instance.access_mode != IntegrationAccessMode.RELAY.value:
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.VALIDATION_ONLY,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="mcp_relay_requires_relay_access_mode",
            request=audit,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mcp_relay_requires_relay_access_mode")
    if not _consumer_mcp_relay_enabled(instance.access_config_json):
        record_access_usage_event(
            db,
            grant=grant,
            integration_instance_id=instance_id,
            integration_id=integration.id,
            event_type=AccessUsageEventType.REQUEST_DENIED,
            usage_type=AccessUsageType.VALIDATION_ONLY,
            outcome=AccessUsageOutcome.DENIED,
            denied_reason="consumer_mcp_relay_disabled",
            request=audit,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="consumer_mcp_relay_disabled")
    record_access_usage_event(
        db,
        grant=grant,
        integration_instance_id=instance_id,
        integration_id=integration.id,
        event_type=AccessUsageEventType.VALIDATED,
        usage_type=AccessUsageType.VALIDATION_ONLY,
        outcome=AccessUsageOutcome.SUCCESS,
        status_code=200,
        request=audit,
        metadata={"surface": "mcp_connection_info"},
    )
    db.commit()
    return {
        "ok": True,
        "transport": "streamable_http",
        "integration_instance_id": instance_id,
        "auth": {
            "broker": {
                "header": "X-Broker-Access-Key",
                "alternate": "Authorization: Bearer <bkr_…>",
            },
            "upstream": "resolved_by_broker",
        },
    }


_RELAY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

router.add_api_route(
    "/consumer/integration-instances/{instance_id}/mcp",
    _mcp_relay_handler,
    methods=_RELAY_METHODS,
)
router.add_api_route(
    "/consumer/integration-instances/{instance_id}/mcp/{path:path}",
    _mcp_relay_handler,
    methods=_RELAY_METHODS,
)
