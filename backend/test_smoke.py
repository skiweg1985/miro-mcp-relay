import unittest

from fastapi.testclient import TestClient

from app.main import app


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


if __name__ == "__main__":
    unittest.main()
