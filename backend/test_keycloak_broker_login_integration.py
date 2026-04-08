"""Optional integration test: real Keycloak (imported realm) + broker OIDC login.

Requires a running Keycloak with realm ``broker-test`` (see ``docker compose --profile test up`` and ``docker-compose.yml``).
Enable with ``KEYCLOAK_LOGIN_INTEGRATION=1``. No mocks: authorization code + PKCE and token exchange hit the IdP.

When the test runs on the host, use the same origin for all IdP calls (default
``KEYCLOAK_BASE_URL=http://localhost:8180``). Discovery endpoints are rewritten to that
origin so a published port is enough; split ``keycloak`` hostnames from in-container
discovery are not required for this test.
"""

from __future__ import annotations

import os
import unittest
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.main import app
from app.database import SessionLocal
from app.models import BrokerLoginProvider, Organization
from app.security import dumps_json, encrypt_text


_PROVIDER_KEY = "keycloak-it"
_KC_DEFAULT = "http://localhost:8180"
_REALM_DEFAULT = "broker-test"


def _keycloak_base_url() -> str:
    return os.environ.get("KEYCLOAK_BASE_URL", _KC_DEFAULT).rstrip("/")


def _keycloak_well_known_url() -> str:
    base = _keycloak_base_url()
    realm = os.environ.get("KEYCLOAK_REALM", _REALM_DEFAULT).strip() or _REALM_DEFAULT
    return f"{base}/realms/{realm}/.well-known/openid-configuration"


def _rewrite_url_origin(url: str, public_origin: str) -> str:
    """Replace scheme/host/port with ``public_origin``; keep path, query, fragment."""
    u = urlparse(str(url).strip())
    b = urlparse(public_origin.rstrip("/") + "/")
    if not u.path:
        return str(url).strip()
    return urlunparse((b.scheme, b.netloc, u.path, u.params, u.query, u.fragment))


def _discovery_with_public_origin(meta: dict, public_origin: str) -> dict:
    """Align issuer and endpoints with ``public_origin`` (e.g. host-reachable localhost:8180)."""
    out = dict(meta)
    for key in ("issuer", "authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"):
        val = out.get(key)
        if not val or not isinstance(val, str) or not val.strip():
            continue
        out[key] = _rewrite_url_origin(val.strip(), public_origin)
    return out


def _keycloak_reachable() -> bool:
    try:
        r = httpx.get(_keycloak_well_known_url(), timeout=3.0)
        return r.status_code == 200
    except Exception:
        return False


class _LoginFormParser(HTMLParser):
    """Collect the first HTML form that contains a password field (Keycloak login page)."""

    def __init__(self) -> None:
        super().__init__()
        self._in_form = False
        self._action: str | None = None
        self._fields: dict[str, str] = {}
        self._has_password = False
        self.action: str | None = None
        self.fields: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs) -> None:
        ad = dict(attrs)
        if tag == "form":
            self._in_form = True
            self._action = unescape(ad.get("action") or "")
            self._fields = {}
            self._has_password = False
        elif self._in_form and tag == "input":
            name = ad.get("name")
            typ = (ad.get("type") or "text").lower()
            if typ == "password":
                self._has_password = True
            if name and typ not in ("submit", "button"):
                self._fields[name] = ad.get("value") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "form" and self._in_form:
            if self._action and self._has_password and self.action is None:
                self.action = self._action
                self.fields = dict(self._fields)
            self._in_form = False
            self._action = None


def _parse_login_form(html: str) -> tuple[str, dict[str, str]]:
    p = _LoginFormParser()
    p.feed(html)
    if not p.action:
        raise RuntimeError("Keycloak login form not found in response")
    return p.action, p.fields


def _authorization_code_after_password_login(
    *,
    client: httpx.Client,
    authorize_url: str,
    username: str,
    password: str,
    callback_prefix: str,
    max_steps: int = 30,
) -> tuple[str, str]:
    """Walk the browserless login flow; return ``(code, state)`` from the broker callback URL."""
    r = client.get(authorize_url)
    for _ in range(max_steps):
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("location")
            if not loc:
                raise RuntimeError("redirect without Location")
            next_url = urljoin(str(r.url), loc)
            if next_url.startswith(callback_prefix) and "code=" in next_url:
                q = parse_qs(urlparse(next_url).query)
                code = (q.get("code") or [""])[0]
                state = (q.get("state") or [""])[0]
                if not code or not state:
                    raise RuntimeError(f"callback without code/state: {next_url!r}")
                return code, state
            r = client.get(next_url)
            continue
        if r.status_code == 200:
            action, fields = _parse_login_form(r.text)
            post_url = urljoin(str(r.url), action)
            body = dict(fields)
            body["username"] = username
            body["password"] = password
            r = client.post(post_url, data=body)
            continue
        raise RuntimeError(f"unexpected HTTP {r.status_code} at {r.url!r}")
    raise RuntimeError("too many redirects / steps in Keycloak login flow")


