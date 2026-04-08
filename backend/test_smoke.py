import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import engine
from app.default_integrations import (
    INTEGRATION_GRAPH_DEFAULT_ID,
    INTEGRATION_MIRO_DEFAULT_ID,
    LEGACY_MIRO_REST_OAUTH_TOKEN_ENDPOINT,
    reconcile_miro_default_integration_token_endpoint,
)
from app.main import app
from app.models import Integration
from app.security import dumps_json, loads_json
from app.seed import init_db


class TestSmoke(unittest.TestCase):
    def test_health(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/health")
            self.assertEqual(response.status_code, 200)
            data = response.json()
        self.assertTrue(data.get("ok"))

    def test_login_options(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/auth/login-options")
            self.assertEqual(response.status_code, 200)
            data = response.json()
        self.assertIn("microsoft_enabled", data)
        self.assertIn("login_providers", data)
        self.assertIsInstance(data.get("login_providers"), list)

    def test_admin_microsoft_oauth_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/admin/microsoft-oauth")
            self.assertEqual(response.status_code, 401)

    def test_admin_broker_login_providers_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/admin/broker-login-providers")
            self.assertEqual(response.status_code, 401)

    def test_admin_users_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/admin/users")
            self.assertEqual(response.status_code, 401)

    def test_access_grants_list_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/access-grants")
            self.assertEqual(response.status_code, 401)

    def test_integration_instance_inspect_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/integration-instances/x/inspect")
            self.assertEqual(response.status_code, 401)

    def test_access_grant_validate_rejects_invalid_token(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/access-grants/validate", json={"token": "bkr_invalid"})
            self.assertEqual(response.status_code, 401)

    def test_consumer_mcp_relay_requires_access_key(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/consumer/integration-instances/x/mcp")
            self.assertEqual(response.status_code, 401)

    def test_consumer_upstream_oauth_token_requires_access_key(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/consumer/integration-instances/x/token")
            self.assertEqual(response.status_code, 401)

    def test_integration_oauth_start_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/integration-instances/x/oauth/start")
            self.assertEqual(response.status_code, 401)

    def test_integration_oauth_callback_redirects_without_params(self) -> None:
        with TestClient(app, follow_redirects=False) as client:
            response = client.get("/api/v1/integration-instances/oauth/callback")
            self.assertEqual(response.status_code, 302)
            self.assertIn("connection_status=error", response.headers.get("location", ""))

    def test_microsoft_graph_connection_callback_redirects_without_params(self) -> None:
        with TestClient(app, follow_redirects=False) as client:
            response = client.get("/api/v1/connections/microsoft-graph/callback")
            self.assertEqual(response.status_code, 302)
            self.assertIn("connection_status=error", response.headers.get("location", ""))

    def test_seed_creates_default_integrations(self) -> None:
        init_db()
        with Session(engine) as db:
            miro = db.get(Integration, INTEGRATION_MIRO_DEFAULT_ID)
            graph = db.get(Integration, INTEGRATION_GRAPH_DEFAULT_ID)
        self.assertIsNotNone(miro)
        self.assertIsNotNone(graph)
        self.assertEqual(miro.type, "mcp_server")
        self.assertTrue(miro.mcp_enabled)
        self.assertEqual(graph.type, "oauth_provider")
        self.assertFalse(graph.mcp_enabled)

    def test_miro_default_integration_uses_mcp_token_endpoint(self) -> None:
        init_db()
        with Session(engine) as db:
            miro = db.get(Integration, INTEGRATION_MIRO_DEFAULT_ID)
        self.assertIsNotNone(miro)
        cfg = loads_json(miro.config_json, {})
        base = get_settings().miro_mcp_base.rstrip("/")
        self.assertEqual(cfg.get("oauth_token_endpoint"), f"{base}/token")

    def test_reconcile_miro_default_updates_legacy_rest_token_endpoint(self) -> None:
        init_db()
        with Session(engine) as db:
            miro = db.get(Integration, INTEGRATION_MIRO_DEFAULT_ID)
            cfg = loads_json(miro.config_json, {})
            cfg["oauth_token_endpoint"] = LEGACY_MIRO_REST_OAUTH_TOKEN_ENDPOINT
            miro.config_json = dumps_json(cfg)
            db.commit()
        with Session(engine) as db:
            reconcile_miro_default_integration_token_endpoint(db)
            db.commit()
        with Session(engine) as db:
            miro = db.get(Integration, INTEGRATION_MIRO_DEFAULT_ID)
            cfg = loads_json(miro.config_json, {})
        base = get_settings().miro_mcp_base.rstrip("/")
        self.assertEqual(cfg.get("oauth_token_endpoint"), f"{base}/token")

    def test_upstream_identity_from_connection_metadata(self) -> None:
        from app.upstream_oauth import upstream_identity_from_connection

        conn = SimpleNamespace(metadata_json='{"email":"user@example.com","username":"upn@tenant"}')
        email, username = upstream_identity_from_connection(conn)  # type: ignore[arg-type]
        self.assertEqual(email, "user@example.com")
        self.assertEqual(username, "upn@tenant")

        display_only = SimpleNamespace(metadata_json='{"email":"a@b.com","display_name":"Pat Example"}')
        e2, u2 = upstream_identity_from_connection(display_only)  # type: ignore[arg-type]
        self.assertEqual(e2, "a@b.com")
        self.assertEqual(u2, "Pat Example")

        empty = SimpleNamespace(metadata_json="{}")
        e3, u3 = upstream_identity_from_connection(empty)  # type: ignore[arg-type]
        self.assertIsNone(e3)
        self.assertIsNone(u3)


if __name__ == "__main__":
    unittest.main()
