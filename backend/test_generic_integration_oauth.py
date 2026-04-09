import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database import engine
from app.deps import get_current_user, require_csrf
from app.generic_integration_oauth import (
    TEMPLATE_KEY_GENERIC_OAUTH,
    first_generic_oauth_config_error,
    merge_id_token_and_userinfo,
    normalized_claim_mapping,
    profile_from_claims,
    resolve_generic_client_credentials,
    token_endpoint_auth_method,
)
from app.main import app
from app.models import Integration, User
from app.security import encrypt_text
from app.seed import init_db


def _generic_cfg(**overrides):
    base = {
        "template_key": TEMPLATE_KEY_GENERIC_OAUTH,
        "oauth_authorization_endpoint": "https://idp.example.com/oauth/authorize",
        "oauth_token_endpoint": "https://idp.example.com/oauth/token",
        "oauth_client_id": "test-client-id",
    }
    base.update(overrides)
    return base


class TestGenericIntegrationOAuthHelpers(unittest.TestCase):
    def test_normalized_claim_mapping_defaults(self) -> None:
        m = normalized_claim_mapping({})
        self.assertEqual(m["subject"], "sub")

    def test_normalized_claim_mapping_custom(self) -> None:
        m = normalized_claim_mapping(
            {"oauth_claim_mapping": {"subject": "user_id", "email": "mail", "display_name": "full_name"}}
        )
        self.assertEqual(m["subject"], "user_id")
        self.assertEqual(m["email"], "mail")

    def test_profile_from_nested_path(self) -> None:
        merged = {"profile": {"id": "u1", "contact": {"mail": "a@example.com"}}}
        mapping = {
            "subject": "profile.id",
            "email": "profile.contact.mail",
            "display_name": "name",
            "preferred_username": "preferred_username",
        }
        meta = profile_from_claims(merged, mapping)
        self.assertEqual(meta.get("external_subject"), "u1")
        self.assertEqual(meta.get("email"), "a@example.com")

    def test_merge_userinfo_over_id_token(self) -> None:
        m = merge_id_token_and_userinfo({"sub": "s", "email": "old@x.com"}, {"email": "new@x.com", "name": "N"})
        self.assertEqual(m["email"], "new@x.com")
        self.assertEqual(m["sub"], "s")

    def test_first_error_missing_token_endpoint(self) -> None:
        integ = SimpleNamespace(oauth_client_secret_encrypted=encrypt_text("sec"))
        err = first_generic_oauth_config_error(
            _generic_cfg(oauth_token_endpoint=""),
            integ,
        )
        self.assertEqual(err, "oauth_token_endpoint_missing")

    def test_resolve_client_secret_priority(self) -> None:
        row = MagicMock(spec=Integration)
        row.oauth_client_secret_encrypted = encrypt_text("from-column")
        cid, sec = resolve_generic_client_credentials(
            row,
            {"oauth_client_id": "c1", "oauth_client_secret": "from-json"},
        )
        self.assertEqual(cid, "c1")
        self.assertEqual(sec, "from-column")

    def test_token_endpoint_auth_method(self) -> None:
        self.assertEqual(token_endpoint_auth_method({}), "client_secret_post")
        self.assertEqual(token_endpoint_auth_method({"oauth_token_endpoint_auth_method": "CLIENT_SECRET_BASIC"}), "client_secret_basic")


def _load_bootstrap_admin_user() -> User:
    settings = get_settings()
    init_db()
    with Session(engine) as db:
        row = db.scalar(
            select(User).where(User.email == str(settings.bootstrap_admin_email or "").strip().lower())
        )
        if not row:
            raise RuntimeError("bootstrap admin missing after init_db")
        db.expunge(row)
        return row


