# miro-mcp-relay

OAuth broker/relay for `https://mcp.miro.com/`, now evolving into a generic OAuth broker and delegated token access platform.

## Current architecture

The active app now runs as:

- `backend/app`: FastAPI broker backend with DB-backed users, sessions, provider definitions/apps, connected accounts, delegated access, Miro relay-token issuance, and legacy-compatible `/miro/mcp/<profile_id>` relay handling
- `frontend/`: React/Vite workspace for login, Miro connection, MCP handoff, grants, and token diagnostics
- `src/`: legacy Node source retained only as reference and for the small platform unit tests; it is no longer part of the deployed runtime path

## Features

- Profile-based Miro OAuth (PKCE)
- Per-profile MCP endpoint: `/miro/mcp/<profile_id>`
- Per-profile relay token (`X-Relay-Key`)
- Configurable provider app policy with `access_mode`: `relay`, `direct_token`, `hybrid`
- Generic service client + delegated credential model for brokered access
- Direct provider access-token issuance endpoint for explicitly allowed provider apps
- Separate relay-call and token-issue audit streams
- Self-service + admin deregistration options
- Admin governance actions: list profiles, rotate relay token, revoke OAuth
- OAuth identity check visibility (expected vs detected Miro email)
- Automatic token refresh
- Audit log endpoint for admin
- Health and readiness endpoints (`/healthz`, `/readyz`)
- Retry + circuit-breaker protection for MCP upstream calls

## Run

```bash
cp .env.example .env
# edit BROKER_PUBLIC_BASE_URL, FRONTEND_BASE_URL, CORS_ORIGINS, and Microsoft credentials if needed

docker compose up -d --build
```

This starts:

- `oauth-broker-proxy` on `http://localhost`
- `postgres` on `localhost:5432`
- `oauth-broker-frontend` and `oauth-broker-backend` on the internal Docker network

Primary new-stack surfaces:

