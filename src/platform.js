export const ACCESS_MODE_RELAY = 'relay';
export const ACCESS_MODE_DIRECT_TOKEN = 'direct_token';
export const ACCESS_MODE_HYBRID = 'hybrid';

export const ACCESS_MODES = [
  ACCESS_MODE_RELAY,
  ACCESS_MODE_DIRECT_TOKEN,
  ACCESS_MODE_HYBRID
];

export const RELAY_PROTOCOL_MCP_STREAMABLE_HTTP = 'mcp_streamable_http';
export const RELAY_PROTOCOL_REST_PROXY = 'rest_proxy';

export const RELAY_PROTOCOLS = [
  RELAY_PROTOCOL_MCP_STREAMABLE_HTTP,
  RELAY_PROTOCOL_REST_PROXY
];

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => String(item || '').trim()).filter(Boolean));
  }

  const raw = String(value || '').trim();
  if (!raw) return [];
  return uniqueStrings(raw.split(/[,\s]+/g).map((item) => item.trim()).filter(Boolean));
}

export function normalizeAccessMode(value, fallback = ACCESS_MODE_RELAY) {
  const normalized = String(value || '').trim().toLowerCase();
  return ACCESS_MODES.includes(normalized) ? normalized : fallback;
}

export function normalizeAllowedAccessModes(values, fallbackMode = ACCESS_MODE_RELAY) {
  const normalized = uniqueStrings(normalizeStringArray(values).map((value) => normalizeAccessMode(value, '')));
  if (normalized.length > 0) return normalized;

  const fallback = normalizeAccessMode(fallbackMode, ACCESS_MODE_RELAY);
  if (fallback === ACCESS_MODE_HYBRID) {
    return [ACCESS_MODE_RELAY, ACCESS_MODE_DIRECT_TOKEN];
  }
  return [fallback];
}

export function parseScopeString(value) {
  return normalizeStringArray(value);
}

export function normalizeProviderApp(input = {}) {
  const accessMode = normalizeAccessMode(input.access_mode, ACCESS_MODE_RELAY);
  const allowRelay = typeof input.allow_relay === 'boolean'
    ? input.allow_relay
    : accessMode !== ACCESS_MODE_DIRECT_TOKEN;
  const allowDirectTokenReturn = typeof input.allow_direct_token_return === 'boolean'
    ? input.allow_direct_token_return
    : accessMode !== ACCESS_MODE_RELAY;
  const relayProtocol = RELAY_PROTOCOLS.includes(input.relay_protocol)
    ? input.relay_protocol
    : RELAY_PROTOCOL_MCP_STREAMABLE_HTTP;

  return {
    id: String(input.id || '').trim(),
    provider_key: String(input.provider_key || '').trim().toLowerCase(),
    display_name: String(input.display_name || '').trim() || String(input.id || '').trim(),
    enabled: input.enabled !== false,
    access_mode: accessMode,
    allow_relay: allowRelay,
    allow_direct_token_return: allowDirectTokenReturn,
    relay_protocol: relayProtocol,
    allow_streaming: input.allow_streaming !== false,
    allowed_service_ids: normalizeStringArray(input.allowed_service_ids),
    scope_ceiling: normalizeStringArray(input.scope_ceiling),
    created_at: input.created_at || null,
    updated_at: input.updated_at || null
  };
}

export function createDefaultMiroProviderApp(scopeString, nowIso) {
  return normalizeProviderApp({
    id: 'miro-default',
    provider_key: 'miro',
    display_name: 'Miro MCP Relay',
    enabled: true,
    access_mode: ACCESS_MODE_RELAY,
    allow_relay: true,
    allow_direct_token_return: false,
    relay_protocol: RELAY_PROTOCOL_MCP_STREAMABLE_HTTP,
    allow_streaming: true,
    allowed_service_ids: [],
    scope_ceiling: parseScopeString(scopeString),
    created_at: nowIso,
    updated_at: nowIso
  });
}

export function isProviderAppRelayEnabled(providerApp) {
  if (!providerApp?.enabled) return false;
  if (!providerApp.allow_relay) return false;
  return providerApp.access_mode === ACCESS_MODE_RELAY || providerApp.access_mode === ACCESS_MODE_HYBRID;
}

export function isProviderDirectTokenAllowed(providerApp) {
  if (!providerApp?.enabled) return false;
  if (!providerApp.allow_direct_token_return) return false;
  return providerApp.access_mode === ACCESS_MODE_DIRECT_TOKEN || providerApp.access_mode === ACCESS_MODE_HYBRID;
}

export function isGrantActive(grant, nowMs = Date.now()) {
  if (!grant || grant.enabled === false || grant.revoked_at) return false;
  if (!grant.expires_at) return true;
  const expiresAt = Date.parse(grant.expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  return nowMs < expiresAt;
}

export function validateServiceAccess({
  providerApp,
  serviceClient,
  grant,
  requestedMode,
  providerKey,
  providerAppId,
  profileId,
  environment = '',
  nowMs = Date.now()
}) {
  if (!serviceClient || serviceClient.enabled === false) {
    return { ok: false, reason: 'service_client_disabled' };
  }

  if (!isGrantActive(grant, nowMs)) {
    return { ok: false, reason: 'delegation_inactive' };
  }

  if (grant.service_id !== serviceClient.id) {
    return { ok: false, reason: 'delegation_service_mismatch' };
  }

  if (grant.profile_id !== profileId) {
    return { ok: false, reason: 'delegation_profile_mismatch' };
  }

  if (grant.provider_key && grant.provider_key !== providerKey) {
    return { ok: false, reason: 'delegation_provider_mismatch' };
  }

  if (grant.provider_app_id && grant.provider_app_id !== providerAppId) {
    return { ok: false, reason: 'delegation_provider_app_mismatch' };
  }

  if (providerApp.provider_key && providerApp.provider_key !== providerKey) {
    return { ok: false, reason: 'provider_app_provider_mismatch' };
  }

  if (grant.environment && serviceClient.environment && grant.environment !== serviceClient.environment) {
    return { ok: false, reason: 'delegation_environment_mismatch' };
  }

  if (environment && grant.environment && grant.environment !== environment) {
    return { ok: false, reason: 'request_environment_mismatch' };
  }

  if (providerApp.allowed_service_ids.length > 0 && !providerApp.allowed_service_ids.includes(serviceClient.id)) {
    return { ok: false, reason: 'service_not_allowed_for_provider_app' };
  }

  if (Array.isArray(serviceClient.allowed_provider_app_ids)
    && serviceClient.allowed_provider_app_ids.length > 0
    && !serviceClient.allowed_provider_app_ids.includes(providerApp.id)) {
    return { ok: false, reason: 'provider_app_not_allowed_for_service' };
  }

  const allowedModes = normalizeAllowedAccessModes(grant.allowed_access_modes, providerApp.access_mode);
  if (!allowedModes.includes(requestedMode)) {
    return { ok: false, reason: 'delegation_mode_not_allowed' };
  }

  if (requestedMode === ACCESS_MODE_RELAY && !isProviderAppRelayEnabled(providerApp)) {
    return { ok: false, reason: 'provider_app_relay_disabled' };
  }

  if (requestedMode === ACCESS_MODE_DIRECT_TOKEN && !isProviderDirectTokenAllowed(providerApp)) {
    return { ok: false, reason: 'provider_app_direct_token_disabled' };
  }

  return { ok: true };
}
