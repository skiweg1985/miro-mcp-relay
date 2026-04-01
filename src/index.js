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
const ADMIN_API_KEY = process.env.MIRO_RELAY_ADMIN_KEY || RELAY_API_KEY;
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');
const CLIENT_FILE = path.join(DATA_DIR, 'oauth-clients.json');
const PROFILE_FILE = path.join(DATA_DIR, 'profiles.json');
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

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function newProfileId() {
  return `p_${b64url(crypto.randomBytes(9))}`;
}

function newRelayToken() {
  return b64url(crypto.randomBytes(32));
}

function tokenHash(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function maskContact(contact = '') {
  if (!contact) return '';
  const at = contact.indexOf('@');
  if (at > 1) return `${contact[0]}***${contact.slice(at)}`;
  return `${contact.slice(0, 2)}***`;
}

function nowIso() {
  return new Date().toISOString();
}

// runtime stores
const pending = new Map(); // state -> { profileId, verifier }
const tokens = readJson(TOKEN_FILE, {}); // profileId -> oauth token set
const clients = readJson(CLIENT_FILE, {}); // profileId -> oauth client
const profiles = readJson(PROFILE_FILE, {}); // profileId -> metadata

function saveAll() {
  writeJson(TOKEN_FILE, tokens);
  writeJson(CLIENT_FILE, clients);
  writeJson(PROFILE_FILE, profiles);
}

function getProfile(profileId) {
  return profiles[profileId] || null;
}

function profilePublic(profileId, p) {
  return {
    profile_id: profileId,
    display_name: p.display_name,
    contact_masked: maskContact(p.contact || ''),
    status: p.status || 'pending',
    created_at: p.created_at,
    connected_at: p.connected_at || null,
    updated_at: p.updated_at || p.created_at
  };
}

function requireAdmin(req, res, next) {
  const key = req.header('x-admin-key') || req.header('x-relay-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!ADMIN_API_KEY || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'unauthorized admin key' });
  }
  next();
}

function requireProfileToken(req, res, next) {
  const profileId = req.params.profile || req.params.profileId;
  const p = getProfile(profileId);
  if (!p || p.status === 'deleted') return res.status(404).json({ error: 'profile not found' });

  const supplied = req.header('x-relay-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!supplied) return res.status(401).json({ error: 'missing relay token' });

  const expected = p.relay_token_hash;
  if (!expected || tokenHash(supplied) !== expected) return res.status(401).json({ error: 'invalid relay token' });

  req.profile = p;
  req.profileId = profileId;
  next();
}

async function registerClient(profileId) {
  if (clients[profileId]?.client_id && clients[profileId]?.client_secret) return clients[profileId];

  const redirect_uri = `${BASE_URL}/miro/auth/callback`;
  const res = await fetch(`${MCP_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: `miro-mcp-relay-${profileId}`,
      redirect_uris: [redirect_uri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post'
    })
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);

  const data = await res.json();
  clients[profileId] = {
    client_id: data.client_id,
    client_secret: data.client_secret,
    redirect_uri
  };
  writeJson(CLIENT_FILE, clients);
  return clients[profileId];
}

async function refreshToken(profileId) {
  const t = tokens[profileId];
  const c = clients[profileId];
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

  tokens[profileId] = {
    ...t,
    access_token: data.access_token,
    refresh_token: data.refresh_token || t.refresh_token,
    token_type: data.token_type,
    scope: data.scope,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
  };
  profiles[profileId] = {
    ...(profiles[profileId] || {}),
    status: 'connected',
    updated_at: nowIso()
  };
  saveAll();
  return tokens[profileId].access_token;
}

async function getAccessToken(profileId) {
  const t = tokens[profileId];
  if (!t?.access_token) throw new Error(`profile '${profileId}' not authenticated`);
  const exp = t.expires_at || 0;
  if (Date.now() > exp - 60_000) return refreshToken(profileId);
  return t.access_token;
}

app.get('/miro/status', (req, res) => {
  const out = {};
  for (const [id, p] of Object.entries(profiles)) {
    if (p.status === 'deleted') continue;
    out[id] = {
      ...profilePublic(id, p),
      connected: Boolean(tokens[id]?.access_token),
      scope: tokens[id]?.scope || null,
      expires_at: tokens[id]?.expires_at || null
    };
  }
  res.json({ ok: true, profiles: out });
});

// Friendly browser landing page
app.get('/miro', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Miro Relay Start</title></head>
  <body style="font-family: sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.45;">
    <h2>Miro MCP Relay</h2>
    <p>Start enrollment directly in browser:</p>
    <form method="get" action="/miro/start">
      <label>Display name<br><input name="display_name" placeholder="Benji Net Agent" style="width:100%;padding:8px"></label><br><br>
      <label>Contact (optional)<br><input name="contact" placeholder="benji@example.com" style="width:100%;padding:8px"></label><br><br>
      <label>Admin key<br><input name="admin_key" placeholder="MIRO_RELAY_ADMIN_KEY" style="width:100%;padding:8px"></label><br><br>
      <button type="submit" style="padding:10px 16px">Start OAuth Enrollment</button>
    </form>
    <p style="margin-top:16px;color:#666">Tip: You can also call <code>POST /miro/profiles</code> from API clients.</p>
  </body>
</html>`);
});

app.get('/miro/status/:profileId', requireProfileToken, (req, res) => {
  const id = req.profileId;
  const p = req.profile;
  res.json({
    ok: true,
    profile: {
      ...profilePublic(id, p),
      connected: Boolean(tokens[id]?.access_token),
      scope: tokens[id]?.scope || null,
      expires_at: tokens[id]?.expires_at || null
    }
  });
});

// v2 provisioning endpoint (admin creates profile + gets one-time relay token)
async function createProfile({ display_name, contact }) {
  const profileId = newProfileId();
  const relayToken = newRelayToken();

  profiles[profileId] = {
    display_name,
    contact,
    relay_token_hash: tokenHash(relayToken),
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso()
  };

  await registerClient(profileId);
  saveAll();

  return {
    profile_id: profileId,
    relay_token: relayToken,
    auth_url: `${BASE_URL}/miro/auth/start?profile=${encodeURIComponent(profileId)}`,
    mcp_url: `${BASE_URL}/miro/mcp/${profileId}`
  };
}

app.post('/miro/profiles', requireAdmin, async (req, res) => {
  try {
    const display_name = String(req.body?.display_name || '').trim();
    const contact = String(req.body?.contact || '').trim();

    if (!display_name) return res.status(400).json({ error: 'display_name is required' });

    const created = await createProfile({ display_name, contact });

    res.status(201).json({
      ok: true,
      ...created,
      note: 'Store relay_token now. It is not shown again.'
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// One-click browser enrollment flow (friendlier UX)
app.get('/miro/start', async (req, res) => {
  try {
    const display_name = String(req.query.display_name || '').trim() || 'Miro User';
    const contact = String(req.query.contact || '').trim();
    const adminKey = String(req.query.admin_key || req.header('x-admin-key') || '');

    if (!ADMIN_API_KEY || adminKey !== ADMIN_API_KEY) {
      return res.status(401).type('html').send('<h3>Unauthorized</h3><p>Provide valid admin key via <code>?admin_key=...</code>.</p>');
    }

    const created = await createProfile({ display_name, contact });

    // optional show credentials as html before redirect
    if (String(req.query.show || '') === '1') {
      return res.type('html').send(`<!doctype html><html><body style="font-family:sans-serif;max-width:760px;margin:40px auto;line-height:1.45">
        <h2>Profile created</h2>
        <p><b>profile_id:</b> <code>${created.profile_id}</code></p>
        <p><b>relay_token:</b> <code>${created.relay_token}</code></p>
        <p><b>mcp_url:</b> <code>${created.mcp_url}</code></p>
        <p>Store relay_token now (one-time).</p>
        <p><a href="${created.auth_url}">Continue to Miro OAuth</a></p>
      </body></html>`);
    }

    return res.redirect(created.auth_url);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/miro/profiles', requireAdmin, (req, res) => {
  const contactFilter = String(req.query.contact || '').trim().toLowerCase();
  const list = Object.entries(profiles)
    .filter(([, p]) => p.status !== 'deleted')
    .filter(([, p]) => !contactFilter || String(p.contact || '').toLowerCase().includes(contactFilter))
    .map(([id, p]) => profilePublic(id, p));
  res.json({ ok: true, profiles: list });
});

app.delete('/miro/profiles/:profileId', requireProfileToken, (req, res) => {
  const id = req.profileId;
  profiles[id] = {
    ...(profiles[id] || {}),
    status: 'deleted',
    updated_at: nowIso()
  };
  delete tokens[id];
  delete clients[id];
  saveAll();
  res.json({ ok: true, message: `profile ${id} deregistered` });
});

app.get('/miro/auth/start', async (req, res) => {
  try {
    const profileId = String(req.query.profile || '').trim() || 'default';

    if (!profiles[profileId]) {
      // backward compatibility path: auto-create lightweight profile
      const relayToken = RELAY_API_KEY ? RELAY_API_KEY : newRelayToken();
      profiles[profileId] = {
        display_name: profileId,
        contact: '',
        relay_token_hash: tokenHash(relayToken),
        status: 'pending',
        created_at: nowIso(),
        updated_at: nowIso()
      };
    }

    const { verifier, challenge } = makePkce();
    const state = b64url(crypto.randomBytes(24));
    const c = await registerClient(profileId);
    pending.set(state, { profileId, verifier });

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
    saveAll();

    if (String(req.query.json || '') === '1') {
      return res.json({ profile_id: profileId, auth_url: authUrl });
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

    const c = clients[p.profileId];
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

    tokens[p.profileId] = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      scope: data.scope,
      expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
    };
    profiles[p.profileId] = {
      ...(profiles[p.profileId] || {}),
      status: 'connected',
      connected_at: profiles[p.profileId]?.connected_at || nowIso(),
      updated_at: nowIso()
    };

    pending.delete(state);
    saveAll();

    res.type('html').send(`<h2>✅ Miro auth successful</h2><p>Profile: <b>${p.profileId}</b></p><p>You can close this tab.</p>`);
  } catch (e) {
    res.status(500).send(`Auth failed: ${String(e)}`);
  }
});

app.post('/miro/mcp/:profile', requireProfileToken, async (req, res) => {
  const profileId = req.profileId;

  let token;
  try {
    token = await getAccessToken(profileId);
  } catch (e) {
    return res.status(401).json({
      error: String(e),
      hint: `Open ${BASE_URL}/miro/auth/start?profile=${encodeURIComponent(profileId)}`
    });
  }

  async function forward(accessToken) {
    return fetch(`${MCP_BASE}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': req.header('content-type') || 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify(req.body)
    });
  }

  try {
    let upstream = await forward(token);
    if (upstream.status === 401) {
      token = await refreshToken(profileId);
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
      ui: '/miro',
      start_enroll: '/miro/start?display_name=...&contact=...&admin_key=... (optional: &show=1)',
      status: '/miro/status',
      create_profile: 'POST /miro/profiles (X-Admin-Key)',
      auth_start: '/miro/auth/start?profile=<profile_id>',
      mcp_proxy: '/miro/mcp/:profile (POST, X-Relay-Key)',
      deregister: 'DELETE /miro/profiles/:profileId (X-Relay-Key of profile)'
    }
  });
});

app.listen(PORT, () => {
  console.log(`miro-mcp-relay listening on ${PORT}`);
  console.log(`BASE_URL=${BASE_URL}`);
});