class TestGenericIntegrationOAuthApi(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_create_generic_oauth_rejects_incomplete(self) -> None:
        admin = _load_bootstrap_admin_user()
        app.dependency_overrides[get_current_user] = lambda: admin
        app.dependency_overrides[require_csrf] = lambda: "test-csrf"
        with TestClient(app) as client:
            bad = client.post(
                "/api/v1/integrations",
                json={
                    "name": "Broken OAuth",
                    "type": "oauth_provider",
                    "mcp_enabled": False,
                    "oauth_integration_client_secret": "s3cret",
                    "config": {
                        "template_key": TEMPLATE_KEY_GENERIC_OAUTH,
                        "oauth_authorization_endpoint": "https://idp.example/authorize",
                        "oauth_token_endpoint": "",
                        "oauth_client_id": "cid",
                    },
                },
            )
            self.assertEqual(bad.status_code, 400)
            self.assertEqual(bad.json().get("detail"), "oauth_token_endpoint_missing")

    def test_start_generic_oauth_happy_path(self) -> None:
        admin = _load_bootstrap_admin_user()
        app.dependency_overrides[get_current_user] = lambda: admin
        app.dependency_overrides[require_csrf] = lambda: "test-csrf"
        user_id = admin.id
        org_id = admin.organization_id
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/integrations",
                json={
                    "name": "Generic IdP",
                    "type": "oauth_provider",
                    "mcp_enabled": False,
                    "oauth_integration_client_secret": "unit-test-secret",
                    "config": _generic_cfg(),
                },
            )
            self.assertEqual(created.status_code, 200)
            integration_id = created.json()["id"]

            inst = client.post(
                "/api/v1/integration-instances",
                json={
                    "name": "My link",
                    "integration_id": integration_id,
                    "auth_mode": "oauth",
                    "auth_config": {"header_name": "Authorization", "prefix": "Bearer"},
                    "access_mode": "relay",
                    "access_config": {},
                },
            )
            self.assertEqual(inst.status_code, 200)
            instance_id = inst.json()["id"]

            start = client.post(f"/api/v1/integration-instances/{instance_id}/oauth/start")
            self.assertEqual(start.status_code, 200)
            body = start.json()
            self.assertIn("auth_url", body)
            self.assertIn("idp.example.com/oauth/authorize", body["auth_url"])
            self.assertIn("code_challenge=", body["auth_url"])
            self.assertNotIn(user_id, body["auth_url"])
            self.assertNotIn(org_id, body["auth_url"])


class TestGenericOAuthRefreshSmoke(unittest.TestCase):
    def test_refresh_posts_for_generic_template(self) -> None:
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        from app.database import engine
        from app.models import IntegrationInstance, UserConnection, UserConnectionStatus
        from app.security import dumps_json, encrypt_text
        from app.upstream_oauth import _refresh_token_for_connection

        init_db()
        settings = get_settings()
        with Session(engine) as db:
            user = db.scalar(select(User).where(User.email == settings.bootstrap_admin_email))
            self.assertIsNotNone(user)
            integ = Integration(
                organization_id=user.organization_id,
                name="Refresh test",
                type="oauth_provider",
                config_json=dumps_json(_generic_cfg()),
                mcp_enabled=False,
                oauth_client_secret_encrypted=encrypt_text("sec"),
            )
            db.add(integ)
            db.flush()
            inst = IntegrationInstance(
                organization_id=user.organization_id,
                integration_id=integ.id,
                name="Conn",
                auth_mode="oauth",
                auth_config_json=dumps_json({"header_name": "Authorization", "prefix": "Bearer"}),
                access_mode="relay",
                access_config_json=dumps_json({}),
                created_by_user_id=user.id,
            )
            db.add(inst)
            db.flush()
            conn = UserConnection(
                organization_id=user.organization_id,
                user_id=user.id,
                integration_instance_id=inst.id,
                status=UserConnectionStatus.ACTIVE.value,
                oauth_refresh_token_encrypted=encrypt_text("refr-tok"),
                oauth_access_token_encrypted=encrypt_text("old"),
                metadata_json=dumps_json({"oauth_expires_at": "2000-01-01T00:00:00+00:00"}),
            )
            db.add(conn)
            db.commit()

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {"access_token": "new-access", "expires_in": 3600}

            with patch("httpx.Client") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.__enter__.return_value = mock_client
                mock_client.__exit__.return_value = None
                mock_client.post.return_value = mock_resp
                mock_client_cls.return_value = mock_client

                ok = _refresh_token_for_connection(db, user=user, instance=inst, conn=conn)
                self.assertTrue(ok)
                mock_client.post.assert_called_once()
                args, kwargs = mock_client.post.call_args
                self.assertIn("oauth/token", args[0])
                posted = kwargs.get("data") or {}
                self.assertEqual(posted.get("grant_type"), "refresh_token")
                self.assertEqual(posted.get("client_secret"), "sec")


