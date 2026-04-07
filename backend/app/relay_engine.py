from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse

import httpx
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

from app.models import ConnectedAccount, ProviderApp, ProviderInstance
from app.oauth_connection_tokens import ensure_access_token, refresh_oauth_tokens
from app.relay_config import RelayConfig, effective_relay_config, resolve_upstream_base_url
from app.security import decrypt_text


@dataclass
class McpRequestInfo:
    method: str | None = None
    tool_name: str | None = None
    jsonrpc_id: Any = None


def parse_mcp_request(body: bytes) -> McpRequestInfo:
    if not body:
        return McpRequestInfo()
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return McpRequestInfo()
    if not isinstance(data, dict):
        return McpRequestInfo()
    method = data.get("method")
    jsonrpc_id = data.get("id")
    tool_name = None
    if method == "tools/call":
        params = data.get("params")
        if isinstance(params, dict):
            tool_name = params.get("name")
    return McpRequestInfo(method=method, tool_name=tool_name, jsonrpc_id=jsonrpc_id)

_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}

_BREAKERS: dict[str, dict[str, Any]] = {}


def _breaker_state(provider_app_id: str) -> dict[str, Any]:
    if provider_app_id not in _BREAKERS:
        _BREAKERS[provider_app_id] = {"consecutive_fails": 0, "open_until": 0.0}
    return _BREAKERS[provider_app_id]


def breaker_open_for(provider_app_id: str, config: RelayConfig) -> bool:
    if not config.circuit_breaker_enabled:
        return False
    return time.time() * 1000 < _breaker_state(provider_app_id)["open_until"]


def breaker_mark_success(provider_app_id: str, config: RelayConfig) -> None:
    if not config.circuit_breaker_enabled:
        return
    _breaker_state(provider_app_id)["consecutive_fails"] = 0


def breaker_mark_failure(provider_app_id: str, config: RelayConfig) -> None:
    if not config.circuit_breaker_enabled:
        return
    st = _breaker_state(provider_app_id)
    st["consecutive_fails"] += 1
    if st["consecutive_fails"] >= config.circuit_breaker_fail_threshold:
        st["open_until"] = time.time() * 1000 + config.circuit_breaker_open_ms
        st["consecutive_fails"] = 0


def _substitute_header_templates(values: dict[str, str], ctx: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, tmpl in values.items():
        s = tmpl
        for name, val in ctx.items():
            s = s.replace(f"{{{name}}}", val)
        out[key] = s
    return out


def _incoming_headers_to_forward(request: Request, config: RelayConfig) -> dict[str, str]:
    blocked = set(_HOP_BY_HOP)
    if config.blocked_request_headers:
        blocked |= {h.lower() for h in config.blocked_request_headers}
    allow = None
    if config.allowed_request_headers:
        allow = {h.lower() for h in config.allowed_request_headers}
    result: dict[str, str] = {}
    for key, value in request.headers.items():
        lk = key.lower()
        if lk in blocked:
            continue
        if allow is not None and lk not in allow:
            continue
        if lk in {"authorization", "cookie"}:
            continue
        result[key] = value
    return result


def _build_upstream_url(request: Request, provider_app: ProviderApp, config: RelayConfig) -> str:
    base = resolve_upstream_base_url(provider_app, config).rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="Upstream base URL is not configured")
    if config.forward_path:
        path = request.url.path or "/"
        path = path if path.startswith("/") else f"/{path}"
        url = f"{base}{path}"
    else:
        tmpl = (config.upstream_path_template or "/").strip() or "/"
        if not tmpl.startswith("/"):
            tmpl = f"/{tmpl}"
        url = f"{base}{tmpl}"
    if config.forward_query and request.url.query:
        join = "&" if "?" in url else "?"
        url = f"{url}{join}{request.url.query}"
    return url


def _apply_token_to_url(url: str, token: str, config: RelayConfig) -> str:
    if config.token_transport != "query" or not config.token_query_param:
        return url
    parsed = urlparse(url)
    pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k != config.token_query_param]
    pairs.append((config.token_query_param, token))
    return urlunparse(parsed._replace(query=urlencode(pairs, quote_via=quote)))


