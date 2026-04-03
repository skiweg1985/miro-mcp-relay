import type { ProviderAppOut } from "../types";

/** Aligns with backend `provider_templates` keys. */
export const TEMPLATE_MS_LOGIN = "microsoft-broker-login";
export const TEMPLATE_MS_GRAPH = "microsoft-graph-direct";
export const TEMPLATE_MIRO = "miro-relay";

export const LEGACY_APP_KEYS: Record<string, string> = {
  [TEMPLATE_MIRO]: "miro-default",
  [TEMPLATE_MS_LOGIN]: "microsoft-broker-default",
  [TEMPLATE_MS_GRAPH]: "microsoft-graph-default",
};

export type GraphClaimId =
  | "email"
  | "first_name"
  | "last_name"
  | "display_name"
  | "user_id"
  | "groups"
  | "roles";

export const GRAPH_CLAIM_OPTIONS: Array<{ id: GraphClaimId; label: string }> = [
  { id: "email", label: "Email" },
  { id: "first_name", label: "First name" },
  { id: "last_name", label: "Last name" },
  { id: "display_name", label: "Display name" },
  { id: "user_id", label: "User ID" },
  { id: "groups", label: "Groups" },
  { id: "roles", label: "Roles" },
];

const BASE_GRAPH_SCOPES = ["openid", "offline_access", "profile", "email", "User.Read"];

/** Maps admin claim selection to Microsoft Graph / OIDC scopes. */
export function graphClaimsToScopes(claimIds: Set<GraphClaimId>): string[] {
  const extra: string[] = [];
  for (const id of claimIds) {
    if (id === "groups") extra.push("GroupMember.Read.All");
    if (id === "roles") extra.push("Directory.Read.All");
  }
  const merged = [...BASE_GRAPH_SCOPES, ...extra];
  return [...new Set(merged)];
}

export function scopesToGraphClaims(scopes: string[]): Set<GraphClaimId> {
  const lower = new Set(scopes.map((s) => s.toLowerCase()));
  const out = new Set<GraphClaimId>();
  if (lower.has("email")) out.add("email");
  if (lower.has("profile")) {
    out.add("first_name");
    out.add("last_name");
    out.add("display_name");
  }
  if (lower.has("openid")) out.add("user_id");
  if (scopes.some((s) => s.includes("GroupMember"))) out.add("groups");
  if (scopes.some((s) => s.includes("Directory.Read"))) out.add("roles");
  return out;
}

export function findAppByTemplate(apps: ProviderAppOut[], templateKey: string) {
  const legacy = LEGACY_APP_KEYS[templateKey];
  return apps.find((a) => a.template_key === templateKey || (legacy && a.key === legacy));
}

export function slugKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
