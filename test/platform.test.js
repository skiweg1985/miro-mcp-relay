import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_MODE_DIRECT_TOKEN,
  ACCESS_MODE_HYBRID,
  ACCESS_MODE_RELAY,
  createDefaultMiroProviderApp,
  isProviderDirectTokenAllowed,
  isProviderAppRelayEnabled,
  normalizeAllowedAccessModes,
  normalizeProviderApp,
  validateServiceAccess
} from '../src/platform.js';

test('default miro provider app is relay-first', () => {
  const app = createDefaultMiroProviderApp('boards:read boards:write', '2026-04-03T00:00:00.000Z');

  assert.equal(app.id, 'miro-default');
  assert.equal(app.provider_key, 'miro');
  assert.equal(app.access_mode, ACCESS_MODE_RELAY);
  assert.equal(isProviderAppRelayEnabled(app), true);
  assert.equal(isProviderDirectTokenAllowed(app), false);
  assert.deepEqual(app.scope_ceiling, ['boards:read', 'boards:write']);
});

test('hybrid mode normalizes to both relay and direct token access', () => {
  assert.deepEqual(
    normalizeAllowedAccessModes([], ACCESS_MODE_HYBRID),
    [ACCESS_MODE_RELAY, ACCESS_MODE_DIRECT_TOKEN]
  );
});

test('service access validation blocks disallowed direct token issuance', () => {
  const providerApp = normalizeProviderApp({
    id: 'miro-default',
    provider_key: 'miro',
    access_mode: ACCESS_MODE_RELAY,
    allow_relay: true,
    allow_direct_token_return: false
  });

  const result = validateServiceAccess({
    providerApp,
    serviceClient: { id: 'agent-a', enabled: true, environment: 'prod' },
    grant: {
      service_id: 'agent-a',
      profile_id: 'user_example.com',
      provider_key: 'miro',
      provider_app_id: 'miro-default',
      allowed_access_modes: [ACCESS_MODE_DIRECT_TOKEN],
      environment: 'prod',
      expires_at: '2099-01-01T00:00:00.000Z'
    },
    requestedMode: ACCESS_MODE_DIRECT_TOKEN,
    providerKey: 'miro',
    providerAppId: 'miro-default',
    profileId: 'user_example.com',
    environment: 'prod'
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'provider_app_direct_token_disabled'
  });
});

test('service access validation allows hybrid provider with matching grant', () => {
  const providerApp = normalizeProviderApp({
    id: 'graph-default',
    provider_key: 'microsoft-graph',
    access_mode: ACCESS_MODE_HYBRID,
    allow_relay: true,
    allow_direct_token_return: true,
    allowed_service_ids: ['agent-a']
  });

  const result = validateServiceAccess({
    providerApp,
    serviceClient: { id: 'agent-a', enabled: true, environment: 'prod' },
    grant: {
      service_id: 'agent-a',
      profile_id: 'user_example.com',
      provider_key: 'microsoft-graph',
      provider_app_id: 'graph-default',
      allowed_access_modes: [ACCESS_MODE_RELAY, ACCESS_MODE_DIRECT_TOKEN],
      environment: 'prod',
      expires_at: '2099-01-01T00:00:00.000Z'
    },
    requestedMode: ACCESS_MODE_DIRECT_TOKEN,
    providerKey: 'microsoft-graph',
    providerAppId: 'graph-default',
    profileId: 'user_example.com',
    environment: 'prod'
  });

  assert.deepEqual(result, { ok: true });
});
