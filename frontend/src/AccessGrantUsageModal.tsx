import { useMemo, useState } from "react";

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

function whatThisAccessIsFor(type: IntegrationV2Out["type"] | null | undefined): string {
  switch (type) {
    case "mcp_server":
      return "This key lets a client call tools exposed by the upstream MCP service through this broker. Use it when your script or service should list or invoke those tools without using the workspace UI.";
    case "oauth_provider":
      return "This key lets a client call provider tools (for example Microsoft Graph) through this broker, using the connection’s sign-in where applicable. Use it when an app should run provider actions without an interactive workspace session.";
    case "api":
      return "This key lets a client invoke the HTTP tools exposed by this integration through the broker. Use it when a backend or script should call those tools with broker-issued access.";
    default:
      return "This key lets an API client act on one connection through this broker. Use it when your script, service, or app should call tools or validate access without signing in through the workspace UI.";
  }
}

function modalDescription(type: IntegrationV2Out["type"] | null | undefined): string {
  switch (type) {
    case "mcp_server":
      return "Connect your MCP-oriented client through this broker using the access key. Replace the placeholder with your secret key.";
    case "oauth_provider":
      return "Connect your client to provider tools through this broker using the access key. Replace the placeholder with your secret key.";
    case "api":
      return "Connect your client to this integration’s tools through the broker using the access key. Replace the placeholder with your secret key.";
    default:
      return "Connect your client to this broker using the access key. Replace the placeholder with your secret key.";
  }
}

