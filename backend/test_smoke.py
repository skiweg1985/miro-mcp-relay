import unittest

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import engine
from app.default_integrations import INTEGRATION_GRAPH_DEFAULT_ID, INTEGRATION_MIRO_DEFAULT_ID
from app.main import app
from app.models import Integration
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

    def test_admin_microsoft_oauth_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/admin/microsoft-oauth")
            self.assertEqual(response.status_code, 401)

    def test_access_grants_list_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/access-grants")
            self.assertEqual(response.status_code, 401)

    def test_access_grant_validate_rejects_invalid_token(self) -> None:
        with TestClient(app) as client:
            response = client.post("/api/v1/access-grants/validate", json={"token": "bkr_invalid"})
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


if __name__ == "__main__":
    unittest.main()
