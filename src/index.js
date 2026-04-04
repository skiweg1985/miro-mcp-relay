import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import {
  ACCESS_MODE_DIRECT_TOKEN,
  ACCESS_MODE_RELAY,
  createDefaultMiroProviderApp,
  isProviderAppRelayEnabled,
  normalizeAccessMode,
  normalizeAllowedAccessModes,
  normalizeProviderApp,
  normalizeStringArray,
  validateServiceAccess
} from './platform.js';

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
const PROVIDER_APP_FILE = path.join(DATA_DIR, 'provider-apps.json');
const SERVICE_CLIENT_FILE = path.join(DATA_DIR, 'service-clients.json');
const DELEGATION_FILE = path.join(DATA_DIR, 'delegation-grants.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const RELAY_CALL_FILE = path.join(DATA_DIR, 'relay-calls.log');
const TOKEN_ISSUE_FILE = path.join(DATA_DIR, 'token-issues.log');
const MCP_BASE = 'https://mcp.miro.com';
const BREAKER_FAIL_THRESHOLD = Number(process.env.MIRO_BREAKER_FAIL_THRESHOLD || 5);
const BREAKER_OPEN_MS = Number(process.env.MIRO_BREAKER_OPEN_MS || 30000);
const MCP_RETRY_COUNT = Number(process.env.MIRO_MCP_RETRY_COUNT || 2);
const OAUTH_EMAIL_MODE = String(process.env.MIRO_OAUTH_EMAIL_MODE || 'warn').trim().toLowerCase() === 'strict' ? 'strict' : 'warn';
const OAUTH_SCOPE = String(process.env.MIRO_OAUTH_SCOPE || 'boards:read boards:write').trim() || 'boards:read boards:write';
const MIRO_PROVIDER_ACCESS_MODE = normalizeAccessMode(process.env.MIRO_PROVIDER_ACCESS_MODE || ACCESS_MODE_RELAY, ACCESS_MODE_RELAY);
const MIRO_PROVIDER_ALLOW_RELAY = String(process.env.MIRO_PROVIDER_ALLOW_RELAY || 'true').trim().toLowerCase() !== 'false';
const MIRO_PROVIDER_ALLOW_DIRECT_TOKEN_RETURN = String(process.env.MIRO_PROVIDER_ALLOW_DIRECT_TOKEN_RETURN || 'false').trim().toLowerCase() === 'true';

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

function appendJsonLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function newRelayToken() {
  return b64url(crypto.randomBytes(32));
}

function newOpaqueSecret(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

function newRecordId(prefix) {
  return `${prefix}_${b64url(crypto.randomBytes(12))}`;
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

function canonicalProfileId(value) {
  return String(value || '').trim().toLowerCase().replace(/@/g, '_');
}

function resolveProfileId(value) {
  const raw = String(value || '').trim().toLowerCase();
  const canonical = canonicalProfileId(raw);
  if (profiles[raw]) return raw;
  return canonical;
}

function normalizeEmailProfileId(value) {
  return String(value || '').trim().toLowerCase();
}

function profileIdFromEnrollmentInput({ profile_id, email, contact }) {
  const fromInput = normalizeEmailProfileId(profile_id || email || contact);
  if (!fromInput) throw Object.assign(new Error('email is required'), { status: 400 });
  if (!isValidEmailLike(fromInput)) throw Object.assign(new Error('email must be a valid email address'), { status: 400 });
  return canonicalProfileId(fromInput);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function profileIdToEmail(profileId) {
  const raw = normalizeEmail(profileId);
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  const firstUnderscore = raw.indexOf('_');
  if (firstUnderscore < 1) return '';
  const candidate = `${raw.slice(0, firstUnderscore)}@${raw.slice(firstUnderscore + 1)}`;
  return isValidEmailLike(candidate) ? candidate : '';
}

function expectedProfileEmail(profileId, profile) {
  const contactEmail = normalizeEmail(profile?.contact || '');
  if (isValidEmailLike(contactEmail)) return contactEmail;
  return profileIdToEmail(profileId);
}

function decodeJwtPayload(token) {
  try {
    const raw = String(token || '');
    const parts = raw.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractIdentityFromTokenResponse(tokenData) {
  const claims = decodeJwtPayload(tokenData?.id_token);
  const email = normalizeEmail(claims?.email || claims?.upn || claims?.preferred_username || '');
  const emailVerifiedRaw = claims?.email_verified;
  const emailVerified = typeof emailVerifiedRaw === 'boolean'
    ? emailVerifiedRaw
    : (String(emailVerifiedRaw || '').toLowerCase() === 'true' ? true : null);
  const userId = safeText(claims?.sub || '', 120) || '';
  const userName = safeText(claims?.name || claims?.preferred_username || '', 120) || '';

  return {
    email: isValidEmailLike(email) ? email : '',
    emailVerified,
    userId,
    userName
  };
}

async function fetchMiroTokenContext(accessToken) {
  try {
    const response = await fetch('https://api.miro.com/v1/oauth-token', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return { ok: false, error: `token_context_${response.status}` };
    }

    const data = await response.json();
    return {
      ok: true,
      userId: safeText(data?.user?.id || '', 120) || '',
      userName: safeText(data?.user?.name || '', 120) || ''
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderExperienceDots(total = 3, activeIndex = 0) {
  const dots = Array.from({ length: total }, (_value, index) => {
    const stateClass = index === activeIndex ? ' is-active' : (index < activeIndex ? ' is-complete' : '');
    return `<span class="experience-dot${stateClass}"></span>`;
  }).join('');

  return `<div class="experience-progress" aria-hidden="true">${dots}</div>`;
}

function renderExperiencePage({
  title,
  body,
  script = ''
}) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg:#f3f3f1;
        --panel:rgba(255,255,255,.3);
        --panel-strong:rgba(255,255,255,.46);
        --panel-soft:rgba(255,255,255,.18);
        --line:rgba(255,255,255,.56);
        --line-soft:rgba(0,0,0,.08);
        --text:rgba(8,8,8,.96);
        --muted:rgba(8,8,8,.52);
        --shadow:0 32px 120px rgba(0,0,0,.16);
        --shadow-soft:0 18px 48px rgba(0,0,0,.1);
        --ease:cubic-bezier(.22, 1, .36, 1);
      }
      * { box-sizing:border-box; }
      html, body { min-height:100%; }
      body {
        margin:0;
        color:var(--text);
        font-family:"SF Pro Display","SF Pro Text","Inter","Helvetica Neue",sans-serif;
        background:
          radial-gradient(circle at 18% 14%, rgba(255,255,255,.92), transparent 28%),
          radial-gradient(circle at 82% 12%, rgba(0,0,0,.09), transparent 22%),
          radial-gradient(circle at 50% 108%, rgba(0,0,0,.08), transparent 32%),
          linear-gradient(180deg, #fafaf9 0%, #ececea 100%);
        overflow-x:hidden;
      }
      body::before,
      body::after {
        content:'';
        position:fixed;
        inset:auto;
        pointer-events:none;
        border-radius:999px;
        filter:blur(88px);
        opacity:.85;
        z-index:0;
      }
      body::before {
        width:32vw;
        height:32vw;
        min-width:240px;
        min-height:240px;
        top:-8vw;
        left:-10vw;
        background:rgba(255,255,255,.88);
      }
      body::after {
        width:28vw;
        height:28vw;
        min-width:220px;
        min-height:220px;
        right:-6vw;
        bottom:-10vw;
        background:rgba(0,0,0,.08);
      }
      a,
      button,
      input,
      textarea {
        font:inherit;
      }
      code,
      .mono {
        font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .experience-root {
        position:relative;
        z-index:1;
        min-height:100vh;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
      }
      .experience-stage {
        position:relative;
        width:min(100%, 960px);
        min-height:min(86vh, 860px);
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .experience-atmosphere,
      .experience-atmosphere::before,
      .experience-atmosphere::after {
        position:absolute;
        inset:auto;
        border-radius:999px;
        pointer-events:none;
        filter:blur(70px);
        transition:transform 1.1s var(--ease), opacity 1.1s var(--ease);
      }
      .experience-atmosphere {
        width:30vw;
        height:30vw;
        min-width:220px;
        min-height:220px;
        top:4%;
        right:5%;
        background:rgba(255,255,255,.66);
      }
      .experience-atmosphere::before,
      .experience-atmosphere::after {
        content:'';
      }
      .experience-atmosphere::before {
        width:18vw;
        height:18vw;
        min-width:150px;
        min-height:150px;
        left:-38%;
        top:34%;
        background:rgba(0,0,0,.06);
      }
      .experience-atmosphere::after {
        width:14vw;
        height:14vw;
        min-width:120px;
        min-height:120px;
        right:10%;
        bottom:-18%;
        background:rgba(255,255,255,.52);
      }
      .experience-surface {
        position:relative;
        width:100%;
        min-height:min(86vh, 860px);
        border-radius:44px;
        border:1px solid var(--line);
        background:
          linear-gradient(180deg, rgba(255,255,255,.48), rgba(255,255,255,.2)),
          rgba(255,255,255,.14);
        backdrop-filter:blur(34px);
        -webkit-backdrop-filter:blur(34px);
        box-shadow:var(--shadow), inset 0 1px 0 rgba(255,255,255,.92);
        overflow:hidden;
      }
      .experience-surface::before {
        content:'';
        position:absolute;
        inset:0;
        background:linear-gradient(180deg, rgba(255,255,255,.56), transparent 28%);
        pointer-events:none;
      }
      .experience-progress {
        position:absolute;
        top:30px;
        left:50%;
        transform:translateX(-50%);
        display:flex;
        gap:10px;
        z-index:2;
      }
      .experience-dot {
        width:8px;
        height:8px;
        border-radius:999px;
        background:rgba(0,0,0,.14);
        transform:scale(.9);
        transition:transform .7s var(--ease), background .7s var(--ease), opacity .7s var(--ease);
      }
      .experience-dot.is-active {
        background:rgba(0,0,0,.92);
        transform:scale(1.35);
      }
      .experience-dot.is-complete {
        background:rgba(0,0,0,.34);
      }
      .experience-viewport {
        position:relative;
        overflow:hidden;
        min-height:min(86vh, 860px);
      }
      .experience-track {
        display:flex;
        min-height:min(86vh, 860px);
        width:100%;
        will-change:transform;
        transition:transform .9s var(--ease);
      }
      .experience-step {
        flex:0 0 100%;
        min-height:min(86vh, 860px);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:92px 44px 44px;
        opacity:.24;
        transform:translate3d(0, 0, 0) scale(.98);
        filter:blur(18px);
        transition:opacity .9s var(--ease), transform .9s var(--ease), filter .9s var(--ease);
      }
      .experience-step.is-active {
        opacity:1;
        transform:translate3d(0, 0, 0) scale(1);
        filter:blur(0);
      }
      .experience-step.is-adjacent {
        opacity:.42;
        transform:translate3d(0, 0, 0) scale(.985);
        filter:blur(8px);
      }
      .experience-step-static {
        min-height:min(86vh, 860px);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:92px 44px 44px;
      }
      .experience-copy {
        width:min(100%, 620px);
        display:grid;
        justify-items:center;
        text-align:center;
        gap:22px;
      }
      .experience-copy h1 {
        margin:0;
        font-size:clamp(48px, 9vw, 92px);
        line-height:.92;
        letter-spacing:-.085em;
        font-weight:600;
      }
      .experience-copy p {
        margin:0;
        max-width:30ch;
        color:var(--muted);
        font-size:clamp(16px, 2.4vw, 20px);
        line-height:1.45;
        letter-spacing:-.02em;
      }
      .experience-control {
        width:min(100%, 440px);
      }
      .experience-button,
      .experience-link-button {
        width:100%;
        min-height:64px;
        border:none;
        border-radius:999px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:18px 28px;
        text-decoration:none;
        background:rgba(10,10,10,.94);
        color:rgba(255,255,255,.96);
        box-shadow:0 20px 60px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.14);
        transition:transform .45s var(--ease), box-shadow .45s var(--ease), background .45s var(--ease), filter .45s var(--ease);
        cursor:pointer;
      }
      .experience-button:hover,
      .experience-link-button:hover {
        transform:translateY(-2px) scale(1.01);
        background:rgba(0,0,0,.98);
        box-shadow:0 24px 70px rgba(0,0,0,.22), 0 0 34px rgba(255,255,255,.12), inset 0 1px 0 rgba(255,255,255,.18);
      }
      .experience-button:active,
      .experience-link-button:active {
        transform:translateY(0) scale(.995);
      }
      .experience-input {
        width:100%;
        height:74px;
        padding:0 26px;
        border:none;
        border-radius:999px;
        text-align:center;
        color:var(--text);
        background:rgba(255,255,255,.42);
        border:1px solid rgba(255,255,255,.68);
        box-shadow:var(--shadow-soft), inset 0 1px 0 rgba(255,255,255,.92);
        backdrop-filter:blur(28px);
        -webkit-backdrop-filter:blur(28px);
        font-size:clamp(22px, 3.6vw, 32px);
        letter-spacing:-.045em;
        transition:border-color .4s var(--ease), box-shadow .4s var(--ease), background .4s var(--ease), transform .4s var(--ease);
      }
      .experience-input::placeholder {
        color:rgba(8,8,8,.28);
      }
      .experience-input:focus {
        outline:none;
        background:rgba(255,255,255,.6);
        border-color:rgba(255,255,255,.84);
        transform:translateY(-1px) scale(1.002);
        box-shadow:0 24px 70px rgba(0,0,0,.14), 0 0 24px rgba(255,255,255,.28), inset 0 1px 0 rgba(255,255,255,.98);
      }
      .experience-output {
        width:min(100%, 560px);
        min-height:236px;
        padding:24px 22px;
        border-radius:30px;
        border:1px solid rgba(255,255,255,.62);
        background:rgba(255,255,255,.3);
        color:var(--text);
        font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size:14px;
        line-height:1.6;
        resize:none;
        box-shadow:var(--shadow-soft), inset 0 1px 0 rgba(255,255,255,.92);
        backdrop-filter:blur(28px);
        -webkit-backdrop-filter:blur(28px);
        transition:transform .4s var(--ease), box-shadow .4s var(--ease), background .4s var(--ease);
      }
      .experience-output:hover,
      .experience-output:focus {
        outline:none;
        transform:translateY(-1px);
        background:rgba(255,255,255,.4);
        box-shadow:0 24px 70px rgba(0,0,0,.14), 0 0 30px rgba(255,255,255,.16), inset 0 1px 0 rgba(255,255,255,.96);
      }
      .experience-details {
        width:min(100%, 560px);
        border-radius:26px;
        border:1px solid rgba(255,255,255,.52);
        background:rgba(255,255,255,.16);
        backdrop-filter:blur(24px);
        -webkit-backdrop-filter:blur(24px);
        overflow:hidden;
      }
      .experience-details summary {
        cursor:pointer;
        list-style:none;
        padding:18px 22px;
        color:var(--muted);
        text-align:left;
      }
      .experience-details summary::-webkit-details-marker {
        display:none;
      }
      .experience-details-body {
        padding:0 18px 18px;
        display:grid;
        gap:14px;
      }
      .experience-meta {
        color:var(--muted);
        font-size:13px;
        line-height:1.5;
        text-align:left;
      }
      .experience-single-control {
        width:min(100%, 560px);
      }
      .experience-ghost {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:100%;
        min-height:60px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.58);
        background:rgba(255,255,255,.18);
        color:var(--text);
        text-decoration:none;
        backdrop-filter:blur(24px);
        -webkit-backdrop-filter:blur(24px);
        transition:transform .45s var(--ease), background .45s var(--ease), box-shadow .45s var(--ease);
      }
      .experience-ghost:hover {
        transform:translateY(-2px);
        background:rgba(255,255,255,.28);
        box-shadow:0 18px 44px rgba(0,0,0,.1);
      }
      @media (max-width: 720px) {
        .experience-root {
          padding:14px;
        }
        .experience-stage,
        .experience-surface,
        .experience-viewport,
        .experience-track,
        .experience-step,
        .experience-step-static {
          min-height:calc(100vh - 28px);
        }
        .experience-surface {
          border-radius:34px;
        }
        .experience-step,
        .experience-step-static {
          padding:84px 24px 28px;
        }
        .experience-progress {
          top:24px;
        }
        .experience-copy {
          width:100%;
        }
        .experience-copy h1 {
          font-size:clamp(42px, 15vw, 68px);
        }
        .experience-input {
          height:68px;
          font-size:24px;
        }
        .experience-output {
          min-height:220px;
          font-size:13px;
        }
      }
    </style>
  </head>
  <body>
    <main class="experience-root">
      ${body}
    </main>
    ${script ? `<script>${script}</script>` : ''}
  </body>
</html>`;
}

function renderOnboardingStep({
  index,
  title = '',
  subtitle = '',
  control = ''
}) {
  return `
    <section class="experience-step${index === 0 ? ' is-active' : ''}" data-step="${index}" aria-hidden="${index === 0 ? 'false' : 'true'}">
      <div class="experience-copy">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        <div class="experience-control">${control}</div>
      </div>
    </section>`;
}

function renderOnboardingExperiencePage({ adminKey = '' } = {}) {
  const hiddenAdminInput = adminKey ? `<input type="hidden" name="admin_key" value="${escapeHtml(adminKey)}" />` : '';

  return renderExperiencePage({
    title: 'Connect - Miro Relay',
    body: `
      <section class="experience-stage">
        <div id="experienceAtmosphere" class="experience-atmosphere"></div>
        <div class="experience-surface">
          ${renderExperienceDots(3, 0)}
          <div id="experienceViewport" class="experience-viewport">
            <div id="experienceTrack" class="experience-track">
              ${renderOnboardingStep({
                index: 0,
                title: 'Connect Miro',
                subtitle: 'A short, quiet setup.',
                control: '<button id="wizardBegin" class="experience-button" type="button">Begin</button>'
              })}
              ${renderOnboardingStep({
                index: 1,
                title: 'Your email',
                subtitle: 'Press return when it feels right.',
                control: `
                  <form id="wizardEmailForm" novalidate>
                    <input id="wizardEmail" class="experience-input" type="email" inputmode="email" autocomplete="email" placeholder="name@company.com" aria-label="Email" />
                  </form>`
              })}
              ${renderOnboardingStep({
                index: 2,
                title: 'Miro opens next',
                subtitle: 'We will use your email.',
                control: `
                  <form id="wizardContinueForm" method="get" action="/miro/start">
                    ${hiddenAdminInput}
                    <input id="wizardEmailSubmit" type="hidden" name="email" value="" />
                    <button class="experience-button" type="submit">Continue to Miro</button>
                  </form>`
              })}
            </div>
          </div>
        </div>
      </section>`,
    script: `
      const WIZARD_TOTAL_STEPS = 3;
      const WIZARD_STORAGE_KEY = 'miroRelayWizardEmail';
      const wizardState = {
        current: 0,
        touchStartX: null,
        email: '',
        emailError: false
      };

      const wizardElements = {
        atmosphere: document.getElementById('experienceAtmosphere'),
        viewport: document.getElementById('experienceViewport'),
        track: document.getElementById('experienceTrack'),
        steps: Array.from(document.querySelectorAll('.experience-step')),
        dots: Array.from(document.querySelectorAll('.experience-dot')),
        begin: document.getElementById('wizardBegin'),
        emailForm: document.getElementById('wizardEmailForm'),
        email: document.getElementById('wizardEmail'),
        continueForm: document.getElementById('wizardContinueForm'),
        submitEmail: document.getElementById('wizardEmailSubmit')
      };

      function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
      }

      function isValidEmail(value) {
        return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizeEmail(value));
      }

      function syncEmail() {
        wizardState.email = normalizeEmail(wizardElements.email.value);
        wizardState.emailError = false;
        wizardElements.submitEmail.value = wizardState.email;
        try {
          if (wizardState.email) {
            window.sessionStorage.setItem(WIZARD_STORAGE_KEY, wizardState.email);
          } else {
            window.sessionStorage.removeItem(WIZARD_STORAGE_KEY);
          }
        } catch (_error) {}
      }

      function stepSubtitle(index) {
        if (index === 1) {
          return wizardState.emailError ? 'Use a real email.' : 'Press return when it feels right.';
        }
        if (index === 2) {
          return wizardState.email ? ('Using ' + wizardState.email) : 'We will use your email.';
        }
        return 'A short, quiet setup.';
      }

      function syncStepUI() {
        wizardElements.track.style.transform = 'translate3d(-' + (wizardState.current * 100) + '%, 0, 0)';
        wizardElements.steps.forEach(function(step, index) {
          const subtitle = step.querySelector('p');
          step.classList.toggle('is-active', index === wizardState.current);
          step.classList.toggle('is-adjacent', Math.abs(index - wizardState.current) === 1);
          step.setAttribute('aria-hidden', index === wizardState.current ? 'false' : 'true');
          if ((index === 1 || index === 2) && subtitle) {
            subtitle.textContent = stepSubtitle(index);
          }
        });
        wizardElements.dots.forEach(function(dot, index) {
          dot.classList.toggle('is-active', index === wizardState.current);
          dot.classList.toggle('is-complete', index < wizardState.current);
        });
        if (wizardState.current === 1) {
          window.setTimeout(function () {
            wizardElements.email.focus();
            wizardElements.email.select();
          }, 140);
        }
      }

      function goToStep(index) {
        wizardState.current = Math.max(0, Math.min(WIZARD_TOTAL_STEPS - 1, index));
        syncStepUI();
      }

      function nextStep() {
        if (wizardState.current === 1) {
          syncEmail();
          if (!isValidEmail(wizardState.email)) {
            wizardState.emailError = true;
            syncStepUI();
            wizardElements.email.focus();
            wizardElements.email.select();
            return;
          }
        }
        if (wizardState.current < WIZARD_TOTAL_STEPS - 1) {
          goToStep(wizardState.current + 1);
        }
      }

      function previousStep() {
        if (wizardState.current > 0) goToStep(wizardState.current - 1);
      }

      function handleTouchStart(event) {
        const point = event.changedTouches ? event.changedTouches[0] : event;
        wizardState.touchStartX = point.clientX;
      }

      function handleTouchEnd(event) {
        if (wizardState.touchStartX === null) return;
        const point = event.changedTouches ? event.changedTouches[0] : event;
        const deltaX = point.clientX - wizardState.touchStartX;
        wizardState.touchStartX = null;
        if (Math.abs(deltaX) < 64) return;
        if (deltaX < 0) nextStep();
        else previousStep();
      }

      function handlePointerMove(event) {
        if (!wizardElements.atmosphere) return;
        const bounds = document.body.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) - 0.5;
        const y = ((event.clientY - bounds.top) / bounds.height) - 0.5;
        wizardElements.atmosphere.style.transform = 'translate3d(' + (x * 18) + 'px,' + (y * 18) + 'px,0)';
      }

      wizardElements.begin.addEventListener('click', function () {
        goToStep(1);
      });

      wizardElements.email.addEventListener('input', syncEmail);
      wizardElements.emailForm.addEventListener('submit', function (event) {
        event.preventDefault();
        nextStep();
      });

      wizardElements.continueForm.addEventListener('submit', function (event) {
        syncEmail();
        if (!isValidEmail(wizardState.email)) {
          event.preventDefault();
          wizardState.emailError = true;
          goToStep(1);
          syncStepUI();
          wizardElements.email.focus();
          wizardElements.email.select();
        }
      });

      window.addEventListener('keydown', function (event) {
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          nextStep();
        } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault();
          previousStep();
        }
      });

      wizardElements.viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
      wizardElements.viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
      wizardElements.viewport.addEventListener('pointerdown', handleTouchStart, { passive: true });
      wizardElements.viewport.addEventListener('pointerup', handleTouchEnd, { passive: true });
      window.addEventListener('pointermove', handlePointerMove, { passive: true });

      try {
        const rememberedEmail = normalizeEmail(window.sessionStorage.getItem(WIZARD_STORAGE_KEY) || '');
        if (rememberedEmail) wizardElements.email.value = rememberedEmail;
      } catch (_error) {}

      syncEmail();
      syncStepUI();
    `
  });
}

function renderOnboardingMessagePage({
  title,
  heading,
  subtitle = '',
  actionHref = '/miro',
  actionLabel = 'Continue',
  detailsHtml = '',
  progressIndex = 0
}) {
  return renderExperiencePage({
    title,
    body: `
      <section class="experience-stage">
        <div class="experience-atmosphere"></div>
        <div class="experience-surface">
          ${renderExperienceDots(3, progressIndex)}
          <div class="experience-step-static">
            <div class="experience-copy">
              <h1>${escapeHtml(heading)}</h1>
              ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
              <div class="experience-control">
                <a class="experience-link-button" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>
              </div>
              ${detailsHtml ? `
                <details class="experience-details">
                  <summary>More</summary>
                  <div class="experience-details-body">${detailsHtml}</div>
                </details>` : ''}
            </div>
          </div>
        </div>
      </section>`
  });
}

function renderConfigScenePage({
  mcpConfigJson,
  credentialsBundle,
  emailStateLabel = ''
}) {
  return renderExperiencePage({
    title: 'Connection Ready - Miro Relay',
    body: `
      <section class="experience-stage">
        <div class="experience-atmosphere"></div>
        <div class="experience-surface">
          ${renderExperienceDots(3, 2)}
          <div class="experience-step-static">
            <div class="experience-copy">
              <h1>Your connection is ready</h1>
              <p id="copyStatus">Tap the config to copy.</p>
              <textarea id="mcpConfig" class="experience-output" readonly>${escapeHtml(mcpConfigJson)}</textarea>
              <details class="experience-details">
                <summary>Recovery</summary>
                <div class="experience-details-body">
                  <textarea id="bundle" class="experience-output" style="min-height:172px" readonly>${escapeHtml(credentialsBundle)}</textarea>
                  ${emailStateLabel ? `<div class="experience-meta">${escapeHtml(emailStateLabel)}</div>` : ''}
                </div>
              </details>
            </div>
          </div>
        </div>
      </section>`,
    script: `
      async function copyValue(id, successMessage, fallbackMessage) {
        const field = document.getElementById(id);
        const status = document.getElementById('copyStatus');
        const value = field.value;
        try {
          await navigator.clipboard.writeText(value);
          status.textContent = successMessage;
          return;
        } catch (_error) {}
        field.focus();
        field.select();
        status.textContent = fallbackMessage;
      }

      document.getElementById('mcpConfig').addEventListener('click', function () {
        copyValue('mcpConfig', 'Config copied.', 'Copy is ready. Press Ctrl/Cmd+C.');
      });

      document.getElementById('bundle').addEventListener('click', function () {
        copyValue('bundle', 'Recovery bundle copied.', 'Recovery bundle selected. Press Ctrl/Cmd+C.');
      });
    `
  });
}

function renderReconnectScenePage({ emailStateLabel = '' } = {}) {
  return renderExperiencePage({
    title: 'Connected Again - Miro Relay',
    body: `
      <section class="experience-stage">
        <div class="experience-atmosphere"></div>
        <div class="experience-surface">
          ${renderExperienceDots(3, 2)}
          <div class="experience-step-static">
            <div class="experience-copy">
              <h1>Connected again</h1>
              <p>${escapeHtml(emailStateLabel || 'You can close this now.')}</p>
              <div class="experience-single-control">
                <a class="experience-link-button" href="/miro">Finish</a>
              </div>
            </div>
          </div>
        </div>
      </section>`
  });
}

const DEFAULT_NAV_ITEMS = [
  { id: 'home', href: '/miro', label: 'Home' },
  { id: 'start', href: '/miro/start', label: 'Connect' },
  { id: 'workspace', href: '/miro/workspace', label: 'My connection' },
  { id: 'admin', href: '/miro/admin', label: 'Admin' }
];

function renderNav(active = 'home', items = DEFAULT_NAV_ITEMS) {
  if (!items.length) return '';

  return items.map((item) => {
    const activeClass = item.id === active ? ' active' : '';
    return `<a class="nav-link${activeClass}" href="${item.href}">${escapeHtml(item.label)}</a>`;
  }).join('');
}

function renderLinkActions(actions = []) {
  if (!actions.length) return '';
  const html = actions.map((action) => {
    const variant = action.variant === 'secondary' ? 'secondary' : (action.variant === 'ghost' ? 'ghost' : 'primary');
    const extraClass = action.className ? ` ${action.className}` : '';
    return `<a class="button ${variant}${extraClass}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
  }).join('');
  return `<div class="actions">${html}</div>`;
}

function renderTechnicalDetails(title, bodyHtml) {
  if (!bodyHtml) return '';
  return `<details class="details"><summary>${escapeHtml(title)}</summary>${bodyHtml}</details>`;
}

function renderUiPage({
  title,
  activeNav = 'home',
  eyebrow = '',
  heading = '',
  subtitle = '',
  body = '',
  script = '',
  pageClass = '',
  navItems = DEFAULT_NAV_ITEMS
}) {
  const hero = heading ? `
      <section class="hero">
        ${eyebrow ? `<div class="eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
        <h1>${escapeHtml(heading)}</h1>
        ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
      </section>` : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg:#fafafa;
        --bg-deep:#f1f1f1;
        --bg-soft:rgba(255,255,255,.72);
        --panel:rgba(255,255,255,.78);
        --panel-strong:rgba(255,255,255,.9);
        --panel-soft:rgba(255,255,255,.58);
        --line:rgba(0,0,0,.08);
        --line-strong:rgba(0,0,0,.16);
        --text:rgba(10,10,10,.94);
        --muted:rgba(10,10,10,.5);
        --muted-strong:rgba(10,10,10,.68);
        --shadow:0 30px 120px rgba(0,0,0,.12);
        --shadow-soft:0 14px 48px rgba(0,0,0,.08);
        --blur:28px;
        --wizard-ease:cubic-bezier(.22, 1, .36, 1);
      }
      * { box-sizing:border-box; }
      body {
        margin:0;
        font-family:'Space Grotesk','Avenir Next','Helvetica Neue',sans-serif;
        color:var(--text);
        background:
          radial-gradient(circle at 16% 20%, rgba(0,0,0,.06), transparent 20%),
          radial-gradient(circle at 86% 16%, rgba(0,0,0,.04), transparent 24%),
          radial-gradient(circle at 50% 120%, rgba(0,0,0,.05), transparent 34%),
          linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(243,243,243,1) 100%);
        min-height:100vh;
        overflow-x:hidden;
      }
      body::before,
      body::after {
        content:'';
        position:fixed;
        inset:auto;
        pointer-events:none;
        z-index:0;
        filter:blur(72px);
        opacity:.66;
      }
      body::before {
        width:34vw;
        height:34vw;
        min-width:260px;
        min-height:260px;
        top:-8vw;
        left:-6vw;
        border-radius:999px;
        background:rgba(0,0,0,.08);
      }
      body::after {
        width:28vw;
        height:28vw;
        min-width:220px;
        min-height:220px;
        right:-4vw;
        bottom:-8vw;
        border-radius:999px;
        background:rgba(0,0,0,.06);
      }
      a { color:inherit; }
      .shell {
        position:relative;
        z-index:1;
        max-width:1240px;
        margin:0 auto;
        padding:24px 20px 40px;
      }
      .topbar {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:16px;
        margin-bottom:28px;
        flex-wrap:wrap;
      }
      .topbar.minimal {
        justify-content:flex-start;
        margin-bottom:16px;
      }
      .brand {
        display:inline-flex;
        align-items:center;
        gap:12px;
        text-decoration:none;
        font-weight:700;
        color:var(--text);
      }
      .brand-mark {
        width:38px;
        height:38px;
        border-radius:14px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        background:rgba(255,255,255,.6);
        border:1px solid var(--line);
        backdrop-filter:blur(var(--blur));
        -webkit-backdrop-filter:blur(var(--blur));
        box-shadow:var(--shadow-soft), inset 0 1px 0 rgba(255,255,255,.86);
        font-size:18px;
      }
      .brand-copy { display:flex; flex-direction:column; line-height:1.05; }
      .brand-copy small { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
      .nav {
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      }
      .nav-link {
        text-decoration:none;
        padding:10px 14px;
        border-radius:999px;
        border:1px solid var(--line);
        color:var(--muted);
        background:rgba(255,255,255,.46);
        backdrop-filter:blur(calc(var(--blur) * .8));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .8));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.9);
        transition:transform .4s var(--wizard-ease), background .4s var(--wizard-ease), border-color .4s var(--wizard-ease), color .4s var(--wizard-ease), box-shadow .4s var(--wizard-ease);
      }
      .nav-link:hover {
        transform:translateY(-1px);
        border-color:var(--line-strong);
        color:var(--text);
        box-shadow:0 0 0 1px rgba(255,255,255,.8), 0 14px 34px rgba(0,0,0,.08);
      }
      .nav-link.active {
        background:rgba(10,10,10,.92);
        color:rgba(255,255,255,.96);
        border-color:rgba(10,10,10,.92);
        box-shadow:0 0 0 1px rgba(255,255,255,.8), 0 16px 42px rgba(0,0,0,.12);
      }
      .page.narrow { max-width:860px; }
      .page.wizard-page {
        display:flex;
        align-items:center;
        min-height:calc(100vh - 132px);
      }
      .hero { margin-bottom:28px; }
      .eyebrow {
        font-size:11px;
        letter-spacing:.18em;
        text-transform:uppercase;
        color:var(--muted);
        margin-bottom:10px;
      }
      h1 {
        margin:0 0 10px;
        font-size:clamp(34px, 4vw, 56px);
        line-height:1;
        letter-spacing:-.04em;
        font-weight:650;
      }
      .subtitle {
        margin:0;
        max-width:820px;
        color:var(--muted);
        font-size:16px;
        line-height:1.6;
      }
      .grid {
        display:grid;
        gap:18px;
      }
      .grid.two { grid-template-columns:repeat(2, minmax(0, 1fr)); }
      .grid.sidebar { grid-template-columns:minmax(0, 1.15fr) minmax(280px, .85fr); }
      .card {
        position:relative;
        background:linear-gradient(180deg, rgba(255,255,255,.84), rgba(255,255,255,.62));
        border:1px solid rgba(255,255,255,.82);
        border-radius:30px;
        padding:24px;
        box-shadow:var(--shadow), inset 0 1px 0 rgba(255,255,255,.92);
        backdrop-filter:blur(var(--blur));
        -webkit-backdrop-filter:blur(var(--blur));
        overflow:hidden;
      }
      .card::before {
        content:'';
        position:absolute;
        inset:0;
        border-radius:inherit;
        pointer-events:none;
        background:linear-gradient(180deg, rgba(255,255,255,.9), transparent 34%);
        opacity:.72;
      }
      .card.soft { background:linear-gradient(180deg, rgba(255,255,255,.76), rgba(255,255,255,.52)); }
      .card.flat { box-shadow:none; }
      .kicker {
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding:7px 11px;
        border-radius:999px;
        background:rgba(255,255,255,.58);
        border:1px solid rgba(255,255,255,.82);
        color:var(--muted);
        font-size:12px;
        margin-bottom:14px;
        backdrop-filter:blur(calc(var(--blur) * .7));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .7));
      }
      h2, h3 { margin:0 0 10px; letter-spacing:-.03em; }
      p { margin:8px 0 14px; color:var(--muted); line-height:1.6; }
      ul.step-list {
        list-style:none;
        padding:0;
        margin:16px 0 0;
        display:grid;
        gap:10px;
      }
      ul.step-list li {
        display:flex;
        gap:12px;
        align-items:flex-start;
        padding:12px 14px;
        border-radius:16px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.5);
        color:var(--text);
        backdrop-filter:blur(calc(var(--blur) * .7));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .7));
      }
      .step-number {
        min-width:28px;
        height:28px;
        border-radius:999px;
        background:rgba(10,10,10,.92);
        color:rgba(255,255,255,.96);
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-size:13px;
        font-weight:700;
        border:1px solid rgba(10,10,10,.08);
      }
      label {
        display:block;
        font-size:12px;
        letter-spacing:.08em;
        text-transform:uppercase;
        color:var(--muted);
        margin:12px 0 6px;
      }
      input, textarea {
        width:100%;
        border-radius:16px;
        border:1px solid rgba(0,0,0,.08);
        background:rgba(255,255,255,.74);
        color:var(--text);
        padding:13px 14px;
        font:inherit;
        backdrop-filter:blur(calc(var(--blur) * .8));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .8));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.92);
        transition:border-color .35s var(--wizard-ease), box-shadow .35s var(--wizard-ease), background .35s var(--wizard-ease), transform .35s var(--wizard-ease);
      }
      input::placeholder, textarea::placeholder { color:rgba(10,10,10,.32); }
      input:focus, textarea:focus {
        outline:none;
        border-color:rgba(0,0,0,.14);
        background:rgba(255,255,255,.94);
        box-shadow:0 0 0 1px rgba(255,255,255,.92), 0 18px 40px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.96);
        transform:translateY(-1px);
      }
      textarea { min-height:118px; resize:vertical; }
      code, .mono {
        font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
      }
      code {
        background:rgba(255,255,255,.72);
        border:1px solid rgba(0,0,0,.08);
        border-radius:10px;
        padding:2px 7px;
        word-break:break-word;
      }
      .actions {
        display:flex;
        flex-wrap:wrap;
        gap:10px;
        margin-top:14px;
      }
      .button {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:8px;
        border-radius:14px;
        padding:12px 16px;
        border:1px solid rgba(0,0,0,.1);
        text-decoration:none;
        font-weight:700;
        cursor:pointer;
        transition:transform .45s var(--wizard-ease), background .45s var(--wizard-ease), border-color .45s var(--wizard-ease), box-shadow .45s var(--wizard-ease), opacity .45s var(--wizard-ease);
        backdrop-filter:blur(calc(var(--blur) * .7));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .7));
      }
      button.button { font:inherit; }
      .button.primary {
        background:rgba(10,10,10,.94);
        color:rgba(255,255,255,.96);
        border-color:rgba(10,10,10,.94);
        box-shadow:0 18px 42px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.12);
      }
      .button.secondary {
        background:rgba(255,255,255,.68);
        color:var(--text);
        border-color:rgba(0,0,0,.08);
      }
      .button.ghost {
        background:rgba(255,255,255,.44);
        color:var(--muted);
        border-color:rgba(0,0,0,.06);
      }
      .button:hover {
        transform:translateY(-2px) scale(1.005);
        box-shadow:0 20px 46px rgba(0,0,0,.1), 0 0 0 1px rgba(255,255,255,.88), inset 0 1px 0 rgba(255,255,255,.94);
      }
      .button:active {
        transform:translateY(0) scale(.995);
      }
      .hint {
        font-size:13px;
        color:var(--muted);
      }
      .callout {
        border-radius:18px;
        padding:14px 16px;
        border:1px solid rgba(0,0,0,.08);
        background:rgba(255,255,255,.66);
        color:var(--text);
        backdrop-filter:blur(calc(var(--blur) * .9));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .9));
      }
      .callout strong { display:block; margin-bottom:6px; }
      .callout.ok { background:rgba(255,255,255,.74); border-color:rgba(0,0,0,.08); }
      .callout.warn { background:rgba(255,255,255,.68); border-color:rgba(0,0,0,.08); }
      .callout.danger { background:rgba(255,255,255,.62); border-color:rgba(0,0,0,.08); color:var(--text); }
      .pill {
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding:7px 11px;
        border-radius:999px;
        font-size:12px;
        font-weight:700;
        border:1px solid rgba(0,0,0,.08);
        background:rgba(255,255,255,.66);
      }
      .pill.ok { background:rgba(10,10,10,.92); border-color:rgba(10,10,10,.92); color:rgba(255,255,255,.96); }
      .pill.warn { background:rgba(255,255,255,.66); border-color:rgba(0,0,0,.08); color:var(--muted-strong); }
      .pill.danger { background:rgba(255,255,255,.62); border-color:rgba(0,0,0,.08); color:var(--muted-strong); }
      .pill.neutral { background:rgba(255,255,255,.56); border-color:rgba(0,0,0,.06); color:var(--muted); }
      .details {
        margin-top:16px;
        border-radius:18px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.56);
        overflow:hidden;
        backdrop-filter:blur(calc(var(--blur) * .85));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .85));
      }
      .details summary {
        cursor:pointer;
        padding:14px 16px;
        font-weight:700;
      }
      .details-body {
        padding:0 16px 16px;
      }
      .stack > * + * { margin-top:14px; }
      .stats {
        display:grid;
        grid-template-columns:repeat(3, minmax(0, 1fr));
        gap:12px;
      }
      .stat {
        padding:14px;
        border-radius:18px;
        background:rgba(255,255,255,.64);
        border:1px solid rgba(0,0,0,.06);
        backdrop-filter:blur(calc(var(--blur) * .8));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .8));
      }
      .stat-label {
        font-size:12px;
        letter-spacing:.08em;
        text-transform:uppercase;
        color:var(--muted);
        margin-bottom:6px;
      }
      .stat-value {
        font-size:18px;
        font-weight:700;
      }
      .table-wrap {
        overflow:auto;
        border-radius:18px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.6);
        backdrop-filter:blur(calc(var(--blur) * .8));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .8));
      }
      table {
        width:100%;
        border-collapse:collapse;
      }
      th, td {
        text-align:left;
        padding:12px 14px;
        border-bottom:1px solid rgba(0,0,0,.06);
        vertical-align:top;
      }
      th {
        font-size:12px;
        letter-spacing:.08em;
        text-transform:uppercase;
        color:var(--muted);
      }
      tr:last-child td { border-bottom:none; }
      .empty {
        padding:18px;
        border-radius:18px;
        border:1px dashed rgba(0,0,0,.12);
        color:var(--muted);
        background:rgba(255,255,255,.52);
      }
      .result-panel {
        min-height:100px;
      }
      .technical-pre {
        margin:0;
        white-space:pre-wrap;
        word-break:break-word;
      }
      .wizard-shell {
        position:relative;
        width:min(100%, 1080px);
        min-height:calc(100vh - 160px);
        margin:0 auto;
        padding:24px;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .wizard-ambient,
      .wizard-ambient::before,
      .wizard-ambient::after {
        position:absolute;
        inset:auto;
        pointer-events:none;
        border-radius:999px;
        filter:blur(56px);
        transition:transform .8s var(--wizard-ease);
      }
      .wizard-ambient {
        width:34vw;
        height:34vw;
        min-width:240px;
        min-height:240px;
        top:6%;
        right:4%;
        background:rgba(0,0,0,.05);
      }
      .wizard-ambient::before,
      .wizard-ambient::after {
        content:'';
      }
      .wizard-ambient::before {
        width:22vw;
        height:22vw;
        min-width:180px;
        min-height:180px;
        left:-38%;
        top:36%;
        background:rgba(0,0,0,.035);
      }
      .wizard-ambient::after {
        width:18vw;
        height:18vw;
        min-width:150px;
        min-height:150px;
        right:8%;
        bottom:-20%;
        background:rgba(0,0,0,.028);
      }
      .wizard-panel {
        position:relative;
        width:min(100%, 860px);
        min-height:min(78vh, 760px);
        padding:30px;
        border-radius:38px;
        border:1px solid rgba(255,255,255,.88);
        background:linear-gradient(180deg, rgba(255,255,255,.84), rgba(255,255,255,.66));
        backdrop-filter:blur(36px);
        -webkit-backdrop-filter:blur(36px);
        box-shadow:0 40px 140px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.96);
        overflow:hidden;
      }
      .wizard-panel::before {
        content:'';
        position:absolute;
        inset:0;
        background:linear-gradient(180deg, rgba(255,255,255,.92), transparent 26%);
        pointer-events:none;
      }
      .wizard-topline {
        position:relative;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
        margin-bottom:20px;
      }
      .wizard-label {
        color:var(--muted);
        font-size:11px;
        letter-spacing:.2em;
        text-transform:uppercase;
      }
      .wizard-progress {
        flex:1;
        display:flex;
        align-items:center;
        gap:14px;
        min-width:0;
      }
      .wizard-progress-track {
        position:relative;
        flex:1;
        height:5px;
        border-radius:999px;
        background:rgba(0,0,0,.08);
        overflow:hidden;
      }
      .wizard-progress-fill {
        position:absolute;
        inset:0 auto 0 0;
        width:0;
        border-radius:999px;
        background:linear-gradient(90deg, rgba(10,10,10,.88), rgba(10,10,10,.3));
        box-shadow:0 0 18px rgba(0,0,0,.08);
        transition:width .72s var(--wizard-ease);
      }
      .wizard-dots {
        display:flex;
        gap:8px;
      }
      .wizard-dot {
        width:7px;
        height:7px;
        border-radius:999px;
        background:rgba(0,0,0,.16);
        transform:scale(.9);
        transition:transform .6s var(--wizard-ease), background .6s var(--wizard-ease), opacity .6s var(--wizard-ease);
      }
      .wizard-dot.is-active {
        background:rgba(10,10,10,.96);
        transform:scale(1.4);
      }
      .wizard-dot.is-complete {
        background:rgba(10,10,10,.42);
        transform:scale(1.05);
      }
      .wizard-viewport {
        position:relative;
        overflow:hidden;
        min-height:calc(min(78vh, 760px) - 150px);
      }
      .wizard-track {
        display:flex;
        width:100%;
        height:100%;
        will-change:transform;
        transition:transform .82s var(--wizard-ease);
      }
      .wizard-step {
        position:relative;
        flex:0 0 100%;
        min-height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:12px 4px;
        opacity:.28;
        transform:scale(.982);
        filter:blur(8px);
        transition:opacity .82s var(--wizard-ease), transform .82s var(--wizard-ease), filter .82s var(--wizard-ease);
      }
      .wizard-step.is-active {
        opacity:1;
        transform:scale(1);
        filter:blur(0);
      }
      .wizard-step.is-adjacent {
        opacity:.46;
        transform:scale(.986);
        filter:blur(4px);
      }
      .wizard-step-inner {
        width:min(100%, 720px);
        text-align:left;
        display:grid;
        gap:18px;
      }
      .wizard-title {
        margin:0;
        font-size:clamp(40px, 7vw, 78px);
        line-height:.95;
        letter-spacing:-.055em;
      }
      .wizard-description {
        margin:0;
        max-width:58ch;
        font-size:16px;
        line-height:1.7;
        color:var(--muted);
      }
      .wizard-meta {
        display:flex;
        flex-wrap:wrap;
        gap:12px;
      }
      .wizard-meta-card {
        min-width:160px;
        padding:14px 16px;
        border-radius:18px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.6);
        backdrop-filter:blur(calc(var(--blur) * .8));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .8));
      }
      .wizard-meta-card strong {
        display:block;
        margin-bottom:6px;
        font-size:12px;
        letter-spacing:.12em;
        text-transform:uppercase;
        color:var(--muted);
      }
      .wizard-input-card {
        padding:18px;
        border-radius:24px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.66);
        backdrop-filter:blur(calc(var(--blur) * .95));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .95));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.94);
      }
      .wizard-input-note {
        display:flex;
        justify-content:space-between;
        gap:14px;
        margin-top:12px;
        color:var(--muted);
        font-size:13px;
        flex-wrap:wrap;
      }
      .wizard-highlight {
        position:relative;
        padding:18px 20px;
        border-radius:24px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.62);
        overflow:hidden;
      }
      .wizard-highlight::before {
        content:'';
        position:absolute;
        inset:0;
        background:linear-gradient(135deg, rgba(255,255,255,.92), transparent 42%);
        pointer-events:none;
      }
      .wizard-actions {
        position:relative;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-top:20px;
        flex-wrap:wrap;
      }
      .wizard-actions-main,
      .wizard-actions-side {
        display:flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
      }
      .wizard-nav-button {
        min-width:108px;
      }
      .wizard-nav-button[disabled] {
        opacity:.34;
        pointer-events:none;
      }
      .wizard-step-counter {
        color:var(--muted);
        font-size:13px;
      }
      .wizard-surface-grid {
        display:grid;
        grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:14px;
      }
      .wizard-summary-list {
        display:grid;
        gap:12px;
      }
      .wizard-summary-item {
        padding:16px 18px;
        border-radius:20px;
        border:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.58);
      }
      .wizard-summary-item strong {
        display:block;
        margin-bottom:6px;
        color:var(--muted);
        font-size:12px;
        letter-spacing:.12em;
        text-transform:uppercase;
      }
      .wizard-swipe-hint {
        color:var(--muted);
        font-size:12px;
        letter-spacing:.08em;
        text-transform:uppercase;
      }
      .wizard-chip {
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding:10px 14px;
        border-radius:999px;
        background:rgba(255,255,255,.72);
        border:1px solid rgba(0,0,0,.06);
        backdrop-filter:blur(calc(var(--blur) * .8));
        -webkit-backdrop-filter:blur(calc(var(--blur) * .8));
        color:var(--muted-strong);
      }
      .wizard-chip::before {
        content:'';
        width:6px;
        height:6px;
        border-radius:999px;
        background:rgba(10,10,10,.82);
        box-shadow:0 0 14px rgba(0,0,0,.08);
      }
      @media (max-width: 900px) {
        .grid.two,
        .grid.sidebar,
        .stats { grid-template-columns:1fr; }
        .shell { padding:20px 16px 34px; }
        .page.wizard-page { min-height:calc(100vh - 120px); }
        .wizard-shell {
          min-height:calc(100vh - 140px);
          padding:0;
        }
        .wizard-panel {
          min-height:calc(100vh - 146px);
          padding:22px 18px 20px;
          border-radius:30px;
        }
        .wizard-topline {
          align-items:flex-start;
          flex-direction:column;
        }
        .wizard-progress { width:100%; }
        .wizard-surface-grid { grid-template-columns:1fr; }
        .wizard-actions {
          flex-direction:column-reverse;
          align-items:stretch;
        }
        .wizard-actions-main,
        .wizard-actions-side {
          width:100%;
          justify-content:space-between;
        }
        .wizard-nav-button {
          flex:1;
          min-width:0;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar${navItems.length ? '' : ' minimal'}">
        <a class="brand" href="/miro">
          <span class="brand-mark">M</span>
          <span class="brand-copy">
            <span>Miro Relay</span>
            <small>MCP OAuth bridge</small>
          </span>
        </a>
        ${navItems.length ? `<nav class="nav">${renderNav(activeNav, navItems)}</nav>` : ''}
      </header>
      <main class="page ${pageClass}">
        ${hero}
        ${body}
      </main>
    </div>
    ${script ? `<script>${script}</script>` : ''}
  </body>
</html>`;
}

function renderMessagePage({
  title,
  activeNav = 'home',
  eyebrow = 'Need attention',
  heading,
  messageHtml,
  detailsHtml = '',
  actions = [],
  navItems = []
}) {
  return renderUiPage({
    title,
    activeNav,
    eyebrow,
    heading,
    body: `
      <section class="card stack">
        <div class="callout warn">
          <strong>${escapeHtml(title)}</strong>
        <div>${messageHtml}</div>
      </div>
      ${detailsHtml ? `<div>${detailsHtml}</div>` : ''}
      ${renderLinkActions(actions)}
    </section>`,
    pageClass: 'narrow',
    navItems
  });
}

function renderWizardStep({
  index,
  eyebrow = '',
  title = '',
  description = '',
  body = ''
}) {
  return `
    <section class="wizard-step${index === 0 ? ' is-active' : ''}" data-step="${index}">
      <div class="wizard-step-inner">
        ${eyebrow ? `<div class="wizard-label">${escapeHtml(eyebrow)}</div>` : ''}
        ${title ? `<h2 class="wizard-title">${escapeHtml(title)}</h2>` : ''}
        ${description ? `<p class="wizard-description">${description}</p>` : ''}
        ${body}
      </div>
    </section>`;
}

function renderConnectWizardPage({ adminKey = '' } = {}) {
  const hiddenAdminInput = adminKey ? `<input type="hidden" name="admin_key" value="${escapeHtml(adminKey)}" />` : '';
  const steps = [
    renderWizardStep({
      index: 0,
      eyebrow: 'Scene 1',
      title: 'Connect Miro',
      description: 'A short setup. Nothing extra.',
      body: ''
    }),
    renderWizardStep({
      index: 1,
      eyebrow: 'Scene 2',
      title: 'Your email',
      description: 'Used for this connection.',
      body: `
        <div class="wizard-input-card" style="max-width:520px">
          <input id="wizardEmail" type="email" inputmode="email" autocomplete="email" placeholder="user@example.com" aria-label="Email" />
        </div>
        <div id="emailPreview" class="wizard-swipe-hint mono" style="margin-top:4px">profile not set</div>`
    }),
    renderWizardStep({
      index: 2,
      eyebrow: 'Scene 3',
      title: 'Authorize',
      description: 'Miro opens next.',
      body: `
        <form id="wizardForm" method="get" action="/miro/start">
          ${hiddenAdminInput}
          <input id="wizardEmailSubmit" type="hidden" name="email" value="" />
        </form>
        <div class="wizard-highlight" style="max-width:520px">
          <div id="summaryEmail" class="wizard-description mono" style="color:var(--text)">user@example.com</div>
        </div>`
    })
  ];

  return renderUiPage({
    title: 'Connect - Miro Relay',
    activeNav: 'home',
    eyebrow: '',
    heading: '',
    subtitle: '',
    pageClass: 'wizard-page',
    navItems: [],
    body: `
      <section class="wizard-shell">
        <div id="wizardAmbient" class="wizard-ambient"></div>
        <div class="wizard-panel">
          <div class="wizard-topline">
            <div class="wizard-label">Miro setup</div>
            <div class="wizard-progress" aria-hidden="true">
              <div class="wizard-progress-track"><div id="wizardProgressFill" class="wizard-progress-fill"></div></div>
              <div id="wizardDots" class="wizard-dots">
                <span class="wizard-dot is-active"></span>
                <span class="wizard-dot"></span>
                <span class="wizard-dot"></span>
              </div>
            </div>
          </div>
          <div id="wizardViewport" class="wizard-viewport">
            <div id="wizardTrack" class="wizard-track">
              ${steps.join('')}
            </div>
          </div>
          <div class="wizard-actions">
            <div class="wizard-actions-side">
              <span id="wizardStepCounter" class="wizard-step-counter">1 / 3</span>
            </div>
            <div class="wizard-actions-main">
              <button id="wizardBack" class="button ghost wizard-nav-button" type="button">Back</button>
              <button id="wizardNext" class="button primary wizard-nav-button" type="button">Next</button>
            </div>
          </div>
        </div>
      </section>`,
    script: `
      const WIZARD_ANIMATION = {
        steps: 3,
        duration: 820,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        swipeThreshold: 64,
        parallaxRange: 18
      };

      const wizardState = {
        current: 0,
        email: '',
        touchStartX: null
      };

      const wizardElements = {
        track: document.getElementById('wizardTrack'),
        steps: Array.from(document.querySelectorAll('.wizard-step')),
        fill: document.getElementById('wizardProgressFill'),
        dots: Array.from(document.querySelectorAll('.wizard-dot')),
        next: document.getElementById('wizardNext'),
        back: document.getElementById('wizardBack'),
        counter: document.getElementById('wizardStepCounter'),
        email: document.getElementById('wizardEmail'),
        emailPreview: document.getElementById('emailPreview'),
        summaryEmail: document.getElementById('summaryEmail'),
        submitEmail: document.getElementById('wizardEmailSubmit'),
        form: document.getElementById('wizardForm'),
        ambient: document.getElementById('wizardAmbient'),
        viewport: document.getElementById('wizardViewport')
      };

      if (document.documentElement && document.documentElement.style) {
        document.documentElement.style.setProperty('--wizard-ease', WIZARD_ANIMATION.easing);
      }

      function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
      }

      function canonicalProfileId(value) {
        return normalizeEmail(value).replace(/@/g, '_');
      }

      function isValidEmail(value) {
        const normalized = normalizeEmail(value);
        return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalized);
      }

      function updateDerivedValues() {
        const normalizedEmail = normalizeEmail(wizardElements.email.value);
        wizardState.email = normalizedEmail;
        const profilePreview = normalizedEmail ? canonicalProfileId(normalizedEmail) : 'profile not set';
        wizardElements.emailPreview.textContent = profilePreview;
        wizardElements.summaryEmail.textContent = normalizedEmail || 'enter your email first';
        wizardElements.submitEmail.value = normalizedEmail;
      }

      function syncStepUI() {
        const progress = ((wizardState.current + 1) / WIZARD_ANIMATION.steps) * 100;
        wizardElements.track.style.transform = 'translate3d(-' + (wizardState.current * 100) + '%, 0, 0)';
        wizardElements.fill.style.width = progress + '%';
        wizardElements.counter.textContent = (wizardState.current + 1) + ' / ' + WIZARD_ANIMATION.steps;

        wizardElements.steps.forEach(function(step, index) {
          step.classList.toggle('is-active', index === wizardState.current);
          step.classList.toggle('is-adjacent', Math.abs(index - wizardState.current) === 1);
          step.setAttribute('aria-hidden', index === wizardState.current ? 'false' : 'true');
        });

        wizardElements.dots.forEach(function(dot, index) {
          dot.classList.toggle('is-active', index === wizardState.current);
          dot.classList.toggle('is-complete', index < wizardState.current);
        });

        wizardElements.back.disabled = wizardState.current === 0;
        if (wizardState.current === WIZARD_ANIMATION.steps - 1) {
          wizardElements.next.textContent = 'Continue';
        } else {
          wizardElements.next.textContent = wizardState.current === 0 ? 'Start' : 'Next';
        }
      }

      function showValidationState(message) {
        if (!message) return;
        wizardElements.email.focus();
        wizardElements.email.select();
        wizardElements.emailPreview.textContent = message;
      }

      function goToStep(index) {
        wizardState.current = Math.max(0, Math.min(WIZARD_ANIMATION.steps - 1, index));
        syncStepUI();
      }

      function goNext() {
        updateDerivedValues();
        if (wizardState.current === 1 && !isValidEmail(wizardState.email)) {
          showValidationState('enter a valid email to continue');
          return;
        }
        if (wizardState.current === WIZARD_ANIMATION.steps - 1) {
          if (!isValidEmail(wizardState.email)) {
            goToStep(1);
            showValidationState('enter a valid email before authorizing');
            return;
          }
          wizardElements.form.submit();
          return;
        }
        goToStep(wizardState.current + 1);
      }

      function goBack() {
        goToStep(wizardState.current - 1);
      }

      function handleKeydown(event) {
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          goNext();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goBack();
        } else if (event.key === 'Enter') {
          const isTextInput = document.activeElement === wizardElements.email;
          if (isTextInput || wizardState.current < WIZARD_ANIMATION.steps - 1) {
            event.preventDefault();
            goNext();
          }
        }
      }

      function handleTouchStart(event) {
        const touch = event.changedTouches ? event.changedTouches[0] : event;
        wizardState.touchStartX = touch.clientX;
      }

      function handleTouchEnd(event) {
        if (wizardState.touchStartX === null) return;
        const touch = event.changedTouches ? event.changedTouches[0] : event;
        const deltaX = touch.clientX - wizardState.touchStartX;
        wizardState.touchStartX = null;
        if (Math.abs(deltaX) < WIZARD_ANIMATION.swipeThreshold) return;
        if (deltaX < 0) {
          goNext();
        } else {
          goBack();
        }
      }

      function handlePointerMove(event) {
        if (!wizardElements.ambient) return;
        const bounds = document.body.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) - 0.5;
        const y = ((event.clientY - bounds.top) / bounds.height) - 0.5;
        const offsetX = x * WIZARD_ANIMATION.parallaxRange;
        const offsetY = y * WIZARD_ANIMATION.parallaxRange;
        wizardElements.ambient.style.transform = 'translate3d(' + offsetX + 'px,' + offsetY + 'px,0)';
      }

      wizardElements.next.addEventListener('click', goNext);
      wizardElements.back.addEventListener('click', goBack);
      wizardElements.email.addEventListener('input', updateDerivedValues);
      window.addEventListener('keydown', handleKeydown);
      wizardElements.viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
      wizardElements.viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
      wizardElements.viewport.addEventListener('pointerdown', handleTouchStart, { passive: true });
      wizardElements.viewport.addEventListener('pointerup', handleTouchEnd, { passive: true });
      window.addEventListener('pointermove', handlePointerMove, { passive: true });

      updateDerivedValues();
      syncStepUI();
    `
  });
}

function profileStatusView(status, connected) {
  if (status === 'deleted') {
    return { label: 'Deleted', tone: 'danger', description: 'This connection has been removed.' };
  }
  if (status === 'revoked') {
    return { label: 'Needs reauthorization', tone: 'warn', description: 'OAuth access was revoked and must be connected again.' };
  }
  if (status === 'pending') {
    return { label: connected ? 'Connected' : 'Pending', tone: connected ? 'ok' : 'warn', description: connected ? 'OAuth is connected.' : 'The connection was started but is not ready yet.' };
  }
  if (status === 'connected' || connected) {
    return { label: 'Connected', tone: 'ok', description: 'Ready to use from your MCP client.' };
  }
  return { label: status || 'Unknown', tone: 'neutral', description: 'Status is available in the technical details.' };
}

function emailCheckView(emailCheckStatus) {
  if (emailCheckStatus === 'match') {
    return { label: 'Email confirmed', tone: 'ok', description: 'Expected and detected Miro email match.' };
  }
  if (emailCheckStatus === 'mismatch') {
    return { label: 'Email mismatch', tone: 'warn', description: 'The detected Miro account does not match the expected email.' };
  }
  if (emailCheckStatus === 'expected_missing') {
    return { label: 'Expected email missing', tone: 'warn', description: 'The connection completed but no expected email was stored for comparison.' };
  }
  return { label: 'Email not verified', tone: 'warn', description: 'Identity details were limited, so the email check could not be fully verified.' };
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
const providerApps = readJson(PROVIDER_APP_FILE, {}); // appId -> provider app policy
const serviceClients = readJson(SERVICE_CLIENT_FILE, {}); // serviceId -> broker service client
const delegationGrants = readJson(DELEGATION_FILE, {}); // grantId -> delegated credential grant
const breaker = { consecutiveFails: 0, openUntil: 0 };
const adminSessions = new Map(); // sid -> {expiresAt}

function saveAll() {
  writeJson(TOKEN_FILE, tokens);
  writeJson(CLIENT_FILE, clients);
  writeJson(PROFILE_FILE, profiles);
  writeJson(PROVIDER_APP_FILE, providerApps);
  writeJson(SERVICE_CLIENT_FILE, serviceClients);
  writeJson(DELEGATION_FILE, delegationGrants);
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

function recordRelayCall(event, details = {}, req = null) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim() : 'system';
    appendJsonLine(RELAY_CALL_FILE, { ts: nowIso(), event, ip, details });
  } catch {
    // best effort only
  }
}

function recordTokenIssueEvent(event, details = {}, req = null) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim() : 'system';
    appendJsonLine(TOKEN_ISSUE_FILE, { ts: nowIso(), event, ip, details });
  } catch {
    // best effort only
  }
}

