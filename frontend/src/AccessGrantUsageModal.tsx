import { useMemo, useState, type ReactNode } from "react";

import { useAppContext } from "./app-context";
import { Modal, StatusBadge } from "./components";
import {
  accessGrantEffectiveStatusLabel,
  accessGrantStatusLabel,
  accessModeLabel,
  authModeLabel,
  integrationTypeLabel,
} from "./integrationLabels";
import { DetailRow, DetailSection, RawJsonDisclosure } from "./object-detail-ui";
import type { AccessGrantOut, IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { copyToClipboard, formatDateTime } from "./utils";

const PLACEHOLDER_KEY = "YOUR_BROKER_ACCESS_KEY";

/** Drives which usage block is shown first; derived from integration + connection when not explicit in API. */
export type AccessPrimaryUsageKind = "mcp" | "relay_http" | "direct_token";

/** `direct_token` is reserved for a future explicit primary-usage flag on the grant or integration. */
export function deriveAccessPrimaryUsage(integration: IntegrationV2Out | null, _instance: IntegrationInstanceV2Out | null): AccessPrimaryUsageKind {
  if (integration?.type === "mcp_server" && integration.mcp_enabled) {
    return "mcp";
  }
  return "relay_http";
}

function summaryWhatFor(kind: AccessPrimaryUsageKind, integrationType: IntegrationV2Out["type"] | null): string {
  if (kind === "mcp") {
    return "Connect an MCP client to the upstream tool service through this broker using your access key.";
  }
  switch (integrationType) {
    case "oauth_provider":
      return "Call provider tools through this broker with your access key.";
    case "api":
      return "Call this integration’s HTTP tools through the broker with your access key.";
    default:
      return "Call tools on this connection through the broker with your access key.";
  }
}

function callToolCaption(type: IntegrationV2Out["type"] | null | undefined): string {
  switch (type) {
    case "mcp_server":
      return "Set tool_name and arguments to match tools discovered for this MCP integration.";
    case "oauth_provider":
      return "Set tool_name and arguments to match the provider tools your integration exposes.";
    case "api":
      return "Set tool_name and arguments to match the tools configured for this integration.";
    default:
      return "Set tool_name and arguments to match your integration.";
  }
}

function automationJsonCaption(type: IntegrationV2Out["type"] | null | undefined): string {
  switch (type) {
    case "mcp_server":
      return "For automation or a secrets manager; not a native desktop MCP transport file.";
    case "oauth_provider":
      return "For automation that injects the broker key and connection id.";
    case "api":
      return "For automation that calls the broker consumer API.";
    default:
      return "For custom runners or secrets managers.";
  }
}

function UsageExampleBlock({
  title,
  code,
  caption,
}: {
  title: string;
  code: string;
  caption?: string;
}) {
  const { notify } = useAppContext();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyToClipboard(code);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied" : "Copy failed",
    });
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="usage-example-block">
      <div className="usage-example-block-header">
        <span className="usage-example-block-title">{title}</span>
        <button type="button" className="ghost-button ghost-button--compact" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {caption ? <p className="usage-example-caption">{caption}</p> : null}
      <pre className="usage-example-pre" tabIndex={0}>
        {code}
      </pre>
    </div>
  );
}

type Props = {
  grant: AccessGrantOut;
  integration: IntegrationV2Out | null;
  instance: IntegrationInstanceV2Out | null;
  onClose: () => void;
};

