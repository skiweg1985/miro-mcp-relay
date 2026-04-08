"""Admin user management API."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.deps import require_admin
from app.main import app
from app.models import Organization


class TestAdminUsers(unittest.TestCase):
    def test_list_requires_session(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/admin/users")
        self.assertEqual(response.status_code, 401)

    def test_list_ok_with_admin_override(self) -> None:
        with SessionLocal() as db:
            org = db.scalar(select(Organization).order_by(Organization.created_at.asc()))
        if org is None:
            self.skipTest("no organization")
        stub = SimpleNamespace(id="admin-test-stub", organization_id=org.id, is_admin=True)

        def _admin_stub():
            return stub

        app.dependency_overrides[require_admin] = _admin_stub
        try:
            with TestClient(app) as client:
                response = client.get("/api/v1/admin/users")
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
        finally:
            app.dependency_overrides.pop(require_admin, None)
        self.assertIn("users", data)
        self.assertIn("total", data)
        self.assertIsInstance(data["users"], list)
