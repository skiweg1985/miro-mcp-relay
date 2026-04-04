import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { Card, DataTable, Field, LoadingScreen, Modal, PageIntro, StatusBadge } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type { AuditEventOut, ProviderAppOut, ServiceClientOut, TokenIssueEventOut, UserOut } from "../types";
import { formatDateTime, formatJson } from "../utils";

function decisionTone(decision: string): "neutral" | "success" | "warn" | "danger" {
  if (decision === "issued" || decision === "relayed") return "success";
  if (decision === "blocked") return "warn";
  if (decision === "error") return "danger";
  return "neutral";
}

function outcomeLabel(decision: string): string {
  if (decision === "issued") return "Allowed";
  if (decision === "relayed") return "Forwarded";
  if (decision === "blocked") return "Blocked";
  if (decision === "error") return "Error";
  return decision;
}

function scopesShort(scopes: string[]): string {
  if (!scopes.length) return "Default";
  const j = scopes.join(", ");
  return j.length > 40 ? `${j.slice(0, 37)}…` : j;
}

export function LogsPage() {
  const { notify, session } = useAppContext();
  const [section, setSection] = useState<"access" | "audit">("access");
  const [events, setEvents] = useState<AuditEventOut[]>([]);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [serviceClients, setServiceClients] = useState<ServiceClientOut[]>([]);
  const [tokenIssues, setTokenIssues] = useState<TokenIssueEventOut[]>([]);
  const [limit, setLimit] = useState(200);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [tokenIssueUserId, setTokenIssueUserId] = useState("");
  const [tokenIssueServiceClientId, setTokenIssueServiceClientId] = useState("");
  const [tokenIssueProviderAppId, setTokenIssueProviderAppId] = useState("");
  const [tokenIssueDecision, setTokenIssueDecision] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);

  const load = async (requestedLimit: number) => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    try {
      const [auditData, userData, providerAppData, serviceClientData, tokenIssueData] = await Promise.all([
        api.auditEvents(session.csrfToken, requestedLimit),
        api.adminUsers(session.csrfToken),
        api.providerApps(session.csrfToken),
        api.serviceClients(session.csrfToken),
        api.adminTokenIssues(session.csrfToken, {
          userId: tokenIssueUserId || undefined,
          serviceClientId: tokenIssueServiceClientId || undefined,
          providerAppId: tokenIssueProviderAppId || undefined,
          decision: tokenIssueDecision || undefined,
          limit: requestedLimit,
        }),
      ]);
      setEvents(auditData);
      setUsers(userData);
      setProviderApps(providerAppData);
      setServiceClients(serviceClientData);
      setTokenIssues(tokenIssueData);
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not load logs",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(limit);
  }, [limit, notify, session, tokenIssueDecision, tokenIssueProviderAppId, tokenIssueServiceClientId, tokenIssueUserId]);

  const filtered = events.filter((event) => {
    const actionMatches = actionFilter ? event.action.toLowerCase().includes(actionFilter.toLowerCase()) : true;
    const actorMatches = actorFilter ? event.actor_type === actorFilter : true;
    return actionMatches && actorMatches;
  });

  const selectedIssue = useMemo(
    () => (selectedIssueId ? tokenIssues.find((i) => i.id === selectedIssueId) ?? null : null),
    [selectedIssueId, tokenIssues],
  );

  const selectedAudit = useMemo(
    () => (selectedAuditId ? events.find((e) => e.id === selectedAuditId) ?? null : null),
    [selectedAuditId, events],
  );

  return (
    <>
      <PageIntro
        title="Logs"
        description="Access outcomes and audit events."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => void load(limit)}>
              Refresh
            </button>
          </div>
        }
      />
      <div className="tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={section === "access"}
          className={section === "access" ? "tab tab-active" : "tab"}
          onClick={() => setSection("access")}
        >
          Access
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "audit"}
          className={section === "audit" ? "tab tab-active" : "tab"}
          onClick={() => setSection("audit")}
        >
          Audit
        </button>
      </div>

      {section === "access" ? (
        <Card title="Access">
          <div className="filter-row">
            <Field label="Person">
              <select value={tokenIssueUserId} onChange={(event) => setTokenIssueUserId(event.target.value)}>
                <option value="">Anyone</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Service">
              <select value={tokenIssueServiceClientId} onChange={(event) => setTokenIssueServiceClientId(event.target.value)}>
                <option value="">Any</option>
                {serviceClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Integration">
              <select value={tokenIssueProviderAppId} onChange={(event) => setTokenIssueProviderAppId(event.target.value)}>
                <option value="">Any</option>
                {providerApps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Outcome">
              <select value={tokenIssueDecision} onChange={(event) => setTokenIssueDecision(event.target.value)}>
                <option value="">Any</option>
                <option value="issued">Allowed</option>
                <option value="relayed">Forwarded</option>
                <option value="blocked">Blocked</option>
                <option value="error">Error</option>
              </select>
            </Field>
          </div>
          {loading ? (
            <LoadingScreen label="Loading…" />
          ) : (
            <DataTable
              columns={["Time", "Service", "Integration", "Connection", "Outcome", "Scopes"]}
              rowKey={(rowIndex) => tokenIssues[rowIndex]?.id ?? rowIndex}
              onRowClick={(rowIndex) => {
                const id = tokenIssues[rowIndex]?.id;
                if (id) setSelectedIssueId(id);
              }}
              getRowAriaLabel={(rowIndex) => {
                const issue = tokenIssues[rowIndex];
                return issue ? `Details ${formatDateTime(issue.created_at)}` : "Details";
              }}
              rows={tokenIssues.map((issue) => [
                formatDateTime(issue.created_at),
                issue.service_client_display_name ?? issue.service_client_id ?? "—",
                issue.provider_app_display_name ?? issue.provider_app_id ?? "—",
                issue.connected_account_display_name ?? issue.connected_account_id ?? "Auto",
                <StatusBadge key={issue.id} tone={decisionTone(issue.decision)}>
                  {outcomeLabel(issue.decision)}
                </StatusBadge>,
                <span key={`${issue.id}-sc`} className="grants-cell-ellipsis" title={issue.scopes.join(", ")}>
                  {scopesShort(issue.scopes)}
                </span>,
              ])}
              emptyTitle="No rows"
              emptyBody="Adjust filters or refresh."
            />
          )}
        </Card>
      ) : (
        <Card title="Audit">
          <div className="filter-row">
            <Field label="Row limit">
              <input type="number" min={1} max={1000} value={limit} onChange={(event) => setLimit(Number(event.target.value) || 200)} />
            </Field>
            <Field label="Action contains">
              <input value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} />
            </Field>
            <Field label="Actor">
              <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
                <option value="">Any</option>
                <option value="user">Person</option>
                <option value="service_client">Service</option>
              </select>
            </Field>
          </div>
          {loading ? (
            <LoadingScreen label="Loading…" />
          ) : (
            <DataTable
              columns={["Time", "Actor", "Action"]}
              rowKey={(rowIndex) => filtered[rowIndex]?.id ?? rowIndex}
              onRowClick={(rowIndex) => {
                const id = filtered[rowIndex]?.id;
                if (id) setSelectedAuditId(id);
              }}
              getRowAriaLabel={(rowIndex) => {
                const ev = filtered[rowIndex];
                return ev ? `Details: ${ev.action}` : "Details";
              }}
              rows={filtered.map((event) => [
                formatDateTime(event.created_at),
                `${event.actor_type}${event.actor_id ? ` · ${event.actor_id}` : ""}`,
                event.action,
              ])}
              emptyTitle="No events"
              emptyBody="Clear filters or raise the limit."
            />
          )}
        </Card>
      )}

      {selectedIssue ? (
        <Modal title="Access event" wide onClose={() => setSelectedIssueId(null)}>
          <div className="stack-list">
            <div className="stack-cell">
              <strong>Time</strong>
              <span>{formatDateTime(selectedIssue.created_at)}</span>
            </div>
            <div className="stack-cell">
              <strong>Outcome</strong>
              <span>
                <StatusBadge tone={decisionTone(selectedIssue.decision)}>{outcomeLabel(selectedIssue.decision)}</StatusBadge>
              </span>
            </div>
            {selectedIssue.reason ? (
              <div className="stack-cell">
                <strong>Note</strong>
                <span>{selectedIssue.reason}</span>
              </div>
            ) : null}
            <div className="stack-cell">
              <strong>Scopes</strong>
              <span>{selectedIssue.scopes.length ? selectedIssue.scopes.join(", ") : "Default"}</span>
            </div>
            <div className="stack-cell">
              <strong>Details</strong>
              <pre className="audit-metadata">{JSON.stringify(selectedIssue.metadata, null, 2)}</pre>
            </div>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="primary-button" onClick={() => setSelectedIssueId(null)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}

      {selectedAudit ? (
        <Modal title="Audit event" wide onClose={() => setSelectedAuditId(null)}>
          <div className="stack-list">
            <div className="stack-cell">
              <strong>Time</strong>
              <span>{formatDateTime(selectedAudit.created_at)}</span>
            </div>
            <div className="stack-cell">
              <strong>Action</strong>
              <span>{selectedAudit.action}</span>
            </div>
            <div className="stack-cell">
              <strong>Actor</strong>
              <span>{selectedAudit.actor_type}</span>
            </div>
            <div className="stack-cell">
              <strong>Payload</strong>
              <pre className="audit-metadata">{formatJson(selectedAudit.metadata_json)}</pre>
            </div>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="primary-button" onClick={() => setSelectedAuditId(null)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
