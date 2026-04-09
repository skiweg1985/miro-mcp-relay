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

/** Primary usage path for this access; drives which instructions appear first. */
export type AccessPrimaryUsageKind = "direct_token" | "mcp" | "api_relay";

export function deriveAccessPrimaryUsage(
  grant: AccessGrantOut,
  integration: IntegrationV2Out | null,
  instance: IntegrationInstanceV2Out | null,
): AccessPrimaryUsageKind {
  const directTokenPrimary = Boolean(grant.direct_token_access) && instance?.auth_mode === "oauth";
  if (directTokenPrimary) {
    return "direct_token";
  }
  if (integration?.type === "mcp_server" && integration.mcp_enabled) {
    return "mcp";
  }
  return "api_relay";
}

function primaryUsageLead(kind: AccessPrimaryUsageKind): string {
  switch (kind) {
    case "direct_token":
      return "Use this access to retrieve OAuth access tokens for the linked connection.";
    case "mcp":
      return "Use this access in your MCP client.";
    case "api_relay":
      return "Use this access for broker API requests on this connection.";
    default:
      return "";
  }
}

function callToolCaption(type: IntegrationV2Out["type"] | null | undefined): string {
  switch (type) {
    case "mcp_server":
      return "Set tool_name and arguments to match tools from discover-tools for this connection.";
    case "oauth_provider":
      return "Set tool_name and arguments to match the tools your integration exposes.";
    case "api":
      return "Set tool_name and arguments to match tools configured for this integration.";
    default:
      return "Set tool_name and arguments to match your integration.";
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

function SetupField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="usage-modal-section usage-modal-section--tight">
      <p className="usage-field-label">{label}</p>
      {children}
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
  const primaryUsage = deriveAccessPrimaryUsage(grant, integration, instance);

  const showMcpDiscovery = integrationType === "mcp_server" && Boolean(integration?.mcp_enabled);
  const showMcpStreamRelay = showMcpDiscovery && instance?.access_mode === "relay";
  const authMode = instance?.auth_mode ?? null;
  const showDirectTokenAccess = Boolean(grant.direct_token_access) && authMode === "oauth";

  const toolsSummary = grant.allowed_tools?.length
    ? grant.allowed_tools.join(", ")
    : "All tools allowed for this connection";

  const executeUrl = `${apiBase}/consumer/integration-instances/${instanceId}/execute`;
  const discoverUrl = `${apiBase}/consumer/integration-instances/${instanceId}/discover-tools`;
  const mcpRelayUrl = `${apiBase}/consumer/integration-instances/${instanceId}/mcp`;
  const mcpConnectionInfoUrl = `${apiBase}/consumer/integration-instances/${instanceId}/mcp-connection-info`;
  const validateUrl = `${apiBase}/access-grants/validate`;
  const upstreamTokenUrl = `${apiBase}/consumer/integration-instances/${instanceId}/token`;

  const curlExecute = `curl -sS -X POST '${executeUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}' \\
  -d '{"action":"call_tool","tool_name":"YOUR_TOOL_NAME","arguments":{}}'`;

  const curlDiscover = `curl -sS -X POST '${discoverUrl}' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}'`;

  const curlUpstreamToken = `curl -sS -X POST '${upstreamTokenUrl}' \\
  -H 'X-Broker-Access-Key: ${PLACEHOLDER_KEY}'`;

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

  const curlValidate = `curl -sS -X POST '${validateUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{"token":"${PLACEHOLDER_KEY}"}'`;

  const curlBearerExecute = `curl -sS -X POST '${executeUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${PLACEHOLDER_KEY}' \\
  -d '{"action":"call_tool","tool_name":"YOUR_TOOL_NAME","arguments":{}}'`;

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

  const headerAccessKey = `X-Broker-Access-Key: ${PLACEHOLDER_KEY}`;

  const headerBearerNote = (
    <p className="usage-prose usage-prose--compact muted-copy">
      You can also send <code className="usage-inline-code">Authorization: Bearer &lt;key&gt;</code> when the secret starts with{" "}
      <code className="usage-inline-code">bkr_</code>.
    </p>
  );

  const primaryHowTo: ReactNode = (() => {
    if (primaryUsage === "direct_token") {
      return (
        <>
          <p className="usage-prose usage-prose--compact">{primaryUsageLead("direct_token")}</p>
          <SetupField label="Method">
            <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
              POST
            </pre>
          </SetupField>
          <UsageExampleBlock title="Endpoint" code={upstreamTokenUrl} />
          <SetupField label="Required header">
            <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
              {headerAccessKey}
            </pre>
          </SetupField>
          {headerBearerNote}
        </>
      );
    }

    if (primaryUsage === "mcp") {
      if (showMcpStreamRelay) {
        return (
          <>
            <p className="usage-prose usage-prose--compact">{primaryUsageLead("mcp")}</p>
            <SetupField label="Method">
              <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
                POST
              </pre>
            </SetupField>
            <UsageExampleBlock title="Endpoint" code={mcpRelayUrl} />
            <SetupField label="Headers">
              <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
                {`Accept: application/json, text/event-stream
Content-Type: application/json
${headerAccessKey}`}
              </pre>
            </SetupField>
            {headerBearerNote}
          </>
        );
      }
      return (
        <>
          <p className="usage-prose usage-prose--compact">
            Use this access with the broker HTTPS API to discover and call MCP tools (this connection is not on streamable
            relay).
          </p>
          <SetupField label="Discover tools">
            <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
              POST {discoverUrl}
            </pre>
          </SetupField>
          <SetupField label="Call tool">
            <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
              POST {executeUrl}
            </pre>
          </SetupField>
          <SetupField label="Required header">
            <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
              {headerAccessKey}
            </pre>
          </SetupField>
          {headerBearerNote}
        </>
      );
    }

    return (
      <>
        <p className="usage-prose usage-prose--compact">{primaryUsageLead("api_relay")}</p>
        <SetupField label="Method">
          <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
            POST
          </pre>
        </SetupField>
        <UsageExampleBlock title="Endpoint" code={executeUrl} />
        <SetupField label="Required header">
          <pre className="usage-example-pre usage-example-pre--inline" tabIndex={0}>
            {headerAccessKey}
          </pre>
        </SetupField>
        {headerBearerNote}
      </>
    );
  })();

  const primaryExample: { title: string; code: string; caption?: string } | null = (() => {
    if (primaryUsage === "direct_token") {
      return {
        title: "curl",
        code: curlUpstreamToken,
        caption:
          "JSON includes access_token, token_type, expires_at or expires_in when known, connection_id, connection_name, access_name; email and username when the connection profile provides them. Refresh tokens are not returned.",
      };
    }
    if (primaryUsage === "mcp" && showMcpStreamRelay) {
      return {
        title: "MCP client config (streamable-http)",
        code: mcpStreamableClientJson,
        caption: "Many MCP clients accept a JSON block like this; replace the placeholder with your full key.",
      };
    }
    if (primaryUsage === "mcp" && !showMcpStreamRelay) {
      return {
        title: "curl (discover then call)",
        code: `${curlDiscover}\n\n${curlExecute}`,
        caption: callToolCaption(integrationType ?? undefined),
      };
    }
    return {
      title: "curl",
      code: curlExecute,
      caption: callToolCaption(integrationType ?? undefined),
    };
  })();

  const hasSecondaryUsage =
    primaryUsage === "direct_token"
      ? true
      : primaryUsage === "mcp"
        ? true
        : showDirectTokenAccess || showMcpDiscovery;

  const secondaryInner = (() => {
    if (primaryUsage === "direct_token") {
      return (
        <>
          <p className="usage-prose usage-prose--compact">
            The same access key can also call broker tool endpoints or MCP relay when your workflow needs them.
          </p>
          {showMcpStreamRelay ? (
            <>
              <UsageExampleBlock title="MCP relay endpoint" code={mcpRelayUrl} />
              <UsageExampleBlock
                title="MCP client config (streamable-http)"
                code={mcpStreamableClientJson}
                caption="Optional if you use MCP relay with this key."
              />
              <UsageExampleBlock title="Call tool (HTTPS)" code={curlExecute} caption={callToolCaption(integrationType ?? undefined)} />
            </>
          ) : null}
          {showMcpDiscovery && !showMcpStreamRelay ? (
            <>
              <UsageExampleBlock title="Discover tools (HTTPS)" code={curlDiscover} />
              <UsageExampleBlock title="Call tool (HTTPS)" code={curlExecute} caption={callToolCaption(integrationType ?? undefined)} />
            </>
          ) : null}
          {!showMcpDiscovery ? (
            <UsageExampleBlock title="Call tool (HTTPS)" code={curlExecute} caption={callToolCaption(integrationType ?? undefined)} />
          ) : null}
        </>
      );
    }
    if (primaryUsage === "mcp") {
      return (
        <>
          {showDirectTokenAccess ? (
            <>
              <UsageExampleBlock title="Upstream token endpoint" code={upstreamTokenUrl} />
              <UsageExampleBlock title="curl (token)" code={curlUpstreamToken} />
            </>
          ) : null}
          {showMcpStreamRelay ? (
            <>
              <UsageExampleBlock title="Discover tools (HTTPS)" code={curlDiscover} />
              <UsageExampleBlock title="Relay JSON-RPC (curl)" code={curlMcpRelaySse} caption="Use -N for streamed responses." />
              <UsageExampleBlock title="Relay metadata (curl)" code={curlMcpConnectionInfo} />
            </>
          ) : (
            <UsageExampleBlock
              title="MCP relay config (if you switch to relay mode)"
              code={mcpStreamableClientJson}
              caption="Only applies when the connection uses streamable relay; otherwise keep using discover + execute above."
            />
          )}
        </>
      );
    }
    return (
      <>
        {showDirectTokenAccess ? (
          <>
            <UsageExampleBlock title="Token endpoint" code={upstreamTokenUrl} />
            <UsageExampleBlock title="curl (token)" code={curlUpstreamToken} />
          </>
        ) : null}
        {showMcpDiscovery && showMcpStreamRelay ? (
          <>
            <UsageExampleBlock title="MCP relay URL" code={mcpRelayUrl} />
            <UsageExampleBlock title="MCP client config" code={mcpStreamableClientJson} />
          </>
        ) : null}
        {showMcpDiscovery && !showMcpStreamRelay ? (
          <UsageExampleBlock title="Discover tools" code={curlDiscover} />
        ) : null}
      </>
    );
  })();

  const technicalDetailsBody = (
    <>
      <DetailRow label="Expires" value={formatDateTime(grant.expires_at)} />
      <DetailRow label="Created" value={formatDateTime(grant.created_at)} />
      <DetailRow label="Last used" value={formatDateTime(grant.last_used_at)} />
      <DetailRow label="Record status" value={accessGrantStatusLabel(grant.status)} />
      {integration ? <DetailRow label="Integration type" value={integrationTypeLabel(integration.type)} /> : null}
      {instance ? <DetailRow label="Connection auth" value={authModeLabel(instance.auth_mode)} /> : null}
      {instance ? <DetailRow label="Access mode" value={accessModeLabel(instance.access_mode)} /> : null}
      <DetailRow
        label="Bound account"
        value={
          grant.user_connection_id ? (
            <span title={grant.user_connection_id}>Linked</span>
          ) : (
            "Not bound to a specific linked account"
          )
        }
      />
      <DetailRow label="Allowed tools" value={toolsSummary} />
      {instance?.auth_mode === "oauth" ? (
        <DetailRow label="Token API for this key" value={grant.direct_token_access ? "On" : "Off"} />
      ) : null}
      {authMode === "oauth" ? (
        <p className="usage-prose usage-prose--compact">
          Optional per-request upstream bearer when the broker cannot use a stored token:{" "}
          <code className="usage-inline-code">X-User-Token: &lt;provider bearer&gt;</code>.
        </p>
      ) : null}
      <DetailRow label="Policy reference" value={grant.policy_ref ?? "—"} />
      <DetailRow label="Notes" value={grant.notes ?? "—"} />
    </>
  );

  const referenceSnippetsBody = (
    <>
      <UsageExampleBlock title="Validate access key" code={curlValidate} caption="Returns validity and ids when the key is accepted." />
      <UsageExampleBlock title="Call tool (Authorization: Bearer)" code={curlBearerExecute} caption="Same as X-Broker-Access-Key when the secret starts with bkr_." />
      <UsageExampleBlock title="Environment variables" code={envSnippet} caption="Shell and local tooling." />
      <UsageExampleBlock title="Automation config (JSON)" code={automationJson} caption="Inject base URL, connection id, and header auth." />
    </>
  );

  return (
    <Modal
      title="How to use this access"
      description={`Replace ${PLACEHOLDER_KEY} with your access key secret.`}
      wide
      onClose={onClose}
    >
      <DetailSection title="Overview">
        <DetailRow label="Access" value={grant.name} />
        <DetailRow label="Integration" value={integration?.name ?? "—"} />
        <DetailRow label="Connection" value={grant.integration_instance_name} />
        <DetailRow
          label="Status"
          value={<StatusBadge tone={statusTone}>{accessGrantEffectiveStatusLabel(eff)}</StatusBadge>}
        />
      </DetailSection>

      <DetailSection title="How to use">{primaryHowTo}</DetailSection>

      {primaryExample ? (
        <DetailSection title="Example">
          <UsageExampleBlock title={primaryExample.title} code={primaryExample.code} caption={primaryExample.caption} />
        </DetailSection>
      ) : null}

      {hasSecondaryUsage ? (
        <details className="grant-disclosure grant-disclosure--nested">
          <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Other ways to use this access</summary>
          <div className="grant-detail-disclosure-body">{secondaryInner}</div>
        </details>
      ) : null}

      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Technical details</summary>
        <div className="grant-detail-disclosure-body">{technicalDetailsBody}</div>
      </details>

      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Reference snippets</summary>
        <div className="grant-detail-disclosure-body">{referenceSnippetsBody}</div>
      </details>

      <RawJsonDisclosure title="Raw details" data={grant} />

      <div className="modal-form-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