function ensureDefaultProviderApps() {
  const now = nowIso();
  const existing = providerApps['miro-default'];
  const seeded = createDefaultMiroProviderApp(OAUTH_SCOPE, now);
  providerApps['miro-default'] = normalizeProviderApp({
    ...seeded,
    ...existing,
    access_mode: existing?.access_mode || MIRO_PROVIDER_ACCESS_MODE,
    allow_relay: typeof existing?.allow_relay === 'boolean' ? existing.allow_relay : MIRO_PROVIDER_ALLOW_RELAY,
    allow_direct_token_return: typeof existing?.allow_direct_token_return === 'boolean'
      ? existing.allow_direct_token_return
      : MIRO_PROVIDER_ALLOW_DIRECT_TOKEN_RETURN,
    created_at: existing?.created_at || seeded.created_at,
    updated_at: now
  });
}

function getProviderApp(appId = 'miro-default') {
  const normalizedId = String(appId || 'miro-default').trim() || 'miro-default';
  const appConfig = providerApps[normalizedId];
  if (!appConfig) return null;
  return normalizeProviderApp({ ...appConfig, id: normalizedId });
}

function getProviderAppByProfile(profileId) {
  const profile = profiles[profileId] || {};
  const providerAppId = profile.provider_app_id || clients[profileId]?.provider_app_id || 'miro-default';
  return getProviderApp(providerAppId);
}

