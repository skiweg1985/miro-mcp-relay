import type { AccessGrantOut, IntegrationInstanceV2Out, IntegrationV2Out } from "./types";

const INTEGRATION_TYPE: Record<IntegrationV2Out["type"], string> = {
  mcp_server: "MCP",
  oauth_provider: "External OAuth",
  api: "API",
};

const AUTH_MODE: Record<IntegrationInstanceV2Out["auth_mode"], string> = {
  none: "No authentication required",
  oauth: "Sign-in with provider",
  api_key: "API key",
  shared_credentials: "Shared account",
};

const ACCESS_MODE: Record<IntegrationInstanceV2Out["access_mode"], string> = {
  relay: "Via broker",
  direct: "Direct",
};

const GRANT_STATUS: Record<string, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  invalid: "Invalid",
};

export function integrationTypeLabel(type: IntegrationV2Out["type"]): string {
  return INTEGRATION_TYPE[type] ?? type;
}

export function authModeLabel(mode: IntegrationInstanceV2Out["auth_mode"]): string {
  return AUTH_MODE[mode] ?? mode;
}

export function accessModeLabel(mode: IntegrationInstanceV2Out["access_mode"]): string {
  return ACCESS_MODE[mode] ?? mode;
}

export function accessGrantStatusLabel(status: string): string {
  return GRANT_STATUS[status] ?? status;
}

const GRANT_EFFECTIVE: Record<string, string> = {
  active: "Active",
  revoked: "Revoked",
  invalid: "Invalid",
  expired: "Expired",
};

export function accessGrantEffectiveStatusLabel(effective: string): string {
  return GRANT_EFFECTIVE[effective] ?? effective;
}

export function accessGrantInvalidationReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    connection_deleted: "Connection removed",
    integration_deleted: "Integration removed",
    critical_settings_changed: "Connection settings changed",
    integration_config_changed: "Integration configuration changed",
  };
  return map[code] ?? code;
}

const PROTECTED_INTEGRATION_IDS = new Set([
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
]);

export function canRemoveAccessGrant(grant: AccessGrantOut): boolean {
  if (grant.status === "revoked" || grant.status === "invalid") return true;
  if (grant.status === "active" && grant.effective_status === "expired") return true;
  return false;
}

export function integrationDeletable(integration: IntegrationV2Out): boolean {
  if (PROTECTED_INTEGRATION_IDS.has(integration.id)) return false;
  const c = integration.config as Record<string, unknown> | undefined;
  const tk = typeof c?.template_key === "string" ? c.template_key.trim() : "";
  if (tk === "miro_default" || tk === "microsoft_graph_default") return false;
  return true;
}

export function isMicrosoftGraphIntegration(integration: IntegrationV2Out): boolean {
  const c = integration.config as Record<string, unknown> | undefined;
  return c?.template_key === "microsoft_graph_default";
}

export function isGenericOAuthIntegration(integration: IntegrationV2Out): boolean {
  const c = integration.config as Record<string, unknown> | undefined;
  return c?.template_key === "generic_oauth";
}

export function hasIntegrationEndpointConfigured(integration: IntegrationV2Out): boolean {
  if (isMicrosoftGraphIntegration(integration)) return true;
  if (isGenericOAuthIntegration(integration)) {
    const c = integration.config as Record<string, unknown>;
    const authz = typeof c.oauth_authorization_endpoint === "string" && !!c.oauth_authorization_endpoint.trim();
    const tok = typeof c.oauth_token_endpoint === "string" && !!c.oauth_token_endpoint.trim();
    const cid = typeof c.oauth_client_id === "string" && !!c.oauth_client_id.trim();
    return Boolean(authz && tok && cid && integration.oauth_client_secret_configured);
  }
  const c = integration.config as Record<string, unknown> | undefined;
  return typeof c?.endpoint === "string" && !!c.endpoint.trim();
}

export function integrationCardDescription(integration: IntegrationV2Out): string {
  if (isMicrosoftGraphIntegration(integration)) {
    return "Microsoft 365 and Graph API access through this workspace.";
  }
  if (isGenericOAuthIntegration(integration)) {
    return "User connections authorize against your OAuth or OIDC provider; tokens stay on the broker for this workspace.";
  }
  const c = integration.config as Record<string, unknown> | undefined;
  const ep = typeof c?.endpoint === "string" ? c.endpoint.trim() : "";
  if (ep) {
    try {
      return `Service at ${new URL(ep).hostname}`;
    } catch {
      return "Remote integration endpoint.";
    }
  }
  return "Add an endpoint to finish setup.";
}

export function integrationLifecycleBadge(
  integration: IntegrationV2Out,
  connectionCount: number,
): { label: string; tone: "neutral" | "success" | "warn" } {
  if (!hasIntegrationEndpointConfigured(integration)) {
    return { label: "Setup required", tone: "warn" };
  }
  if (connectionCount > 0) {
    return { label: "Active", tone: "success" };
  }
  return { label: "Ready", tone: "neutral" };
}

export function connectionRowStatus(instance: IntegrationInstanceV2Out): {
  label: string;
  tone: "neutral" | "success" | "warn" | "danger";
} {
  if (instance.auth_mode === "oauth") {
    if (!instance.oauth_connected) {
      return { label: "Sign-in required", tone: "warn" };
    }
    const h = instance.oauth_upstream_health;
    if (!h || h === "healthy") {
      return { label: "Connected", tone: "success" };
    }
    if (h === "expiring_soon") {
      return { label: "Expiring soon", tone: "warn" };
    }
    if (h === "no_refresh_token") {
      return { label: "Limited", tone: "warn" };
    }
    if (h === "expired" || h === "refresh_failed") {
      return { label: "Action needed", tone: "danger" };
    }
    return { label: "Connected", tone: "success" };
  }
  return { label: "Ready", tone: "neutral" };
}

/** User-facing label for oauth_upstream_health (inspect modal, tooltips). */
export function oauthUpstreamHealthLabel(health: string | null | undefined): string {
  if (!health) return "—";
  if (health === "healthy") return "OK";
  if (health === "expiring_soon") return "Expiring soon";
  if (health === "expired") return "Expired";
  if (health === "refresh_failed") return "Token error";
  if (health === "no_refresh_token") return "No refresh token";
  return health;
}

export function userConnectionStatusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "Active",
    disconnected: "Disconnected",
  };
  return map[status] ?? status;
}

export function oauthProviderProductLabel(provider: unknown): string | null {
  if (provider === "microsoft_graph") return "Microsoft 365";
  if (provider === "miro") return "Miro";
  if (provider === "generic_oauth") return "External provider";
  return null;
}