function automationJsonCaption(type: IntegrationV2Out["type"] | null | undefined): string {
  switch (type) {
    case "mcp_server":
      return "Shape for custom runners or secrets managers; not a native desktop MCP transport file.";
    case "oauth_provider":
      return "Shape for automation or secrets managers that inject the broker key and connection id.";
    case "api":
      return "Shape for automation or secrets managers that call the broker consumer API.";
    default:
      return "Shape for custom runners or secrets managers.";
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
  const showMcpDiscovery =
    integrationType === "mcp_server" && Boolean(integration?.mcp_enabled);
  const authMode = instance?.auth_mode ?? null;
  const showAdvancedUserToken = authMode === "oauth";

  const toolsSummary = grant.allowed_tools?.length
    ? grant.allowed_tools.join(", ")
    : "All tools allowed for this connection";

  const executeUrl = `${apiBase}/consumer/integration-instances/${instanceId}/execute`;
  const discoverUrl = `${apiBase}/consumer/integration-instances/${instanceId}/discover-tools`;
  const validateUrl = `${apiBase}/access-grants/validate`;

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

  const mcpScriptNote = showMcpDiscovery
    ? "Use these broker URLs from your scripts or backend. Standard MCP desktop clients expect their own transport; this broker exposes tools through the HTTP API below."
    : undefined;

  const oauthExtra =
    authMode === "oauth" ? (
      <p className="usage-prose">
        This connection can use a provider sign-in stored in the workspace. The broker resolves the upstream token when a linked
        account exists. If your automation cannot rely on that, you can pass a provider bearer token in{" "}
        <code className="usage-inline-code">X-User-Token</code> for a single request.
      </p>
    ) : null;

  const rawReference = {
    "Client label": grant.name,
    Integration: integration?.name ?? null,
    Connection: grant.integration_instance_name,
    "Connection id": instanceId,
    "Key prefix": grant.key_prefix,
  };

  return (
    <Modal title="How to use this access" description={modalDescription(integrationType ?? undefined)} wide onClose={onClose}>
      <DetailSection title="Overview">
        <DetailRow label="Client or app" value={grant.name} />
        <DetailRow label="Integration" value={integration?.name ?? "—"} />
        <DetailRow label="Connection" value={grant.integration_instance_name} />
        <DetailRow
          label="Status"
          value={<StatusBadge tone={statusTone}>{accessGrantEffectiveStatusLabel(eff)}</StatusBadge>}
        />
        <DetailRow label="Record status" value={accessGrantStatusLabel(grant.status)} />
        <DetailRow label="Expires" value={formatDateTime(grant.expires_at)} />
        {integration ? <DetailRow label="Integration type" value={integrationTypeLabel(integration.type)} /> : null}
        {instance ? <DetailRow label="Connection auth" value={authModeLabel(instance.auth_mode)} /> : null}
        {instance ? <DetailRow label="Access mode" value={accessModeLabel(instance.access_mode)} /> : null}
        <DetailRow label="Tool policy" value={toolsSummary} />
      </DetailSection>

      <section className="usage-modal-section">
        <h3 className="detail-modal-section-title">What this access is for</h3>
        <p className="usage-prose">{whatThisAccessIsFor(integrationType ?? undefined)}</p>
      </section>

      <DetailSection title="Authentication">
        <p className="usage-prose">
          The access key identifies your client to this broker. It is not the provider OAuth token, not the upstream API key, and
          not the end-user connection secret.
        </p>
        <ul className="usage-list">
          <li>
            Send the key in <code className="usage-inline-code">X-Broker-Access-Key</code>, or as{" "}
            <code className="usage-inline-code">Authorization: Bearer</code> when the value starts with{" "}
            <code className="usage-inline-code">bkr_</code>.
          </li>
          <li>Keep the full key private. Only the prefix is shown in lists after creation.</li>
        </ul>
        {oauthExtra}
      </DetailSection>

      <DetailSection title="Available endpoints">
        <p className="usage-prose">
          All paths are under your broker origin. <code className="usage-inline-code">{apiBase}</code> is derived from this browser
          session.
        </p>
        <ul className="usage-list">
          <li>
            <strong>
              {integrationType === "oauth_provider"
                ? "Call a provider tool"
                : integrationType === "api"
                  ? "Call a tool"
                  : integrationType === "mcp_server"
                    ? "Call a tool (MCP)"
                    : "Call a tool"}
            </strong>{" "}
            — <code className="usage-inline-code">POST …/consumer/integration-instances/{"{"}id{"}"}/execute</code> with JSON body{" "}
            <code className="usage-inline-code">action</code>, <code className="usage-inline-code">tool_name</code>,{" "}
            <code className="usage-inline-code">arguments</code>.
          </li>
          <li>
            <strong>Validate a key</strong> — <code className="usage-inline-code">POST …/access-grants/validate</code> with{" "}
            <code className="usage-inline-code">{"{ \"token\": \"…\" }"}</code>. Returns grant and connection identifiers when the
            key is active.
          </li>
          {showMcpDiscovery ? (
            <li>
              <strong>List tools (MCP)</strong> —{" "}
              <code className="usage-inline-code">POST …/consumer/integration-instances/{"{"}id{"}"}/discover-tools</code>. Persists
              tool metadata for policy checks before <code className="usage-inline-code">call_tool</code>.
            </li>
          ) : null}
        </ul>
      </DetailSection>

      {showMcpDiscovery ? (
        <DetailSection title="MCP connection">
          <p className="usage-prose">
            The broker calls the upstream MCP HTTP API (tools list and tool calls) using the connection credentials. Your client
            should call the broker consumer endpoints above, not the upstream MCP base URL, when using this access key.
          </p>
          {mcpScriptNote ? <p className="usage-prose muted-copy">{mcpScriptNote}</p> : null}
        </DetailSection>
      ) : null}

      <DetailSection title="Direct token request">
        <p className="usage-prose">
          {integrationType === "oauth_provider"
            ? "Use validation when you need to confirm the broker still accepts this key. It does not issue or return provider OAuth tokens."
            : "Use validation when you need a lightweight check that a key is still valid. It does not return upstream OAuth tokens."}
        </p>
      </DetailSection>

      <section className="usage-modal-section">
        <h3 className="detail-modal-section-title">Examples</h3>
        <UsageExampleBlock
          title="Environment variables"
          code={envSnippet}
          caption="Use in shell scripts; paste your real key where noted."
        />
        <UsageExampleBlock title="Automation config (JSON)" code={automationJson} caption={automationJsonCaption(integrationType ?? undefined)} />
        <UsageExampleBlock title="Call a tool (header)" code={curlExecute} caption={callToolCaption(integrationType ?? undefined)} />
        <UsageExampleBlock title="Call a tool (Bearer)" code={curlBearerExecute} />
        {showMcpDiscovery ? (
          <UsageExampleBlock
            title="Discover tools (MCP)"
            code={curlDiscover}
            caption="Response lists tools the connection can expose; call_tool still enforces allowed tools."
          />
        ) : null}
        <UsageExampleBlock
          title="Validate access key"
          code={curlValidate}
          caption="Response includes grant_id and integration_instance_id when valid."
        />
      </section>

      {showAdvancedUserToken ? (
        <section className="usage-modal-section">
          <h3 className="detail-modal-section-title">Advanced</h3>
          <p className="usage-prose muted-copy">
            Optional upstream header when the broker cannot use a stored account token for this request:{" "}
            <code className="usage-inline-code">X-User-Token: &lt;provider bearer&gt;</code>.
            {integrationType === "oauth_provider"
              ? " Typical for OAuth provider integrations when automation supplies the provider token directly."
              : null}
          </p>
        </section>
      ) : null}

      <RawJsonDisclosure title="Raw details" data={rawReference} />

      <div className="modal-form-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
