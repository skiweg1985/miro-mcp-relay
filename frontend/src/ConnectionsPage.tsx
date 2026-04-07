import { useEffect, useMemo, useState, useCallback } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { ConnectionCreateModal } from "./ConnectionCreateModal";
import { Card, DataTable, PageIntro, StatusBadge } from "./components";
import type { IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import {
  accessModeLabel,
  authModeLabel,
  connectionRowStatus,
  integrationTypeLabel,
} from "./integrationLabels";
import { formatOAuthCallbackMessage } from "./utils";

export function ConnectionsPage() {
  const { session, notify } = useAppContext();
  const isAdmin = session.status === "authenticated" && session.user.is_admin;
  const [integrations, setIntegrations] = useState<IntegrationV2Out[]>([]);
  const [instances, setInstances] = useState<IntegrationInstanceV2Out[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [defaultIntegrationId, setDefaultIntegrationId] = useState<string | undefined>(undefined);

  const integrationNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of integrations) {
      m.set(i.id, i.name);
    }
    return m;
  }, [integrations]);

  const load = useCallback(async () => {
    const [i, ins] = await Promise.all([api.integrationsV2(), api.integrationInstancesV2()]);
    setIntegrations(i);
    setInstances(ins);
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      notify({
        tone: "error",
        title: "Could not load data",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    });
  }, [session.status, load, notify]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const params = new URLSearchParams(window.location.search);
    const forId = params.get("for");
    if (forId && integrations.some((x) => x.id === forId)) {
      setDefaultIntegrationId(forId);
      setCreateOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [session.status, integrations]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const params = new URLSearchParams(window.location.search);
    const connectionStatus = params.get("connection_status");
    if (connectionStatus === "connected") {
      notify({ tone: "success", title: "Connection saved" });
      window.history.replaceState({}, "", window.location.pathname);
      void load().catch(() => {});
    } else if (connectionStatus === "error") {
      notify({
        tone: "error",
        title: "Connection failed",
        description: formatOAuthCallbackMessage(params.get("message")),
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [session.status, notify, load]);

  const connectOAuth = useCallback(async (instanceId: string) => {
    if (session.status !== "authenticated") return;
    setBusy(true);
    try {
      const out = await api.startIntegrationOAuth(instanceId);
      window.location.assign(out.auth_url);
    } catch (error) {
      setBusy(false);
      notify({
        tone: "error",
        title: "Could not start sign-in",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    }
  }, [session, notify]);

  const disconnectOAuth = useCallback(
    async (instanceId: string) => {
    if (session.status !== "authenticated") return;
    setBusy(true);
    try {
      await api.disconnectIntegrationOAuth(session.csrfToken, instanceId);
      await load();
      notify({ tone: "success", title: "Disconnected" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not disconnect",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
    },
    [session, notify, load],
  );

  const testConnection = useCallback(async (instanceId: string) => {
    setBusy(true);
    try {
      const tools = await api.discoverIntegrationToolsV2(instanceId);
      notify({
        tone: "success",
        title: "Connection check succeeded",
        description: tools.length ? `${tools.length} tools available.` : "No tools reported.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Connection check failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const rows = instances.map((instance) => {
    const intName = integrationNameById.get(instance.integration_id) ?? "—";
    const intType = integrations.find((i) => i.id === instance.integration_id);
    const status = connectionRowStatus(instance);
    const actions = (
      <div className="inline-actions">
        <button type="button" className="ghost-button" disabled={busy} onClick={() => void testConnection(instance.id)}>
          Test
        </button>
        {instance.auth_mode === "oauth" ? (
          instance.oauth_connected ? (
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => void disconnectOAuth(instance.id)}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void connectOAuth(instance.id)}
            >
              Connect
            </button>
          )
        ) : null}
      </div>
    );
    return [
      <span key="n">{instance.name}</span>,
      <span key="i">
        {intName}
        {intType ? <span className="muted-copy"> · {integrationTypeLabel(intType.type)}</span> : null}
      </span>,
      <span key="a">{authModeLabel(instance.auth_mode)}</span>,
      <span key="t">{accessModeLabel(instance.access_mode)}</span>,
      <StatusBadge key="s" tone={status.tone}>
        {status.label}
      </StatusBadge>,
      actions,
    ];
  });

  const csrf = session.status === "authenticated" ? session.csrfToken : "";

  return (
    <>
      <PageIntro
        title="Connections"
        description="Connections are how this workspace uses an integration: authentication, routing, and runtime checks."
        actions={
          isAdmin ? (
            <button type="button" className="primary-button" onClick={() => setCreateOpen(true)}>
              Add connection
            </button>
          ) : null
        }
      />

      {session.status === "authenticated" ? (
        <ConnectionCreateModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setDefaultIntegrationId(undefined);
          }}
          integrations={integrations}
          defaultIntegrationId={defaultIntegrationId}
          csrfToken={csrf}
          onCreated={(created) => {
            setInstances((prev) => [created, ...prev]);
            notify({ tone: "success", title: "Connection created" });
          }}
          onError={(message) => notify({ tone: "error", title: "Could not create connection", description: message })}
        />
      ) : null}

      <Card title="All connections">
        <DataTable
          columns={["Name", "Integration", "Authentication", "Traffic", "Status", "Actions"]}
          rows={rows}
          emptyTitle="No connections yet"
          emptyBody="Create a connection to route traffic through the broker."
        />
      </Card>
    </>
  );
}
