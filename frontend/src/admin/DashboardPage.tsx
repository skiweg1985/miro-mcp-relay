import { useEffect, useState } from "react";

import { api } from "../api";
import { Card, DataTable, LoadingScreen, Modal, PageIntro } from "../components";
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
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);

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

  const selectedAudit = selectedAuditId ? audit.find((e) => e.id === selectedAuditId) ?? null : null;

  if (loading) return <LoadingScreen label="Loading…" />;

  return (
    <>
      <PageIntro title="Overview" description="Status counts and the latest audit events." />
      <div className="metric-grid">
        <MetricCard label="API" value={health?.ok ? "Online" : "Unavailable"} caption={health?.service ?? "—"} />
        <MetricCard label="Integrations" value={String(providerApps.length)} caption="Registered" />
        <MetricCard label="Connections" value={String(connections.length)} caption="Linked accounts" />
        <MetricCard label="Clients" value={String(serviceClients.length)} caption="Registered callers" />
        <MetricCard label="Access" value={String(grants.length)} caption="Active rules" />
      </div>

      <Card title="Recent events">
        <DataTable
          columns={["Time", "Action", "Actor"]}
          rowKey={(rowIndex) => audit[rowIndex]?.id ?? rowIndex}
          onRowClick={(rowIndex) => {
            const id = audit[rowIndex]?.id;
            if (id) setSelectedAuditId(id);
          }}
          getRowAriaLabel={(rowIndex) => {
            const ev = audit[rowIndex];
            return ev ? `Details: ${ev.action}` : "Details";
          }}
          rows={audit.map((event) => [formatDateTime(event.created_at), event.action, event.actor_type])}
          emptyTitle="No events yet"
          emptyBody="Actions appear here as people use the system."
        />
      </Card>

      {selectedAudit ? (
        <Modal title="Event" wide onClose={() => setSelectedAuditId(null)}>
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
