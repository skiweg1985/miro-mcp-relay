import { useState } from "react";

import { Card, StatusBadge } from "../components";
import type { BrokerCallbackUrls, ConnectedAccountOut, ProviderAppOut, ProviderInstanceOut, TokenIssueEventOut } from "../types";
import { formatDateTime } from "../utils";
import { TEMPLATE_MS_GRAPH, TEMPLATE_MS_LOGIN, TEMPLATE_MIRO } from "./constants";

function toneFromStatus(
  label: string,
): "neutral" | "success" | "warn" | "danger" {
  if (label === "Active") return "success";
  if (label === "Disabled") return "danger";
  return "neutral";
}

function relayTypeLabel(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (v === "streamable_http") return "Streamable HTTP";
  if (v === "rest_proxy") return "REST proxy";
  if (v === "generic_http") return "Generic HTTP";
  return v || "—";
}

function tokenTransportLabel(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (v === "authorization_bearer") return "Bearer";
  if (v === "header") return "Header";
  if (v === "query") return "Query";
  return v || "—";
}

function connectionTypesSummary(types: string[]): string {
  if (!types.length) return "None";
  const parts: string[] = [];
  if (types.includes("direct_token")) parts.push("Direct");
  if (types.includes("relay")) parts.push("Relay");
  if (!parts.length) return types.join(", ");
  return parts.join(" · ");
}

