from __future__ import annotations

from enum import StrEnum


class AuthFlowFailureCode(StrEnum):
    PROVIDER_DISABLED = "provider_disabled"
    PROVIDER_NOT_CONFIGURED = "provider_not_configured"
    PROVIDER_MISMATCH = "provider_mismatch"
    UPSTREAM_ERROR = "upstream_error"
    TOKEN_EXCHANGE_FAILED = "token_exchange_failed"
    USERINFO_FAILED = "userinfo_failed"
    INVALID_CALLBACK = "invalid_callback"
    INVALID_STATE = "invalid_state"
    NONCE_MISMATCH = "nonce_mismatch"
    MISSING_IDENTITY = "missing_identity"
    ACCOUNT_DISABLED = "account_disabled"
    INTERNAL = "internal"


class AuthFlowFailure(Exception):
    """Expected login-flow failure; safe `message` is shown to the user (no secrets)."""

    def __init__(self, code: AuthFlowFailureCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
