import type { RouteMatch } from "./types";

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
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

export function classNames(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter(Boolean).join(" ");
}

export function matchesRoute(pathname: string): RouteMatch {
  if (pathname === "/" || pathname === "/login") return { name: "login", path: "/login" };
  if (pathname === "/miro" || pathname === "/start" || pathname === "/miro/start") {
    return { name: "connect", path: "/connect/miro", params: { providerKey: "miro" } };
  }
  if (pathname === "/miro/workspace") return { name: "workspace", path: "/workspace" };
  if (pathname === "/miro/admin") return { name: "dashboard", path: "/app" };
  if (pathname === "/app") return { name: "dashboard", path: "/app" };
  if (pathname === "/app/providers") return { name: "providers", path: "/app/providers" };
  if (pathname === "/app/connections") return { name: "connections", path: "/app/connections" };
  if (pathname === "/app/service-clients") return { name: "serviceClients", path: "/app/service-clients" };
  if (pathname === "/app/delegation") return { name: "delegation", path: "/app/delegation" };
  if (pathname === "/app/audit") return { name: "audit", path: "/app/audit" };
  if (pathname === "/workspace") return { name: "workspace", path: "/workspace" };
  if (pathname === "/grants") return { name: "grants", path: "/grants" };
  if (pathname === "/token-access") return { name: "tokenAccess", path: "/token-access" };
  if (pathname.startsWith("/connect/")) {
    const providerKey = pathname.slice("/connect/".length).trim();
    if (providerKey) {
      return { name: "connect", path: `/connect/${providerKey}`, params: { providerKey } };
    }
  }
  return { name: "notFound", path: pathname };
}
