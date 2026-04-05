import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException

from app.generic_oauth import assert_canonical_redirect_registered
from app.security import dumps_json


class TestGenericOAuthRedirect(unittest.TestCase):
    def test_accepts_exact_registered_uri(self) -> None:
        app = MagicMock()
        url = "https://broker.example/api/v1/connections/provider-oauth/callback"
        app.redirect_uris_json = dumps_json([url])
        assert_canonical_redirect_registered(app, url)

    def test_rejects_unregistered(self) -> None:
        app = MagicMock()
        app.redirect_uris_json = dumps_json(["https://other/cb"])
        with self.assertRaises(HTTPException) as ctx:
            assert_canonical_redirect_registered(app, "https://broker.example/api/v1/connections/provider-oauth/callback")
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
