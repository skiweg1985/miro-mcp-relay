/**
 * Canonical user-visible labels and formatters for OAuth broker concepts.
 * API field names stay in types/api; map values to these strings at the UI boundary.
 */

export const brokerUi = {
  integrationTemplate: "Integration template",
  builtInTemplate: "Built-in template",
  customOAuthIntegration: "Custom OAuth integration",
  availableAccessMethods: "Available access methods",
  howAccessWorks: "How access works",
  authenticationToUpstream: "Authentication to upstream",
  brokerRelay: "Broker relay",
  signInSetup: "Sign-in setup",
  recentTokenActivitySample: "Recent token activity (sample)",
  liveConnectivity: "Live connectivity",
  relayTransport: "Relay transport",
  relayApiStyle: "Relay API style",
  internalProviderInstanceKey: "Internal provider instance key",
  internalIntegrationAppKey: "Internal integration app key",
  authorizationEndpoint: "Authorization endpoint",
  tokenEndpoint: "Token endpoint",
  userProfileEndpoint: "User profile endpoint",
  issuerOpenId: "Issuer (OpenID)",
  technicalDetails: "Technical details",
  dynamicClientRegistration: "Dynamic client registration",
  registrationEndpoint: "Registration endpoint",
  registrationAuthMethod: "Registration auth method",
  tokenDeliveryDetail: "Token delivery (detail)",
  personalConnection: "Personal connection",
  sharedCredential: "Shared credential",
  executionIdentity: "Execution identity",
  runsAsPersonal: "Your account",
  runsAsShared: "Shared credential (managed by admin)",
  sharedAccessAvailable: "Shared access available",
  discoveredTools: "Discovered tools",
  toolPolicy: "Tool access policy",
} as const;

export function formatRelayTypeLabel(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (v === "streamable_http") return "Streamable HTTP";
  if (v === "rest_proxy") return "REST proxy";
  if (v === "generic_http") return "Generic HTTP";
  return v || "—";
}

export function formatRelayProtocolLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "—";
  if (v === "mcp_streamable_http") return "MCP streamable HTTP";
  if (v === "rest_proxy") return "REST proxy";
  if (v === "generic_http") return "Generic HTTP";
  return v;
}

function tokenTransportPhrase(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (v === "authorization_bearer") return "Bearer in Authorization header";
  if (v === "header") return "Custom header";
  if (v === "query") return "Query parameter";
  return v || "—";
}

/** Human-readable summary of relay_config token delivery (admin overview). */
export function formatAuthenticationToUpstreamSummary(rc: Record<string, unknown>): string {
  const parts: string[] = [];
  const tt = rc.token_transport;
  if (typeof tt === "string") parts.push(tokenTransportPhrase(tt));
  const th = rc.token_header_name;
  if (typeof th === "string" && th.trim()) parts.push(`Header name: ${th.trim()}`);
  const tq = rc.token_query_param;
  if (typeof tq === "string" && tq.trim()) parts.push(`Query name: ${tq.trim()}`);
  const sh = rc.static_headers;
  if (sh && typeof sh === "object" && !Array.isArray(sh)) {
    const n = Object.keys(sh as object).length;
    if (n) parts.push(`Static headers: ${n}`);
  }
  const dh = rc.dynamic_headers;
  if (dh && typeof dh === "object" && !Array.isArray(dh)) {
    const n = Object.keys(dh as object).length;
    if (n) parts.push(`Dynamic headers: ${n}`);
  }
  return parts.length ? parts.join(" · ") : "Default";
}

/** Compact relay token delivery line for default admin views (no header map counts). */
export function formatAuthenticationToUpstreamBasic(rc: Record<string, unknown>): string {
  const parts: string[] = [];
  const tt = rc.token_transport;
  if (typeof tt === "string") parts.push(tokenTransportPhrase(tt));
  const th = rc.token_header_name;
  if (typeof th === "string" && th.trim()) parts.push(`Header name: ${th.trim()}`);
  const tq = rc.token_query_param;
  if (typeof tq === "string" && tq.trim()) parts.push(`Query name: ${tq.trim()}`);
  return parts.length ? parts.join(" · ") : "Default";
}

export function formatAllowedConnectionTypesSummary(types: string[]): string {
  if (!types.length) return "None";
  const parts: string[] = [];
  if (types.includes("direct_token")) parts.push("Direct connection");
  if (types.includes("relay")) parts.push("Relay through broker");
  if (!parts.length) return types.join(", ");
  return parts.join(" · ");
}

export function formatAccessModeLabel(mode: string): string {
  const m = mode.trim();
  if (m === "relay") return "Relay through broker only";
  if (m === "direct_token") return "Direct token only";
  if (m === "hybrid") return "Relay and direct token";
  return m;
}

/** Compact labels for workspace tables (Modes column). */
export function formatAccessModeShortLabel(mode: string): string {
  const m = mode.trim();
  if (m === "relay") return "Relay through broker";
  if (m === "direct_token") return "Direct token";
  return m;
}

export function formatTokenIssueDecisionLabel(decision: string): string {
  if (decision === "issued") return "Allowed";
  if (decision === "relayed") return "Forwarded";
  if (decision === "blocked") return "Blocked";
  if (decision === "error") return "Error";
  return decision;
}
