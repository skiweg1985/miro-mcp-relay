# miro-mcp-relay

OAuth broker/relay for `https://mcp.miro.com/`, now evolving into a generic OAuth broker and delegated token access platform.

## Current architecture

This repository now contains two layers:

- `src/index.js`: the existing Node-based Miro relay, kept in place for compatibility
- `backend/app`: a new FastAPI broker backend with DB-backed users, sessions, provider definitions/apps, connected accounts, service clients, delegation grants, and audited token issuance
- `frontend/`: a minimal React/Vite shell for the new broker UI

The intended migration shape is:

- keep the existing Miro MCP relay alive
- move broker identity, configuration, connected-account management, and delegated token issuance into the new backend
- grow the new frontend around those APIs

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
# edit BASE_URL, MIRO_RELAY_API_KEY, MIRO_RELAY_ADMIN_KEY, MIRO_ADMIN_PASSWORD

docker compose up -d --build
```

This starts:

- `postgres` on `localhost:5432`
- `oauth-broker-backend` on `localhost:8000`
- `miro-mcp-relay` on `localhost:8787`

Primary new-stack surfaces:

- broker API docs: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
- broker frontend shell: [http://localhost:5173](http://localhost:5173)
- end-user workspace: [http://localhost:5173/workspace](http://localhost:5173/workspace)

For local development without Docker:

```bash
cp .env.example .env
npm install
npm start
```

```bash
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
MICROSOFT_BROKER_SCOPE="openid profile email"
```

## BASE_URL note (important)

Set `BASE_URL` to host+port only.

- ✅ `BASE_URL=https://relay.example.com`
- ✅ `BASE_URL=https://relay.example.com:8443`
- ❌ `BASE_URL=https://relay.example.com/miro`

## Friendly browser flow

Open:

- `/miro` → full-screen onboarding wizard that starts the connection flow immediately
- `/start` → alias that redirects to `/miro`
- `/miro/start` → dedicated browser entry for the guided wizard
- `/miro/workspace` → self-service page for status, reconnect, and deregistration
- `/miro/admin` → admin governance UI with login, profile list, token rotation, OAuth revoke, delete, and audit
- `/miro/start?email=user@example.com` → jump directly into the guided OAuth enrollment for that email
- primary user journey is: begin → enter email → authorize with Miro → copy MCP config
- profile id is URL-safe: `@` is replaced with `_`
- profile + relay token are finalized only after successful `/miro/auth/callback`
- callback success page shows the MCP config first and keeps recovery details hidden until requested
- OAuth callback now shows expected profile email vs detected Miro user details for manual verification
- if `MIRO_START_REQUIRE_ADMIN=true`, also pass `&admin_key=...`

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
X-Service-Secret: <service-client-secret>
X-Delegated-Credential: <delegated-credential>
Content-Type: application/json

{
  "provider_app_key": "microsoft-graph-default",
  "connected_account_id": "<optional-connected-account-id>",
  "requested_scopes": ["Mail.Read"]
}
```

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

### 1) Create profile (admin)

```http
POST /miro/profiles
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "email": "user@example.com"
}
```

Response:

- `profile_id` (canonicalized from email: `@` -> `_`)
- `relay_token` (one-time, store it)
- `auth_url`
- `mcp_url`

### 2) OAuth login

Open returned `auth_url` in browser.

### 3) Use MCP endpoint

```http
POST /miro/mcp/<profile_id>
X-Relay-Key: <relay_token>
```

### 4) Status

- `GET /miro/status`
- `GET /miro/status/<profile_id>` (requires `X-Relay-Key`)

### 5) Deregister profile

User self-service:

```http
DELETE /miro/profiles/<profile_id>
X-Relay-Key: <relay_token>
```

Admin override:

```http
DELETE /miro/admin/profiles/<profile_id>
X-Admin-Key: <ADMIN_KEY>
```

### 6) Admin web login session

```http
POST /miro/admin/login
Content-Type: application/json