def _build_outgoing_headers(
    request: Request,
    *,
    config: RelayConfig,
    access_token: str,
    provider_app: ProviderApp,
    connected_account: ConnectedAccount,
) -> dict[str, str]:
    ctx = {
        "access_token": access_token,
        "user_id": connected_account.user_id,
        "connected_account_id": connected_account.id,
        "provider_app_key": provider_app.key,
    }
    headers: dict[str, str] = {}
    if config.forward_path or config.allowed_request_headers:
        headers.update(_incoming_headers_to_forward(request, config))
    headers.update(config.static_headers)
    headers.update(_substitute_header_templates(config.dynamic_headers, ctx))

    if config.token_transport == "authorization_bearer":
        headers["Authorization"] = f"Bearer {access_token}"
    elif config.token_transport == "header":
        name = config.token_header_name or "Authorization"
        headers[name] = f"Bearer {access_token}"
    elif config.token_transport == "query":
        pass
    else:
        headers["Authorization"] = f"Bearer {access_token}"

    if config.force_content_type:
        headers["Content-Type"] = config.force_content_type
    elif not any(k.lower() == "content-type" for k in headers):
        ct = request.headers.get("content-type")
        if ct:
            headers["Content-Type"] = ct
        elif config.forward_body:
            headers["Content-Type"] = "application/json"
    return headers


def _method_for(request: Request, config: RelayConfig) -> str:
    if config.method_mode == "fixed":
        return (config.fixed_method or "POST").upper()
    return request.method.upper()


def _is_mcp_relay(provider_app: ProviderApp) -> bool:
    protocol = (provider_app.relay_protocol or "").strip().lower()
    return protocol in {"mcp_streamable_http", ""}


def _apply_tool_policy(
    db: Session,
    *,
    mcp_info: McpRequestInfo,
    provider_app: ProviderApp,
    credential_scope: str,
) -> None:
    if not mcp_info.tool_name:
        return

    from app.tool_policy import check_tool_access

    decision = check_tool_access(
        db,
        tool_name=mcp_info.tool_name,
        provider_app_id=provider_app.id,
        credential_scope=credential_scope,
    )
    if not decision.allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Tool access denied: {decision.reason}",
        )


def _filter_tools_list_in_response(
    db: Session,
    content: bytes,
    *,
    provider_app_id: str,
    credential_scope: str,
    media_type: str,
) -> bytes:
    from app.tool_policy import filter_tools_list_response

    if "text/event-stream" in media_type:
        return _filter_sse_tools_list(db, content, provider_app_id=provider_app_id, credential_scope=credential_scope)

    try:
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return content

    if not isinstance(data, dict):
        return content

    result = data.get("result")
    if isinstance(result, dict):
        tools = result.get("tools")
        if isinstance(tools, list):
            result["tools"] = filter_tools_list_response(
                db, provider_app_id=provider_app_id, credential_scope=credential_scope, tools=tools,
            )
            return json.dumps(data).encode()

    tools = data.get("tools")
    if isinstance(tools, list):
        data["tools"] = filter_tools_list_response(
            db, provider_app_id=provider_app_id, credential_scope=credential_scope, tools=tools,
        )
        return json.dumps(data).encode()

    return content


def _filter_sse_tools_list(
    db: Session,
    content: bytes,
    *,
    provider_app_id: str,
    credential_scope: str,
) -> bytes:
    from app.tool_policy import filter_tools_list_response

    text = content.decode("utf-8", errors="replace")
    output_lines: list[str] = []

    for line in text.splitlines():
        if not line.startswith("data:"):
            output_lines.append(line)
            continue

        payload = line[len("data:"):].strip()
        if not payload:
            output_lines.append(line)
            continue

        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            output_lines.append(line)
            continue

        if isinstance(data, dict):
            result = data.get("result")
            if isinstance(result, dict):
                tools = result.get("tools")
                if isinstance(tools, list):
                    result["tools"] = filter_tools_list_response(
                        db, provider_app_id=provider_app_id, credential_scope=credential_scope, tools=tools,
                    )
                    output_lines.append(f"data: {json.dumps(data)}")
                    continue

        output_lines.append(line)

    return "\n".join(output_lines).encode()


