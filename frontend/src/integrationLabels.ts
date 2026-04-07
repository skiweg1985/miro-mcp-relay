import type { IntegrationInstanceV2Out, IntegrationV2Out } from "./types";

const INTEGRATION_TYPE: Record<IntegrationV2Out["type"], string> = {
  mcp_server: "MCP",
  oauth_provider: "OAuth",
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

export function isMicrosoftGraphIntegration(integration: IntegrationV2Out): boolean {
  const c = integration.config as Record<string, unknown> | undefined;
  return c?.template_key === "microsoft_graph_default";
}

export function hasIntegrationEndpointConfigured(integration: IntegrationV2Out): boolean {
  if (isMicrosoftGraphIntegration(integration)) return true;
  const c = integration.config as Record<string, unknown> | undefined;
  return typeof c?.endpoint === "string" && !!c.endpoint.trim();
}

export function integrationCardDescription(integration: IntegrationV2Out): string {
  if (isMicrosoftGraphIntegration(integration)) {
    return "Microsoft 365 and Graph API access through this workspace.";
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

export function connectionRowStatus(instance: IntegrationInstanceV2Out): { label: string; tone: "neutral" | "success" | "warn" } {
  if (instance.auth_mode === "oauth") {
    return instance.oauth_connected
      ? { label: "Connected", tone: "success" }
      : { label: "Sign-in required", tone: "warn" };
  }
  return { label: "Ready", tone: "neutral" };
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
  return null;
}