{ "password": "<MIRO_ADMIN_PASSWORD>" }
```

Or browser form on `/miro/admin`. Logout:

```http
POST /miro/admin/logout
```

### 7) Admin governance actions

Rotate profile relay token:

```http
POST /miro/admin/profiles/<profile_id>/rotate-token
X-Admin-Key: <ADMIN_KEY>
```

Revoke OAuth for a profile:

```http
POST /miro/admin/profiles/<profile_id>/revoke-oauth
X-Admin-Key: <ADMIN_KEY>
```

Read audit log:

```http
GET /miro/admin/audit?lines=200
X-Admin-Key: <ADMIN_KEY>
```

### 8) Provider app policy (admin)

List provider apps:

```http
GET /broker/admin/provider-apps
X-Admin-Key: <ADMIN_KEY>
```

Create or update a provider app policy:

```http
POST /broker/admin/provider-apps
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "id": "miro-default",
  "provider_key": "miro",
  "display_name": "Miro MCP Relay",
  "access_mode": "relay",
  "allow_relay": true,
  "allow_direct_token_return": false,
  "relay_protocol": "mcp_streamable_http",
  "allowed_service_ids": ["agent-zero"]
}
```

### 9) Service clients + delegated credentials (admin)

Create a service client:

```http
POST /broker/admin/service-clients
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "service_id": "agent-zero",
  "display_name": "Agent Zero",
  "allowed_provider_app_ids": ["miro-default"],
  "environment": "prod"
}
```

Create a delegation grant:

```http
POST /broker/admin/delegation-grants
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "profile_id": "user_example.com",
  "service_id": "agent-zero",
  "provider_key": "miro",
  "provider_app_id": "miro-default",
  "allowed_access_modes": ["relay"],
  "expires_in_hours": 24
}
```

### 10) Service relay and direct token access

Relay through the broker with delegated service credentials:

```http
POST /broker/relay/miro/<profile_id>
X-Service-Key: <service_key>
X-Delegated-Credential: <delegated_credential>
Content-Type: application/json
```

Request a provider access token directly:

```http
POST /broker/provider-access/miro/<profile_id>
X-Service-Key: <service_key>
X-Delegated-Credential: <delegated_credential>
```

Refresh tokens are never returned.

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
use_backend be_miro_relay if is_miro

backend be_miro_relay
  server relay1 127.0.0.1:8787 check
```

## Health checks

- `GET /healthz` basic process liveness
- `GET /readyz` readiness with upstream + circuit-breaker state

## Security notes

- Use HTTPS in production
- Use long random keys for admin + relay
- Treat `service_key` and `delegated_credential` like secrets; both are shown only once
- Keep `access_mode=relay` for sensitive integrations unless direct token return is explicitly required
- Restrict `/miro/mcp/*` by IP if possible
- Rotate keys periodically
- Optional: set `MIRO_START_REQUIRE_ADMIN=true` to protect browser onboarding
- Pending profiles are auto-deleted after `MIRO_PENDING_PROFILE_TTL_MINUTES` (default 15)
- OAuth email check mode is `MIRO_OAUTH_EMAIL_MODE=warn` by default (fail-open); set `strict` after validation
- OAuth scopes are configurable via `MIRO_OAUTH_SCOPE` (default `boards:read boards:write`)
- `MIRO_PROVIDER_ACCESS_MODE`, `MIRO_PROVIDER_ALLOW_RELAY`, and `MIRO_PROVIDER_ALLOW_DIRECT_TOKEN_RETURN` seed the built-in Miro provider-app policy
- Basic rate limiting is active on enroll/auth/delete endpoints
- Browser UI supports both self-service deregistration and admin override deregistration

## Tests

Run all tests:

```bash
npm test
```

Run the policy tests only:

```bash
node --test test/platform.test.js
```
