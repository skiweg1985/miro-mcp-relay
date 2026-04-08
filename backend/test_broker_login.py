import unittest

from app.broker_login.claim_paths import get_by_path
from app.broker_login.generic_oidc import GenericOidcLoginProvider
from app.broker_login.microsoft_entra import MicrosoftEntraLoginProvider
from app.broker_login.oidc_config import GenericOidcLoginConfig
from app.broker_login.registry import is_safe_provider_key
from app.microsoft_oauth_resolver import ResolvedMicrosoftOAuth


class TestBrokerLogin(unittest.TestCase):
    def test_safe_provider_key(self) -> None:
        self.assertTrue(is_safe_provider_key("microsoft"))
        self.assertTrue(is_safe_provider_key("oidc-test"))
        self.assertFalse(is_safe_provider_key(""))
        self.assertFalse(is_safe_provider_key("../x"))
        self.assertFalse(is_safe_provider_key("Microsoft"))

    def test_claim_path_nested(self) -> None:
        d = {"a": {"b": {"c": "x"}}}
        self.assertEqual(get_by_path(d, "a.b.c"), "x")
        self.assertIsNone(get_by_path(d, "a.b.missing"))

    def test_microsoft_map_claims(self) -> None:
        r = ResolvedMicrosoftOAuth(
            authority_base="https://login.microsoftonline.com",
            tenant_id="common",
            client_id="cid",
            client_secret="sec",
            scope_list=["openid", "profile", "email"],
        )
        p = MicrosoftEntraLoginProvider(r)
        c = p.map_claims(
            id_token_claims={
                "sub": "s1",
                "email": "a@b.com",
                "name": "Alice",
                "iss": "https://login.microsoftonline.com/xxx/v2.0",
            },
            userinfo=None,
        )
        self.assertEqual(c.subject, "s1")
        self.assertEqual(c.email, "a@b.com")
        self.assertEqual(c.display_name, "Alice")

    def test_generic_oidc_map_claims(self) -> None:
        cfg = GenericOidcLoginConfig(
            authorization_endpoint="https://idp.example/authorize",
            token_endpoint="https://idp.example/token",
            userinfo_endpoint="https://idp.example/userinfo",
            scopes=["openid", "email"],
        )
        p = GenericOidcLoginProvider(provider_key="demo", client_id="c", client_secret="s", config=cfg)
        c = p.map_claims(
            id_token_claims={"sub": "subj", "email": "u@example.com"},
            userinfo={"name": "U"},
        )
        self.assertEqual(c.subject, "subj")
        self.assertEqual(c.email, "u@example.com")
        self.assertEqual(c.display_name, "U")


if __name__ == "__main__":
    unittest.main()
