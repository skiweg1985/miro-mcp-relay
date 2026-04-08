# Broker sign-in (OAuth / OIDC)

Schritt-für-Schritt (Provider anlegen, Keycloak-Tests, Kommandos): [runbook-broker-login-testing.md](./runbook-broker-login-testing.md).

## Flow

1. `POST /api/v1/auth/{provider_id}/start` stores pending state (`broker_login`), returns authorize URL.
2. IdP redirects to `GET /api/v1/auth/{provider_id}/callback` with `code` and `state`.
3. Backend exchanges the code, maps claims to the internal profile model, creates the session cookie.

Structured log events (no tokens): `broker_login.start`, `broker_login.token_exchange_http_error`, `broker_login.nonce_mismatch`, `broker_login.userinfo_ok`, `broker_login.session_create`, `broker_login.complete`, `broker_login.failure`.

Log fields: `auth_provider`, `auth_correlation_id`, `auth_step`.

## Microsoft (Entra)

Configuration remains under **Microsoft sign-in** (`microsoft_oauth_settings` / environment). Redirect URI registered at Entra must match:

`{BROKER_PUBLIC_BASE_URL}{api_v1_prefix}/auth/microsoft/callback`

## Generic OIDC providers

Admin API: `GET|POST|PATCH|DELETE /api/v1/admin/broker-login-providers` (admin session + CSRF).

Each provider has a stable `provider_key` used in the URL path. Register the callback at the IdP:

`{BROKER_PUBLIC_BASE_URL}{api_v1_prefix}/auth/{provider_key}/callback`

## Typical failures

| Symptom | Check |
|--------|--------|
| `Invalid or expired sign-in state` | State TTL (15 min), clock skew, or user hit Back and reused an old URL. |
| `Sign-in provider mismatch` | Pending state `provider_id` does not match the callback path (tamper or broken proxy). |
| `Sign-in nonce validation failed` | IdP did not echo `nonce` in `id_token`, or wrong client / wrong flow. |
| `Token exchange failed (4xx/5xx)` | Wrong `token_endpoint`, `redirect_uri`, `client_secret`, or PKCE verifier. |
| `Sign-in did not provide a usable identity` | Claim mapping: ensure `subject` and `email` resolve after mapping (OIDC userinfo may be required). |

## Transition

Audit actions use `auth.broker_login.success` with `provider` metadata. Older deployments may still have historical `auth.microsoft.login.success` entries in the audit log.
