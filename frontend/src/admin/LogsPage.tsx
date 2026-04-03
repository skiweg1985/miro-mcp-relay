import { useEffect, useState } from "react";

import { api } from "../api";
import { Card, DataTable, Field, LoadingScreen, PageIntro, StatusBadge } from "../components";
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

export function LogsPage() {
  const { notify, session } = useAppContext();
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

  return (
    <>
      <PageIntro
        eyebrow="Logs"
        title="Diagnostics"
        description="Audit events and access decisions for support and compliance review."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => void load(limit)}>
              Reload
            </button>
          </div>
        }
      />
      <Card title="Filters" description="Narrow the event list.">
        <div className="filter-row">
          <Field label="Limit">
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
      </Card>
      <Card title="Access decisions" description="Issued, relayed, blocked, or failed requests.">
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
              <option value="">Any service</option>
              {serviceClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Integration">
            <select value={tokenIssueProviderAppId} onChange={(event) => setTokenIssueProviderAppId(event.target.value)}>
              <option value="">Any integration</option>
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
              <option value="issued">Issued</option>
              <option value="relayed">Relayed</option>
              <option value="blocked">Blocked</option>
              <option value="error">Error</option>
            </select>
          </Field>
        </div>
        {loading ? (
          <LoadingScreen label="Loading…" />
        ) : (
          <DataTable
            columns={["Time", "Service", "Integration", "Connection", "Outcome", "Scopes", "Details"]}
            rows={tokenIssues.map((issue) => [
              formatDateTime(issue.created_at),
              issue.service_client_display_name ?? issue.service_client_id ?? "—",
              issue.provider_app_display_name ?? issue.provider_app_id ?? "—",
              issue.connected_account_display_name ?? issue.connected_account_id ?? "Automatic",
              <StatusBadge key={issue.id} tone={decisionTone(issue.decision)}>
                {issue.reason ? `${issue.decision}: ${issue.reason}` : issue.decision}
              </StatusBadge>,
              issue.scopes.length ? issue.scopes.join(", ") : "Inherited",
              <pre className="audit-metadata" key={`${issue.id}-metadata`}>
                {JSON.stringify(issue.metadata, null, 2)}
              </pre>,
            ])}
            emptyTitle="No access decisions"
            emptyBody="Nothing matched the filters."
          />
        )}
      </Card>
      <Card title="Audit log" description="Structured backend events.">
        {loading ? (
          <LoadingScreen label="Loading…" />
        ) : (
          <DataTable
            columns={["Time", "Actor", "Action", "Details"]}
            rows={filtered.map((event) => [
              formatDateTime(event.created_at),
              `${event.actor_type}${event.actor_id ? ` · ${event.actor_id}` : ""}`,
              event.action,
              <pre className="audit-metadata" key={event.id}>
                {formatJson(event.metadata_json)}
              </pre>,
            ])}
            emptyTitle="No events"
            emptyBody="Clear filters or raise the limit."
          />
        )}
      </Card>
    </>
  );
}