- broker API docs: [http://localhost/api/v1/docs](http://localhost/api/v1/docs)
- broker frontend shell: [http://localhost](http://localhost)
- end-user workspace: [http://localhost/workspace](http://localhost/workspace)

The same Compose stack also exposes local HTTPS on `https://localhost`. HAProxy generates a self-signed dev certificate automatically on first start and stores it under `./devcert`.

If you want to pre-generate the same certificate before starting Docker, you can still run:

```bash
./scripts/generate-dev-cert.sh
```

Primary local HTTPS surfaces:

- broker API docs: [https://localhost/api/v1/docs](https://localhost/api/v1/docs)
- broker frontend shell: [https://localhost](https://localhost)
- end-user workspace: [https://localhost/workspace](https://localhost/workspace)

The generated certificate is self-signed and intended for local development only, so your browser will need to trust it manually.

For local development without Docker:

```bash
cp .env.example .env
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
npm run dev
```

To enable Microsoft end-user login, set these values in `.env` before starting the backend:

```bash
MICROSOFT_BROKER_TENANT_ID=common
MICROSOFT_BROKER_CLIENT_ID=...
MICROSOFT_BROKER_CLIENT_SECRET=...
MICROSOFT_BROKER_SCOPE="openid profile email User.Read"
```

## Welle 1 smoke flow

This is the reproducible Miro path that now defines feature-complete Welle 1:

1. Start the backend and frontend.
2. Open the frontend login page and sign in as an end user through Microsoft.
3. Open `/connect/miro` and complete the Miro OAuth flow.
4. In `/grants`, create a delegated credential (optionally tied to a service client).
5. Call one of these broker paths with `X-Delegated-Credential`. `X-Service-Secret` is optional and only required when the grant is restricted to a service client and you use the legacy two-secret flow.
   - `POST /api/v1/token-issues/provider-access`
   - `POST /api/v1/broker-proxy/miro/{connected_account_id}`
6. Verify the result in:
   - end-user `Token Access`
   - admin `Audit`, including token issue diagnostics

Example direct-token request:

```bash
curl -sS \
  -X POST http://localhost/api/v1/token-issues/provider-access \
  -H "Content-Type: application/json" \
  -H "X-Delegated-Credential: <delegated-credential>" \
  -d '{
    "provider_app_key": "microsoft-graph-default",
    "requested_scopes": ["Mail.Read"]
  }'
```

Optional header for grants tied to a service client: `X-Service-Secret: <service-client-secret>`.

## Validation

- Relay unit checks: `node --test`
- Backend syntax validation: `python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/core/*.py`
- Welle-1 smoke tests: `python3 -m unittest backend/test_welle1_smoke.py`

## BASE_URL note (important)

Set `BASE_URL` to host+port only.

- ✅ `BASE_URL=https://relay.example.com`
- ✅ `BASE_URL=https://relay.example.com:8443`
- ❌ `BASE_URL=https://relay.example.com/miro`

## Friendly browser flow

Open:

- `/workspace` → authenticated end-user workspace
- `/connect/miro` → user-facing Miro connect and reconnect flow
- `/grants` → self-service delegated-credential management
- `/token-access` → self-service diagnostics for issued or blocked delegated access
- `/miro`, `/start`, `/miro/start`, and `/miro/workspace` → compatibility entries that redirect into the new frontend experience
- primary user journey is now: sign in with Microsoft → connect Miro → copy MCP config from the new app handoff card
- profile id remains URL-safe: `@` is replaced with `_`
- the FastAPI callback now finalizes or reuses the stored Miro connection, then redirects to `/connect/miro`
- on first successful connect, the frontend receives a one-time relay token handoff and shows the ready-to-paste MCP config

## API

## New broker backend API

The new backend lives under `/api/v1`.

### Health

```http
GET /api/v1/health
```

### Login

Seeded local admin login:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "change-me-admin-password"
}
```

Response includes a CSRF token. Send that token in `X-CSRF-Token` for state-changing authenticated requests.

### Provider definitions

```http
GET /api/v1/provider-definitions
```

### Admin provider instances/apps

```http
GET /api/v1/admin/provider-instances
GET /api/v1/admin/provider-apps
POST /api/v1/admin/provider-instances
POST /api/v1/admin/provider-apps
```

### Admin connected accounts

For now, the new backend supports manual connected-account creation for migration/bootstrap:

```http
POST /api/v1/admin/connected-accounts/manual
```

This stores provider tokens encrypted in the database and keeps refresh tokens inside the broker.

### Miro connection and relay in the new backend

```http
POST /api/v1/connections/miro/start
GET /api/v1/connections/miro/callback
POST /api/v1/connections/{id}/refresh
POST /api/v1/connections/{id}/revoke
GET /api/v1/connections/{id}/miro-access
POST /api/v1/connections/{id}/miro-access/reset
POST /api/v1/connections/miro/setup/exchange
POST /api/v1/broker-proxy/miro/{connected_account_id}
```

The new FastAPI backend now owns the active Miro migration path:

- start OAuth from the broker backend
- complete callback into the broker frontend
- refresh stored Miro tokens from encrypted token material
- relay MCP traffic through the new broker proxy path

### Miro migration endpoints

```http
GET /api/v1/admin/migrations/miro/status
POST /api/v1/admin/migrations/miro/import
```

These endpoints import legacy file-backed Miro profiles, tokens, and dynamic OAuth clients from `data/` into:

- broker users
- Miro connected accounts
- encrypted token material

### Service clients and delegation grants

```http
GET /api/v1/admin/service-clients
POST /api/v1/admin/service-clients
GET /api/v1/admin/delegation-grants
POST /api/v1/admin/delegation-grants
POST /api/v1/admin/delegation-grants/{grant_id}/revoke
```

### Direct provider access token issuance

```http
POST /api/v1/token-issues/provider-access
X-Delegated-Credential: <delegated-credential>
Content-Type: application/json

{
  "provider_app_key": "microsoft-graph-default",
  "connected_account_id": "<optional-connected-account-id>",
  "requested_scopes": ["Mail.Read"]
}
```

Optional: `X-Service-Secret: <service-client-secret>` when the delegation grant is bound to a service client and you want the previous two-header authentication.

Refresh tokens are never returned.

### Provider policy and delegated access

The built-in Miro provider app is seeded as `miro-default`.

- default mode is `relay`
- legacy Miro MCP clients continue to use `/miro/mcp/<profile_id>`
- future providers can be configured with the same `access_mode` policy model

Supported access modes:

- `relay`: broker keeps provider tokens and relays requests
- `direct_token`: authorized services can request a real provider access token
- `hybrid`: both are available, subject to policy

For Miro, the new backend currently uses relay as the primary supported mode.

### End-user Miro MCP handoff

The old profile-provisioning UI is retired. The equivalent user journey is now:

1. Sign in to the new app.
2. Open `/connect/miro` and finish the Miro OAuth flow.
3. Copy the one-time relay token or full MCP config from the handoff card.
4. Use the legacy-compatible relay endpoint:

```http
POST /miro/mcp/<profile_id>
X-Relay-Key: <relay_token>
```

You can inspect the stored relay identity without rotating the token:

```http
GET /api/v1/connections/{connected_account_id}/miro-access
```

You can intentionally rotate the relay token and retrieve a fresh MCP config:

```http
POST /api/v1/connections/{connected_account_id}/miro-access/reset
X-CSRF-Token: <csrf-token>
```

The one-time callback handoff is redeemed by the frontend through:

```http
POST /api/v1/connections/miro/setup/exchange
X-CSRF-Token: <csrf-token>
Content-Type: application/json

{
  "setup_token": "<one-time-token>"
}
```

## Agent Zero example

```json
{
  "mcpServers": {
    "miro_personal": {
      "type": "streamable-http",
      "url": "https://relay.example.com/miro/mcp/<profile_id>",
      "headers": {
        "X-Relay-Key": "<relay_token>"
      }
    }
  }
}
```

## HAProxy snippet (concept)

```haproxy
acl is_miro path_beg /miro
use_backend be_broker_backend if is_miro

backend be_broker_backend
  server broker-backend 127.0.0.1:8000 check
```

## Health checks

- `GET /healthz` basic process liveness
- `GET /readyz` readiness with upstream + circuit-breaker state

## Security notes

- Terminate public TLS at the upstream load balancer in production
- The app-local HAProxy also exposes `443` with a self-signed certificate for local development only
- Use long random relay tokens and service secrets
- Treat `service_key` and `delegated_credential` like secrets; both are shown only once
- Keep `access_mode=relay` for sensitive integrations unless direct token return is explicitly required
- Restrict `/miro/mcp/*` by IP if possible
- Rotate keys periodically
- OAuth email check mode is `MIRO_OAUTH_EMAIL_MODE=warn` by default (fail-open); set `strict` after validation
- OAuth scopes are configurable via `MIRO_OAUTH_SCOPE` (default `boards:read boards:write`)
- The built-in `miro-default` provider app seeds the relay-first policy

## Tests

Run all tests:

```bash
npm test
```

Run the policy tests only:

```bash
node --test test/platform.test.js
```
