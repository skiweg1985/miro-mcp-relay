from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

TMPDIR = tempfile.TemporaryDirectory()
DB_PATH = Path(TMPDIR.name) / "welle1-smoke.db"

os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
os.environ["SESSION_SECRET"] = "welle1-test-session-secret"
os.environ["BROKER_PUBLIC_BASE_URL"] = "http://testserver"
os.environ["FRONTEND_BASE_URL"] = "http://testserver"

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from sqlalchemy import select

from app.core.config import get_settings

get_settings.cache_clear()

from app.database import Base, SessionLocal, engine
from app.main import create_app
from app.miro import issue_miro_setup_token
from app.models import ConnectedAccount, DelegationGrant, ProviderApp, ServiceClient, TokenMaterial, User
from app.security import dumps_json, encrypt_text, hash_secret
from app.seed import init_db


class Welle1SmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(create_app())

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        init_db()

    def _login_admin(self) -> tuple[TestClient, str]:
        response = self.client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "change-me-admin-password"},
        )
        self.assertEqual(response.status_code, 200)
        return self.client, response.json()["csrf_token"]

    def _seed_service_access_fixture(self) -> dict[str, str]:
        with SessionLocal() as db:
            graph_app = db.scalar(select(ProviderApp).where(ProviderApp.key == "microsoft-graph-default"))
            miro_app = db.scalar(select(ProviderApp).where(ProviderApp.key == "miro-default"))
            self.assertIsNotNone(graph_app)
            self.assertIsNotNone(miro_app)

            user = User(
                organization_id=graph_app.organization_id,
                email="person@example.com",
                display_name="Example Person",
                password_hash=None,
                is_admin=False,
                is_active=True,
            )
            db.add(user)
            db.flush()

            service_secret = "svc-secret"
            service_client = ServiceClient(
                organization_id=graph_app.organization_id,
                key="svc-agent",
                display_name="Service Agent",
                secret_hash=hash_secret(service_secret),
                environment="test",
                allowed_provider_app_keys_json=dumps_json(["microsoft-graph-default", "miro-default"]),
            )
            db.add(service_client)
            db.flush()

            graph_connection = ConnectedAccount(
                organization_id=user.organization_id,
                user_id=user.id,
                provider_app_id=graph_app.id,
                external_email="person@example.com",
                display_name="Graph Account",
                status="connected",
            )
            miro_connection = ConnectedAccount(
                organization_id=user.organization_id,
                user_id=user.id,
                provider_app_id=miro_app.id,
                external_email="person@example.com",
                display_name="Miro Account",
                status="connected",
            )
            db.add(graph_connection)
            db.add(miro_connection)
            db.flush()

            db.add(
                TokenMaterial(
                    organization_id=user.organization_id,
                    connected_account_id=graph_connection.id,
                    encrypted_access_token=encrypt_text("graph-access-token"),
                    encrypted_refresh_token=None,
                    token_type="Bearer",
                    scopes_json=dumps_json(["Mail.Read"]),
                )
            )
            db.add(
                TokenMaterial(
                    organization_id=user.organization_id,
                    connected_account_id=miro_connection.id,
                    encrypted_access_token=encrypt_text("miro-access-token"),
                    encrypted_refresh_token=None,
                    token_type="Bearer",
                    scopes_json=dumps_json(["boards:read"]),
                )
            )

            graph_credential = "grant-graph"
            miro_credential = "grant-miro"
            db.add(
                DelegationGrant(
                    organization_id=user.organization_id,
                    user_id=user.id,
                    service_client_id=service_client.id,
                    provider_app_id=graph_app.id,
                    connected_account_id=graph_connection.id,
                    credential_hash=hash_secret(graph_credential),
                    allowed_access_modes_json=dumps_json(["direct_token"]),
                    scope_ceiling_json=dumps_json(["Mail.Read"]),
                    environment="test",
                )
            )
            db.add(
                DelegationGrant(
                    organization_id=user.organization_id,
                    user_id=user.id,
                    service_client_id=service_client.id,
                    provider_app_id=miro_app.id,
                    connected_account_id=miro_connection.id,
                    credential_hash=hash_secret(miro_credential),
                    allowed_access_modes_json=dumps_json(["direct_token", "relay"]),
                    scope_ceiling_json=dumps_json(["boards:read"]),
                    environment="test",
                )
            )
            db.commit()

            return {
                "user_email": user.email,
                "service_secret": service_secret,
                "graph_credential": graph_credential,
                "miro_credential": miro_credential,
                "graph_connection_id": graph_connection.id,
                "miro_connection_id": miro_connection.id,
            }

    def test_token_issue_diagnostics_capture_issued_and_blocked_access(self) -> None:
        fixture = self._seed_service_access_fixture()

        issued = self.client.post(
            "/api/v1/token-issues/provider-access",
            json={
                "provider_app_key": "microsoft-graph-default",
                "connected_account_id": fixture["graph_connection_id"],
                "requested_scopes": ["Mail.Read"],
            },
            headers={
                "X-Service-Secret": fixture["service_secret"],
                "X-Delegated-Credential": fixture["graph_credential"],
            },
        )
        self.assertEqual(issued.status_code, 200)
        self.assertEqual(issued.json()["access_token"], "graph-access-token")

        blocked = self.client.post(
            "/api/v1/token-issues/provider-access",
            json={
                "provider_app_key": "miro-default",
                "connected_account_id": fixture["miro_connection_id"],
                "requested_scopes": ["boards:read"],
            },
            headers={
                "X-Service-Secret": fixture["service_secret"],
                "X-Delegated-Credential": fixture["miro_credential"],
            },
        )
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["detail"], "Provider app does not allow direct token return")

        client, csrf_token = self._login_admin()
        diagnostics = client.get(
            "/api/v1/admin/token-issues?limit=20",
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(diagnostics.status_code, 200)
        issue_data = diagnostics.json()
        self.assertEqual({entry["decision"] for entry in issue_data}, {"issued", "blocked"})
        blocked_entry = next(entry for entry in issue_data if entry["decision"] == "blocked")
        self.assertEqual(blocked_entry["reason"], "Provider app does not allow direct token return")

        blocked_only = client.get(
            "/api/v1/admin/token-issues?decision=blocked&limit=20",
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(blocked_only.status_code, 200)
        self.assertEqual([entry["decision"] for entry in blocked_only.json()], ["blocked"])

    def test_connected_accounts_filters_support_operator_views(self) -> None:
        fixture = self._seed_service_access_fixture()
        client, csrf_token = self._login_admin()

        filtered = client.get(
            f"/api/v1/admin/connected-accounts?user_email={fixture['user_email']}&provider_app_key=miro-default&status=connected&limit=20",
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(filtered.status_code, 200)
        body = filtered.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["id"], fixture["miro_connection_id"])

    def test_miro_access_bundle_and_legacy_proxy_run_on_fastapi_stack(self) -> None:
        fixture = self._seed_service_access_fixture()
        client, csrf_token = self._login_admin()

        details = client.get(
            f"/api/v1/connections/{fixture['miro_connection_id']}/miro-access",
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(details.status_code, 200)
        details_body = details.json()
        self.assertEqual(details_body["profile_id"], "person_example.com")
        self.assertTrue(details_body["has_relay_token"])
        self.assertIsNone(details_body["relay_token"])

        rotated = client.post(
            f"/api/v1/connections/{fixture['miro_connection_id']}/miro-access/reset",
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(rotated.status_code, 200)
        rotated_body = rotated.json()
        self.assertTrue(rotated_body["relay_token"])
        self.assertIn("/miro/mcp/person_example.com", rotated_body["mcp_url"])
        self.assertIn("X-Relay-Key", rotated_body["mcp_config_json"])

        setup_token = issue_miro_setup_token(
            connected_account_id=fixture["miro_connection_id"],
            relay_token="setup-relay-token",
        )
        exchanged = client.post(
            "/api/v1/connections/miro/setup/exchange",
            json={"setup_token": setup_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(exchanged.status_code, 200)
        self.assertEqual(exchanged.json()["relay_token"], "setup-relay-token")

        expired = client.post(
            "/api/v1/connections/miro/setup/exchange",
            json={"setup_token": setup_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(expired.status_code, 404)

        with patch("app.routers.legacy_miro.relay_miro_request") as relay_mock:
            relay_mock.return_value = JSONResponse({"ok": True, "channel": "fastapi-legacy"})
            relayed = client.post(
                "/miro/mcp/person_example.com",
                json={"method": "tools/list"},
                headers={"X-Relay-Key": rotated_body["relay_token"]},
            )

        self.assertEqual(relayed.status_code, 200)
        self.assertEqual(relayed.json(), {"ok": True, "channel": "fastapi-legacy"})


if __name__ == "__main__":
    unittest.main()
