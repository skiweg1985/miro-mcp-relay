from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

TMPDIR = tempfile.TemporaryDirectory()
DB_PATH = Path(TMPDIR.name) / "provider-app-delete.db"

os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
os.environ["SESSION_SECRET"] = "delete-test-session-secret"
os.environ["BROKER_PUBLIC_BASE_URL"] = "http://testserver"
os.environ["FRONTEND_BASE_URL"] = "http://testserver"

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings

get_settings.cache_clear()

from app.database import Base, SessionLocal, engine
from app.main import create_app
from app.models import ConnectedAccount, DelegationGrant, ProviderApp, ProviderInstance, User
from app.provider_app_delete import freed_key_after_soft_delete
from app.security import dumps_json, encrypt_text, hash_secret, lookup_secret_hash, utcnow
from app.seed import init_db


class ProviderAppDeleteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(create_app())

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        init_db()

    def _login_admin(self) -> str:
        response = self.client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "change-me-admin-password"},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["csrf_token"]

    def _create_custom_app(self, csrf: str) -> str:
        inst = self.client.post(
            "/api/v1/admin/provider-instances",
            headers={"X-CSRF-Token": csrf},
            json={
                "key": "del-test-generic",
                "display_name": "Delete test OAuth",
                "provider_definition_key": "generic_oauth",
                "role": "downstream_oauth",
                "authorization_endpoint": "https://oauth.example.com/authorize",
                "token_endpoint": "https://oauth.example.com/token",
                "settings": {"use_pkce": True},
                "is_enabled": True,
            },
        )
        self.assertEqual(inst.status_code, 200, inst.text)
        app = self.client.post(
            "/api/v1/admin/provider-apps",
            headers={"X-CSRF-Token": csrf},
            json={
                "provider_instance_key": "del-test-generic",
                "key": "custom-del-1",
                "template_key": None,
                "display_name": "Custom delete me",
                "client_id": "cid",
                "redirect_uris": ["http://localhost/cb"],
                "default_scopes": ["openid"],
                "scope_ceiling": ["openid"],
                "access_mode": "relay",
                "allow_relay": True,
                "allow_direct_token_return": False,
                "relay_protocol": "mcp_streamable_http",
                "is_enabled": True,
            },
        )
        self.assertEqual(app.status_code, 200, app.text)
        return app.json()["id"]

    def test_template_app_delete_forbidden(self) -> None:
        csrf = self._login_admin()
        listing = self.client.get("/api/v1/admin/provider-apps", headers={"X-CSRF-Token": csrf})
        self.assertEqual(listing.status_code, 200)
        graph = next(a for a in listing.json() if a.get("key") == "microsoft-graph-default")
        response = self.client.delete(
            f"/api/v1/admin/provider-apps/{graph['id']}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 403)

    def test_custom_delete_success_and_idempotent(self) -> None:
        csrf = self._login_admin()
        app_id = self._create_custom_app(csrf)
        response = self.client.delete(
            f"/api/v1/admin/provider-apps/{app_id}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 204)
        again = self.client.delete(
            f"/api/v1/admin/provider-apps/{app_id}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(again.status_code, 204)

    def test_custom_delete_blocked_by_connection(self) -> None:
        csrf = self._login_admin()
        app_id = self._create_custom_app(csrf)
        with SessionLocal() as db:
            app = db.get(ProviderApp, app_id)
            self.assertIsNotNone(app)
            user = db.scalar(select(User).where(User.organization_id == app.organization_id, User.email == "admin@example.com"))
            self.assertIsNotNone(user)
            db.add(
                ConnectedAccount(
                    organization_id=app.organization_id,
                    user_id=user.id,
                    provider_app_id=app.id,
                    status="connected",
                )
            )
            db.commit()

        response = self.client.delete(
            f"/api/v1/admin/provider-apps/{app_id}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["detail"]["code"], "integration_in_use")
        self.assertGreaterEqual(body["detail"]["active_connected_accounts"], 1)

    def test_custom_delete_blocked_by_active_grant(self) -> None:
        csrf = self._login_admin()
        app_id = self._create_custom_app(csrf)
        with SessionLocal() as db:
            app = db.get(ProviderApp, app_id)
            self.assertIsNotNone(app)
            user = db.scalar(select(User).where(User.organization_id == app.organization_id, User.email == "admin@example.com"))
            self.assertIsNotNone(user)
            cred = "test-delegation-secret"
            db.add(
                DelegationGrant(
                    organization_id=app.organization_id,
                    user_id=user.id,
                    provider_app_id=app.id,
                    credential_hash=hash_secret(cred),
                    credential_lookup_hash=lookup_secret_hash(cred),
                    encrypted_delegated_credential=encrypt_text(cred),
                    allowed_access_modes_json=dumps_json(["relay"]),
                    scope_ceiling_json=dumps_json(["openid"]),
                    expires_at=None,
                )
            )
            db.commit()

        response = self.client.delete(
            f"/api/v1/admin/provider-apps/{app_id}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 409)
        self.assertGreaterEqual(response.json()["detail"]["active_delegation_grants"], 1)

    def test_expired_grant_does_not_block(self) -> None:
        csrf = self._login_admin()
        app_id = self._create_custom_app(csrf)
        with SessionLocal() as db:
            app = db.get(ProviderApp, app_id)
            self.assertIsNotNone(app)
            user = db.scalar(select(User).where(User.organization_id == app.organization_id, User.email == "admin@example.com"))
            self.assertIsNotNone(user)
            cred = "expired-grant-secret"
            db.add(
                DelegationGrant(
                    organization_id=app.organization_id,
                    user_id=user.id,
                    provider_app_id=app.id,
                    credential_hash=hash_secret(cred),
                    credential_lookup_hash=lookup_secret_hash(cred),
                    encrypted_delegated_credential=encrypt_text(cred),
                    allowed_access_modes_json=dumps_json(["relay"]),
                    scope_ceiling_json=dumps_json(["openid"]),
                    expires_at=utcnow(),
                )
            )
            db.commit()

        response = self.client.delete(
            f"/api/v1/admin/provider-apps/{app_id}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 204)

    def test_freed_key_suffix(self) -> None:
        long_key = "a" * 100
        out = freed_key_after_soft_delete(previous_key=long_key, provider_app_id="550e8400-e29b-41d4-a716-446655440000")
        self.assertLessEqual(len(out), 120)
        self.assertIn("-deleted-", out)


if __name__ == "__main__":
    unittest.main()
