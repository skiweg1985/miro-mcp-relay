import type { RouteMatch } from "./types";

const LEGACY_PATHS: Record<string, string> = {
  "/app/providers": "/workspace/integrations-v2",
  "/app/connections": "/workspace/integrations-v2",
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
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
  if (path === "/workspace/admin/microsoft-oauth") {
    return { name: "workspaceAdminMicrosoftOAuth", path: "/workspace/admin/microsoft-oauth" };
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
