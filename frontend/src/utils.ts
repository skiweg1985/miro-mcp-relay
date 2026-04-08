import type { RouteMatch } from "./types";

const LEGACY_PATHS: Record<string, string> = {
  "/app/providers": "/workspace/integrations-v2",
  "/app/connections": "/workspace/connections",
  "/app/service-clients": "/workspace/integrations-v2",
  "/app/services": "/workspace/integrations-v2",
  "/app/delegation": "/workspace/integrations-v2",
  "/app/audit": "/workspace/integrations-v2",
  "/app": "/workspace/integrations-v2",
  "/app/integrations": "/workspace/integrations-v2",
  "/app/users": "/workspace/integrations-v2",
  "/app/access": "/workspace/integrations-v2",
  "/app/logs": "/workspace/integrations-v2",
  "/workspace": "/workspace/integrations-v2",
  "/workspace/integrations": "/workspace/integrations-v2",
  "/workspace/clients": "/workspace/integrations-v2",
  "/grants": "/workspace/broker-access",
  "/token-access": "/workspace/broker-access",
};

/** If the browser is on a legacy URL, returns the canonical path to replace the history entry. */
export function replaceLegacyAdminPath(pathname: string): string | null {
  const raw = pathname.length > 1 && pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : pathname;
  return LEGACY_PATHS[raw] ?? null;
}

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseApiDateTime(value: string): Date {
  const trimmed = value.trim();
  const isoNaiveUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/i.test(trimmed);
  const hasTzSuffix = /Z$|[+-]\d{2}:\d{2}$/i.test(trimmed);
  return new Date(isoNaiveUtc && !hasTzSuffix ? `${trimmed}Z` : trimmed);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Not set";
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const OAUTH_CALLBACK_MESSAGES: Record<string, string> = {
  connection_failed: "Connection failed.",
  missing_callback_parameters: "Missing OAuth callback parameters.",
  invalid_oauth_state: "Invalid or expired sign-in state. Try again.",
  oauth_callback_state_invalid: "Invalid or expired sign-in state. Try again.",
  invalid_connection_target: "Invalid connection target.",
  integration_not_found: "Integration not found.",
  microsoft_oauth_not_configured: "Microsoft sign-in is not configured for this broker.",
  token_exchange_failed: "Token exchange with the provider failed.",
  missing_access_token: "No access token returned from the provider.",
  miro_oauth_not_configured: "Miro OAuth is not configured for this integration.",
  oauth_provider_configuration_incomplete: "OAuth provider configuration is incomplete.",
  oauth_authorization_endpoint_missing: "Authorization URL is not configured.",
  oauth_token_endpoint_missing: "Token URL is not configured.",
  oauth_client_id_missing: "OAuth client ID is not configured.",
  oauth_client_secret_not_configured: "OAuth client secret is not configured.",
  oauth_invalid_authorization_url: "Authorization URL is not a valid http(s) URL.",
  oauth_invalid_token_url: "Token URL is not a valid http(s) URL.",
  oauth_invalid_userinfo_url: "Userinfo URL is not a valid http(s) URL.",
  oauth_invalid_discovery_url: "Discovery URL is not a valid http(s) URL.",
  oauth_invalid_jwks_url: "JWKS URL is not a valid http(s) URL.",
  claim_mapping_missing_subject: "Provider response had no subject for the configured claim mapping.",
  integration_oauth_template_unsupported: "This integration does not support the connection sign-in flow.",
};

/** Maps backend OAuth redirect `message` query codes to English copy for toasts. */
export function formatOAuthCallbackMessage(raw: string | null | undefined): string {
  if (!raw || !String(raw).trim()) return "Something went wrong.";
  const key = String(raw).trim();
  if (OAUTH_CALLBACK_MESSAGES[key]) return OAUTH_CALLBACK_MESSAGES[key];
  if (/^[a-z0-9_]+$/i.test(key) && key.includes("_")) {
    return "Connection error.";
  }
  return key;
}

export async function copyToClipboard(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function classNames(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter(Boolean).join(" ");
}

export function matchesRoute(pathname: string): RouteMatch {
  const raw = pathname.length > 1 && pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : pathname;
  let path = LEGACY_PATHS[raw] ?? raw;
  if (path.startsWith("/app/integrations/")) {
    path = "/workspace/integrations-v2";
  }
  if (path.startsWith("/connect/")) {
    path = "/workspace/integrations-v2";
  }
  if (path === "/" || path === "/login") return { name: "login", path: "/login" };
  if (path === "/miro" || path === "/start" || path === "/miro/start" || path === "/miro/workspace" || path === "/miro/admin") {
    return { name: "workspaceIntegrationsV2", path: "/workspace/integrations-v2" };
  }
  if (path === "/workspace/integrations-v2") {
    return { name: "workspaceIntegrationsV2", path: "/workspace/integrations-v2" };
  }
  if (path === "/workspace/broker-access") {
    return { name: "workspaceBrokerAccess", path: "/workspace/broker-access" };
  }
  if (path === "/workspace/connections") {
    return { name: "workspaceConnections", path: "/workspace/connections" };
  }
  if (path === "/workspace/admin/microsoft-oauth") {
    return { name: "workspaceAdminMicrosoftOAuth", path: "/workspace/admin/microsoft-oauth" };
  }
  if (path === "/workspace/admin/login-providers") {
    return { name: "workspaceAdminLoginProviders", path: "/workspace/admin/login-providers" };
  }
  if (path === "/workspace/admin/users") {
    return { name: "workspaceAdminUsers", path: "/workspace/admin/users" };
  }
  if (path.startsWith("/grants") || path.startsWith("/token-access")) {
    return { name: "workspaceBrokerAccess", path: "/workspace/broker-access" };
  }
  if (
    path.startsWith("/workspace") ||
    path.startsWith("/app") ||
    path.startsWith("/connect") ||
    path.startsWith("/miro")
  ) {
    return { name: "workspaceIntegrationsV2", path: "/workspace/integrations-v2" };
  }
  return { name: "notFound", path: path };
}