class TestUpsertUserConnectionClearsStaleRefreshError(unittest.TestCase):
    def test_upsert_clears_oauth_refresh_error_metadata(self) -> None:
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        from app.database import engine
        from app.models import Integration, IntegrationInstance, User, UserConnection, UserConnectionStatus
        from app.routers.integration_oauth import _upsert_user_connection
        from app.security import dumps_json, encrypt_text, loads_json
        from app.token_health import compute_oauth_connection_health

        init_db()
        settings = get_settings()
        user_id: str | None = None
        org_id: str | None = None
        instance_id: str | None = None
        conn_id: str | None = None
        with Session(engine) as db:
            user = db.scalar(select(User).where(User.email == settings.bootstrap_admin_email))
            self.assertIsNotNone(user)
            integ = Integration(
                organization_id=user.organization_id,
                name="Upsert clear err",
                type="oauth_provider",
                config_json=dumps_json(_generic_cfg()),
                mcp_enabled=False,
                oauth_client_secret_encrypted=encrypt_text("sec"),
            )
            db.add(integ)
            db.flush()
            inst = IntegrationInstance(
                organization_id=user.organization_id,
                integration_id=integ.id,
                name="Conn",
                auth_mode="oauth",
                auth_config_json=dumps_json({"header_name": "Authorization", "prefix": "Bearer"}),
                access_mode="relay",
                access_config_json=dumps_json({}),
                created_by_user_id=user.id,
            )
            db.add(inst)
            db.flush()
            conn = UserConnection(
                organization_id=user.organization_id,
                user_id=user.id,
                integration_instance_id=inst.id,
                status=UserConnectionStatus.ACTIVE.value,
                oauth_refresh_token_encrypted=encrypt_text("refr-tok"),
                oauth_access_token_encrypted=encrypt_text("bad"),
                metadata_json=dumps_json(
                    {
                        "oauth_refresh_error": "invalid_grant",
                        "oauth_refresh_error_at": "2020-01-01T00:00:00+00:00",
                        "oauth_expires_at": "2000-01-01T00:00:00+00:00",
                    }
                ),
            )
            db.add(conn)
            db.commit()
            user_id = user.id
            org_id = user.organization_id
            instance_id = inst.id
            conn_id = conn.id

        with Session(engine) as db:
            _upsert_user_connection(
                db,
                organization_id=org_id or "",
                user_id=user_id or "",
                instance_id=instance_id or "",
                access_token="new-access",
                refresh_token="refr-tok",
                profile_metadata={"oauth_expires_at": "2099-01-01T00:00:00+00:00"},
            )
            db.commit()

        with Session(engine) as db:
            row = db.get(UserConnection, conn_id)
            self.assertIsNotNone(row)
            meta = loads_json(row.metadata_json, {})
            self.assertIsInstance(meta, dict)
            self.assertNotIn("oauth_refresh_error", meta)
            self.assertNotIn("oauth_refresh_error_at", meta)
            self.assertEqual(compute_oauth_connection_health(row), "healthy")


if __name__ == "__main__":
    unittest.main()
