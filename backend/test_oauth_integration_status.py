import unittest

from app.models import ProviderApp, ProviderInstance
from app.oauth_integration_status import oauth_integration_configured
from app.security import dumps_json


class OAuthIntegrationStatusTests(unittest.TestCase):
    def test_static_requires_client_id(self) -> None:
        app = ProviderApp(
            organization_id="o1",
            provider_instance_id="i1",
            key="k",
            display_name="x",
            oauth_dynamic_client_registration_enabled=False,
        )
        inst = ProviderInstance(
            organization_id="o1",
            provider_definition_id="d1",
            key="ik",
            display_name="ix",
            role="downstream_oauth",
            authorization_endpoint="https://id.example/authorize",
            token_endpoint="https://id.example/token",
            settings_json=dumps_json({"use_pkce": True}),
        )
        ok, reason = oauth_integration_configured(provider_app=app, provider_instance=inst, needs_tenant=False)
        self.assertFalse(ok)
        self.assertIn("Client ID", reason or "")

    def test_dcr_requires_registration_url_not_client_id(self) -> None:
        app = ProviderApp(
            organization_id="o1",
            provider_instance_id="i1",
            key="k",
            display_name="x",
            oauth_dynamic_client_registration_enabled=True,
            oauth_registration_endpoint="https://id.example/register",
        )
        inst = ProviderInstance(
            organization_id="o1",
            provider_definition_id="d1",
            key="ik",
            display_name="ix",
            role="downstream_oauth",
            authorization_endpoint="https://id.example/authorize",
            token_endpoint="https://id.example/token",
            settings_json=dumps_json({"use_pkce": True}),
        )
        ok, reason = oauth_integration_configured(provider_app=app, provider_instance=inst, needs_tenant=False)
        self.assertTrue(ok)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
