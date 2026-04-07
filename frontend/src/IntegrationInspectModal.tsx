import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { Modal, StatusBadge } from "./components";
import type { BrokerCallbackUrls, IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import {
  accessModeLabel,
  authModeLabel,
  integrationCardDescription,
  integrationLifecycleBadge,
  integrationTypeLabel,
  isMicrosoftGraphIntegration,
} from "./integrationLabels";
import { DetailRow, DetailSection, RawJsonDisclosure } from "./object-detail-ui";
import { formatDateTime } from "./utils";

const CONFIG_LABELS: Record<string, string> = {
  endpoint: "Endpoint URL",
  template_key: "Template",
  oauth_authorization_endpoint: "Authorize URL",
  oauth_token_endpoint: "Token URL",
  oauth_registration_endpoint: "Client registration URL",
  oauth_scope: "OAuth scopes",
  default_scopes: "Default scopes",
  graph_oauth_redirect_uri: "Graph redirect URL",
  graph_oauth_use_broker_defaults: "Use broker Microsoft defaults",
  oauth_dynamic_client_registration_enabled: "Dynamic client registration",
  oauth_client_id: "OAuth client ID",
};

function formatConfigPrimitive(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map((x) => String(x)).join(", ");
  return JSON.stringify(val);
}

function integrationConfigRows(config: Record<string, unknown>): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  for (const [key, val] of Object.entries(config)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) continue;
    const label = CONFIG_LABELS[key] ?? key.replace(/_/g, " ");
    rows.push({ key, label, value: formatConfigPrimitive(val) });
  }
  return rows.filter((r) => r.value.trim().length > 0);
}

type Props = {
  integration: IntegrationV2Out;
  relatedInstances: IntegrationInstanceV2Out[];
  isAdmin: boolean;
  onClose: () => void;
  onGoToConnections: () => void;
  onAddConnection?: () => void;
};

export function IntegrationInspectModal({
  integration,
  relatedInstances,
  isAdmin,
  onClose,
  onGoToConnections,
  onAddConnection,
}: Props) {
  const [callbacks, setCallbacks] = useState<BrokerCallbackUrls | null>(null);
  const badge = integrationLifecycleBadge(integration, relatedInstances.length);
  const cfg = integration.config ?? {};
  const configRows = useMemo(() => integrationConfigRows(cfg as Record<string, unknown>), [cfg]);
  const isGraph = isMicrosoftGraphIntegration(integration);

  useEffect(() => {
    let cancelled = false;
    void api
      .brokerCallbackUrls()
      .then((c) => {
        if (!cancelled) setCallbacks(c);
      })
      .catch(() => {
        if (!cancelled) setCallbacks(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const authSummary = useMemo(() => {
    const modes = new Set(relatedInstances.map((i) => i.auth_mode));
    if (modes.size === 0) return "Defined when you add a connection.";
    if (modes.size === 1) {
      const m = [...modes][0];
      return authModeLabel(m);
    }
    return "Varies by connection";
  }, [relatedInstances]);

  const trafficSummary = useMemo(() => {
    const modes = new Set(relatedInstances.map((i) => i.access_mode));
    if (modes.size === 0) return "—";
    if (modes.size === 1) {
      const m = [...modes][0];
      return accessModeLabel(m);
    }
    return "Varies by connection";
  }, [relatedInstances]);

  const personalVsShared = useMemo(() => {
    if (!relatedInstances.length) return "—";
    const hasShared = relatedInstances.some((i) => i.auth_mode === "shared_credentials");
    const hasPersonal = relatedInstances.some((i) => i.auth_mode === "oauth" || i.auth_mode === "api_key");
    if (hasShared && hasPersonal) return "Both shared and per-user options are in use.";
    if (hasShared) return "Shared credentials are used for at least one connection.";
    if (hasPersonal) return "Personal or per-user credentials are used.";
    return "No authentication required for current connections.";
  }, [relatedInstances]);

  return (
    <Modal
      title={integration.name}
      description={integrationCardDescription(integration)}
      wide
      onClose={onClose}
    >
      <DetailSection title="Summary">
        <DetailRow label="Kind" value={integrationTypeLabel(integration.type)} />
        <DetailRow
          label="Status"
          value={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
        />
        <DetailRow label="MCP" value={integration.mcp_enabled ? "Enabled" : "Off"} />
        <DetailRow label="Created" value={formatDateTime(integration.created_at)} />
        <DetailRow label="Updated" value={formatDateTime(integration.updated_at)} />
      </DetailSection>

      <DetailSection title="Connections">
        <DetailRow
          label="In use"
          value={
            relatedInstances.length === 0 ? (
              <span className="muted-copy">None yet</span>
            ) : (
              <button type="button" className="ghost-button" onClick={onGoToConnections}>
                View connections ({relatedInstances.length})
              </button>
            )
          }
        />
        {isAdmin && onAddConnection ? (
          <div className="detail-modal-actions-row">
            <button type="button" className="primary-button" onClick={onAddConnection}>
              Add connection
            </button>
          </div>
        ) : null}
      </DetailSection>

      <DetailSection title="Connection & endpoints">
        {configRows.length ? (
          configRows.map((row) => <DetailRow key={row.key} label={row.label} value={row.value} />)
        ) : (
          <p className="muted-copy">No endpoint fields in this definition.</p>
        )}
        {integration.integration_oauth_callback_url ? (
          <DetailRow label="Integration OAuth callback" value={integration.integration_oauth_callback_url} />
        ) : null}
        {callbacks ? (
          <>
            {isGraph && callbacks.microsoft_graph ? (
              <DetailRow label="Microsoft Graph redirect" value={callbacks.microsoft_graph} />
            ) : null}
            {!isGraph && callbacks.integration_oauth ? (
              <DetailRow label="Broker OAuth callback (Miro path)" value={callbacks.integration_oauth} />
            ) : null}
          </>
        ) : null}
      </DetailSection>

      <DetailSection title="Authentication">
        <DetailRow label="Connections use" value={authSummary} />
        <DetailRow
          label="OAuth client secret"
          value={integration.oauth_client_secret_configured ? "Configured for this integration" : "Not set on this integration"}
        />
        <DetailRow label="Personal vs shared" value={personalVsShared} />
      </DetailSection>

      <DetailSection title="Broker behavior">
        <DetailRow
          label="MCP tool discovery"
          value={
            integration.mcp_enabled
              ? "Allowed through broker when a connection runs a check."
              : "Not applicable (MCP off)."
          }
        />
        <DetailRow label="Typical traffic" value={trafficSummary} />
      </DetailSection>

      {relatedInstances.length ? (
        <DetailSection title="Connections using this integration">
          <ul className="detail-modal-list">
            {relatedInstances.map((ins) => (
              <li key={ins.id}>
                <strong>{ins.name}</strong>
                <span className="muted-copy">
                  {" "}
                  · {authModeLabel(ins.auth_mode)} · {accessModeLabel(ins.access_mode)}
                </span>
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {isAdmin ? (
        <RawJsonDisclosure title="Raw configuration" data={{ integration, relatedInstances }} />
      ) : null}

      <div className="modal-form-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