function headerMappingSummary(rc: Record<string, unknown>): string {
  const parts: string[] = [];
  const tt = rc.token_transport;
  if (typeof tt === "string") parts.push(`Token: ${tokenTransportLabel(tt)}`);
  const th = rc.token_header_name;
  if (typeof th === "string" && th.trim()) parts.push(`Header name: ${th.trim()}`);
  const tq = rc.token_query_param;
  if (typeof tq === "string" && tq.trim()) parts.push(`Query param: ${tq.trim()}`);
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

function advancedRelayRows(rc: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const pick = (k: string, label: string, fmt?: (v: unknown) => string) => {
    if (!(k in rc)) return;
    const v = rc[k];
    if (v === undefined || v === null || v === "") return;
    rows.push({ label, value: fmt ? fmt(v) : String(v) });
  };
  pick("upstream_path_template", "Upstream path template");
  pick("method_mode", "Method mode");
  pick("fixed_method", "Fixed method");
  pick("relay_health_url", "Health URL");
  pick("forward_path", "Forward path", (v) => (v ? "Yes" : "No"));
  pick("forward_query", "Forward query", (v) => (v ? "Yes" : "No"));
  pick("forward_body", "Forward body", (v) => (v ? "Yes" : "No"));
  pick("stream_response", "Stream response", (v) => (v ? "Yes" : "No"));
  pick("supports_refresh", "Supports refresh", (v) => (v ? "Yes" : "No"));
  pick("retry_enabled", "Retry", (v) => (v ? "Yes" : "No"));
  pick("retry_count", "Retry count");
  pick("circuit_breaker_enabled", "Circuit breaker", (v) => (v ? "Yes" : "No"));
  pick("oauth_refresh_client_credential_source", "OAuth refresh source");
  if (rc.static_headers && typeof rc.static_headers === "object") {
    rows.push({
      label: "Static headers",
      value: JSON.stringify(rc.static_headers, null, 0),
    });
  }
  if (rc.dynamic_headers && typeof rc.dynamic_headers === "object") {
    rows.push({
      label: "Dynamic headers",
      value: JSON.stringify(rc.dynamic_headers, null, 0),
    });
  }
  const allow = rc.allowed_request_headers;
  if (Array.isArray(allow) && allow.length) {
    rows.push({ label: "Allowed request headers", value: allow.join(", ") });
  }
  const block = rc.blocked_request_headers;
  if (Array.isArray(block) && block.length) {
    rows.push({ label: "Blocked request headers", value: block.join(", ") });
  }
  return rows;
}

function templateDescription(templateKey: string | null): string {
  if (templateKey === TEMPLATE_MS_LOGIN) {
    return "Microsoft Entra ID application used for administrator and user sign-in to this console.";
  }
  if (templateKey === TEMPLATE_MS_GRAPH) {
    return "Microsoft 365 data (mail, calendar, directory) for linked user accounts.";
  }
  if (templateKey === TEMPLATE_MIRO) {
    return "Miro boards and MCP access through the broker relay.";
  }
  return "OAuth 2.0 provider registered for relayed access.";
}

function providerKindLabel(templateKey: string | null): string {
  if (templateKey === TEMPLATE_MS_LOGIN || templateKey === TEMPLATE_MS_GRAPH) return "Microsoft Entra ID";
  if (templateKey === TEMPLATE_MIRO) return "Miro";
  return "OAuth 2.0";
}

function redirectUriForApp(
  app: ProviderAppOut,
  urls: BrokerCallbackUrls,
): string {
  const uris = app.redirect_uris ?? [];
  if (uris[0]) return uris[0];
  if (app.template_key === TEMPLATE_MS_LOGIN) return urls.microsoft_login;
  if (app.template_key === TEMPLATE_MS_GRAPH) return urls.microsoft_graph;
  if (app.template_key === TEMPLATE_MIRO) return urls.miro;
  return urls.custom_oauth;
}

function oauthConfigured(
  app: ProviderAppOut,
  instance: ProviderInstanceOut,
): { ok: boolean; detail: string } {
  const pkce = Boolean((instance.settings as { use_pkce?: boolean }).use_pkce);
  const cid = (app.client_id ?? "").trim();
  const authz = (instance.authorization_endpoint ?? "").trim();
  const tok = (instance.token_endpoint ?? "").trim();
  if (!cid) {
    return { ok: false, detail: "Client ID missing" };
  }
  if (!authz) {
    return { ok: false, detail: "Authorize URL missing" };
  }
  if (!tok) {
    return { ok: false, detail: "Token URL missing" };
  }
  if (pkce) {
    return { ok: true, detail: "Client ID, endpoints, PKCE" };
  }
  if (app.has_client_secret) {
    return { ok: true, detail: "Client ID, endpoints, secret stored" };
  }
  return { ok: false, detail: "Client secret or PKCE required" };
}

function scopesSummary(app: ProviderAppOut): string {
  const s = app.default_scopes ?? [];
  if (!s.length) return "—";
  if (s.length <= 6) return s.join(", ");
  return `${s.slice(0, 5).join(", ")} +${s.length - 5}`;
}

function maxIsoDate(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = 0;
  for (const d of dates) {
    if (!d) continue;
    const t = Date.parse(d);
    if (!Number.isNaN(t) && t >= bestMs) {
      bestMs = t;
      best = d;
    }
  }
  return best;
}

export type IntegrationOverviewStats = {
  connectedUsers: number;
  activeConnections: number;
  recentTokenEvents: number;
  lastActivity: string | null;
  lastSuccessAt: string | null;
  lastSuccessLabel: string | null;
};

export type IntegrationOverviewHealth = {
  refreshPossible: boolean;
  lastRefresh: string | null;
  lastError: string | null;
  connectivityNote: string | null;
};

export function IntegrationOverview({
  app,
  instance,
  urls,
  statusLabel: stLabel,
  needsTenant,
  stats,
  health,
  onBack,
  onEdit,
  onTest,
  onToggleEnabled,
  testing,
  toggling,
  testAvailable,
  lastUpdated,
}: {
  app: ProviderAppOut;
  instance: ProviderInstanceOut;
  urls: BrokerCallbackUrls;
  statusLabel: string;
  needsTenant: boolean;
  stats: IntegrationOverviewStats;
  health: IntegrationOverviewHealth;
  onBack: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggleEnabled: () => void;
  testing: boolean;
  toggling: boolean;
  testAvailable: boolean;
  lastUpdated: string | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const rc = (app.relay_config ?? {}) as Record<string, unknown>;
  const oauth = oauthConfigured(app, instance);
  const tenant = (instance.settings as { tenant_id?: string })?.tenant_id;
  const tenantDisplay =
    typeof tenant === "string" && tenant.trim()
      ? tenant === "common"
        ? "common (multi-tenant)"
        : tenant.trim()
      : "—";

  const relayEnabled = app.allowed_connection_types?.includes("relay");

  return (
    <div className="integration-detail">
      <div className="integration-detail-toolbar">
        <button type="button" className="ghost-button integration-detail-back" onClick={onBack}>
          ← Integrations
        </button>
      </div>

      <header className="integration-detail-header">
        <div className="integration-detail-title-block">
          <h1 className="integration-detail-title">{app.display_name}</h1>
          <p className="integration-detail-sub">{providerKindLabel(app.template_key)}</p>
        </div>
        <div className="integration-detail-header-meta">
          <StatusBadge tone={toneFromStatus(stLabel)}>{stLabel}</StatusBadge>
          <span className="integration-detail-updated muted">
            Updated {lastUpdated ? formatDateTime(lastUpdated) : "—"}
          </span>
        </div>
        <div className="integration-detail-actions">
          <button type="button" className="secondary-button" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!testAvailable || testing}
            onClick={onTest}
            title={!testAvailable ? "Connection check is only available for built-in templates." : undefined}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button type="button" className="primary-button" disabled={toggling} onClick={onToggleEnabled}>
            {toggling ? "Saving…" : app.is_enabled && instance.is_enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </header>

      <div className="integration-detail-grid">
        <Card title="Overview">
          <dl className="integration-kv">
            <div>
              <dt>Description</dt>
              <dd>{templateDescription(app.template_key)}</dd>
            </div>
            <div>
              <dt>App type</dt>
              <dd>{app.template_key ? "Built-in template" : "Custom OAuth app"}</dd>
            </div>
            <div>
              <dt>Connection types</dt>
              <dd>{connectionTypesSummary(app.allowed_connection_types ?? [])}</dd>
            </div>
            <div>
              <dt>Relay</dt>
              <dd>
                {relayEnabled ? (
                  <>
                    <span className="integration-pill">On</span>{" "}
                    <span className="muted">{relayTypeLabel(typeof rc.relay_type === "string" ? rc.relay_type : undefined)}</span>
                  </>
                ) : (
                  <span className="muted">Off</span>
                )}
              </dd>
            </div>
            <div>
              <dt>OAuth</dt>
              <dd>
                {oauth.ok ? (
                  <span className="integration-pill integration-pill--ok">Ready</span>
                ) : (
                  <span className="integration-pill integration-pill--warn">Incomplete</span>
                )}{" "}
                <span className="muted">{oauth.detail}</span>
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Configuration">
          <dl className="integration-kv">
            {needsTenant ? (
              <div>
                <dt>Directory (tenant)</dt>
                <dd>{tenantDisplay}</dd>
              </div>
            ) : null}
            <div>
              <dt>Redirect URI</dt>
              <dd className="integration-kv-mono">{redirectUriForApp(app, urls)}</dd>
            </div>
            {relayEnabled ? (
              <div>
                <dt>Upstream URL</dt>
                <dd className="integration-kv-mono">
                  {typeof rc.upstream_base_url === "string" && rc.upstream_base_url.trim()
                    ? rc.upstream_base_url.trim()
                    : "—"}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Auth mode</dt>
              <dd>
                {app.access_mode}
                <span className="muted">
                  {" "}
                  · relay {app.allow_relay ? "on" : "off"}, direct {app.allow_direct_token_return ? "on" : "off"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Scopes</dt>
              <dd>{scopesSummary(app)}</dd>
            </div>
            <div>
              <dt>Header mapping</dt>
              <dd>{relayEnabled ? headerMappingSummary(rc) : "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Usage">
          <div className="metric-row metric-row--tight">
            <MetricMini label="Connected users" value={String(stats.connectedUsers)} />
            <MetricMini label="Active connections" value={String(stats.activeConnections)} />
            <MetricMini label="Token events (sample)" value={String(stats.recentTokenEvents)} />
          </div>
          <dl className="integration-kv integration-kv--spaced">
            <div>
              <dt>Last activity</dt>
              <dd>{stats.lastActivity ? formatDateTime(stats.lastActivity) : "—"}</dd>
            </div>
            <div>
              <dt>Last successful use</dt>
              <dd>
                {stats.lastSuccessAt ? (
                  <>
                    {formatDateTime(stats.lastSuccessAt)}
                    {stats.lastSuccessLabel ? (
                      <span className="muted"> · {stats.lastSuccessLabel}</span>
                    ) : null}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Health">
          <dl className="integration-kv">
            <div>
              <dt>Token refresh</dt>
              <dd>{health.refreshPossible ? "Available for at least one connection" : "No refresh token on record"}</dd>
            </div>
            <div>
              <dt>Last token update</dt>
              <dd>{health.lastRefresh ? formatDateTime(health.lastRefresh) : "—"}</dd>
            </div>
            <div>
              <dt>Last connection error</dt>
              <dd className={health.lastError ? "integration-kv-danger" : undefined}>
                {health.lastError ?? "None recorded"}
              </dd>
            </div>
            <div>
              <dt>Connectivity check</dt>
              <dd>{health.connectivityNote ?? "Run “Test connection” for a live check."}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <section className="integration-advanced">
        <button
          type="button"
          className="integration-advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          Advanced details
          <span className="integration-advanced-chevron" aria-hidden>
            {advancedOpen ? "▾" : "▸"}
          </span>
        </button>
        {advancedOpen ? (
          <div className="integration-advanced-body">
            <div className="integration-advanced-cols">
              <div>
                <h3 className="integration-advanced-h">Relay engine</h3>
                <dl className="integration-kv integration-kv--compact">
                  <div>
                    <dt>Relay protocol</dt>
                    <dd>{app.relay_protocol ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Instance key</dt>
                    <dd className="integration-kv-mono">{instance.key}</dd>
                  </div>
                  <div>
                    <dt>App key</dt>
                    <dd className="integration-kv-mono">{app.key}</dd>
                  </div>
                  {advancedRelayRows(rc).map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd className={row.label.includes("headers") ? "integration-kv-pre" : undefined}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3 className="integration-advanced-h">Endpoints</h3>
                <dl className="integration-kv integration-kv--compact">
                  <div>
                    <dt>Issuer</dt>
                    <dd className="integration-kv-mono">{instance.issuer ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Authorize</dt>
                    <dd className="integration-kv-mono">{instance.authorization_endpoint ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Token</dt>
                    <dd className="integration-kv-mono">{instance.token_endpoint ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>User info</dt>
                    <dd className="integration-kv-mono">{instance.userinfo_endpoint ?? "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-mini">
      <span className="metric-mini-value">{value}</span>
      <span className="metric-mini-label">{label}</span>
    </div>
  );
}

export function buildOverviewStats(
  appId: string,
  connections: ConnectedAccountOut[],
  tokenIssues: TokenIssueEventOut[],
): IntegrationOverviewStats {
  const forApp = connections.filter((c) => c.provider_app_id === appId);
  const users = new Set(forApp.map((c) => c.user_id));
  const active = forApp.filter((c) => c.status === "connected").length;
  const issues = tokenIssues.filter((t) => t.provider_app_id === appId);
  const issued = issues.filter((t) => t.decision === "issued" || t.decision === "relayed");
  const lastIssued = issued.sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )[0];
  const activityDates = [
    ...forApp.map((c) => c.connected_at),
    ...forApp.map((c) => c.token_material_updated_at ?? null),
    ...issues.map((i) => i.created_at),
  ];
  const lastActivity = maxIsoDate(activityDates);
  return {
    connectedUsers: users.size,
    activeConnections: active,
    recentTokenEvents: issues.length,
    lastActivity,
    lastSuccessAt: lastIssued?.created_at ?? null,
    lastSuccessLabel: lastIssued ? userIssueDecisionLabel(lastIssued.decision) : null,
  };
}

function userIssueDecisionLabel(decision: string): string {
  if (decision === "issued") return "issued";
  if (decision === "relayed") return "relayed";
  return decision;
}

export function buildOverviewHealth(connections: ConnectedAccountOut[]): IntegrationOverviewHealth {
  const refreshPossible = connections.some((c) => c.refresh_token_available === true);
  const tokenDates = connections
    .map((c) => c.token_material_updated_at)
    .filter(Boolean) as string[];
  const lastRefresh = maxIsoDate(tokenDates);
  const withErr = connections.filter((c) => (c.last_error ?? "").trim());
  const lastErr = withErr.sort(
    (a, b) => Date.parse(b.connected_at) - Date.parse(a.connected_at),
  )[0];
  return {
    refreshPossible,
    lastRefresh,
    lastError: lastErr?.last_error?.trim() || null,
    connectivityNote: null,
  };
}

export function integrationLastUpdated(
  app: ProviderAppOut,
  connections: ConnectedAccountOut[],
  tokenIssues: TokenIssueEventOut[],
): string | null {
  const forApp = connections.filter((c) => c.provider_app_id === app.id);
  const issues = tokenIssues.filter((t) => t.provider_app_id === app.id);
  return maxIsoDate([
    ...forApp.map((c) => c.connected_at),
    ...forApp.map((c) => c.token_material_updated_at ?? null),
    ...issues.map((i) => i.created_at),
  ]);
}
