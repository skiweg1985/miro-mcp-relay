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

- `/miro` → small enrollment page
- `/miro/start?display_name=Benji&contact=benji@example.com&admin_key=...` → one-click profile creation + OAuth redirect
- add `&show=1` to display `profile_id`, `relay_token`, `mcp_url` before redirect

## API

### 1) Create profile (admin)

```http
POST /miro/profiles
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "display_name": "Benji Net Agent",
  "contact": "benji@example.com"
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

```http
DELETE /miro/profiles/<profile_id>
X-Relay-Key: <relay_token>
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