function upsertProviderApp(input) {
  const existing = providerApps[input.id] || {};
  providerApps[input.id] = normalizeProviderApp({
    ...existing,
    ...input,
    created_at: existing.created_at || input.created_at || nowIso(),
    updated_at: nowIso()
  });
  saveAll();
  return providerApps[input.id];
}

function profilePublic(profileId, p) {
  const providerApp = getProviderAppByProfile(profileId);
  return {
    profile_id: profileId,
    provider_key: p.provider_key || providerApp?.provider_key || 'miro',
    provider_app_id: p.provider_app_id || providerApp?.id || 'miro-default',
    provider_access_mode: providerApp?.access_mode || ACCESS_MODE_RELAY,
    display_name: p.display_name,
    contact: p.contact || '',
    contact_masked: maskContact(p.contact || ''),
    status: p.status || 'pending',
    oauth_user_id: p.oauth_user_id || null,
    oauth_user_name: p.oauth_user_name || null,
    oauth_email_expected: p.oauth_email_expected || null,
    oauth_email_detected: p.oauth_email_detected || null,
    oauth_email_verified: typeof p.oauth_email_verified === 'boolean' ? p.oauth_email_verified : null,
    oauth_email_match: typeof p.oauth_email_match === 'boolean' ? p.oauth_email_match : null,
    oauth_email_check_status: p.oauth_email_check_status || null,
    oauth_token_context_error: p.oauth_token_context_error || null,
    oauth_id_token_present: Boolean(p.oauth_id_token_present),
    oauth_checked_at: p.oauth_checked_at || null,
    created_at: p.created_at,
    connected_at: p.connected_at || null,
    updated_at: p.updated_at || p.created_at
  };
}

