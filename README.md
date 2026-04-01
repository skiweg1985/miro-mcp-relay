# miro-mcp-relay

Minimal OAuth relay/proxy for `https://mcp.miro.com/`.

## What it does

- Handles Miro OAuth (PKCE) per profile
- Stores/refreshes tokens automatically
- Exposes MCP proxy endpoint per profile
- Protects MCP endpoint with static relay API key

## Run

```bash
cp .env.example .env
# edit BASE_URL and MIRO_RELAY_API_KEY
# IMPORTANT: BASE_URL must be host+port only (without /miro)

docker compose up -d --build
```

## Endpoints

- `GET /miro/status`
- `GET /miro/auth/start?profile=<name>`
- `GET /miro/auth/callback`
- `POST /miro/mcp/<profile>` (requires `X-Relay-Key`)

## BASE_URL note (important)

Set `BASE_URL` to host+port only.

- ✅ `BASE_URL=https://oe-a0-01.opus.local:8443`
- ❌ `BASE_URL=https://oe-a0-01.opus.local:8443/miro`

Why: routes already include `/miro/...`. If you add `/miro` in `BASE_URL`, callback becomes duplicated (`/miro/miro/auth/callback`).

## First login

Open in browser:

```text
https://YOUR_HOST/miro/auth/start?profile=net
```

After success, profile `net` is connected.

## Agent Zero config

```json
{
  "mcpServers": {
    "miro_net": {
      "url": "https://YOUR_HOST/miro/mcp/net",
      "headers": {
        "X-Relay-Key": "YOUR_STATIC_RELAY_KEY"
      }
    }
  }
}
```

For multiple identities, add more profiles (`ops`, `docs`, ...), each authenticated separately via `/miro/auth/start?profile=<profile>`.

## HAProxy snippet (concept)

```haproxy
acl is_miro path_beg /miro
use_backend be_miro_relay if is_miro

backend be_miro_relay
  server relay1 127.0.0.1:8787 check
```

## Security notes

- Use HTTPS in production
- Use a long random `MIRO_RELAY_API_KEY`
- Restrict `/miro/mcp/*` by IP if possible
- Rotate relay key periodically