async def execute_relay_request(
    db: Session,
    *,
    provider_app: ProviderApp,
    provider_instance: ProviderInstance,
    connected_account: ConnectedAccount,
    request: Request,
    credential_scope: str = "personal",
) -> Response:
    config = effective_relay_config(provider_app)
    if breaker_open_for(provider_app.id, config):
        raise HTTPException(status_code=503, detail="Upstream circuit is open")

    body = await request.body() if config.forward_body else b""
    method = _method_for(request, config)

    mcp_info = McpRequestInfo()
    if _is_mcp_relay(provider_app) and body:
        mcp_info = parse_mcp_request(body)
        if mcp_info.method == "tools/call" and mcp_info.tool_name:
            _apply_tool_policy(
                db,
                mcp_info=mcp_info,
                provider_app=provider_app,
                credential_scope=credential_scope,
            )

    async def send_upstream(access_token: str) -> tuple[httpx.Response, httpx.AsyncClient]:
        url = _build_upstream_url(request, provider_app, config)
        url = _apply_token_to_url(url, access_token, config)
        headers = _build_outgoing_headers(
            request,
            config=config,
            access_token=access_token,
            provider_app=provider_app,
            connected_account=connected_account,
        )
        client = httpx.AsyncClient(timeout=None)
        upstream = client.build_request(method, url, content=body if config.forward_body else None, headers=headers)
        response = await client.send(upstream, stream=config.stream_response)
        return response, client

    access_token = await ensure_access_token(
        db,
        provider_app=provider_app,
        provider_instance=provider_instance,
        connected_account=connected_account,
    )

    max_attempts = (config.retry_count + 1) if config.retry_enabled else 1
    last_response: httpx.Response | None = None
    client: httpx.AsyncClient | None = None

    try:
        for attempt in range(max_attempts):
            last_response, client = await send_upstream(access_token)
            if last_response.status_code == 401 and config.supports_refresh:
                await last_response.aclose()
                await client.aclose()
                refreshed = await refresh_oauth_tokens(
                    db,
                    provider_app=provider_app,
                    provider_instance=provider_instance,
                    connected_account=connected_account,
                )
                access_token = decrypt_text(refreshed.encrypted_access_token) or access_token
                last_response, client = await send_upstream(access_token)
            if last_response.status_code < 500 or attempt == max_attempts - 1:
                break
            await last_response.aclose()
            await client.aclose()

        if last_response is None or client is None:
            raise HTTPException(status_code=502, detail="No response from upstream")

        if last_response.status_code >= 500:
            breaker_mark_failure(provider_app.id, config)
        else:
            breaker_mark_success(provider_app.id, config)

        is_tools_list = mcp_info.method == "tools/list"

        if not config.stream_response:
            content = await last_response.aread()
            await last_response.aclose()
            await client.aclose()
            response_media = last_response.headers.get("content-type", "application/json")
            if is_tools_list and _is_mcp_relay(provider_app):
                content = _filter_tools_list_in_response(
                    db, content, provider_app_id=provider_app.id,
                    credential_scope=credential_scope, media_type=response_media,
                )
            return Response(
                content=content,
                status_code=last_response.status_code,
                media_type=response_media,
            )

        if is_tools_list and _is_mcp_relay(provider_app):
            full_content = await last_response.aread()
            await last_response.aclose()
            await client.aclose()
            response_media = last_response.headers.get("content-type", "application/json")
            filtered = _filter_tools_list_in_response(
                db, full_content, provider_app_id=provider_app.id,
                credential_scope=credential_scope, media_type=response_media,
            )
            return Response(
                content=filtered,
                status_code=last_response.status_code,
                media_type=response_media,
            )

        async def iterator():
            try:
                async for chunk in last_response.aiter_bytes():
                    yield chunk
            finally:
                await last_response.aclose()
                await client.aclose()

        return StreamingResponse(
            iterator(),
            status_code=last_response.status_code,
            media_type=last_response.headers.get("content-type", "application/json"),
            background=BackgroundTask(lambda: None),
        )
    except HTTPException:
        raise
    except Exception as exc:
        breaker_mark_failure(provider_app.id, config)
        connected_account.last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