function getProfile(profileId) {
  return profiles[profileId] || null;
}

ensureDefaultProviderApps();
saveAll();

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
  const profileId = resolveProfileId(req.params.profile || req.params.profileId);
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

function authenticateServiceRequest(req, { profileId, providerKey, requestedMode }) {
  const serviceKey = req.header('x-service-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const delegatedCredential = req.header('x-delegated-credential');
  if (!serviceKey || !delegatedCredential) {
    return { ok: false, status: 401, error: 'missing_service_credentials' };
  }

  const serviceClient = Object.values(serviceClients).find((client) => {
    if (!client?.service_token_hash) return false;
    return timingSafeEqualHex(tokenHash(serviceKey), client.service_token_hash);
  });

  if (!serviceClient || serviceClient.enabled === false) {
    return { ok: false, status: 401, error: 'invalid_service_client' };
  }

  const grant = Object.values(delegationGrants).find((item) => {
    if (!item?.delegated_credential_hash) return false;
    return timingSafeEqualHex(tokenHash(delegatedCredential), item.delegated_credential_hash);
  });

  if (!grant) {
    return { ok: false, status: 401, error: 'invalid_delegated_credential' };
  }

  const providerApp = getProviderApp(grant.provider_app_id || 'miro-default');
  if (!providerApp) {
    return { ok: false, status: 404, error: 'provider_app_not_found' };
  }

  const profileProviderApp = getProviderAppByProfile(profileId);
  if (!profileProviderApp || profileProviderApp.id !== providerApp.id) {
    return { ok: false, status: 403, error: 'profile_provider_app_mismatch', serviceClient, grant, providerApp };
  }

  const decision = validateServiceAccess({
    providerApp,
    serviceClient,
    grant,
    requestedMode,
    providerKey,
    providerAppId: providerApp.id,
    profileId,
    environment: String(req.header('x-broker-environment') || '').trim()
  });

  if (!decision.ok) {
    return { ok: false, status: 403, error: decision.reason, serviceClient, grant, providerApp };
  }

  return { ok: true, serviceClient, grant, providerApp };
}

function issueServiceClient({ service_id, display_name, allowed_provider_app_ids = [], environment = '' }) {
  const serviceId = safeText(service_id || '', 120).toLowerCase();
  if (!serviceId) throw Object.assign(new Error('service_id is required'), { status: 400 });
  if (serviceClients[serviceId] && serviceClients[serviceId].enabled !== false) {
    throw Object.assign(new Error('service client already exists'), { status: 409 });
  }

  const serviceKey = newOpaqueSecret();
  serviceClients[serviceId] = {
    id: serviceId,
    display_name: safeText(display_name || serviceId, 120),
    allowed_provider_app_ids: normalizeStringArray(allowed_provider_app_ids),
    environment: safeText(environment || '', 40),
    enabled: true,
    service_token_hash: tokenHash(serviceKey),
    created_at: nowIso(),
    updated_at: nowIso()
  };
  saveAll();

  return {
    service_id: serviceId,
    service_key: serviceKey,
    client: serviceClients[serviceId]
  };
}

function issueDelegationGrant({
  profile_id,
  service_id,
  provider_key = 'miro',
  provider_app_id = 'miro-default',
  allowed_access_modes = [ACCESS_MODE_RELAY],
  scope_ceiling = [],
  environment = '',
  expires_in_hours = 24,
  expires_in_days
}) {
  const profileId = resolveProfileId(profile_id);
  if (!profileId || !profiles[profileId] || profiles[profileId].status === 'deleted') {
    throw Object.assign(new Error('profile not found'), { status: 404 });
  }

  if (!serviceClients[service_id] || serviceClients[service_id].enabled === false) {
    throw Object.assign(new Error('service client not found'), { status: 404 });
  }

  const providerApp = getProviderApp(provider_app_id);
  if (!providerApp) {
    throw Object.assign(new Error('provider app not found'), { status: 404 });
  }

  const grantId = newRecordId('grant');
  const delegatedCredential = newOpaqueSecret();
  let ttlMs;
  if (expires_in_days != null && expires_in_days !== '') {
    const days = Math.max(1, Math.min(365, Number(expires_in_days) || 365));
    ttlMs = days * 24 * 60 * 60 * 1000;
  } else {
    const hours = Math.max(1, Math.min(24 * 365, Number(expires_in_hours) || 24));
    ttlMs = hours * 60 * 60 * 1000;
  }
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  delegationGrants[grantId] = {
    id: grantId,
    profile_id: profileId,
    service_id,
    provider_key: provider_key || providerApp.provider_key,
    provider_app_id: providerApp.id,
    allowed_access_modes: normalizeAllowedAccessModes(allowed_access_modes, providerApp.access_mode),
    scope_ceiling: normalizeStringArray(scope_ceiling),
    environment: safeText(environment || '', 40),
    enabled: true,
    delegated_credential_hash: tokenHash(delegatedCredential),
    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso(),
    revoked_at: null
  };
  saveAll();

  return {
    grant_id: grantId,
    delegated_credential: delegatedCredential,
    grant: delegationGrants[grantId]
  };
}

function safeRedirectPath(value, fallback) {
  const pathValue = String(value || '').trim();
  if (pathValue.startsWith('/miro')) return pathValue;
  return fallback;
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
    redirect_uri,
    provider_key: 'miro',
    provider_app_id: 'miro-default'
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

function readJsonLines(file, lines = 200) {
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const arr = content.trim() ? content.trim().split('\n') : [];
  return arr.slice(-Math.max(1, Math.min(2000, lines))).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}

async function forwardMiroRelay({ accessToken, req }) {
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

const relayAdapters = {
  miro: {
    async forward({ accessToken, req }) {
      return forwardMiroRelay({ accessToken, req });
    }
  }
};

async function relayProviderRequest({ providerKey, profileId, req, res, actor }) {
  const providerApp = getProviderAppByProfile(profileId);
  if (!providerApp) {
    return res.status(404).json({ error: 'provider_app_not_found' });
  }

  if (!isProviderAppRelayEnabled(providerApp)) {
    return res.status(403).json({ error: 'provider_app_relay_disabled', provider_app_id: providerApp.id });
  }

  const adapter = relayAdapters[providerKey];
  if (!adapter) {
    return res.status(501).json({ error: 'relay_protocol_not_supported', provider: providerKey });
  }

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

  try {
    let upstream = null;

    for (let attempt = 0; attempt <= MCP_RETRY_COUNT; attempt++) {
      upstream = await adapter.forward({ accessToken: token, req, providerApp });

      if (upstream.status === 401) {
        token = await refreshToken(profileId);
        upstream = await adapter.forward({ accessToken: token, req, providerApp });
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

    const relayDetails = {
      provider_key: providerKey,
      provider_app_id: providerApp.id,
      profile_id: profileId,
      actor_type: actor?.type || 'profile',
      actor_id: actor?.id || profileId,
      method: req.body?.method || 'unknown',
      status: upstream.status
    };

    audit('relay_call', relayDetails, req);
    recordRelayCall('relay_call', relayDetails, req);

    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    breakerMarkFailure();
    const relayDetails = {
      provider_key: providerKey,
      provider_app_id: providerApp.id,
      profile_id: profileId,
      actor_type: actor?.type || 'profile',
      actor_id: actor?.id || profileId,
      error: String(e)
    };
    audit('relay_call_failed', relayDetails, req);
    recordRelayCall('relay_call_failed', relayDetails, req);
    res.status(502).json({ error: String(e) });
  }
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
  if (req.query.redirect === '1') {
    const nextPath = safeRedirectPath(req.query.next, '/miro/admin');
    return res.redirect(nextPath);
  }
  res.json({ ok: true, message: 'admin session active' });
});

app.post('/miro/admin/logout', (req, res) => {
  clearAdminSession(req, res);
  audit('admin_logout', {}, req);
  if (req.query.redirect === '1') {
    const nextPath = safeRedirectPath(req.query.next, '/miro');
    return res.redirect(nextPath);
  }
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

// User browser workspace page
app.get('/miro/workspace', (_req, res) => {
  res.type('html').send(renderUiPage({
    title: 'My connection - Miro Relay',
    activeNav: 'workspace',
    eyebrow: 'My connection',
    heading: 'Check status, reconnect fast, or remove a connection',
    subtitle: 'Paste the credentials you received after setup, then we will show a readable connection summary and the next useful action.',
    body: `
      <section class="grid sidebar">
        <section class="card stack">
          <div class="kicker">Connection tools</div>
          <div>
            <h2>Find an existing connection</h2>
            <p>Already have credentials? Paste them here and we will fill the fields for you. You can then check status, reconnect with Miro, or remove the connection.</p>
          </div>
          <div>
            <label for="credsBlob">Paste credentials or MCP config</label>
            <textarea id="credsBlob" placeholder='{"mcpServers":{"miro_personal":{"type":"streamable-http","url":"https://relay.example.com/miro/mcp/user_example.com","headers":{"X-Relay-Key":"..."}}}}'></textarea>
          </div>
          <div class="actions">
            <button class="button secondary" type="button" onclick="applyCredentialsBlob()">Use pasted credentials</button>
          </div>
          <div>
            <label for="delProfile">Profile ID</label>
            <input id="delProfile" placeholder="user_example.com" />
          </div>
          <div>
            <label for="delToken">Relay token</label>
            <input id="delToken" placeholder="Paste the one-time relay token" />
          </div>
          <div class="actions">
            <button class="button primary" type="button" onclick="doStatus()">Check connection</button>
            <button class="button secondary" type="button" onclick="doDelete()">Remove connection</button>
          </div>
          <p class="hint">Status uses the same secure API as before. This page only improves the explanation and next steps.</p>
        </section>

        <aside class="card soft stack">
          <div class="kicker">Need a new connection?</div>
          <div>
            <h2>Start from your email</h2>
            <p>The fastest path is still the guided flow: enter your email, authorize with Miro, then copy the config into your MCP client.</p>
          </div>
          <ul class="step-list">
            <li><span class="step-number">1</span><div><strong>Enter email</strong><div class="hint">Your email becomes the connection identity.</div></div></li>
            <li><span class="step-number">2</span><div><strong>Authorize with Miro</strong><div class="hint">OAuth finishes in the browser.</div></div></li>
            <li><span class="step-number">3</span><div><strong>Copy config and finish</strong><div class="hint">You receive a ready-to-paste MCP config and one-time backup credentials.</div></div></li>
          </ul>
          ${renderLinkActions([
            { href: '/miro/start', label: 'Start a new connection', variant: 'primary' },
            { href: '/miro/admin', label: 'Open admin area', variant: 'ghost' }
          ])}
        </aside>
      </section>

      <section id="statusPanel" class="card result-panel stack">
        <div class="kicker">Connection status</div>
        <h2>No connection loaded yet</h2>
        <p>Paste your credentials or enter your profile ID and relay token to see a structured summary here.</p>
      </section>`,
    script: `
      function escapeHtmlClient(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatDateTime(value) {
        if (!value) return 'Not available';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return escapeHtmlClient(value);
        return escapeHtmlClient(date.toLocaleString());
      }

      function statusView(status, connected) {
        if (status === 'deleted') return { label: 'Deleted', tone: 'danger', summary: 'This connection has already been removed.' };
        if (status === 'revoked') return { label: 'Needs reauthorization', tone: 'warn', summary: 'OAuth access was revoked. Connect the same profile again to resume usage.' };
        if (status === 'pending' && !connected) return { label: 'Pending', tone: 'warn', summary: 'The connection exists, but OAuth has not completed yet.' };
        if (status === 'connected' || connected) return { label: 'Connected', tone: 'ok', summary: 'Everything looks ready for your MCP client.' };
        return { label: status || 'Unknown', tone: 'neutral', summary: 'We found the connection, but it needs a manual review.' };
      }

      function emailCheckView(status) {
        if (status === 'match') return { label: 'Email confirmed', tone: 'ok', summary: 'Expected and detected Miro email match.' };
        if (status === 'mismatch') return { label: 'Email mismatch', tone: 'warn', summary: 'The detected Miro account does not match the expected email.' };
        if (status === 'expected_missing') return { label: 'Expected email missing', tone: 'warn', summary: 'The connection was created without a comparable expected email.' };
        return { label: 'Email not fully verified', tone: 'warn', summary: 'The OAuth response did not expose enough identity information to verify the email.' };
      }

      function parseCredentialsBlob(text) {
        var raw = String(text || '').trim();
        if (!raw) return {};

        try {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
            var firstServer = Object.values(parsed.mcpServers)[0];
            var mcpUrl = String((firstServer && firstServer.url) || '');
            var token = String(((firstServer && firstServer.headers && (firstServer.headers['X-Relay-Key'] || firstServer.headers['x-relay-key'])) || ''));
            var profileFromUrl = mcpUrl.match(/\\/miro\\/mcp\\/([^/?#]+)/i);
            return {
              profile_id: profileFromUrl ? decodeURIComponent(profileFromUrl[1]) : '',
              relay_token: token
            };
          }
          return {
            profile_id: parsed.profile_id || '',
            relay_token: parsed.relay_token || ''
          };
        } catch (_error) {}

        var profile = raw.match(/profile_id\\s*[:=]\\s*([^\\s\\n]+)/i);
        var token = raw.match(/relay_token\\s*[:=]\\s*([^\\s\\n]+)/i);
        return {
          profile_id: profile ? profile[1].trim() : '',
          relay_token: token ? token[1].trim() : ''
        };
      }

      function applyCredentialsBlob() {
        var parsed = parseCredentialsBlob(document.getElementById('credsBlob').value);
        if (parsed.profile_id) document.getElementById('delProfile').value = parsed.profile_id;
        if (parsed.relay_token) document.getElementById('delToken').value = parsed.relay_token;
        if (!parsed.profile_id && !parsed.relay_token) {
          renderErrorPanel('Nothing usable found', 'We could not detect a profile ID or relay token in the pasted text.');
          return;
        }
        renderHintPanel('Credentials imported', 'The fields were filled for you. Use "Check connection" to load the current status.');
      }

      function renderHintPanel(title, text) {
        document.getElementById('statusPanel').innerHTML =
          '<div class="kicker">Connection status</div>' +
          '<div class="callout ok"><strong>' + escapeHtmlClient(title) + '</strong><div>' + escapeHtmlClient(text) + '</div></div>';
      }

      function renderErrorPanel(title, text, technical) {
        var details = technical
          ? '<details class="details"><summary>Technical response</summary><div class="details-body"><pre class="technical-pre">' + escapeHtmlClient(typeof technical === 'string' ? technical : JSON.stringify(technical, null, 2)) + '</pre></div></details>'
          : '';
        document.getElementById('statusPanel').innerHTML =
          '<div class="kicker">Connection status</div>' +
          '<div class="callout danger"><strong>' + escapeHtmlClient(title) + '</strong><div>' + escapeHtmlClient(text) + '</div></div>' +
          '<div class="actions"><a class="button secondary" href="/miro/start">Start a new connection</a></div>' +
          details;
      }

      function renderStatus(profile, technical) {
        var status = statusView(profile.status, profile.connected);
        var emailState = emailCheckView(profile.oauth_email_check_status);
        var actionHtml = '<div class="actions">';
        if (profile.status === 'revoked' || profile.status === 'pending' || !profile.connected) {
          actionHtml += '<a class="button primary" href="/miro/auth/start?profile=' + encodeURIComponent(profile.profile_id) + '">Authorize again with Miro</a>';
        } else {
          actionHtml += '<a class="button secondary" href="/miro/start">Create another connection</a>';
        }
        actionHtml += '<a class="button ghost" href="/miro/admin">Need admin help?</a></div>';

        var warningBlock = '';
        if (profile.oauth_email_check_status && profile.oauth_email_check_status !== 'match') {
          warningBlock = '<div class="callout warn"><strong>' + escapeHtmlClient(emailState.label) + '</strong><div>' + escapeHtmlClient(emailState.summary) + '</div></div>';
        }

        var details = '<details class="details"><summary>Technical details</summary><div class="details-body">' +
          '<pre class="technical-pre">' + escapeHtmlClient(JSON.stringify(technical || { profile: profile }, null, 2)) + '</pre></div></details>';

        document.getElementById('statusPanel').innerHTML =
          '<div class="kicker">Connection status</div>' +
          '<div class="stack">' +
          '<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">' +
          '<div><h2>' + escapeHtmlClient(status.label) + '</h2><p>' + escapeHtmlClient(status.summary) + '</p></div>' +
          '<span class="pill ' + escapeHtmlClient(status.tone) + '">' + escapeHtmlClient(status.label) + '</span>' +
          '</div>' +
          '<div class="stats">' +
          '<div class="stat"><div class="stat-label">Profile</div><div class="stat-value mono">' + escapeHtmlClient(profile.profile_id || 'Not available') + '</div></div>' +
          '<div class="stat"><div class="stat-label">Contact</div><div class="stat-value">' + escapeHtmlClient(profile.contact || profile.contact_masked || 'Not available') + '</div></div>' +
          '<div class="stat"><div class="stat-label">Expires</div><div class="stat-value">' + formatDateTime(profile.expires_at) + '</div></div>' +
          '</div>' +
          warningBlock +
          '<div class="callout ' + escapeHtmlClient(emailState.tone) + '"><strong>' + escapeHtmlClient(emailState.label) + '</strong><div>' + escapeHtmlClient(emailState.summary) + '</div></div>' +
          actionHtml +
          details +
          '</div>';
      }

      async function readJsonResponse(response) {
        var text = await response.text();
        try {
          return { text: text, data: JSON.parse(text) };
        } catch (_error) {
          return { text: text, data: null };
        }
      }

      async function doStatus() {
        var id = document.getElementById('delProfile').value.trim();
        var token = document.getElementById('delToken').value.trim();
        if (!id || !token) {
          renderErrorPanel('Missing information', 'Enter both the profile ID and relay token to load the connection.');
          return;
        }

        renderHintPanel('Checking connection', 'Loading status from the relay...');
        var response = await fetch('/miro/status/' + encodeURIComponent(id), {
          headers: { 'X-Relay-Key': token, Accept: 'application/json' }
        });
        var parsed = await readJsonResponse(response);

        if (!response.ok || !parsed.data || !parsed.data.profile) {
          var message = parsed.data && parsed.data.error ? parsed.data.error : ('Request failed with status ' + response.status + '.');
          renderErrorPanel('Unable to load the connection', message, parsed.data || parsed.text);
          return;
        }

        renderStatus(parsed.data.profile, parsed.data);
      }

      async function doDelete() {
        var id = document.getElementById('delProfile').value.trim();
        var token = document.getElementById('delToken').value.trim();
        if (!id || !token) {
          renderErrorPanel('Missing information', 'Enter both the profile ID and relay token before removing the connection.');
          return;
        }
        if (!window.confirm('Remove this connection? This deletes the stored OAuth access and profile metadata.')) {
          return;
        }

        renderHintPanel('Removing connection', 'Deleting the connection from the relay...');
        var response = await fetch('/miro/profiles/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'X-Relay-Key': token, Accept: 'application/json' }
        });
        var parsed = await readJsonResponse(response);

        if (!response.ok) {
          var message = parsed.data && parsed.data.error ? parsed.data.error : ('Request failed with status ' + response.status + '.');
          renderErrorPanel('Could not remove the connection', message, parsed.data || parsed.text);
          return;
        }

        document.getElementById('statusPanel').innerHTML =
          '<div class="kicker">Connection status</div>' +
          '<div class="stack">' +
          '<div class="callout ok"><strong>Connection removed</strong><div>The stored profile and OAuth access were deleted successfully.</div></div>' +
          '<div class="actions"><a class="button primary" href="/miro/start">Create a new connection</a></div>' +
          '<details class="details"><summary>Technical response</summary><div class="details-body"><pre class="technical-pre">' + escapeHtmlClient(JSON.stringify(parsed.data || { ok: true }, null, 2)) + '</pre></div></details>' +
          '</div>';
      }
    `,
  }));
});

app.get('/miro', (_req, res) => {
  res.type('html').send(renderOnboardingExperiencePage());
});

app.get('/start', (_req, res) => {
  res.redirect('/miro');
});

// Admin-only browser page
app.get('/miro/admin', (req, res) => {
  const hasSession = isAdminBySession(req);
  res.type('html').send(renderUiPage({
    title: 'Admin - Miro Relay',
    activeNav: 'admin',
    eyebrow: 'Operator',
    heading: 'Profiles and access',
    subtitle: 'Plain operator view.',
    body: `
      <section class="grid sidebar">
        <section class="card stack">
          <div class="kicker">Session</div>
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <div>
              <h2>Login</h2>
              <p>Session first. Key fallback below.</p>
            </div>
            <span class="pill ${hasSession ? 'ok' : 'neutral'}">${hasSession ? 'Session active' : 'Session inactive'}</span>
          </div>
          <form method="post" action="/miro/admin/login?redirect=1&next=%2Fmiro%2Fadmin">
            <label for="adminPassword">Admin password</label>
            <input id="adminPassword" name="password" type="password" placeholder="MIRO_ADMIN_PASSWORD" />
            <div class="actions">
              <button class="button primary" type="submit">Login</button>
              <button class="button secondary" type="button" onclick="doAdminLogout()">Logout</button>
            </div>
          </form>
          <div>
            <label for="adminKey">Admin key</label>
            <input id="adminKey" placeholder="MIRO_RELAY_ADMIN_KEY" />
          </div>
        </section>

        <aside class="card soft stack">
          <div class="kicker">Actions</div>
          <div>
            <label for="contactFilter">Filter by contact or profile</label>
            <input id="contactFilter" placeholder="user@example.com" />
          </div>
          <div>
            <label for="adminProfile">Selected profile</label>
            <input id="adminProfile" placeholder="user_example.com" />
          </div>
          <div class="actions">
            <button class="button primary" type="button" onclick="doListProfiles()">Load profiles</button>
            <button class="button secondary" type="button" onclick="doRotateToken()">Rotate relay token</button>
            <button class="button secondary" type="button" onclick="doRevokeOAuth()">Revoke OAuth</button>
            <button class="button secondary" type="button" onclick="doAdminDelete()">Delete connection</button>
          </div>
          <div class="actions">
            <button class="button ghost" type="button" onclick="doAudit()">Load audit log</button>
            <a class="button ghost" href="/miro/workspace">Open self-service page</a>
          </div>
        </aside>
      </section>

      <section class="grid two" style="margin-top:18px">
        <section id="profilesPanel" class="card result-panel stack">
          <div class="kicker">Profiles</div>
          <h2>Not loaded</h2>
        </section>
        <section id="actionPanel" class="card result-panel stack">
          <div class="kicker">Result</div>
          <h2>Idle</h2>
        </section>
      </section>

      <section id="auditPanel" class="card result-panel stack" style="margin-top:18px">
        <div class="kicker">Audit log</div>
        <h2>Not loaded</h2>
      </section>`,
    script: `
      var hasSession = ${hasSession ? 'true' : 'false'};

      function escapeHtmlClient(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatDateTime(value) {
        if (!value) return 'Not available';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return escapeHtmlClient(value);
        return escapeHtmlClient(date.toLocaleString());
      }

      function profileTone(status) {
        if (status === 'connected') return 'ok';
        if (status === 'revoked' || status === 'pending') return 'warn';
        if (status === 'deleted') return 'danger';
        return 'neutral';
      }

      function adminHeaders() {
        var key = document.getElementById('adminKey').value.trim();
        return key ? { 'X-Admin-Key': key } : {};
      }

      function selectedProfile() {
        return document.getElementById('adminProfile').value.trim();
      }

      function contactFilter() {
        return document.getElementById('contactFilter').value.trim();
      }

      function setSelectedProfile(profileId) {
        document.getElementById('adminProfile').value = profileId;
      }

      function renderActionResult(title, tone, summary, technical) {
        var details = technical
          ? '<details class="details"><summary>Technical response</summary><div class="details-body"><pre class="technical-pre">' + escapeHtmlClient(typeof technical === 'string' ? technical : JSON.stringify(technical, null, 2)) + '</pre></div></details>'
          : '';
        document.getElementById('actionPanel').innerHTML =
          '<div class="kicker">Action result</div>' +
          '<div class="stack">' +
          '<div class="callout ' + escapeHtmlClient(tone) + '"><strong>' + escapeHtmlClient(title) + '</strong><div>' + escapeHtmlClient(summary) + '</div></div>' +
          details +
          '</div>';
      }

      async function readJsonResponse(response) {
        var text = await response.text();
        try {
          return { text: text, data: JSON.parse(text) };
        } catch (_error) {
          return { text: text, data: null };
        }
      }

      function renderProfiles(profiles) {
        if (!profiles.length) {
          document.getElementById('profilesPanel').innerHTML =
            '<div class="kicker">Profiles</div><div class="empty">No active profiles matched the current filter.</div>';
          return;
        }

        var rows = profiles.map(function (profile) {
          return '<tr>' +
            '<td><strong class="mono">' + escapeHtmlClient(profile.profile_id) + '</strong></td>' +
            '<td>' + escapeHtmlClient(profile.contact || profile.contact_masked || 'Not available') + '</td>' +
            '<td><span class="pill ' + profileTone(profile.status) + '">' + escapeHtmlClient(profile.status || 'unknown') + '</span></td>' +
            '<td>' + formatDateTime(profile.updated_at) + '</td>' +
            '<td><button class="button ghost" type="button" onclick="setSelectedProfile(\\'' + escapeHtmlClient(profile.profile_id).replace(/'/g, '&#39;') + '\\')">Use</button></td>' +
            '</tr>';
        }).join('');

        document.getElementById('profilesPanel').innerHTML =
          '<div class="kicker">Profiles</div>' +
          '<div class="stack">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
          '<div><h2>' + profiles.length + ' active connection' + (profiles.length === 1 ? '' : 's') + '</h2><p>Select a row to populate the profile action field.</p></div>' +
          '</div>' +
          '<div class="table-wrap"><table>' +
          '<thead><tr><th>Profile</th><th>Contact</th><th>Status</th><th>Updated</th><th>Use</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
          '</div>';
      }

      function renderAudit(entries) {
        if (!entries.length) {
          document.getElementById('auditPanel').innerHTML =
            '<div class="kicker">Audit log</div><div class="empty">No audit entries were returned for the selected range.</div>';
          return;
        }

        var cards = entries.map(function (entry) {
          return '<div class="card flat" style="padding:14px;border-radius:18px">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><strong>' + escapeHtmlClient(entry.event || 'event') + '</strong><span class="hint">' + formatDateTime(entry.ts) + '</span></div>' +
            '<p class="hint" style="margin:6px 0 0">IP: ' + escapeHtmlClient(entry.ip || 'unknown') + '</p>' +
            '<details class="details"><summary>Details</summary><div class="details-body"><pre class="technical-pre">' + escapeHtmlClient(JSON.stringify(entry.details || entry, null, 2)) + '</pre></div></details>' +
            '</div>';
        }).join('');

        document.getElementById('auditPanel').innerHTML =
          '<div class="kicker">Audit log</div>' +
          '<div class="stack"><h2>Recent governance events</h2><p>Most recent entries only. Use the raw API for deeper automation.</p>' + cards + '</div>';
      }

      async function doAdminLogout() {
        var response = await fetch('/miro/admin/logout', { method: 'POST' });
        var parsed = await readJsonResponse(response);
        renderActionResult(response.ok ? 'Logged out' : 'Logout failed', response.ok ? 'ok' : 'danger', response.ok ? 'The admin session cookie was cleared.' : 'The relay could not clear the admin session.', parsed.data || parsed.text);
        if (response.ok) {
          setTimeout(function () { window.location.href = '/miro/admin'; }, 300);
        }
      }

      async function doListProfiles() {
        renderActionResult('Loading profiles', 'ok', 'Fetching active relay profiles...', null);
        var filter = contactFilter();
        var path = '/miro/profiles' + (filter ? ('?contact=' + encodeURIComponent(filter)) : '');
        var response = await fetch(path, { headers: adminHeaders() });
        var parsed = await readJsonResponse(response);

        if (!response.ok || !parsed.data || !Array.isArray(parsed.data.profiles)) {
          var message = parsed.data && parsed.data.error ? parsed.data.error : ('Request failed with status ' + response.status + '.');
          renderActionResult('Could not load profiles', 'danger', message, parsed.data || parsed.text);
          return;
        }

        renderProfiles(parsed.data.profiles);
        renderActionResult('Profiles loaded', 'ok', parsed.data.profiles.length + ' active profile(s) loaded successfully.', parsed.data);
      }

      async function runProfileAction(label, path, method) {
        var id = selectedProfile();
        if (!id) {
          renderActionResult('No profile selected', 'warn', 'Select or enter a profile before running this action.', null);
          return;
        }

        var response = await fetch(path + encodeURIComponent(id), {
          method: method,
          headers: adminHeaders()
        });
        var parsed = await readJsonResponse(response);
        var ok = response.ok;
        var message = parsed.data && (parsed.data.message || parsed.data.note || parsed.data.error)
          ? (parsed.data.message || parsed.data.note || parsed.data.error)
          : (ok ? 'Action completed.' : ('Request failed with status ' + response.status + '.'));
        renderActionResult(label, ok ? 'ok' : 'danger', message, parsed.data || parsed.text);
        if (ok) doListProfiles();
      }

      async function doAdminDelete() {
        if (!selectedProfile()) {
          renderActionResult('No profile selected', 'warn', 'Select or enter a profile before deleting it.', null);
          return;
        }
        if (!window.confirm('Delete this profile and remove its stored OAuth access?')) return;
        await runProfileAction('Connection deleted', '/miro/admin/profiles/', 'DELETE');
      }

      async function doRotateToken() {
        var id = selectedProfile();
        if (!id) {
          renderActionResult('No profile selected', 'warn', 'Select or enter a profile before rotating the relay token.', null);
          return;
        }
        var response = await fetch('/miro/admin/profiles/' + encodeURIComponent(id) + '/rotate-token', {
          method: 'POST',
          headers: adminHeaders()
        });
        var parsed = await readJsonResponse(response);
        var ok = response.ok;
        var message = parsed.data && (parsed.data.note || parsed.data.message || parsed.data.error)
          ? (parsed.data.note || parsed.data.message || parsed.data.error)
          : (ok ? 'Relay token rotated.' : ('Request failed with status ' + response.status + '.'));
        renderActionResult('Relay token rotated', ok ? 'ok' : 'danger', message, parsed.data || parsed.text);
        if (ok) doListProfiles();
      }

      async function doRevokeOAuth() {
        var id = selectedProfile();
        if (!id) {
          renderActionResult('No profile selected', 'warn', 'Select or enter a profile before revoking OAuth.', null);
          return;
        }
        var response = await fetch('/miro/admin/profiles/' + encodeURIComponent(id) + '/revoke-oauth', {
          method: 'POST',
          headers: adminHeaders()
        });
        var parsed = await readJsonResponse(response);
        var ok = response.ok;
        var message = parsed.data && (parsed.data.message || parsed.data.error)
          ? (parsed.data.message || parsed.data.error)
          : (ok ? 'OAuth revoked.' : ('Request failed with status ' + response.status + '.'));
        renderActionResult('OAuth access updated', ok ? 'ok' : 'danger', message, parsed.data || parsed.text);
        if (ok) doListProfiles();
      }

      async function doAudit() {
        renderActionResult('Loading audit log', 'ok', 'Fetching recent governance events...', null);
        var response = await fetch('/miro/admin/audit?lines=80', { headers: adminHeaders() });
        var parsed = await readJsonResponse(response);

        if (!response.ok || !parsed.data || !Array.isArray(parsed.data.entries)) {
          var message = parsed.data && parsed.data.error ? parsed.data.error : ('Request failed with status ' + response.status + '.');
          renderActionResult('Could not load audit log', 'danger', message, parsed.data || parsed.text);
          return;
        }

        renderAudit(parsed.data.entries);
        renderActionResult('Audit log loaded', 'ok', parsed.data.entries.length + ' recent event(s) loaded.', parsed.data);
      }

      if (hasSession) {
        doListProfiles();
      }
    `,
  }));
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
async function createProfile({ profile_id, email, contact }) {
  const contactEmail = normalizeEmailProfileId(profile_id || email || contact);
  const profileId = profileIdFromEnrollmentInput({ profile_id, email, contact });
  const existing = profiles[profileId];
  if (existing && existing.status !== 'deleted') {
    throw Object.assign(new Error('profile already exists for this email'), { status: 409 });
  }

  const relayToken = newRelayToken();

  profiles[profileId] = {
    display_name: profileId,
    contact: contactEmail,
    provider_key: 'miro',
    provider_app_id: 'miro-default',
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
    auth_path: `/miro/auth/start?profile=${encodeURIComponent(profileId)}`,
    auth_url: `${BASE_URL}/miro/auth/start?profile=${encodeURIComponent(profileId)}`,
    mcp_url: `${BASE_URL}/miro/mcp/${encodeURIComponent(profileId)}`
  };
}

app.post('/miro/profiles', rateLimit('profiles-create', 20, 60_000), requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || req.body?.profile_id || req.body?.contact || '').trim();
    const created = await createProfile({ email, contact: email, profile_id: email });
    audit('profile_created_admin', { profile_id: created.profile_id }, req);

    res.status(201).json({
      ok: true,
      ...created,
      note: 'Store relay_token now. It is not shown again.'
    });
  } catch (e) {
    res.status(Number(e?.status) || 500).json({ error: String(e?.message || e) });
  }
});

// One-click browser enrollment flow (friendlier UX)
app.get('/miro/start', rateLimit('start-enroll', 30, 60_000), async (req, res) => {
  try {
    const email = normalizeEmailProfileId(safeText(req.query.email || req.query.contact || '', 120));
    const adminKey = String(req.query.admin_key || req.header('x-admin-key') || '');

    if (START_REQUIRE_ADMIN && (!ADMIN_API_KEY || adminKey !== ADMIN_API_KEY)) {
      return res.status(401).type('html').send(renderOnboardingMessagePage({
        title: 'Admin Approval Required',
        heading: 'Approval required',
        subtitle: 'Open this link with a valid admin key.',
        actionHref: '/miro',
        actionLabel: 'Back'
      }));
    }

    if (!email) {
      return res.type('html').send(renderOnboardingExperiencePage({ adminKey }));
    }

    const next = `/miro/auth/start?mode=enroll&email=${encodeURIComponent(email)}`;
    return res.redirect(next);
  } catch (e) {
    res.status(Number(e?.status) || 500).json({ error: String(e?.message || e) });
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
  const id = resolveProfileId(req.params.profileId);
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
  const id = resolveProfileId(req.params.profileId);
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
  const id = resolveProfileId(req.params.profileId);
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
    const mode = String(req.query.mode || '').trim().toLowerCase() === 'enroll' ? 'enroll' : 'reauth';
    const inputEmail = normalizeEmailProfileId(safeText(req.query.email || '', 120));
    const inputProfileId = String(req.query.profile || '').trim();

    let profileId = '';
    let enrollmentEmail = '';

    if (mode === 'enroll') {
      enrollmentEmail = inputEmail;
      if (!enrollmentEmail) {
        return res.status(400).type('html').send(renderOnboardingMessagePage({
          title: 'Email Required',
          heading: 'Email required',
          subtitle: 'Start again and enter the address first.',
          actionHref: '/miro',
          actionLabel: 'Start again',
          progressIndex: 1
        }));
      }
      if (!isValidEmailLike(enrollmentEmail)) {
        return res.status(400).type('html').send(renderOnboardingMessagePage({
          title: 'Invalid Email',
          heading: 'Use a real email',
          subtitle: 'Try a normal address like name@company.com.',
          actionHref: '/miro',
          actionLabel: 'Try again',
          progressIndex: 1
        }));
      }
      profileId = canonicalProfileId(enrollmentEmail);
    } else {
      profileId = resolveProfileId(inputProfileId || inputEmail);
      if (!profileId || !profiles[profileId] || profiles[profileId].status === 'deleted') {
        return res.status(404).type('html').send(renderOnboardingMessagePage({
          title: 'Connection Not Found',
          heading: 'Connection not found',
          subtitle: 'Start a new setup for this profile.',
          actionHref: '/miro',
          actionLabel: 'Start setup',
          progressIndex: 1
        }));
      }
      enrollmentEmail = normalizeEmail(profiles[profileId]?.contact || profileIdToEmail(profileId));
    }

    const { verifier, challenge } = makePkce();
    const state = b64url(crypto.randomBytes(24));
    const c = await registerClient(profileId);
    pending.set(state, { profileId, verifier, mode, enrollmentEmail });

    const q = new URLSearchParams({
      response_type: 'code',
      client_id: c.client_id,
      redirect_uri: c.redirect_uri,
      scope: OAUTH_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `${MCP_BASE}/authorize?${q.toString()}`;

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
    if (!code || !p) {
      return res.status(400).type('html').send(renderOnboardingMessagePage({
        title: 'Invalid Callback',
        heading: 'This session expired',
        subtitle: 'Start the setup again from the beginning.',
        actionHref: '/miro',
        actionLabel: 'Start again',
        progressIndex: 2
      }));
    }

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

    const isEnrollMode = p.mode === 'enroll';
    const existingProfile = profiles[p.profileId] || {};
    const expectedEmail = normalizeEmail(p.enrollmentEmail || expectedProfileEmail(p.profileId, existingProfile));
    const activeExisting = existingProfile && existingProfile.status && existingProfile.status !== 'deleted';

    if (isEnrollMode && activeExisting) {
      pending.delete(state);
      audit('oauth_finalize_conflict', { profile_id: p.profileId }, req);
      return res.status(409).type('html').send(renderOnboardingMessagePage({
        title: 'Connection Exists',
        heading: 'Already connected',
        subtitle: `${p.profileId} is already active here.`,
        actionHref: '/miro',
        actionLabel: 'Start over',
        progressIndex: 2
      }));
    }

    const identity = extractIdentityFromTokenResponse(data);
    const tokenContext = await fetchMiroTokenContext(data.access_token);

    const detectedEmail = identity.email;
    const oauthUserId = identity.userId || tokenContext.userId || '';
    const oauthUserName = identity.userName || tokenContext.userName || '';

    let emailCheckStatus = 'unavailable';
    let emailMatch = null;
    if (expectedEmail && detectedEmail) {
      emailMatch = expectedEmail === detectedEmail;
      emailCheckStatus = emailMatch ? 'match' : 'mismatch';
    } else if (!expectedEmail) {
      emailCheckStatus = 'expected_missing';
    }

    const strictEmailMode = OAUTH_EMAIL_MODE === 'strict';
    const shouldBlockOnEmail = strictEmailMode && emailCheckStatus !== 'match';

    const oauthMeta = {
      oauth_user_id: oauthUserId || null,
      oauth_user_name: oauthUserName || null,
      oauth_email_expected: expectedEmail || null,
      oauth_email_detected: detectedEmail || null,
      oauth_email_verified: identity.emailVerified,
      oauth_email_match: emailMatch,
      oauth_email_check_status: emailCheckStatus,
      oauth_token_context_error: tokenContext.ok ? null : (tokenContext.error || 'unknown'),
      oauth_id_token_present: Boolean(data?.id_token),
      oauth_checked_at: nowIso()
    };

    if (emailCheckStatus === 'match') {
      audit('oauth_email_check_match', { profile_id: p.profileId, expected_email: expectedEmail, detected_email: detectedEmail }, req);
    } else if (emailCheckStatus === 'mismatch') {
      audit('oauth_email_check_mismatch', { profile_id: p.profileId, expected_email: expectedEmail, detected_email: detectedEmail, mode: OAUTH_EMAIL_MODE }, req);
    } else {
      audit('oauth_email_check_unavailable', {
        profile_id: p.profileId,
        expected_email: expectedEmail || null,
        detected_email: detectedEmail || null,
        mode: OAUTH_EMAIL_MODE,
        token_context_ok: tokenContext.ok,
        token_context_error: tokenContext.error || null,
        id_token_present: Boolean(data?.id_token)
      }, req);
    }

    if (shouldBlockOnEmail) {
      if (!isEnrollMode) {
        profiles[p.profileId] = {
          ...(profiles[p.profileId] || {}),
          provider_key: 'miro',
          provider_app_id: 'miro-default',
          ...oauthMeta,
          status: 'pending',
          updated_at: nowIso()
        };
        saveAll();
      }
      pending.delete(state);

      return res.status(403).type('html').send(renderOnboardingMessagePage({
        title: 'Identity Blocked',
        heading: 'Wrong Miro account',
        subtitle: 'The email check did not pass in strict mode.',
        actionHref: '/miro',
        actionLabel: 'Start again',
        progressIndex: 2,
        detailsHtml: `
          <div class="experience-meta">Expected: <strong class="mono">${escapeHtml(expectedEmail || '(missing)')}</strong></div>
          <div class="experience-meta">Detected: <strong class="mono">${escapeHtml(detectedEmail || '(not available)')}</strong></div>`
      }));
    }

    let relayToken = null;
    let profileCreatedAt = profiles[p.profileId]?.created_at || nowIso();
    if (isEnrollMode) {
      relayToken = newRelayToken();
      profiles[p.profileId] = {
        display_name: p.profileId,
        contact: expectedEmail,
        provider_key: 'miro',
        provider_app_id: 'miro-default',
        relay_token_hash: tokenHash(relayToken),
        status: 'pending',
        created_at: profileCreatedAt,
        updated_at: nowIso()
      };
    } else if (!profiles[p.profileId]) {
      return res.status(404).type('html').send(renderOnboardingMessagePage({
        title: 'Connection Missing',
        heading: 'That profile disappeared',
        subtitle: 'Start a fresh setup to continue.',
        actionHref: '/miro',
        actionLabel: 'Start again',
        progressIndex: 2
      }));
    }

    tokens[p.profileId] = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      scope: data.scope,
      expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
      provider_key: 'miro',
      provider_app_id: 'miro-default'
    };
    profiles[p.profileId] = {
      ...(profiles[p.profileId] || {}),
      provider_key: 'miro',
      provider_app_id: 'miro-default',
      ...oauthMeta,
      status: 'connected',
      connected_at: profiles[p.profileId]?.connected_at || nowIso(),
      updated_at: nowIso()
    };

    pending.delete(state);
    saveAll();
    audit('oauth_success', {
      profile_id: p.profileId,
      scope: data.scope || null,
      email_check_status: emailCheckStatus,
      email_mode: OAUTH_EMAIL_MODE,
      token_context_ok: tokenContext.ok,
      mode: isEnrollMode ? 'enroll' : 'reauth'
    }, req);
    if (isEnrollMode) {
      audit('oauth_finalize_success', { profile_id: p.profileId }, req);
    }

    const emailState = emailCheckView(emailCheckStatus);
    const mcpUrl = `${BASE_URL}/miro/mcp/${encodeURIComponent(p.profileId)}`;

    if (isEnrollMode) {
      const credentialsBundle = JSON.stringify({
        profile_id: p.profileId,
        relay_token: relayToken,
        mcp_url: mcpUrl
      }, null, 2);
      const mcpConfigJson = JSON.stringify({
        mcpServers: {
          miro_personal: {
            type: 'streamable-http',
            url: mcpUrl,
            headers: {
              'X-Relay-Key': relayToken
            }
          }
        }
      }, null, 2);

      return res.type('html').send(renderConfigScenePage({
        mcpConfigJson,
        credentialsBundle,
        emailStateLabel: emailState.label
      }));
    }

    res.type('html').send(renderReconnectScenePage({
      emailStateLabel: emailState.label
    }));
  } catch (e) {
    audit('oauth_failed', { error: String(e) }, req);
    res.status(500).type('html').send(renderOnboardingMessagePage({
      title: 'Authentication Failed',
      heading: 'Could not finish setup',
      subtitle: 'The final Miro handshake failed.',
      actionHref: '/miro',
      actionLabel: 'Start again',
      progressIndex: 2,
      detailsHtml: `<div class="experience-meta"><code>${escapeHtml(String(e))}</code></div>`
    }));
  }
});

app.get('/broker/admin/provider-apps', requireAdmin, (_req, res) => {
  const apps = Object.values(providerApps).map((providerApp) => normalizeProviderApp(providerApp));
  res.json({ ok: true, provider_apps: apps });
});

app.post('/broker/admin/provider-apps', requireAdmin, (req, res) => {
  try {
    const id = safeText(req.body?.id || '', 120).toLowerCase();
    const providerKey = safeText(req.body?.provider_key || '', 120).toLowerCase();
    if (!id || !providerKey) {
      return res.status(400).json({ error: 'id and provider_key are required' });
    }

    const providerApp = upsertProviderApp({
      id,
      provider_key: providerKey,
      display_name: safeText(req.body?.display_name || id, 120),
      enabled: req.body?.enabled !== false,
      access_mode: normalizeAccessMode(req.body?.access_mode, ACCESS_MODE_RELAY),
      allow_relay: typeof req.body?.allow_relay === 'boolean' ? req.body.allow_relay : undefined,
      allow_direct_token_return: typeof req.body?.allow_direct_token_return === 'boolean'
        ? req.body.allow_direct_token_return
        : undefined,
      relay_protocol: safeText(req.body?.relay_protocol || '', 120).toLowerCase(),
      allow_streaming: typeof req.body?.allow_streaming === 'boolean' ? req.body.allow_streaming : true,
      allowed_service_ids: normalizeStringArray(req.body?.allowed_service_ids),
      scope_ceiling: normalizeStringArray(req.body?.scope_ceiling)
    });
    audit('provider_app_upserted', { provider_app_id: providerApp.id, provider_key: providerApp.provider_key }, req);
    res.status(201).json({ ok: true, provider_app: providerApp });
  } catch (e) {
    res.status(Number(e?.status) || 500).json({ error: String(e?.message || e) });
  }
});

app.post('/broker/admin/service-clients', requireAdmin, (req, res) => {
  try {
    const created = issueServiceClient({
      service_id: req.body?.service_id,
      display_name: req.body?.display_name,
      allowed_provider_app_ids: req.body?.allowed_provider_app_ids,
      environment: req.body?.environment
    });
    audit('service_client_created', { service_id: created.service_id }, req);
    res.status(201).json({ ok: true, ...created, note: 'Store service_key now. It is not shown again.' });
  } catch (e) {
    res.status(Number(e?.status) || 500).json({ error: String(e?.message || e) });
  }
});

app.get('/broker/admin/service-clients', requireAdmin, (_req, res) => {
  const clientsList = Object.values(serviceClients).map((client) => ({
    id: client.id,
    display_name: client.display_name,
    allowed_provider_app_ids: client.allowed_provider_app_ids || [],
    environment: client.environment || '',
    enabled: client.enabled !== false,
    created_at: client.created_at,
    updated_at: client.updated_at
  }));
  res.json({ ok: true, service_clients: clientsList });
});

app.post('/broker/admin/delegation-grants', requireAdmin, (req, res) => {
  try {
    const created = issueDelegationGrant({
      profile_id: req.body?.profile_id,
      service_id: req.body?.service_id,
      provider_key: req.body?.provider_key || 'miro',
      provider_app_id: req.body?.provider_app_id || 'miro-default',
      allowed_access_modes: req.body?.allowed_access_modes,
      scope_ceiling: req.body?.scope_ceiling,
      environment: req.body?.environment,
      expires_in_days: req.body?.expires_in_days,
      expires_in_hours: req.body?.expires_in_hours
    });
    audit('delegation_grant_created', {
      grant_id: created.grant_id,
      service_id: created.grant.service_id,
      profile_id: created.grant.profile_id,
      provider_app_id: created.grant.provider_app_id
    }, req);
    res.status(201).json({ ok: true, ...created, note: 'Store delegated_credential now. It is not shown again.' });
  } catch (e) {
    res.status(Number(e?.status) || 500).json({ error: String(e?.message || e) });
  }
});

app.get('/broker/admin/delegation-grants', requireAdmin, (_req, res) => {
  const grants = Object.values(delegationGrants).map((grant) => ({
    id: grant.id,
    profile_id: grant.profile_id,
    service_id: grant.service_id,
    provider_key: grant.provider_key,
    provider_app_id: grant.provider_app_id,
    allowed_access_modes: grant.allowed_access_modes,
    scope_ceiling: grant.scope_ceiling || [],
    environment: grant.environment || '',
    enabled: grant.enabled !== false,
    expires_at: grant.expires_at,
    revoked_at: grant.revoked_at || null,
    created_at: grant.created_at,
    updated_at: grant.updated_at
  }));
  res.json({ ok: true, delegation_grants: grants });
});

app.post('/broker/admin/delegation-grants/:grantId/revoke', requireAdmin, (req, res) => {
  const grantId = String(req.params.grantId || '').trim();
  const grant = delegationGrants[grantId];
  if (!grant) {
    return res.status(404).json({ error: 'delegation grant not found' });
  }

  delegationGrants[grantId] = {
    ...grant,
    enabled: false,
    revoked_at: nowIso(),
    updated_at: nowIso()
  };
  saveAll();
  audit('delegation_grant_revoked', { grant_id: grantId }, req);
  res.json({ ok: true, grant: delegationGrants[grantId] });
});

app.post('/broker/provider-access/:provider/:profileId', rateLimit('provider-access', 60, 60_000), async (req, res) => {
  const providerKey = safeText(req.params.provider || '', 120).toLowerCase();
  const profileId = resolveProfileId(req.params.profileId);
  const requestedMode = ACCESS_MODE_DIRECT_TOKEN;
  if (!profileId || !profiles[profileId] || profiles[profileId].status === 'deleted') {
    return res.status(404).json({ error: 'profile not found' });
  }

  const auth = authenticateServiceRequest(req, { profileId, providerKey, requestedMode });
  if (!auth.ok) {
    recordTokenIssueEvent('provider_access_token_denied', {
      provider_key: providerKey,
      profile_id: profileId,
      error: auth.error,
      provider_app_id: auth.providerApp?.id || null,
      service_id: auth.serviceClient?.id || null
    }, req);
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    const accessToken = await getAccessToken(profileId);
    const tokenSet = tokens[profileId] || {};
    const responseBody = {
      ok: true,
      provider_key: providerKey,
      provider_app_id: auth.providerApp.id,
      profile_id: profileId,
      access_mode: ACCESS_MODE_DIRECT_TOKEN,
      access_token: accessToken,
      token_type: tokenSet.token_type || 'Bearer',
      scope: tokenSet.scope || null,
      expires_at: tokenSet.expires_at || null
    };
    const details = {
      provider_key: providerKey,
      provider_app_id: auth.providerApp.id,
      profile_id: profileId,
      service_id: auth.serviceClient.id,
      grant_id: auth.grant.id,
      scope: tokenSet.scope || null
    };
    audit('provider_access_token_issued', details, req);
    recordTokenIssueEvent('provider_access_token_issued', details, req);
    res.json(responseBody);
  } catch (e) {
    recordTokenIssueEvent('provider_access_token_failed', {
      provider_key: providerKey,
      profile_id: profileId,
      provider_app_id: auth.providerApp.id,
      service_id: auth.serviceClient.id,
      grant_id: auth.grant.id,
      error: String(e)
    }, req);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/broker/relay/:provider/:profileId', rateLimit('broker-relay', 120, 60_000), async (req, res) => {
  const providerKey = safeText(req.params.provider || '', 120).toLowerCase();
  const profileId = resolveProfileId(req.params.profileId);
  if (!profileId || !profiles[profileId] || profiles[profileId].status === 'deleted') {
    return res.status(404).json({ error: 'profile not found' });
  }

  const auth = authenticateServiceRequest(req, { profileId, providerKey, requestedMode: ACCESS_MODE_RELAY });
  if (!auth.ok) {
    recordRelayCall('relay_call_denied', {
      provider_key: providerKey,
      profile_id: profileId,
      error: auth.error,
      provider_app_id: auth.providerApp?.id || null,
      service_id: auth.serviceClient?.id || null
    }, req);
    return res.status(auth.status).json({ error: auth.error });
  }

  return relayProviderRequest({
    providerKey,
    profileId,
    req,
    res,
    actor: { type: 'service', id: auth.serviceClient.id }
  });
});

app.get('/broker/admin/token-issues', requireAdmin, (req, res) => {
  const entries = readJsonLines(TOKEN_ISSUE_FILE, Number(req.query.lines || 200));
  res.json({ ok: true, count: entries.length, entries });
});

app.get('/broker/admin/relay-calls', requireAdmin, (req, res) => {
  const entries = readJsonLines(RELAY_CALL_FILE, Number(req.query.lines || 200));
  res.json({ ok: true, count: entries.length, entries });
});

app.post('/miro/mcp/:profile', requireProfileToken, async (req, res) => {
  return relayProviderRequest({
    providerKey: 'miro',
    profileId: req.profileId,
    req,
    res,
    actor: { type: 'profile', id: req.profileId }
  });
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
    const out = readJsonLines(AUDIT_FILE, Number(req.query.lines || 200));
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
      oauth_email_mode: OAUTH_EMAIL_MODE,
      oauth_scope: OAUTH_SCOPE,
      pending_profile_ttl_minutes: PENDING_PROFILE_TTL_MINUTES,
      miro_provider_access_mode: getProviderApp('miro-default')?.access_mode || ACCESS_MODE_RELAY,
      miro_allow_relay: getProviderApp('miro-default')?.allow_relay !== false,
      miro_allow_direct_token_return: getProviderApp('miro-default')?.allow_direct_token_return === true
    },
    endpoints: {
      ui: '/miro',
      workspace_ui: '/miro/workspace',
      admin_ui: '/miro/admin',
      health: '/healthz',
      ready: '/readyz',
      start_enroll: '/miro/start?email=user@example.com (final profile + relay token are created after successful callback)',
      status: '/miro/status',
      create_profile: 'POST /miro/profiles (X-Admin-Key)',
      auth_start: '/miro/auth/start?profile=<profile_id>',
      mcp_proxy: '/miro/mcp/:profile (POST, X-Relay-Key)',
      generic_relay: '/broker/relay/:provider/:profileId (POST, X-Service-Key + X-Delegated-Credential)',
      provider_access_token: '/broker/provider-access/:provider/:profileId (POST, X-Service-Key + X-Delegated-Credential)',
      deregister: 'DELETE /miro/profiles/:profileId (X-Relay-Key of profile)',
      admin_deregister: 'DELETE /miro/admin/profiles/:profileId (X-Admin-Key)',
      admin_rotate_token: 'POST /miro/admin/profiles/:profileId/rotate-token (X-Admin-Key)',
      admin_revoke_oauth: 'POST /miro/admin/profiles/:profileId/revoke-oauth (X-Admin-Key)',
      admin_audit: 'GET /miro/admin/audit?lines=200 (X-Admin-Key)',
      admin_provider_apps: 'GET/POST /broker/admin/provider-apps (X-Admin-Key)',
      admin_service_clients: 'GET/POST /broker/admin/service-clients (X-Admin-Key)',
      admin_delegation_grants: 'GET/POST /broker/admin/delegation-grants (X-Admin-Key)',
      admin_token_issues: 'GET /broker/admin/token-issues?lines=200 (X-Admin-Key)',
      admin_relay_calls: 'GET /broker/admin/relay-calls?lines=200 (X-Admin-Key)'
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
  console.log(`OAUTH_EMAIL_MODE=${OAUTH_EMAIL_MODE}`);
  console.log(`OAUTH_SCOPE=${OAUTH_SCOPE}`);
  console.log(`PENDING_PROFILE_TTL_MINUTES=${PENDING_PROFILE_TTL_MINUTES}`);
});
