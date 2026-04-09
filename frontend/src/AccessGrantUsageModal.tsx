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
import { DetailRow, RawJsonDisclosure } from "./object-detail-ui";
import type { AccessGrantOut, IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { copyToClipboard, formatDateTime } from "./utils";

const PLACEHOLDER_KEY = "YOUR_BROKER_ACCESS_KEY";

export type AccessPrimaryUsageKind = "direct_token" | "mcp" | "api_relay";

export function deriveAccessPrimaryUsage(
  grant: AccessGrantOut,
  integration: IntegrationV2Out | null,
  instance: IntegrationInstanceV2Out | null,
): AccessPrimaryUsageKind {
  if (Boolean(grant.direct_token_access) && instance?.auth_mode === "oauth") {
    return "direct_token";
  }
  if (integration?.type === "mcp_server" && integration.mcp_enabled) {
    return "mcp";
  }
  return "api_relay";
}

function CopyBlock({ label, code, caption }: { label: string; code: string; caption?: string }) {
  const { notify } = useAppContext();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyToClipboard(code);
    notify({ tone: ok ? "success" : "error", title: ok ? "Copied" : "Copy failed" });
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="usage-copy-block">
      <div className="usage-copy-block-header">
        <span className="usage-copy-block-label">{label}</span>
        <button type="button" className="ghost-button ghost-button--compact" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {caption ? <p className="usage-copy-block-caption">{caption}</p> : null}
      <pre className="usage-copy-block-pre" tabIndex={0}>{code}</pre>
    </div>
  );
}

function InlineValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-inline-field">
      <span className="usage-inline-field-label">{label}</span>
      <code className="usage-inline-field-value">{value}</code>
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
    eff === "active" ? "success" : eff === "revoked" ? "danger" : eff === "invalid" ? "warn" : "neutral";

  const apiBase = useMemo(() => {
    if (typeof window === "undefined") return "/api/v1";
    return `${window.location.origin}/api/v1`;
  }, []);

  const instanceId = grant.integration_instance_id;
  const integrationType = integration?.type ?? null;
  const primaryUsage = deriveAccessPrimaryUsage(grant, integration, instance);
  const showMcpDiscovery = integrationType === "mcp_server" && Boolean(integration?.mcp_enabled);
  const showMcpStreamRelay = showMcpDiscovery && instance?.access_mode === "relay";
  const authMode = instance?.auth_mode ?? null;
  const showDirectTokenAccess = Boolean(grant.direct_token_access) && authMode === "oauth";

  const executeUrl = `${apiBase}/consumer/integration-instances/${instanceId}/execute`;
  const discoverUrl = `${apiBase}/consumer/integration-instances/${instanceId}/discover-tools`;
  const mcpRelayUrl = `${apiBase}/consumer/integration-instances/${instanceId}/mcp`;
  const upstreamTokenUrl = `${apiBase}/consumer/integration-instances/${instanceId}/token`;
  const validateUrl = `${apiBase}/access-grants/validate`;

  const headerAccessKey = `X-Broker-Access-Key: ${PLACEHOLDER_KEY}`;

  // ── context sentence ──────────────────────────────────────────────────
  const contextSentence = (() => {
    switch (primaryUsage) {
      case "direct_token":
        return "Retrieve the upstream OAuth access token for the linked connection.";
      case "mcp":
        return showMcpStreamRelay
          ? "Connect your MCP client to this connection through the broker."
          : "Discover and call MCP tools on this connection through the broker API.";
      case "api_relay":
        return "Call tools on this connection through the broker API.";
    }
  })();

  // ── primary snippet ───────────────────────────────────────────────────
  const primarySnippet = (() => {
    if (primaryUsage === "direct_token") {
      return {
        label: "curl",
        code: `curl -sS -X POST '${upstreamTokenUrl}' \\\n  -H '${headerAccessKey}'`,
        caption: "Returns access_token, token_type, expires_at, connection_name, access_name. No refresh token.",
      };
    }
    if (primaryUsage === "mcp" && showMcpStreamRelay) {
      return {
        label: "MCP client config",
        code: `{
  "mcpServers": {
    "${grant.integration_instance_name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()}": {
      "type": "streamable-http",
      "url": "${mcpRelayUrl}",
      "headers": {
        "X-Broker-Access-Key": "${PLACEHOLDER_KEY}"
      }
    }
  }
}`,
        caption: "Paste into your MCP client settings. Replace the placeholder with your key.",
      };
    }
    if (primaryUsage === "mcp") {
      return {
        label: "curl",
        code: `curl -sS -X POST '${discoverUrl}' \\\n  -H '${headerAccessKey}'\n\ncurl -sS -X POST '${executeUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -H '${headerAccessKey}' \\\n  -d '{"action":"call_tool","tool_name":"YOUR_TOOL","arguments":{}}'`,
        caption: "Discover tools first, then call them by name.",
      };
    }
    return {
      label: "curl",
      code: `curl -sS -X POST '${executeUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -H '${headerAccessKey}' \\\n  -d '{"action":"call_tool","tool_name":"YOUR_TOOL","arguments":{}}'`,
    };
  })();

  // ── primary fields ────────────────────────────────────────────────────
  const primaryFields = (() => {
    if (primaryUsage === "direct_token") {
      return { method: "POST", endpoint: upstreamTokenUrl, header: headerAccessKey };
    }
    if (primaryUsage === "mcp" && showMcpStreamRelay) {
      return { method: "POST", endpoint: mcpRelayUrl, header: headerAccessKey };
    }
    if (primaryUsage === "mcp") {
      return { method: "POST", endpoint: executeUrl, header: headerAccessKey };
    }
    return { method: "POST", endpoint: executeUrl, header: headerAccessKey };
  })();

  // ── secondary snippets (collapsed "Also possible") ────────────────────
  const secondarySnippets: { label: string; code: string; caption?: string }[] = [];

  if (primaryUsage === "direct_token") {
    if (showMcpStreamRelay) {
      secondarySnippets.push({
        label: "MCP client config",
        code: `{\n  "mcpServers": {\n    "broker_relay": {\n      "type": "streamable-http",\n      "url": "${mcpRelayUrl}",\n      "headers": { "X-Broker-Access-Key": "${PLACEHOLDER_KEY}" }\n    }\n  }\n}`,
      });
    }
    secondarySnippets.push({
      label: "Call a tool",
      code: `curl -sS -X POST '${executeUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -H '${headerAccessKey}' \\\n  -d '{"action":"call_tool","tool_name":"YOUR_TOOL","arguments":{}}'`,
    });
  }

  if (primaryUsage === "mcp") {
    if (showDirectTokenAccess) {
      secondarySnippets.push({
        label: "Retrieve token",
        code: `curl -sS -X POST '${upstreamTokenUrl}' \\\n  -H '${headerAccessKey}'`,
      });
    }
    if (showMcpStreamRelay) {
      secondarySnippets.push({
        label: "Discover tools",
        code: `curl -sS -X POST '${discoverUrl}' \\\n  -H '${headerAccessKey}'`,
      });
    }
  }

  if (primaryUsage === "api_relay") {
    if (showDirectTokenAccess) {
      secondarySnippets.push({
        label: "Retrieve token",
        code: `curl -sS -X POST '${upstreamTokenUrl}' \\\n  -H '${headerAccessKey}'`,
      });
    }
    if (showMcpStreamRelay) {
      secondarySnippets.push({
        label: "MCP client config",
        code: `{\n  "mcpServers": {\n    "broker_relay": {\n      "type": "streamable-http",\n      "url": "${mcpRelayUrl}",\n      "headers": { "X-Broker-Access-Key": "${PLACEHOLDER_KEY}" }\n    }\n  }\n}`,
      });
    } else if (showMcpDiscovery) {
      secondarySnippets.push({
        label: "Discover tools",
        code: `curl -sS -X POST '${discoverUrl}' \\\n  -H '${headerAccessKey}'`,
      });
    }
  }

  secondarySnippets.push({
    label: "Validate key",
    code: `curl -sS -X POST '${validateUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"token":"${PLACEHOLDER_KEY}"}'`,
  });

  secondarySnippets.push({
    label: "Environment variables",
    code: `export BROKER_API='${apiBase}'\nexport BROKER_ACCESS_KEY='${PLACEHOLDER_KEY}'\nexport CONNECTION_ID='${instanceId}'`,
  });

  // ── technical details ─────────────────────────────────────────────────
  const toolsSummary = grant.allowed_tools?.length
    ? grant.allowed_tools.join(", ")
    : "All tools allowed for this connection";

  return (
    <Modal title={grant.name} wide onClose={onClose}>
      {/* ── context bar ────────────────────────────────────────────── */}
      <div className="usage-context-bar">
        <span className="usage-context-meta">
          {integration?.name ?? "—"} · {grant.integration_instance_name}
        </span>
        <StatusBadge tone={statusTone}>{accessGrantEffectiveStatusLabel(eff)}</StatusBadge>
      </div>

      {/* ── primary block ──────────────────────────────────────────── */}
      <section className="usage-hero" aria-label="How to use">
        <p className="usage-hero-lead">{contextSentence}</p>

        <div className="usage-hero-fields">
          <InlineValue label="Method" value={primaryFields.method} />
          <InlineValue label="Endpoint" value={primaryFields.endpoint} />
          <InlineValue label="Header" value={primaryFields.header} />
        </div>

        <CopyBlock
          label={primarySnippet.label}
          code={primarySnippet.code}
          caption={primarySnippet.caption}
        />
      </section>

      {/* ── also possible (collapsed) ──────────────────────────────── */}
      {secondarySnippets.length > 0 ? (
        <details className="grant-disclosure grant-disclosure--nested">
          <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Also possible</summary>
          <div className="grant-detail-disclosure-body">
            {secondarySnippets.map((s) => (
              <CopyBlock key={s.label} label={s.label} code={s.code} caption={s.caption} />
            ))}
          </div>
        </details>
      ) : null}

      {/* ── technical details (collapsed) ──────────────────────────── */}
      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Technical details</summary>
        <div className="grant-detail-disclosure-body">
          <DetailRow label="Expires" value={formatDateTime(grant.expires_at)} />
          <DetailRow label="Created" value={formatDateTime(grant.created_at)} />
          <DetailRow label="Last used" value={formatDateTime(grant.last_used_at)} />
          <DetailRow label="Status" value={accessGrantStatusLabel(grant.status)} />
          <DetailRow label="Key prefix" value={grant.key_prefix} />
          {integration ? <DetailRow label="Integration type" value={integrationTypeLabel(integration.type)} /> : null}
          {instance ? <DetailRow label="Auth mode" value={authModeLabel(instance.auth_mode)} /> : null}
          {instance ? <DetailRow label="Access mode" value={accessModeLabel(instance.access_mode)} /> : null}
          <DetailRow label="Allowed tools" value={toolsSummary} />
          {instance?.auth_mode === "oauth" ? (
            <DetailRow label="Token API" value={grant.direct_token_access ? "On" : "Off"} />
          ) : null}
        </div>
      </details>

      {/* ── raw (collapsed) ────────────────────────────────────────── */}
      <RawJsonDisclosure title="Raw details" data={grant} />

      <div className="modal-form-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
