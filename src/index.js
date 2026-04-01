import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';

dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));

// Basic security headers for HTML/API responses
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const PORT = Number(process.env.PORT || 8787);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const RELAY_API_KEY = process.env.MIRO_RELAY_API_KEY || '';
const ADMIN_API_KEY = process.env.MIRO_RELAY_ADMIN_KEY || RELAY_API_KEY;
const ADMIN_PASSWORD = process.env.MIRO_ADMIN_PASSWORD || '';
const START_REQUIRE_ADMIN = String(process.env.MIRO_START_REQUIRE_ADMIN || 'false').toLowerCase() === 'true';
const PENDING_PROFILE_TTL_MINUTES = Number(process.env.MIRO_PENDING_PROFILE_TTL_MINUTES || 15);
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');
const CLIENT_FILE = path.join(DATA_DIR, 'oauth-clients.json');
const PROFILE_FILE = path.join(DATA_DIR, 'profiles.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const MCP_BASE = 'https://mcp.miro.com';
const BREAKER_FAIL_THRESHOLD = Number(process.env.MIRO_BREAKER_FAIL_THRESHOLD || 5);
const BREAKER_OPEN_MS = Number(process.env.MIRO_BREAKER_OPEN_MS || 30000);
const MCP_RETRY_COUNT = Number(process.env.MIRO_MCP_RETRY_COUNT || 2);

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

function safeText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function isValidEmailLike(v) {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(a || '', 'hex');
    const bb = Buffer.from(b || '', 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// Simple in-memory rate-limit by IP + key (good enough for relay edge hardening)
const rateMap = new Map();
function rateLimit(key, maxHits, windowMs) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
    const now = Date.now();
    const bucketKey = `${key}:${ip}`;
    const bucket = rateMap.get(bucketKey) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateMap.set(bucketKey, bucket);
    if (bucket.count > maxHits) {
      return res.status(429).json({ error: 'rate_limited', retry_after_ms: Math.max(0, bucket.resetAt - now) });
    }
    next();
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function breakerIsOpen() {
  return Date.now() < breaker.openUntil;
}

function breakerMarkSuccess() {
  breaker.consecutiveFails = 0;
}

function breakerMarkFailure() {
  breaker.consecutiveFails += 1;
  if (breaker.consecutiveFails >= BREAKER_FAIL_THRESHOLD) {
    breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
    breaker.consecutiveFails = 0;
  }
}

// runtime stores
const pending = new Map(); // state -> { profileId, verifier }
const tokens = readJson(TOKEN_FILE, {}); // profileId -> oauth token set
const clients = readJson(CLIENT_FILE, {}); // profileId -> oauth client
const profiles = readJson(PROFILE_FILE, {}); // profileId -> metadata
const breaker = { consecutiveFails: 0, openUntil: 0 };
const adminSessions = new Map(); // sid -> {expiresAt}

function saveAll() {
  writeJson(TOKEN_FILE, tokens);
  writeJson(CLIENT_FILE, clients);
  writeJson(PROFILE_FILE, profiles);
}

function audit(event, details = {}, req = null) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim() : 'system';
    const line = JSON.stringify({ ts: nowIso(), event, ip, details });
    fs.appendFileSync(AUDIT_FILE, line + '\n');
  } catch {
    // do not break request flow on audit errors
  }
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

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function createAdminSession(res) {
  const sid = b64url(crypto.randomBytes(24));
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  adminSessions.set(sid, { expiresAt });
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
}

function clearAdminSession(req, res) {
  const cookies = parseCookies(req);
  const sid = cookies.admin_session;
  if (sid) adminSessions.delete(sid);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function isAdminBySession(req) {
  const cookies = parseCookies(req);
  const sid = cookies.admin_session;
  if (!sid) return false;
  const s = adminSessions.get(sid);
  if (!s) return false;
  if (Date.now() > s.expiresAt) {
    adminSessions.delete(sid);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (isAdminBySession(req)) return next();
  const key = req.header('x-admin-key') || req.header('x-relay-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (ADMIN_API_KEY && key === ADMIN_API_KEY) return next();
  return res.status(401).json({ error: 'unauthorized admin' });
}

function requireProfileToken(req, res, next) {
  const profileId = req.params.profile || req.params.profileId;
  const p = getProfile(profileId);
  if (!p || p.status === 'deleted') return res.status(404).json({ error: 'profile not found' });

  const supplied = req.header('x-relay-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!supplied) return res.status(401).json({ error: 'missing relay token' });

  const expected = p.relay_token_hash;
  const suppliedHash = tokenHash(supplied);
  if (!expected || !timingSafeEqualHex(suppliedHash, expected)) return res.status(401).json({ error: 'invalid relay token' });

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

app.post('/miro/admin/login', rateLimit('admin-login', 20, 60_000), (req, res) => {
  const pw = String(req.body?.password || '');
  const formPw = String(req.query.password || '');
  const provided = pw || formPw;
  if (!ADMIN_PASSWORD || provided !== ADMIN_PASSWORD) {
    audit('admin_login_failed', {}, req);
    return res.status(401).json({ error: 'invalid_admin_password' });
  }
  createAdminSession(res);
  audit('admin_login_success', {}, req);
  if (req.query.redirect === '1') return res.redirect('/miro');
  res.json({ ok: true, message: 'admin session active' });
});

app.post('/miro/admin/logout', (req, res) => {
  clearAdminSession(req, res);
  audit('admin_logout', {}, req);
  if (req.query.redirect === '1') return res.redirect('/miro');
  res.json({ ok: true });
});

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
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Miro MCP Relay</title>
    <style>
      :root { --bg:#0b1020; --card:#151c33; --muted:#9fb0d9; --text:#ecf2ff; --accent:#7aa2ff; --accent2:#6ee7b7; --danger:#f87171; }
      body { margin:0; font-family:Inter,system-ui,Segoe UI,Roboto,sans-serif; background:linear-gradient(160deg,#0b1020,#111936); color:var(--text); }
      .wrap { max-width:980px; margin:32px auto; padding:0 16px; }
      .grid { display:grid; grid-template-columns:1fr; gap:16px; }
      @media (min-width: 900px){ .grid{ grid-template-columns: 1fr 1fr; } }
      .card { background:rgba(21,28,51,.88); border:1px solid #2a3761; border-radius:14px; padding:18px; box-shadow:0 10px 28px rgba(0,0,0,.25); }
      h1 { margin:0 0 8px; font-size:24px; }
      h2 { margin:0 0 10px; font-size:18px; }
      p { color:var(--muted); margin:8px 0 14px; }
      label { display:block; font-size:13px; color:#c8d6ff; margin:8px 0 4px; }
      input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid #38508f; background:#0e1530; color:#fff; }
      .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
      button { border:0; border-radius:10px; padding:10px 14px; color:#fff; cursor:pointer; font-weight:600; }
      .btn-primary { background:linear-gradient(135deg,#4f7fff,#7aa2ff); }
      .btn-danger { background:linear-gradient(135deg,#ef4444,#f87171); }
      .btn-secondary { background:#2c3a67; }
      .hint { font-size:12px; color:#9fb0d9; }
      .result { margin-top:10px; padding:10px; border-radius:10px; background:#0e1530; border:1px dashed #3a4f88; white-space:pre-wrap; word-break:break-word; font-size:12px; }
      code { background:#0e1530; padding:2px 6px; border-radius:8px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Miro MCP Relay</h1>
      <p>Enroll profile, copy token, connect OAuth, and manage deregistration from one page.</p>

      <div class="grid">
        <section class="card">
          <h2>Start Enrollment</h2>
          <p>Creates profile and shows one-time relay token.</p>
          <form method="get" action="/miro/start">
            <label>Display name</label>
            <input name="display_name" placeholder="Network Automation Agent" required />
            <label>Contact (optional)</label>
            <input name="contact" placeholder="user@example.com" />
            <input type="hidden" name="show" value="1" />
            <div class="row">
              <button class="btn-primary" type="submit">Create Profile</button>
            </div>
          </form>
          <div class="hint">Tip: add <code>auto=1</code> if you want direct redirect without preview. If admin gating is enabled, pass <code>?admin_key=...</code> in URL.</div>
        </section>

        <section class="card">
          <h2>Admin Login</h2>
          <p>Login once with admin password (session cookie), then use admin actions.</p>
          <form method="post" action="/miro/admin/login?redirect=1">
            <label>Admin password</label>
            <input name="password" type="password" placeholder="MIRO_ADMIN_PASSWORD" />
            <div class="row">
              <button class="btn-secondary" type="submit">Admin Login</button>
              <button class="btn-secondary" type="button" onclick="doAdminLogout()">Admin Logout</button>
            </div>
          </form>
          <div class="hint">Fallback: admin endpoints still accept <code>X-Admin-Key</code> header.</div>
        </section>

        <section class="card">
          <h2>Deregister / Admin Tools</h2>
          <p>Delete a profile via user relay token, or via admin session/key.</p>
          <label>Profile ID</label>
          <input id="delProfile" placeholder="p_xxxxx" />
          <label>Relay token (X-Relay-Key)</label>
          <input id="delToken" placeholder="one-time relay token" />
          <label>Admin key (optional override)</label>
          <input id="adminKey" placeholder="MIRO_RELAY_ADMIN_KEY" />
          <div class="row">
            <button class="btn-danger" type="button" onclick="doDelete()">Deregister (profile token)</button>
            <button class="btn-danger" type="button" onclick="doAdminDelete()">Deregister (admin)</button>
            <button class="btn-secondary" type="button" onclick="doStatus()">Check Status</button>
            <button class="btn-secondary" type="button" onclick="doListProfiles()">List Profiles (admin)</button>
            <button class="btn-secondary" type="button" onclick="doRotateToken()">Rotate Token (admin)</button>
            <button class="btn-secondary" type="button" onclick="doRevokeOAuth()">Revoke OAuth (admin)</button>
            <button class="btn-secondary" type="button" onclick="doAudit()">Audit Log (admin)</button>
          </div>
          <div id="out" class="result">Ready.</div>
        </section>
      </div>
    </div>

    <script>
      async function doAdminLogout(){
        const out=document.getElementById('out');
        const r=await fetch('/miro/admin/logout',{method:'POST'});
        const t=await r.text();
        out.textContent='ADMIN LOGOUT '+r.status+'\n'+t;
      }
      async function doDelete(){
        const id=document.getElementById('delProfile').value.trim();
        const tk=document.getElementById('delToken').value.trim();
        const out=document.getElementById('out');
        if(!id||!tk){ out.textContent='Please enter profile ID and relay token.'; return; }
        const r=await fetch('/miro/profiles/'+encodeURIComponent(id),{method:'DELETE',headers:{'X-Relay-Key':tk}});
        const t=await r.text();
        out.textContent='DELETE '+r.status+'\n'+t;
      }
      async function doStatus(){
        const id=document.getElementById('delProfile').value.trim();
        const tk=document.getElementById('delToken').value.trim();
        const out=document.getElementById('out');
        if(!id||!tk){ out.textContent='Please enter profile ID and relay token.'; return; }
        const r=await fetch('/miro/status/'+encodeURIComponent(id),{headers:{'X-Relay-Key':tk}});
        const t=await r.text();
        out.textContent='STATUS '+r.status+'\n'+t;
      }
      function adminHeaders(){
        const ak=document.getElementById('adminKey').value.trim();
        return ak ? {'X-Admin-Key':ak} : {};
      }
      async function doAdminDelete(){
        const id=document.getElementById('delProfile').value.trim();
        const out=document.getElementById('out');
        if(!id){ out.textContent='Please enter profile ID.'; return; }
        const r=await fetch('/miro/admin/profiles/'+encodeURIComponent(id),{method:'DELETE',headers:adminHeaders()});
        const t=await r.text();
        out.textContent='ADMIN DELETE '+r.status+'\n'+t;
      }
      async function doListProfiles(){
        const out=document.getElementById('out');
        const r=await fetch('/miro/profiles',{headers:adminHeaders()});
        const t=await r.text();
        out.textContent='LIST '+r.status+'\n'+t;
      }
      async function doRotateToken(){
        const id=document.getElementById('delProfile').value.trim();
        const out=document.getElementById('out');
        if(!id){ out.textContent='Please enter profile ID.'; return; }
        const r=await fetch('/miro/admin/profiles/'+encodeURIComponent(id)+'/rotate-token',{method:'POST',headers:adminHeaders()});
        const t=await r.text();
        out.textContent='ROTATE '+r.status+'\n'+t;
      }
      async function doRevokeOAuth(){
        const id=document.getElementById('delProfile').value.trim();
        const out=document.getElementById('out');
        if(!id){ out.textContent='Please enter profile ID.'; return; }
        const r=await fetch('/miro/admin/profiles/'+encodeURIComponent(id)+'/revoke-oauth',{method:'POST',headers:adminHeaders()});
        const t=await r.text();
        out.textContent='REVOKE '+r.status+'\n'+t;
      }
      async function doAudit(){
        const out=document.getElementById('out');
        const r=await fetch('/miro/admin/audit?lines=80',{headers:adminHeaders()});
        const t=await r.text();
        out.textContent='AUDIT '+r.status+'\n'+t;
      }
    </script>
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
  const safeName = safeText(display_name, 80);
  const safeContact = safeText(contact, 120);
  if (!safeName) throw new Error('display_name is required');
  if (!isValidEmailLike(safeContact)) throw new Error('contact must be a valid email-like value');

  const profileId = newProfileId();
  const relayToken = newRelayToken();

  profiles[profileId] = {
    display_name: safeName,
    contact: safeContact,
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

app.post('/miro/profiles', rateLimit('profiles-create', 20, 60_000), requireAdmin, async (req, res) => {
  try {
    const display_name = String(req.body?.display_name || '').trim();
    const contact = String(req.body?.contact || '').trim();

    if (!display_name) return res.status(400).json({ error: 'display_name is required' });

    const created = await createProfile({ display_name, contact });
    audit('profile_created_admin', { profile_id: created.profile_id, display_name: safeText(display_name, 80) }, req);

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
app.get('/miro/start', rateLimit('start-enroll', 30, 60_000), async (req, res) => {
  try {
    const display_name = safeText(req.query.display_name || 'Miro User', 80) || 'Miro User';
    const contact = safeText(req.query.contact || '', 120);
    const adminKey = String(req.query.admin_key || req.header('x-admin-key') || '');

    if (START_REQUIRE_ADMIN && (!ADMIN_API_KEY || adminKey !== ADMIN_API_KEY)) {
      return res.status(401).type('html').send('<h3>Unauthorized</h3><p>Provide valid admin key via <code>?admin_key=...</code>.</p>');
    }

    const created = await createProfile({ display_name, contact });
    audit('profile_created_start', { profile_id: created.profile_id, display_name }, req);

    // default: always show credentials first so user can store relay token safely
    // optional: set auto=1 to skip preview and redirect immediately
    if (String(req.query.auto || '') !== '1') {
      return res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Profile Created</title>
    <style>
      body{margin:0;font-family:Inter,system-ui,Segoe UI,Roboto,sans-serif;background:linear-gradient(160deg,#0b1020,#111936);color:#ecf2ff}
      .card{max-width:860px;margin:34px auto;padding:20px;background:rgba(21,28,51,.9);border:1px solid #2a3761;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.25)}
      h2{margin-top:0} p{color:#b8c7ea} code{background:#0e1530;padding:4px 8px;border-radius:8px;word-break:break-all}
      .warn{color:#fecaca;background:#3f1d1d;padding:10px 12px;border-radius:10px;border:1px solid #7f1d1d}
      .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      a.btn,button{display:inline-block;text-decoration:none;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
      a.primary{background:linear-gradient(135deg,#4f7fff,#7aa2ff);color:#fff}
      button.secondary{background:#2c3a67;color:#fff}
      .mini{font-size:12px;color:#9fb0d9;margin-top:8px}
    </style>
  </head>
  <body>
    <div class="card">
      <h2>✅ Profile created</h2>
      <p><b>profile_id:</b> <code id="pid">${created.profile_id}</code></p>
      <p><b>relay_token (save now):</b> <code id="rtk">${created.relay_token}</code></p>
      <p><b>mcp_url:</b> <code id="murl">${created.mcp_url}</code></p>
      <p class="warn"><b>Important:</b> relay_token is shown one-time. Save it before continuing.</p>
      <div class="row">
        <button class="secondary" onclick="copyAll()">Copy credentials</button>
        <a class="btn primary" href="${created.auth_url}">Continue to Miro OAuth</a>
      </div>
      <hr style="border-color:#2a3761;margin:18px 0" />
      <h3 style="margin:0 0 8px">Deregister this profile</h3>
      <p style="margin-top:0">If you want to cancel now, you can remove this profile immediately.</p>
      <button class="secondary" onclick="deregister()">Deregister profile now</button>
      <div id="out" class="mini"></div>
    </div>
    <script>
      function copyAll(){
        const text = 'profile_id=${created.profile_id}\\nrelay_token=${created.relay_token}\\nmcp_url=${created.mcp_url}';
        navigator.clipboard.writeText(text).then(()=>{document.getElementById('out').textContent='Credentials copied to clipboard.';});
      }
      async function deregister(){
        const r = await fetch('/miro/profiles/${created.profile_id}', {method:'DELETE', headers:{'X-Relay-Key':'${created.relay_token}'}});
        const t = await r.text();
        document.getElementById('out').textContent = 'DEREGISTER '+r.status+' - '+t;
      }
    </script>
  </body>
</html>`);
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

app.delete('/miro/admin/profiles/:profileId', rateLimit('admin-delete', 40, 60_000), requireAdmin, (req, res) => {
  const id = req.params.profileId;
  if (!profiles[id] || profiles[id].status === 'deleted') {
    return res.status(404).json({ error: 'profile not found' });
  }
  profiles[id] = {
    ...(profiles[id] || {}),
    status: 'deleted',
    updated_at: nowIso()
  };
  delete tokens[id];
  delete clients[id];
  saveAll();
  audit('profile_admin_deregistered', { profile_id: id }, req);
  res.json({ ok: true, message: `profile ${id} admin-deregistered` });
});

app.post('/miro/admin/profiles/:profileId/rotate-token', rateLimit('admin-rotate', 40, 60_000), requireAdmin, (req, res) => {
  const id = req.params.profileId;
  if (!profiles[id] || profiles[id].status === 'deleted') {
    return res.status(404).json({ error: 'profile not found' });
  }
  const relayToken = newRelayToken();
  profiles[id] = {
    ...(profiles[id] || {}),
    relay_token_hash: tokenHash(relayToken),
    updated_at: nowIso()
  };
  saveAll();
  audit('profile_admin_token_rotated', { profile_id: id }, req);
  res.json({ ok: true, profile_id: id, relay_token: relayToken, note: 'Store relay_token now. It is not shown again.' });
});

app.post('/miro/admin/profiles/:profileId/revoke-oauth', rateLimit('admin-revoke', 40, 60_000), requireAdmin, (req, res) => {
  const id = req.params.profileId;
  if (!profiles[id] || profiles[id].status === 'deleted') {
    return res.status(404).json({ error: 'profile not found' });
  }
  delete tokens[id];
  profiles[id] = {
    ...(profiles[id] || {}),
    status: 'revoked',
    updated_at: nowIso()
  };
  saveAll();
  audit('profile_admin_oauth_revoked', { profile_id: id }, req);
  res.json({ ok: true, profile_id: id, message: 'oauth revoked; re-auth required' });
});

app.delete('/miro/profiles/:profileId', rateLimit('self-delete', 40, 60_000), requireProfileToken, (req, res) => {
  const id = req.profileId;
  profiles[id] = {
    ...(profiles[id] || {}),
    status: 'deleted',
    updated_at: nowIso()
  };
  delete tokens[id];
  delete clients[id];
  saveAll();
  audit('profile_self_deregistered', { profile_id: id }, req);
  res.json({ ok: true, message: `profile ${id} deregistered` });
});

app.get('/miro/auth/start', rateLimit('auth-start', 60, 60_000), async (req, res) => {
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
    audit('oauth_success', { profile_id: p.profileId, scope: data.scope || null }, req);

    res.type('html').send(`<h2>✅ Miro auth successful</h2><p>Profile: <b>${p.profileId}</b></p><p>You can close this tab.</p>`);
  } catch (e) {
    audit('oauth_failed', { error: String(e) }, req);
    res.status(500).send(`Auth failed: ${String(e)}`);
  }
});

app.post('/miro/mcp/:profile', requireProfileToken, async (req, res) => {
  const profileId = req.profileId;

  if (breakerIsOpen()) {
    return res.status(503).json({ error: 'upstream_temporarily_unavailable', retry_after_ms: Math.max(0, breaker.openUntil - Date.now()) });
  }

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
    let upstream = null;

    // initial + retry loop for transient failures
    for (let attempt = 0; attempt <= MCP_RETRY_COUNT; attempt++) {
      upstream = await forward(token);

      if (upstream.status === 401) {
        token = await refreshToken(profileId);
        upstream = await forward(token);
      }

      if (upstream.status < 500) break;
      if (attempt < MCP_RETRY_COUNT) await sleep(200 * (attempt + 1));
    }

    if (!upstream) throw new Error('no upstream response');

    if (upstream.status >= 500) {
      breakerMarkFailure();
    } else {
      breakerMarkSuccess();
    }

    audit('mcp_call', {
      profile_id: profileId,
      method: req.body?.method || 'unknown',
      status: upstream.status
    }, req);

    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    breakerMarkFailure();
    audit('mcp_call_failed', { profile_id: profileId, error: String(e) }, req);
    res.status(502).json({ error: String(e) });
  }
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'miro-mcp-relay', time: nowIso() });
});

app.get('/readyz', async (_req, res) => {
  if (breakerIsOpen()) {
    return res.status(503).json({ ok: false, reason: 'circuit_open', retry_after_ms: Math.max(0, breaker.openUntil - Date.now()) });
  }
  try {
    const r = await fetch(`${MCP_BASE}/.well-known/oauth-protected-resource`, { method: 'GET' });
    const ok = [200, 401].includes(r.status);
    if (!ok) return res.status(503).json({ ok: false, reason: 'upstream_unhealthy', status: r.status });
    return res.json({ ok: true, upstream_status: r.status });
  } catch (e) {
    return res.status(503).json({ ok: false, reason: 'upstream_unreachable', error: String(e) });
  }
});

app.get('/miro/admin/audit', requireAdmin, (req, res) => {
  try {
    const lines = Number(req.query.lines || 200);
    const content = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, 'utf8') : '';
    const arr = content.trim() ? content.trim().split('\n') : [];
    const out = arr.slice(-Math.max(1, Math.min(2000, lines))).map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
    res.json({ ok: true, count: out.length, entries: out });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'miro-mcp-relay',
    config: {
      start_require_admin: START_REQUIRE_ADMIN,
      pending_profile_ttl_minutes: PENDING_PROFILE_TTL_MINUTES
    },
    endpoints: {
      ui: '/miro',
      health: '/healthz',
      ready: '/readyz',
      start_enroll: '/miro/start?display_name=...&contact=... (optional: &admin_key=...&show=1)',
      status: '/miro/status',
      create_profile: 'POST /miro/profiles (X-Admin-Key)',
      auth_start: '/miro/auth/start?profile=<profile_id>',
      mcp_proxy: '/miro/mcp/:profile (POST, X-Relay-Key)',
      deregister: 'DELETE /miro/profiles/:profileId (X-Relay-Key of profile)',
      admin_deregister: 'DELETE /miro/admin/profiles/:profileId (X-Admin-Key)',
      admin_rotate_token: 'POST /miro/admin/profiles/:profileId/rotate-token (X-Admin-Key)',
      admin_revoke_oauth: 'POST /miro/admin/profiles/:profileId/revoke-oauth (X-Admin-Key)',
      admin_audit: 'GET /miro/admin/audit?lines=200 (X-Admin-Key)'
    }
  });
});

function cleanupPendingProfiles() {
  const ttlMs = Math.max(1, PENDING_PROFILE_TTL_MINUTES) * 60_000;
  const now = Date.now();
  let removed = 0;

  for (const [id, p] of Object.entries(profiles)) {
    if (!p || p.status === 'deleted' || p.status === 'connected') continue;

    const createdAt = Date.parse(p.created_at || '');
    if (!Number.isFinite(createdAt)) continue;

    if (now - createdAt > ttlMs) {
      delete profiles[id];
      delete tokens[id];
      delete clients[id];
      removed += 1;
    }
  }

  if (removed > 0) {
    saveAll();
    console.log(`cleanup: removed ${removed} expired pending profile(s)`);
  }
}

setInterval(cleanupPendingProfiles, 60_000);

app.listen(PORT, () => {
  console.log(`miro-mcp-relay listening on ${PORT}`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`START_REQUIRE_ADMIN=${START_REQUIRE_ADMIN}`);
  console.log(`PENDING_PROFILE_TTL_MINUTES=${PENDING_PROFILE_TTL_MINUTES}`);
});
