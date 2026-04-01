# miro-mcp-relay

OAuth relay/proxy for `https://mcp.miro.com/`, with multi-profile support.

## Features

- Profile-based Miro OAuth (PKCE)
- Per-profile MCP endpoint: `/miro/mcp/<profile_id>`
- Per-profile relay token (`X-Relay-Key`)
- Self-service deregistration per profile
- Automatic token refresh

## Run

```bash
cp .env.example .env
# edit BASE_URL, MIRO_RELAY_API_KEY, MIRO_RELAY_ADMIN_KEY

docker compose up -d --build
```

## BASE_URL note (important)

Set `BASE_URL` to host+port only.

- ✅ `BASE_URL=https://relay.example.com`
- ✅ `BASE_URL=https://relay.example.com:8443`
- ❌ `BASE_URL=https://relay.example.com/miro`

## Friendly browser flow

Open:

- `/miro` → enrollment + deregistration web UI
- `/miro/start?display_name=Network+Agent&contact=user@example.com` → one-click profile creation + token preview page
- token preview now appears by default (so users can store relay token)
- click "Continue to Miro OAuth" from preview page
- optional `&auto=1` skips preview and redirects immediately
- if `MIRO_START_REQUIRE_ADMIN=true`, also pass `&admin_key=...`

## API

### 1) Create profile (admin)

```http
POST /miro/profiles
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "display_name": "Network Automation Agent",
  "contact": "user@example.com"
}
```

Response:

- `profile_id`
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

## Security notes

- Use HTTPS in production
- Use long random keys for admin + relay
- Restrict `/miro/mcp/*` by IP if possible
- Rotate keys periodically
- Optional: set `MIRO_START_REQUIRE_ADMIN=true` to protect browser onboarding
- Pending profiles are auto-deleted after `MIRO_PENDING_PROFILE_TTL_MINUTES` (default 15)
- Basic rate limiting is active on enroll/auth/delete endpoints
- Browser UI supports both self-service deregistration and admin override deregistration
