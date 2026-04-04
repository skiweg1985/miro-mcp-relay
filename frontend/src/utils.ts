import type { RouteMatch } from "./types";

const LEGACY_ADMIN_PATHS: Record<string, string> = {
  "/app/providers": "/app/integrations",
  "/app/connections": "/app/users",
  "/app/service-clients": "/app/services",
  "/app/delegation": "/app/access",
  "/app/audit": "/app/logs",
};

/** If the browser is on a legacy admin URL, returns the canonical path to replace the history entry. */
export function replaceLegacyAdminPath(pathname: string): string | null {
  const raw = pathname.length > 1 && pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : pathname;
  return LEGACY_ADMIN_PATHS[raw] ?? null;
}

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * API liefert UTC-Zeiten oft als ISO ohne Offset; `Date` würde sie sonst als lokale Uhrzeit lesen.
 * Strings, die bereits `Z` oder `±hh:mm` haben, bleiben unverändert.
 */
export function parseApiDateTime(value: string): Date {
  const trimmed = value.trim();
  const isoNaiveUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/i.test(trimmed);
  const hasTzSuffix = /Z$|[+-]\d{2}:\d{2}$/i.test(trimmed);
  return new Date(isoNaiveUtc && !hasTzSuffix ? `${trimmed}Z` : trimmed);
}

export function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function toIsoDateTime(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

export function relativeTime(value: string | null): string {
  if (!value) return "No expiry";
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = date.getTime() - Date.now();
  const absHours = Math.round(Math.abs(diff) / 3_600_000);
  if (absHours < 1) {
    return diff >= 0 ? "Under 1 hour left" : "Expired under 1 hour ago";
  }
  return diff >= 0 ? `${absHours}h remaining` : `${absHours}h overdue`;
}

/** Short relative phrase for dense tables (e.g. "in 5h", "in 2d", "3h ago"). */
export function relativeTimeCompact(value: string | null): string {
  if (!value) return "—";
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const absMins = Math.round(abs / 60_000);
  const absHours = Math.round(abs / 3_600_000);
  const absDays = Math.round(abs / 86_400_000);
  if (diff >= 0) {
    if (absMins < 60) return `in ${Math.max(1, absMins)}m`;
    if (absHours < 48) return `in ${absHours}h`;
    return `in ${absDays}d`;
  }
  if (absMins < 60) return `${Math.max(1, absMins)}m ago`;
  if (absHours < 48) return `${absHours}h ago`;
  return `${absDays}d ago`;
}

export function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
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
  const path = LEGACY_ADMIN_PATHS[raw] ?? raw;
  if (path === "/" || path === "/login") return { name: "login", path: "/login" };
  if (path === "/miro" || path === "/start" || path === "/miro/start") {
    return { name: "workspaceIntegrations", path: "/workspace/integrations" };
  }
  if (path === "/miro/workspace") return { name: "workspace", path: "/workspace" };
  if (path === "/miro/admin") return { name: "dashboard", path: "/app" };
  if (path === "/app") return { name: "dashboard", path: "/app" };
  if (path === "/app/integrations") return { name: "integrations", path: "/app/integrations" };
  if (path.startsWith("/app/integrations/")) {
    const rest = path.slice("/app/integrations/".length).replace(/^\/+/, "");
    const appId = rest.split("/")[0]?.trim();
    if (appId) {
      return { name: "integrationDetail", path: `/app/integrations/${appId}`, params: { appId } };
    }
  }
  if (path === "/app/users") return { name: "users", path: "/app/users" };
  if (path === "/app/services") return { name: "services", path: "/app/services" };
  if (path === "/app/access") return { name: "access", path: "/app/access" };
  if (path === "/app/logs") return { name: "logs", path: "/app/logs" };
  if (path === "/workspace") return { name: "workspace", path: "/workspace" };
  if (path === "/workspace/integrations") return { name: "workspaceIntegrations", path: "/workspace/integrations" };
  if (path === "/grants") return { name: "grants", path: "/grants" };
  if (path === "/token-access") return { name: "tokenAccess", path: "/token-access" };
  if (path.startsWith("/connect/")) {
    const providerKey = path.slice("/connect/".length).trim();
    if (providerKey) {
      return { name: "connect", path: `/connect/${providerKey}`, params: { providerKey } };
    }
  }
  return { name: "notFound", path: path };
}
