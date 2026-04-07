from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from starlette.datastructures import Headers

# Hop-by-hop and proxy headers (RFC 7230); not forwarded to upstream or back to client.
_HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
    }
)

# Stripped from client request before upstream (broker injects upstream Authorization).
_BLOCKED_REQUEST = frozenset(
    {
        "authorization",
        "cookie",
        "x-broker-access-key",
        "x-user-token",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-port",
        "x-forwarded-server",
        "x-real-ip",
        "forwarded",
        "via",
    }
)


def _netloc_key(netloc: str) -> tuple[str, str | None]:
    """Return (host.lower(), port or None) for comparison."""
    if "@" in netloc:
        netloc = netloc.split("@", 1)[1]
    host: str
    port: str | None
    if netloc.startswith("["):
        end = netloc.find("]")
        if end == -1:
            return (netloc.lower(), None)
        host = netloc[1:end].lower()
        rest = netloc[end + 1 :]
        if rest.startswith(":"):
            return (host, rest[1:])
        return (host, None)
    if ":" in netloc:
        host_part, port_part = netloc.rsplit(":", 1)
        if port_part.isdigit():
            return (host_part.lower(), port_part)
    return (netloc.lower(), None)


def _host_only(host: str) -> str:
    if host.startswith("["):
        end = host.find("]")
        if end != -1:
            return host[1:end].lower()
    if ":" in host and not host.startswith("["):
        # IPv6 without brackets unlikely here
        pass
    return host.lower()


def _default_scheme_port(scheme: str) -> str:
    s = scheme.lower()
    return "443" if s == "https" else "80"


def upstream_urls_equivalent(configured_base: str, target: str) -> bool:
    """
    Ensure target URL stays on the same host and scheme as the integration endpoint.
    Prevents using the relay as an open forward proxy.
    """
    a = urlparse(configured_base)
    b = urlparse(target)
    if a.scheme.lower() != b.scheme.lower():
        return False
    ha, pa = _netloc_key(a.netloc)
    hb, pb = _netloc_key(b.netloc)
    if ha != hb:
        return False
    pa_eff = pa or _default_scheme_port(a.scheme)
    pb_eff = pb or _default_scheme_port(b.scheme)
    return pa_eff == pb_eff


def join_upstream_url(base: str, subpath: str | None) -> str:
    base = base.strip().rstrip("/")
    if not subpath or not subpath.strip():
        return base
    tail = subpath.strip().lstrip("/")
    if not tail:
        return base
    return f"{base}/{tail}"


def filter_client_headers_for_upstream(headers: Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers.items():
        lk = key.lower()
        if lk in _HOP_BY_HOP or lk in _BLOCKED_REQUEST:
            continue
        if lk == "content-length":
            continue
        out[key] = value
    return out


def merge_upstream_auth_headers(
    *,
    client_headers: dict[str, str],
    upstream_auth: dict[str, str],
) -> dict[str, str]:
    """Consumer broker auth never overwrites upstream service credentials."""
    merged = {**client_headers}
    for k, v in upstream_auth.items():
        merged[k] = v
    return merged


def filter_upstream_response_headers(headers: httpx.Headers, *, streaming: bool = True) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers.items():
        lk = key.lower()
        if lk in _HOP_BY_HOP:
            continue
        if streaming and lk == "content-length":
            continue
        out[key] = value
    return out


def assert_integration_endpoint_safe_for_relay(endpoint: str) -> None:
    """Block obviously unsafe upstream bases (e.g. metadata IPs) in addition to URL equivalence checks."""
    parsed = urlparse(endpoint)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("unsupported_scheme")
    if not parsed.netloc:
        raise ValueError("missing_netloc")
    host = _host_only(parsed.hostname or "")
    if not host:
        raise ValueError("missing_host")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return
    raise ValueError("literal_ip_not_allowed")
