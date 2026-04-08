"""HTTP-level broker login flows (happy path + errors). Microsoft paths use mocks; no real IdP."""

from __future__ import annotations

import json
import unittest
from datetime import timedelta
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database import SessionLocal
from app.deps import require_admin, require_csrf
from app.microsoft_oauth_resolver import ResolvedMicrosoftOAuth
from app.models import BrokerLoginProvider, OAuthPendingState, Organization, User
from app.security import dumps_json, encrypt_text, loads_json, utcnow


def _b64json(obj: dict) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode()
    import base64

    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def fake_id_token(payload: dict) -> str:
    return f"{_b64json({'alg': 'none'})}.{_b64json(payload)}.x"


class MockAsyncTransport:
    def __init__(self, post_status: int = 200, post_body: dict | None = None, get_status: int = 200, get_body: dict | None = None):
        self._post_status = post_status
        self._post_body = post_body if post_body is not None else {}
        self._get_status = get_status
        self._get_body = get_body if get_body is not None else {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        resp = MagicMock()
        resp.status_code = self._post_status
        resp.json = MagicMock(return_value=dict(self._post_body))
        return resp

    async def get(self, *args, **kwargs):
        resp = MagicMock()
        resp.status_code = self._get_status
        resp.json = MagicMock(return_value=dict(self._get_body))
        return resp


class TestBrokerLoginFlow(unittest.TestCase):
    def test_microsoft_start_returns_503_when_not_configured(self) -> None:
        with patch("app.broker_login.registry.resolve_microsoft_oauth", return_value=None):
            with TestClient(app) as client:
                response = client.post("/api/v1/auth/microsoft/start")
        self.assertEqual(response.status_code, 503)

    def test_start_rejects_bad_provider_id(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/auth/BadId/start")
        self.assertEqual(response.status_code, 400)

    def test_start_unknown_provider_503(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/auth/unknown-oidc-xyz/start")
        self.assertEqual(response.status_code, 503)

    def test_callback_invalid_state_redirects(self) -> None:
        with TestClient(app, follow_redirects=False) as client:
            response = client.get("/api/v1/auth/microsoft/callback?code=x&state=not-in-db")
        self.assertEqual(response.status_code, 302)
        self.assertIn("login_status=error", response.headers.get("location", ""))

    def test_callback_provider_mismatch_redirects(self) -> None:
        db = SessionLocal()
        try:
            state = "test-state-mismatch-abc123"
            db.merge(
                OAuthPendingState(
                    state_key=state,
                    flow="broker_login",
                    payload_json=dumps_json({"provider_id": "microsoft", "verifier": "v", "nonce": "n", "correlation_id": "c1"}),
                    expires_at=utcnow() + timedelta(seconds=900),
                )
            )
            db.commit()
        finally:
            db.close()
        with TestClient(app, follow_redirects=False) as client:
            response = client.get(f"/api/v1/auth/other/callback?code=x&state={state}")
        self.assertEqual(response.status_code, 302)
        self.assertIn("login_status=error", response.headers.get("location", ""))

    @patch("app.broker_login.registry.resolve_microsoft_oauth")
    @patch("app.routers.auth.httpx.AsyncClient")
    def test_microsoft_happy_path_session_cookie(self, mock_client_cls, mock_resolve) -> None:
        mock_resolve.return_value = ResolvedMicrosoftOAuth(
            authority_base="https://login.microsoftonline.com",
            tenant_id="common",
            client_id="test-client-id",
            client_secret="test-client-secret",
            scope_list=["openid", "profile", "email"],
        )
        mock_client_cls.return_value = MockAsyncTransport(
            post_status=200,
            post_body={},
        )

        with TestClient(app) as client:
            start = client.post("/api/v1/auth/microsoft/start")
            self.assertEqual(start.status_code, 200, start.text)
            state = start.json()["state"]

        db = SessionLocal()
        try:
            row = db.get(OAuthPendingState, state)
            self.assertIsNotNone(row)
            pending = loads_json(row.payload_json, {})
            nonce = str(pending.get("nonce") or "")
            self.assertTrue(nonce)
        finally:
            db.close()

        token_payload = {
            "sub": "oidc-subject-1",
            "email": "flowtest@example.com",
            "name": "Flow Test",
            "nonce": nonce,
        }
        post_body = {"access_token": "at1", "id_token": fake_id_token(token_payload)}

        mock_client_cls.return_value = MockAsyncTransport(post_status=200, post_body=post_body)

        with TestClient(app, follow_redirects=False) as client:
            response = client.get(f"/api/v1/auth/microsoft/callback?code=auth-code&state={state}")
        self.assertEqual(response.status_code, 302, response.text)
        loc = response.headers.get("location", "")
        self.assertIn("login_status=success", loc)
        self.assertIn("broker_session=", response.headers.get("set-cookie", ""))

    @patch("app.broker_login.registry.resolve_microsoft_oauth")
    @patch("app.routers.auth.httpx.AsyncClient")
    def test_microsoft_token_exchange_error_redirects(self, mock_client_cls, mock_resolve) -> None:
        mock_resolve.return_value = ResolvedMicrosoftOAuth(
            authority_base="https://login.microsoftonline.com",
            tenant_id="common",
            client_id="cid",
            client_secret="sec",
            scope_list=["openid"],
        )
        mock_client_cls.return_value = MockAsyncTransport(post_status=401, post_body={"error": "invalid_grant"})

        with TestClient(app) as client:
            start = client.post("/api/v1/auth/microsoft/start")
            state = start.json()["state"]

        with TestClient(app, follow_redirects=False) as client:
            response = client.get(f"/api/v1/auth/microsoft/callback?code=c&state={state}")
        self.assertEqual(response.status_code, 302)
        self.assertIn("login_status=error", response.headers.get("location", ""))

    @patch("app.broker_login.registry.resolve_microsoft_oauth")
    @patch("app.routers.auth.httpx.AsyncClient")
    def test_microsoft_missing_identity_redirects(self, mock_client_cls, mock_resolve) -> None:
        mock_resolve.return_value = ResolvedMicrosoftOAuth(
            authority_base="https://login.microsoftonline.com",
            tenant_id="common",
            client_id="cid",
            client_secret="sec",
            scope_list=["openid"],
        )

        with TestClient(app) as client:
            start = client.post("/api/v1/auth/microsoft/start")
            state = start.json()["state"]

        db = SessionLocal()
        try:
            row = db.get(OAuthPendingState, state)
            nonce = str(loads_json(row.payload_json, {}).get("nonce") or "")
        finally:
            db.close()

        post_body = {"access_token": "at", "id_token": fake_id_token({"sub": "only-sub", "nonce": nonce})}
        mock_client_cls.return_value = MockAsyncTransport(post_status=200, post_body=post_body)

        with TestClient(app, follow_redirects=False) as client:
            response = client.get(f"/api/v1/auth/microsoft/callback?code=c&state={state}")
        self.assertEqual(response.status_code, 302)
        self.assertIn("login_status=error", response.headers.get("location", ""))

    def test_generic_oidc_disabled_503(self) -> None:
        db = SessionLocal()
        try:
            org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
            self.assertIsNotNone(org)
            oidc_cfg = {
                "issuer": "http://localhost:8180/realms/broker-test",
                "authorization_endpoint": "http://localhost:8180/realms/broker-test/protocol/openid-connect/auth",
                "token_endpoint": "http://localhost:8180/realms/broker-test/protocol/openid-connect/token",
                "userinfo_endpoint": "http://localhost:8180/realms/broker-test/protocol/openid-connect/userinfo",
                "jwks_uri": None,
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
            row = BrokerLoginProvider(
                organization_id=org.id,
                provider_key="oidc-flow-test",
                display_name="Flow test",
                enabled=False,
                client_id="cid",
                encrypted_client_secret=encrypt_text("sec"),
                oidc_config_json=dumps_json(oidc_cfg),
            )
            db.merge(row)
            db.commit()
        finally:
            db.close()

        try:
            with TestClient(app) as client:
                response = client.post("/api/v1/auth/oidc-flow-test/start")
            self.assertEqual(response.status_code, 503)
        finally:
            db = SessionLocal()
            try:
                r = db.scalar(select(BrokerLoginProvider).where(BrokerLoginProvider.provider_key == "oidc-flow-test"))
                if r:
                    db.delete(r)
                    db.commit()
            finally:
                db.close()

    @patch("app.routers.auth.httpx.AsyncClient")
    def test_generic_oidc_happy_path(self, mock_client_cls) -> None:
        db = SessionLocal()
        try:
            org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
            self.assertIsNotNone(org)
            oidc_cfg = {
                "issuer": "http://localhost:9000/realms/x",
                "authorization_endpoint": "http://localhost:9000/authorize",
                "token_endpoint": "http://localhost:9000/token",
                "userinfo_endpoint": "http://localhost:9000/userinfo",
                "jwks_uri": None,
                "scopes": ["openid", "email"],
                "claim_mapping": {
                    "subject": "sub",
                    "email": "email",
                    "display_name": "name",
                    "preferred_username": "preferred_username",
                    "locale": "locale",
                    "zoneinfo": "zoneinfo",
                },
            }
            row = BrokerLoginProvider(
                organization_id=org.id,
                provider_key="oidc-flow-test",
                display_name="Flow test",
                enabled=True,
                client_id="cid",
                encrypted_client_secret=encrypt_text("sec"),
                oidc_config_json=dumps_json(oidc_cfg),
            )
            db.merge(row)
            db.commit()
        finally:
            db.close()

        try:
            with TestClient(app) as client:
                start = client.post("/api/v1/auth/oidc-flow-test/start")
                self.assertEqual(start.status_code, 200, start.text)
                state = start.json()["state"]

            db = SessionLocal()
            try:
                pending_row = db.get(OAuthPendingState, state)
                nonce = str(loads_json(pending_row.payload_json, {}).get("nonce") or "")
            finally:
                db.close()

            token_body = {
                "access_token": "at2",
                "id_token": fake_id_token({"sub": "g-sub", "email": "generic@example.com", "name": "G", "nonce": nonce}),
            }
            userinfo_body = {"email": "generic@example.com", "name": "G User"}

            holder = MockAsyncTransport(post_status=200, post_body=token_body, get_status=200, get_body=userinfo_body)
            mock_client_cls.return_value = holder

            with TestClient(app, follow_redirects=False) as client:
                response = client.get(f"/api/v1/auth/oidc-flow-test/callback?code=cc&state={state}")
            self.assertEqual(response.status_code, 302)
            self.assertIn("login_status=success", response.headers.get("location", ""))
        finally:
            db = SessionLocal()
            try:
                r = db.scalar(select(BrokerLoginProvider).where(BrokerLoginProvider.provider_key == "oidc-flow-test"))
                if r:
                    db.delete(r)
                    db.commit()
            finally:
                db.close()

    def test_admin_create_provider_invalid_url_422(self) -> None:
        def _admin_user() -> User:
            db = SessionLocal()
            try:
                u = db.scalar(select(User).where(User.is_admin.is_(True)))
                assert u is not None
                return u
            finally:
                db.close()

        app.dependency_overrides[require_admin] = _admin_user
        app.dependency_overrides[require_csrf] = lambda: "test-csrf-override"
        try:
            with TestClient(app) as client:
                body = {
                    "provider_key": "bad-url-provider",
                    "display_name": "X",
                    "enabled": True,
                    "client_id": "c",
                    "client_secret": "s",
                    "oidc": {
                        "issuer": "",
                        "authorization_endpoint": "not-a-url",
                        "token_endpoint": "https://example.com/token",
                        "userinfo_endpoint": None,
                        "jwks_uri": None,
                        "scopes": ["openid"],
                        "claim_mapping": {"subject": "sub", "email": "email"},
                    },
                }
                response = client.post("/api/v1/admin/broker-login-providers", json=body)
            self.assertEqual(response.status_code, 422)
        finally:
            app.dependency_overrides.pop(require_admin, None)
            app.dependency_overrides.pop(require_csrf, None)

    def test_admin_create_provider_missing_claim_paths_422(self) -> None:
        def _admin_user() -> User:
            db = SessionLocal()
            try:
                u = db.scalar(select(User).where(User.is_admin.is_(True)))
                assert u is not None
                return u
            finally:
                db.close()

        app.dependency_overrides[require_admin] = _admin_user
        app.dependency_overrides[require_csrf] = lambda: "test-csrf-override"
        try:
            with TestClient(app) as client:
                body = {
                    "provider_key": "bad-map-provider",
                    "display_name": "X",
                    "enabled": True,
                    "client_id": "c",
                    "client_secret": "s",
                    "oidc": {
                        "issuer": "",
                        "authorization_endpoint": "https://example.com/auth",
                        "token_endpoint": "https://example.com/token",
                        "userinfo_endpoint": None,
                        "jwks_uri": None,
                        "scopes": ["openid"],
                        "claim_mapping": {"subject": "", "email": "email"},
                    },
                }
                response = client.post("/api/v1/admin/broker-login-providers", json=body)
            self.assertEqual(response.status_code, 422)
        finally:
            app.dependency_overrides.pop(require_admin, None)
            app.dependency_overrides.pop(require_csrf, None)


if __name__ == "__main__":
    unittest.main()
