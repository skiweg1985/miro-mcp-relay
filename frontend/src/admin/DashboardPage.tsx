import { useEffect, useState } from "react";

import { api } from "../api";
import { Card, DataTable, LoadingScreen, PageIntro } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type { AuditEventOut, ConnectedAccountOut, DelegationGrantOut, Health, ProviderAppOut, ServiceClientOut } from "../types";
import { formatDateTime, formatJson } from "../utils";

function MetricCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

export function DashboardPage() {
  const { notify, session } = useAppContext();
  const [health, setHealth] = useState<Health | null>(null);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [serviceClients, setServiceClients] = useState<ServiceClientOut[]>([]);
  const [grants, setGrants] = useState<DelegationGrantOut[]>([]);
  const [audit, setAudit] = useState<AuditEventOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    Promise.all([
      api.health(),
      api.providerApps(session.csrfToken),
      api.connectedAccounts(session.csrfToken),
      api.serviceClients(session.csrfToken),
      api.delegationGrants(session.csrfToken),
      api.auditEvents(session.csrfToken, 8),
    ])
      .then(([healthData, providerAppData, connectionData, clientData, grantData, auditData]) => {
        setHealth(healthData);
        setProviderApps(providerAppData);
        setConnections(connectionData);
        setServiceClients(clientData);
        setGrants(grantData);
        setAudit(auditData);
      })
      .catch((error) => {
        notify({
          tone: "error",
          title: "Could not load dashboard",
          description: isApiError(error) ? error.message : "Unexpected error.",
        });
      })
      .finally(() => setLoading(false));
  }, [notify, session]);

  if (loading) return <LoadingScreen label="Loading…" />;

  return (
    <>
      <PageIntro
        eyebrow="Dashboard"
        title="Overview"
        description="Service health, integrations, and recent activity at a glance."
      />
      <div className="metric-grid">
        <MetricCard label="API status" value={health?.ok ? "Online" : "Unavailable"} caption={health?.service ?? "Unknown"} />
        <MetricCard label="Integrations" value={String(providerApps.length)} caption="Registered apps" />
        <MetricCard label="Connected accounts" value={String(connections.length)} caption="User-linked connections" />
        <MetricCard label="Services" value={String(serviceClients.length)} caption="Internal clients" />
        <MetricCard label="Access grants" value={String(grants.length)} caption="Active permissions" />
      </div>

      <Card title="Recent activity" description="Latest events from the audit log.">
        <DataTable
          columns={["Time", "Action", "Actor", "Details"]}
          rows={audit.map((event) => [
            formatDateTime(event.created_at),
            event.action,
            event.actor_type,
            <code className="inline-code" key={event.id}>
              {formatJson(event.metadata_json)}
            </code>,
          ])}
          emptyTitle="No events yet"
          emptyBody="Actions will appear here as people use the system."
        />
      </Card>
    </>
  );
}
