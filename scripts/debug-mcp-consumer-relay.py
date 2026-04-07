#!/usr/bin/env python3
"""
Lokaler Debug-Lauf gegen den Broker Consumer-MCP-Relay (streamable HTTP).

Voraussetzung: pip install httpx (wie backend/requirements.txt)

Beispiel:
  export DEBUG_MCP_ACCESS_KEY='bkr_…'
  python3 scripts/debug-mcp-consumer-relay.py --base-url http://localhost

HTTPS mit Dev-Zertifikat:
  python3 scripts/debug-mcp-consumer-relay.py --base-url https://localhost --insecure

Umgebungsvariablen (optional): DEBUG_MCP_BASE_URL, DEBUG_MCP_INSTANCE_ID,
DEBUG_MCP_ACCESS_KEY, DEBUG_MCP_USER_TOKEN (OAuth-Upstream für die Instanz)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any
from urllib.parse import urljoin, urlparse

try:
    import httpx
except ImportError:
    print("httpx fehlt: pip install httpx", file=sys.stderr)
    sys.exit(1)

DEFAULT_INSTANCE_ID = "00000000-0000-4000-8000-000000000201"


def _load_env_file(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            if not key or key in os.environ:
                continue
            val = val.strip().strip('"').strip("'")
            os.environ[key] = val


def _mask_secret(s: str) -> str:
    if len(s) <= 10:
        return "***"
    return f"{s[:6]}…{s[-4:]}"


def _parse_mcp_body(body: bytes, content_type: str | None) -> Any:
    ct = (content_type or "").split(";")[0].strip().lower()
    text = body.decode("utf-8", errors="replace")
    if "text/event-stream" in ct:
        events: list[Any] = []
        for line in text.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload:
                continue
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                events.append({"_unparsed": payload[:500]})
        return {"_transport": "sse", "_events": events}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"_raw_text": text[:8000]}


def _session_from_headers(headers: httpx.Headers) -> str | None:
    for name, value in headers.items():
        if name.lower() == "mcp-session-id":
            return value
    return None


def main() -> int:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    _load_env_file(os.path.join(repo_root, ".env"))

    default_base = (
        os.environ.get("DEBUG_MCP_BASE_URL")
        or os.environ.get("BROKER_PUBLIC_BASE_URL")
        or "http://localhost"
    ).rstrip("/")
    default_instance = os.environ.get("DEBUG_MCP_INSTANCE_ID", DEFAULT_INSTANCE_ID)
    default_key = os.environ.get("DEBUG_MCP_ACCESS_KEY") or os.environ.get(
        "BROKER_ACCESS_KEY", ""
    )

    p = argparse.ArgumentParser(description="Consumer MCP-Relay gegen lokalen Broker prüfen.")
    p.add_argument("--base-url", default=default_base, help="Broker-Origin (ohne /api/v1)")
    p.add_argument("--instance-id", default=default_instance, help="Integration-Instance-UUID")
    p.add_argument(
        "--access-key",
        default=default_key,
        help="bkr_… oder leer → DEBUG_MCP_ACCESS_KEY / BROKER_ACCESS_KEY",
    )
    p.add_argument(
        "--user-token",
        default=os.environ.get("DEBUG_MCP_USER_TOKEN", ""),
        help="Optional X-User-Token für OAuth-Upstream",
    )
    p.add_argument(
        "--protocol-version",
        default="2024-11-05",
        help="initialize params.protocolVersion",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="Gesamt-Timeout pro HTTP-Request (Sekunden)",
    )
    p.add_argument(
        "--insecure",
        action="store_true",
        help="TLS-Zertifikat nicht prüfen (lokales HTTPS / Dev-Zertifikat)",
    )
    p.add_argument(
        "--skip-tools-list",
        action="store_true",
        help="Nur Health, connection-info und initialize (schneller Smoke-Test)",
    )
    p.add_argument("-q", "--quiet", action="store_true", help="Weniger Ausgabe")
    args = p.parse_args()

    if not args.access_key or not args.access_key.strip():
        print(
            "Kein Access Key: --access-key setzen oder DEBUG_MCP_ACCESS_KEY / BROKER_ACCESS_KEY",
            file=sys.stderr,
        )
        return 2

    api_prefix = "/api/v1"
    base = args.base_url.rstrip("/")
    inst = args.instance_id.strip()
    relay_path = f"{api_prefix}/consumer/integration-instances/{inst}/mcp"
    info_path = f"{api_prefix}/consumer/integration-instances/{inst}/mcp-connection-info"
    relay_url = urljoin(base + "/", relay_path.lstrip("/"))
    info_url = urljoin(base + "/", info_path.lstrip("/"))
    health_url = urljoin(base + "/", f"{api_prefix}/health".lstrip("/"))

    headers_base: dict[str, str] = {
        "X-Broker-Access-Key": args.access_key.strip(),
        "Accept": "application/json, text/event-stream",
    }
    if args.user_token.strip():
        headers_base["X-User-Token"] = args.user_token.strip()

    timeout = httpx.Timeout(args.timeout, connect=30.0)
    verify = not args.insecure
    client = httpx.Client(timeout=timeout, verify=verify, follow_redirects=False)

    def log(msg: str) -> None:
        if not args.quiet:
            print(msg, flush=True)

    log(f"Base URL:     {base}")
    log(f"Relay URL:    {relay_url}")
    log(f"Access Key:   {_mask_secret(args.access_key.strip())}")
    if args.user_token.strip():
        log("X-User-Token: (gesetzt)")
    log("")

    run_start = time.perf_counter()
    try:
        t0 = time.perf_counter()
        r = client.get(health_url)
        log(f"[health] {r.status_code} in {(time.perf_counter()-t0)*1000:.0f} ms")
        if r.status_code != 200:
            log(r.text[:500])
            return 1

        t0 = time.perf_counter()
        r = client.get(info_url, headers={"X-Broker-Access-Key": args.access_key.strip()})
        log(f"[mcp-connection-info] {r.status_code} in {(time.perf_counter()-t0)*1000:.0f} ms")
        if r.status_code == 200 and r.text:
            try:
                info = r.json()
                log(json.dumps(info, indent=2, ensure_ascii=False))
            except json.JSONDecodeError:
                log(r.text[:2000])
        else:
            log(r.text[:2000])
        log("")

        def post_rpc(
            label: str,
            payload: dict[str, Any],
            extra_headers: dict[str, str] | None = None,
        ) -> tuple[int, httpx.Headers, Any]:
            h = {**headers_base, "Content-Type": "application/json"}
            if extra_headers:
                h.update(extra_headers)
            t_start = time.perf_counter()
            with client.stream("POST", relay_url, headers=h, json=payload) as resp:
                body = b"".join(resp.iter_bytes())
                elapsed_ms = (time.perf_counter() - t_start) * 1000
                code = resp.status_code
                resp_headers = resp.headers
                ctype = resp.headers.get("content-type")
            parsed = _parse_mcp_body(body, ctype)
            log(f"[{label}] HTTP {code} in {elapsed_ms:.0f} ms")
            sess = _session_from_headers(resp_headers)
            if sess:
                log(f"  Mcp-Session-Id: {sess[:16]}…")
            if isinstance(parsed, dict) and parsed.get("_transport") == "sse":
                events = parsed.get("_events") or []
                log(f"  SSE events: {len(events)}")
                for i, ev in enumerate(events[:5]):
                    log(f"  event[{i}]: {json.dumps(ev, ensure_ascii=False)[:800]}")
                if len(events) > 5:
                    log(f"  … ({len(events) - 5} weitere)")
            else:
                log(f"  body: {json.dumps(parsed, indent=2, ensure_ascii=False)[:12000]}")
            log("")
            return code, resp_headers, parsed

        init_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": args.protocol_version,
                "capabilities": {},
                "clientInfo": {"name": "debug-mcp-consumer-relay", "version": "0.1"},
            },
        }
        status, hdrs, _ = post_rpc("initialize", init_payload)
        if status != 200:
            return 1

        session_id = _session_from_headers(hdrs)
        extra: dict[str, str] = {}
        if session_id:
            extra["Mcp-Session-Id"] = session_id

        notif_payload = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        post_rpc("notifications/initialized", notif_payload, extra_headers=extra or None)

        if not args.skip_tools_list:
            list_payload = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
            status, _, parsed = post_rpc("tools/list", list_payload, extra_headers=extra or None)
            if status != 200:
                return 1
            if isinstance(parsed, dict) and parsed.get("error"):
                log(f"JSON-RPC error: {parsed['error']}")
                return 1

        log(f"Fertig in {(time.perf_counter()-run_start):.1f} s (gesamt)")
        return 0
    except httpx.ConnectError as e:
        print(f"Verbindungsfehler: {e}", file=sys.stderr)
        print(f"Host: {urlparse(base).netloc} — läuft HAProxy/Broker?", file=sys.stderr)
        return 1
    except httpx.HTTPError as e:
        print(f"HTTP-Fehler: {e}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
