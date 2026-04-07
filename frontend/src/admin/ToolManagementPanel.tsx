import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { brokerUi } from "../brokerTerminology";
import { Card, EmptyState, StatusBadge } from "../components";
import { isApiError } from "../errors";
import type { DiscoveredToolOut, ToolAccessPolicyOut, ToolDiscoveryResult } from "../types";
import { formatDateTime } from "../utils";

export function ToolManagementPanel({
  appId,
  csrfToken,
  onNotify,
}: {
  appId: string;
  csrfToken: string;
  onNotify: (toast: { tone: "success" | "error" | "info"; title: string; description?: string }) => void;
}) {
  const [tools, setTools] = useState<DiscoveredToolOut[]>([]);
  const [policies, setPolicies] = useState<ToolAccessPolicyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [updatingPolicy, setUpdatingPolicy] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [toolsData, policiesData] = await Promise.all([
        api.discoveredTools(csrfToken, appId),
        api.toolPolicies(csrfToken, appId),
      ]);
      setTools(toolsData);
      setPolicies(policiesData);
    } catch {
      // keep empty state
    } finally {
      setLoading(false);
    }
  }, [appId, csrfToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const policyByToolId = Object.fromEntries(policies.map((p) => [p.discovered_tool_id, p]));

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const result: ToolDiscoveryResult = await api.discoverTools(csrfToken, appId);
      onNotify({
        tone: "success",
        title: `${result.tools_found} tools discovered`,
        description: `${result.tools_added} added, ${result.tools_updated} updated, ${result.tools_removed} removed`,
      });
      await load();
    } catch (error) {
      onNotify({
        tone: "error",
        title: "Tool discovery failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setDiscovering(false);
    }
  };

  const togglePolicy = async (policyId: string, field: "visible" | "allowed_with_personal" | "allowed_with_shared", value: boolean) => {
    setUpdatingPolicy((prev) => new Set(prev).add(policyId));
    try {
      const updated = await api.updateToolPolicy(csrfToken, policyId, { [field]: value });
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (error) {
      onNotify({
        tone: "error",
        title: "Policy update failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setUpdatingPolicy((prev) => {
        const next = new Set(prev);
        next.delete(policyId);
        return next;
      });
    }
  };

  const activeTools = tools.filter((t) => t.status === "active");
  const removedTools = tools.filter((t) => t.status === "removed");

  if (loading) {
    return (
      <Card title={brokerUi.discoveredTools}>
        <p className="muted">Loading tools…</p>
      </Card>
    );
  }

  return (
    <div className="tool-management-panel">
      <Card title={brokerUi.discoveredTools}>
        <div className="integration-detail-actions" style={{ marginBottom: "1rem" }}>
          <button type="button" className="primary-button" disabled={discovering} onClick={handleDiscover}>
            {discovering ? "Discovering…" : "Discover tools"}
          </button>
        </div>

        {tools.length === 0 ? (
          <EmptyState title="No tools discovered" body="Use the button above to discover tools from the upstream MCP server." />
        ) : (
          <>
            {activeTools.length > 0 ? (
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Visible</th>
                    <th>Personal</th>
                    <th>Shared</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTools.map((tool) => {
                    const policy = policyByToolId[tool.id];
                    const busy = policy ? updatingPolicy.has(policy.id) : false;
                    return (
                      <tr key={tool.id}>
                        <td>
                          <strong>{tool.display_name || tool.tool_name}</strong>
                          {tool.description ? (
                            <span className="muted" style={{ display: "block", fontSize: "0.85em" }}>
                              {tool.description.length > 100 ? `${tool.description.slice(0, 100)}…` : tool.description}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {policy ? (
                            <input
                              type="checkbox"
                              checked={policy.visible}
                              disabled={busy}
                              onChange={() => togglePolicy(policy.id, "visible", !policy.visible)}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {policy ? (
                            <input
                              type="checkbox"
                              checked={policy.allowed_with_personal}
                              disabled={busy}
                              onChange={() => togglePolicy(policy.id, "allowed_with_personal", !policy.allowed_with_personal)}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {policy ? (
                            <input
                              type="checkbox"
                              checked={policy.allowed_with_shared}
                              disabled={busy}
                              onChange={() => togglePolicy(policy.id, "allowed_with_shared", !policy.allowed_with_shared)}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="muted">{formatDateTime(tool.last_seen_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}

            {removedTools.length > 0 ? (
              <details className="grant-disclosure grant-disclosure--compact" style={{ marginTop: "1rem" }}>
                <summary className="grant-disclosure-summary grant-disclosure-summary--compact">
                  {removedTools.length} removed tool{removedTools.length !== 1 ? "s" : ""}
                </summary>
                <div style={{ padding: "0.5rem 0" }}>
                  {removedTools.map((tool) => (
                    <div key={tool.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.25rem 0" }}>
                      <StatusBadge tone="warn">Removed</StatusBadge>
                      <span>{tool.tool_name}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