export function AccessGrantUsageModal({ grant, integration, instance, onClose }: Props) {
  const eff = grant.effective_status ?? grant.status;
  const statusTone =
    eff === "active"
      ? "success"
      : eff === "revoked"
        ? "danger"
        : eff === "invalid"
          ? "warn"
          : "neutral";

  const apiBase = useMemo(() => {
    if (typeof window === "undefined") {
      return "/api/v1";
    }
    return `${window.location.origin}/api/v1`;
  }, []);

  const instanceId = grant.integration_instance_id;
  const integrationType = integration?.type ?? null;
  const primaryUsage = deriveAccessPrimaryUsage(integration, instance);

  const showMcpDiscovery =
    integrationType === "mcp_server" && Boolean(integration?.mcp_enabled);
  const showMcpStreamRelay = showMcpDiscovery && instance?.access_mode === "relay";
  const authMode = instance?.auth_mode ?? null;
  const showAdvancedUserToken = authMode === "oauth";

  const toolsSummary = grant.allowed_tools?.length
    ? grant.allowed_tools.join(", ")
    : "All tools allowed for this connection";

  const executeUrl = `${apiBase}/consumer/integration-instances/${instanceId}/execute`;
  const discoverUrl = `${apiBase}/consumer/integration-instances/${instanceId}/discover-tools`;
  const mcpRelayUrl = `${apiBase}/consumer/integration-instances/${instanceId}/mcp`;
  const mcpConnectionInfoUrl = `${apiBase}/consumer/integration-instances/${instanceId}/mcp-connection-info`;
  const validateUrl = `${apiBase}/access-grants/validate`;
  const upstreamTokenUrl = `${apiBase}/consumer/integration-instances/${instanceId}/token`;
  const showDirectTokenAccess = Boolean(grant.direct_token_access) && instance?.auth_mode === "oauth";

  const curlExecute = `curl -sS -X POST '${executeUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}' \\
  -d '{"action":"call_tool","tool_name":"YOUR_TOOL_NAME","arguments":{}}'`;

  const curlDiscover = `curl -sS -X POST '${discoverUrl}' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}'`;

  const curlBearerExecute = `curl -sS -X POST '${executeUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${PLACEHOLDER_KEY}' \\
  -d '{"action":"call_tool","tool_name":"YOUR_TOOL_NAME","arguments":{}}'`;

  const curlValidate = `curl -sS -X POST '${validateUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{"token":"${PLACEHOLDER_KEY}"}'`;

  const curlUpstreamToken = `curl -sS -X POST '${upstreamTokenUrl}' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}'`;

  const envSnippet = `export BROKER_API='${apiBase}'
export BROKER_ACCESS_KEY='${PLACEHOLDER_KEY}'
export CONNECTION_ID='${instanceId}'`;

  const automationJson = `{
  "broker_api_base": "${apiBase}",
  "connection_id": "${instanceId}",
  "auth": {
    "type": "broker_access_key",
    "header": "X-Broker-Access-Key",
    "value": "${PLACEHOLDER_KEY}"
  }
}`;

  const mcpStreamableClientJson = `{
  "mcpServers": {
    "broker_relay": {
      "type": "streamable-http",
      "url": "${mcpRelayUrl}",
      "headers": {
        "X-Broker-Access-Key": "${PLACEHOLDER_KEY}"
      }
    }
  }
}`;

  const curlMcpRelaySse = `curl -sS -N -X POST '${mcpRelayUrl}' \\
  -H 'Accept: application/json, text/event-stream' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0.0"}}}'`;

  const curlMcpConnectionInfo = `curl -sS '${mcpConnectionInfoUrl}' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}'`;

  const oauthExtra =
    authMode === "oauth" ? (
      <p className="usage-prose usage-prose--compact">
        This connection can use a stored provider sign-in. If automation cannot rely on that, pass a provider bearer in{" "}
        <code className="usage-inline-code">X-User-Token</code> for a single request (see Advanced).
      </p>
    ) : null;

  const rawReference = {
    "Client label": grant.name,
    Integration: integration?.name ?? null,
    Connection: grant.integration_instance_name,
    "Connection id": instanceId,
    "Key prefix": grant.key_prefix,
  };

  const authLines = (
    <ul className="usage-list usage-list--tight">
      <li>
        Send the key in <code className="usage-inline-code">X-Broker-Access-Key</code>, or{" "}
        <code className="usage-inline-code">Authorization: Bearer &lt;key&gt;</code> when the value starts with{" "}
        <code className="usage-inline-code">bkr_</code>.
      </li>
      <li>It identifies your client to this broker, not the upstream OAuth token or API key.</li>
    </ul>
  );

  const primaryMcpRelay = (
    <>
      <div className="usage-primary-lede">
        <h3 className="usage-primary-heading">Use this in your MCP client</h3>
        <p className="usage-prose usage-prose--compact">{summaryWhatFor("mcp", integrationType)}</p>
      </div>
      {authLines}
      {oauthExtra}
      <UsageExampleBlock title="MCP endpoint" code={mcpRelayUrl} />
      <div className="usage-modal-section usage-modal-section--tight">
        <p className="usage-field-label">Header</p>
        <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
          {`X-Broker-Access-Key: ${PLACEHOLDER_KEY}`}
        </pre>
      </div>
      <UsageExampleBlock
        title="Example client config (streamable-http)"
        code={mcpStreamableClientJson}
        caption="Replace the placeholder with your full key. Many MCP clients accept this JSON shape."
      />
    </>
  );

  const primaryMcpDirect = (
    <>
      <div className="usage-primary-lede">
        <h3 className="usage-primary-heading">Use this with the broker MCP API</h3>
        <p className="usage-prose usage-prose--compact">
          This connection uses broker HTTPS endpoints (not the streamable relay URL). Discover tools, then call them with the same
          access key.
        </p>
      </div>
      {authLines}
      <UsageExampleBlock title="Discover tools" code={curlDiscover} caption="Lists tools for this connection before call_tool." />
      <UsageExampleBlock title="Call a tool" code={curlExecute} caption={callToolCaption(integrationType ?? undefined)} />
    </>
  );

  const primaryRelayHttp = (
    <>
      <div className="usage-primary-lede">
        <h3 className="usage-primary-heading">Call tools over HTTPS</h3>
        <p className="usage-prose usage-prose--compact">{summaryWhatFor("relay_http", integrationType)}</p>
      </div>
      {authLines}
      {oauthExtra}
      <UsageExampleBlock title="Tool call endpoint" code={executeUrl} />
      <div className="usage-modal-section usage-modal-section--tight">
        <p className="usage-field-label">Header</p>
        <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
          {`X-Broker-Access-Key: ${PLACEHOLDER_KEY}`}
        </pre>
      </div>
      <UsageExampleBlock title="Example request (curl)" code={curlExecute} caption={callToolCaption(integrationType ?? undefined)} />
    </>
  );

  let primaryBlock: ReactNode;
  if (primaryUsage === "mcp") {
    primaryBlock = showMcpStreamRelay ? primaryMcpRelay : primaryMcpDirect;
  } else {
    primaryBlock = primaryRelayHttp;
  }

  const secondaryMcpRelayExtras =
    showMcpStreamRelay ? (
      <>
        <UsageExampleBlock
          title="Discover tools (MCP)"
          code={curlDiscover}
          caption="Optional; lists tools the connection can expose."
        />
        <UsageExampleBlock
          title="Relay request (curl)"
          code={curlMcpRelaySse}
          caption="JSON-RPC example; use -N for streamed responses."
        />
        <UsageExampleBlock title="Relay metadata (curl)" code={curlMcpConnectionInfo} />
      </>
    ) : null;

  const secondaryMcpDirectExtras =
    showMcpDiscovery && !showMcpStreamRelay ? (
      <UsageExampleBlock
        title="MCP client config (streamable-http)"
        code={mcpStreamableClientJson}
        caption="Only if you switch this connection to relay mode; otherwise use the broker API above."
      />
    ) : null;

  const secondaryDiscoverIfNotPrimary =
    showMcpDiscovery && primaryUsage === "relay_http" ? (
      <UsageExampleBlock
        title="Discover tools (MCP)"
        code={curlDiscover}
        caption="Lists tools before call_tool."
      />
    ) : null;

  const secondaryValidate = (
    <UsageExampleBlock title="Validate access key" code={curlValidate} caption="Lightweight check; includes ids when valid." />
  );

  return (
    <Modal
      title="How to use this access"
      description={`Replace ${PLACEHOLDER_KEY} with your full secret key.`}
      wide
      onClose={onClose}
    >
      <DetailSection title="Summary">
        <DetailRow label="Client or app" value={grant.name} />
        <DetailRow label="Integration" value={integration?.name ?? "—"} />
        <DetailRow label="Connection" value={grant.integration_instance_name} />
        <DetailRow
          label="Status"
          value={<StatusBadge tone={statusTone}>{accessGrantEffectiveStatusLabel(eff)}</StatusBadge>}
        />
      </DetailSection>

      {showDirectTokenAccess ? (
        <section className="usage-primary-card usage-direct-token-card" aria-labelledby="usage-direct-token-label">
          <p id="usage-direct-token-label" className="usage-primary-kicker">
            Direct token access
          </p>
          <div className="usage-primary-lede">
            <h3 className="usage-primary-heading">Retrieve upstream OAuth access token</h3>
            <p className="usage-prose usage-prose--compact">
              Authenticate with your broker access key. The response includes the current provider access token (refreshed if
              needed), and when the connection stores a profile, <code className="usage-inline-code">email</code> and{" "}
              <code className="usage-inline-code">username</code> (from the linked account metadata). Refresh tokens are not
              returned.
            </p>
          </div>
          <UsageExampleBlock title="Endpoint" code={upstreamTokenUrl} />
          <div className="usage-modal-section usage-modal-section--tight">
            <p className="usage-field-label">Header</p>
            <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
              {`X-Broker-Access-Key: ${PLACEHOLDER_KEY}`}
            </pre>
          </div>
          <UsageExampleBlock
            title="Example (curl)"
            code={curlUpstreamToken}
            caption="JSON: access_token, token_type, expires_at, expires_in (if known), connection_id, connection_name, access_name, email, username (when available from the connection profile)."
          />
        </section>
      ) : null}

      <section className="usage-primary-card" aria-labelledby="usage-primary-label">
        <p id="usage-primary-label" className="usage-primary-kicker">
          Primary usage
        </p>
        {primaryBlock}
      </section>

      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">More examples and alternate auth</summary>
        <div className="grant-detail-disclosure-body">
          {secondaryValidate}
          <UsageExampleBlock title="Environment variables" code={envSnippet} caption="Shell scripts and local tooling." />
          <UsageExampleBlock title="Automation config (JSON)" code={automationJson} caption={automationJsonCaption(integrationType ?? undefined)} />
          <UsageExampleBlock title="Call a tool (Bearer)" code={curlBearerExecute} caption="Same as the header form when the key starts with bkr_." />
          {secondaryDiscoverIfNotPrimary}
          {secondaryMcpRelayExtras}
          {secondaryMcpDirectExtras}
        </div>
      </details>

      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Connection and policy details</summary>
        <div className="grant-detail-disclosure-body">
          <DetailRow label="Record status" value={accessGrantStatusLabel(grant.status)} />
          <DetailRow label="Expires" value={formatDateTime(grant.expires_at)} />
          {integration ? <DetailRow label="Integration type" value={integrationTypeLabel(integration.type)} /> : null}
          {instance ? <DetailRow label="Connection auth" value={authModeLabel(instance.auth_mode)} /> : null}
          {instance ? <DetailRow label="Access mode" value={accessModeLabel(instance.access_mode)} /> : null}
          {instance?.auth_mode === "oauth" ? (
            <DetailRow
              label="Upstream token API"
              value={grant.direct_token_access ? "Allowed for this key" : "Off"}
            />
          ) : null}
          <DetailRow label="Tool policy" value={toolsSummary} />
        </div>
      </details>

      {showAdvancedUserToken ? (
        <details className="grant-disclosure grant-disclosure--nested">
          <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Advanced</summary>
          <div className="grant-detail-disclosure-body">
            <p className="usage-prose usage-prose--compact">
              Optional per-request upstream bearer when the broker cannot use a stored account token:{" "}
              <code className="usage-inline-code">X-User-Token: &lt;provider bearer&gt;</code>.
              {integrationType === "oauth_provider"
                ? " Typical when automation supplies the provider token directly."
                : null}
            </p>
          </div>
        </details>
      ) : null}

      <RawJsonDisclosure title="Raw reference" data={rawReference} />

      <div className="modal-form-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