class TestDiscoveryOriginHelpers(unittest.TestCase):
    def test_rewrite_url_origin_swaps_host(self) -> None:
        out = _rewrite_url_origin(
            "http://keycloak:8180/realms/broker-test/protocol/openid-connect/token",
            "http://localhost:8180",
        )
        self.assertEqual(
            out,
            "http://localhost:8180/realms/broker-test/protocol/openid-connect/token",
        )


@unittest.skipUnless(os.environ.get("KEYCLOAK_LOGIN_INTEGRATION") == "1", "set KEYCLOAK_LOGIN_INTEGRATION=1 to run")
class TestKeycloakBrokerLoginIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not _keycloak_reachable():
            raise unittest.SkipTest(f"Keycloak nicht erreichbar: {_keycloak_well_known_url()}")

    def setUp(self) -> None:
        self._settings = get_settings()
        self._callback_prefix = (
            f"{self._settings.broker_public_base_url.rstrip('/')}"
            f"{self._settings.api_v1_prefix}/auth/{_PROVIDER_KEY}/callback"
        )

    def tearDown(self) -> None:
        db = SessionLocal()
        try:
            row = db.scalar(select(BrokerLoginProvider).where(BrokerLoginProvider.provider_key == _PROVIDER_KEY))
            if row:
                db.delete(row)
                db.commit()
        finally:
            db.close()

    def test_keycloak_oidc_login_end_to_end(self) -> None:
        wk = httpx.get(_keycloak_well_known_url(), timeout=10.0)
        self.assertEqual(wk.status_code, 200, wk.text)
        meta = _discovery_with_public_origin(wk.json(), _keycloak_base_url())
        issuer = str(meta.get("issuer") or "").rstrip("/")
        auth_ep = str(meta.get("authorization_endpoint") or "")
        token_ep = str(meta.get("token_endpoint") or "")
        userinfo_ep = str(meta.get("userinfo_endpoint") or "")
        self.assertTrue(issuer and auth_ep and token_ep and userinfo_ep)

        oidc_cfg = {
            "issuer": issuer,
            "authorization_endpoint": auth_ep,
            "token_endpoint": token_ep,
            "userinfo_endpoint": userinfo_ep,
            "jwks_uri": meta.get("jwks_uri"),
            "scopes": ["openid", "profile", "email"],
            "claim_mapping": {
                "subject": "sub",
                "email": "email",
                "display_name": "name",
                "preferred_username": "preferred_username",
                "locale": "locale",
                "zoneinfo": "zoneinfo",
            },
        }

        db = SessionLocal()
        try:
            org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
            self.assertIsNotNone(org)
            secret = os.environ.get("KEYCLOAK_BROKER_CLIENT_SECRET", "broker-test-client-secret-change-me")
            cid = os.environ.get("KEYCLOAK_BROKER_CLIENT_ID", "broker-login-confidential")
            row = BrokerLoginProvider(
                organization_id=org.id,
                provider_key=_PROVIDER_KEY,
                display_name="Keycloak integration",
                enabled=True,
                client_id=cid,
                encrypted_client_secret=encrypt_text(secret),
                oidc_config_json=dumps_json(oidc_cfg),
            )
            db.merge(row)
            db.commit()
        finally:
            db.close()

        user = os.environ.get("KEYCLOAK_TEST_USERNAME", "testuser")
        password = os.environ.get("KEYCLOAK_TEST_PASSWORD", "change-me")

        with TestClient(app) as tc:
            start = tc.post(f"/api/v1/auth/{_PROVIDER_KEY}/start")
            self.assertEqual(start.status_code, 200, start.text)
            auth_url = start.json()["auth_url"]

        with httpx.Client(follow_redirects=False, timeout=60.0) as kc_http:
            code, state = _authorization_code_after_password_login(
                client=kc_http,
                authorize_url=auth_url,
                username=user,
                password=password,
                callback_prefix=self._callback_prefix,
            )

        with TestClient(app, follow_redirects=False) as tc:
            cb = tc.get(f"/api/v1/auth/{_PROVIDER_KEY}/callback", params={"code": code, "state": state})
        self.assertEqual(cb.status_code, 302, cb.text)
        loc = cb.headers.get("location") or ""
        self.assertIn("login_status=success", loc)
        self.assertIn("broker_session=", cb.headers.get("set-cookie", ""))


if __name__ == "__main__":
    unittest.main()
