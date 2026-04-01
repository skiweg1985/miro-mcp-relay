import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';

dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 8787);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const RELAY_API_KEY = process.env.MIRO_RELAY_API_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');
const CLIENT_FILE = path.join(DATA_DIR, 'oauth-clients.json');
const MCP_BASE = 'https://mcp.miro.com';

if (!RELAY_API_KEY) {
  console.warn('⚠️ MIRO_RELAY_API_KEY is empty. Set it in .env for secure usage.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

const pending = new Map(); // state -> { profile, verifier }

const tokens = readJson(TOKEN_FILE, {});
const clients = readJson(CLIENT_FILE, {});

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function registerClient(profile) {
  if (clients[profile]?.client_id && clients[profile]?.client_secret) return clients[profile];

  const redirect_uri = `${BASE_URL}/miro/auth/callback`;
  const res = await fetch(`${MCP_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: `miro-mcp-relay-${profile}`,
      redirect_uris: [redirect_uri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post'
    })
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const data = await res.json();
  clients[profile] = {
    client_id: data.client_id,
    client_secret: data.client_secret,
    redirect_uri
  };
  writeJson(CLIENT_FILE, clients);
  return clients[profile];
}

async function refreshToken(profile) {
  const t = tokens[profile];
  const c = clients[profile];
  if (!t?.refresh_token || !c?.client_id) throw new Error('missing refresh/client');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: c.client_id,
    client_secret: c.client_secret
  });

  const res = await fetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const data = await res.json();

  tokens[profile] = {
    ...t,
    access_token: data.access_token,
    refresh_token: data.refresh_token || t.refresh_token,
    token_type: data.token_type,
    scope: data.scope,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
  };
  writeJson(TOKEN_FILE, tokens);
  return tokens[profile].access_token;
}

async function getAccessToken(profile) {
  const t = tokens[profile];
  if (!t?.access_token) throw new Error(`profile '${profile}' not authenticated`);
  const exp = t.expires_at || 0;
  if (Date.now() > exp - 60_000) {
    return refreshToken(profile);
  }
  return t.access_token;
}

function requireRelayKey(req, res, next) {
  const key = req.header('x-relay-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!RELAY_API_KEY || key !== RELAY_API_KEY) {
    return res.status(401).json({ error: 'unauthorized relay key' });
  }
  next();
}

app.get('/miro/status', (req, res) => {
  const out = Object.fromEntries(
    Object.entries(tokens).map(([k, v]) => [k, {
      connected: Boolean(v?.access_token),
      expires_at: v?.expires_at || null,
      scope: v?.scope || null
    }])
  );
  res.json({ ok: true, profiles: out });
});

app.get('/miro/auth/start', async (req, res) => {
  try {
    const profile = String(req.query.profile || 'default');
    const { verifier, challenge } = makePkce();
    const state = b64url(crypto.randomBytes(24));
    const c = await registerClient(profile);
    pending.set(state, { profile, verifier });

    const q = new URLSearchParams({
      response_type: 'code',
      client_id: c.client_id,
      redirect_uri: c.redirect_uri,
      scope: 'boards:read boards:write',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `${MCP_BASE}/authorize?${q.toString()}`;

    if (String(req.query.json || '') === '1') {
      return res.json({ profile, auth_url: authUrl });
    }
    return res.redirect(authUrl);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/miro/auth/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const p = pending.get(state);
    if (!code || !p) return res.status(400).send('Invalid callback: missing/unknown state');

    const c = clients[p.profile];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirect_uri,
      client_id: c.client_id,
      client_secret: c.client_secret,
      code_verifier: p.verifier
    });

    const tokenRes = await fetch(`${MCP_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    const data = await tokenRes.json();

    tokens[p.profile] = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      scope: data.scope,
      expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
    };
    writeJson(TOKEN_FILE, tokens);
    pending.delete(state);

    res.type('html').send(`<h2>✅ Miro auth successful for profile: ${p.profile}</h2><p>You can close this tab.</p>`);
  } catch (e) {
    res.status(500).send(`Auth failed: ${String(e)}`);
  }
});

app.post('/miro/mcp/:profile', requireRelayKey, async (req, res) => {
  const profile = req.params.profile;
  let token;
  try {
    token = await getAccessToken(profile);
  } catch (e) {
    return res.status(401).json({ error: String(e), hint: `Open ${BASE_URL}/miro/auth/start?profile=${profile}` });
  }

  async function forward(accessToken) {
    return fetch(`${MCP_BASE}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': req.header('content-type') || 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify(req.body)
    });
  }

  try {
    let upstream = await forward(token);
    if (upstream.status === 401) {
      token = await refreshToken(profile);
      upstream = await forward(token);
    }

    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'miro-mcp-relay',
    endpoints: {
      status: '/miro/status',
      auth_start: '/miro/auth/start?profile=default',
      mcp_proxy: '/miro/mcp/:profile (POST, requires X-Relay-Key)'
    }
  });
});

app.listen(PORT, () => {
  console.log(`miro-mcp-relay listening on ${PORT}`);
  console.log(`BASE_URL=${BASE_URL}`);
});
