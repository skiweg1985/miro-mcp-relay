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

export function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function relativeTime(value: string | null): string {
  if (!value) return "No expiry";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = date.getTime() - Date.now();
  const absHours = Math.round(Math.abs(diff) / 3_600_000);
  if (absHours < 1) {
    return diff >= 0 ? "Under 1 hour left" : "Expired under 1 hour ago";
  }
  return diff >= 0 ? `${absHours}h remaining` : `${absHours}h overdue`;
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
    return { name: "connect", path: "/connect/miro", params: { providerKey: "miro" } };
  }
  if (path === "/miro/workspace") return { name: "workspace", path: "/workspace" };
  if (path === "/miro/admin") return { name: "dashboard", path: "/app" };
  if (path === "/app") return { name: "dashboard", path: "/app" };
  if (path === "/app/integrations") return { name: "integrations", path: "/app/integrations" };
  if (path === "/app/users") return { name: "users", path: "/app/users" };
  if (path === "/app/services") return { name: "services", path: "/app/services" };
  if (path === "/app/access") return { name: "access", path: "/app/access" };
  if (path === "/app/logs") return { name: "logs", path: "/app/logs" };
  if (path === "/workspace") return { name: "workspace", path: "/workspace" };
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
