import { useEffect, useMemo, useState, useCallback } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { ConnectionCreateModal } from "./ConnectionCreateModal";
import { ConnectionDetailModal } from "./ConnectionDetailModal";
import { ConnectionEditModal } from "./ConnectionEditModal";
import { Card, ConfirmModal, DataTable, PageIntro, StatusBadge } from "./components";
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
  const [detailInstanceId, setDetailInstanceId] = useState<string | null>(null);
  const [editInstanceId, setEditInstanceId] = useState<string | null>(null);
  const [disconnectConfirmId, setDisconnectConfirmId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  const runDisconnect = useCallback(
    async (instanceId: string) => {
      if (session.status !== "authenticated") return;
      setBusy(true);
      try {
        await api.disconnectIntegrationOAuth(session.csrfToken, instanceId);
        await load();
        notify({ tone: "success", title: "Disconnected" });
        setDetailInstanceId((cur) => (cur === instanceId ? null : cur));
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

  const runDeleteConnection = useCallback(
    async (instanceId: string) => {
      if (session.status !== "authenticated") return;
      setBusy(true);
      try {
        const r = await api.deleteIntegrationInstanceV2(session.csrfToken, instanceId);
        await load();
        notify({
          tone: "success",
          title: "Connection deleted",
          description:
            r.grants_invalidated > 0
              ? `${r.grants_invalidated} dependent access keys were marked invalid and can no longer authenticate.`
              : undefined,
        });
        setDetailInstanceId((cur) => (cur === instanceId ? null : cur));
        setDeleteConfirmId(null);
      } catch (error) {
        notify({
          tone: "error",
          title: "Could not delete connection",
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
    const integrationLine = intType
      ? `${intName} · ${integrationTypeLabel(intType.type)}`
      : intName;
    const status = connectionRowStatus(instance);
    const actions = (
      <div className="inline-actions inline-actions--table" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="ghost-button" onClick={() => setDetailInstanceId(instance.id)}>
          Open
        </button>
        <button type="button" className="ghost-button" disabled={busy} onClick={() => void testConnection(instance.id)}>
          Test
        </button>
        {instance.auth_mode === "oauth" ? (
          instance.oauth_connected ? (
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => setDisconnectConfirmId(instance.id)}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
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
      <span key="n" className="table-cell-ellipsis" title={instance.name}>
        {instance.name}
      </span>,
      <span key="i" className="table-cell-ellipsis" title={integrationLine}>
        {intName}
        {intType ? <span className="muted-copy"> · {integrationTypeLabel(intType.type)}</span> : null}
      </span>,
      <span key="a" className="table-cell-ellipsis" title={authModeLabel(instance.auth_mode)}>
        {authModeLabel(instance.auth_mode)}
      </span>,
      <span key="t" title={accessModeLabel(instance.access_mode)}>
        {accessModeLabel(instance.access_mode)}
      </span>,
      <StatusBadge key="s" tone={status.tone}>
        {status.label}
      </StatusBadge>,
      actions,
    ];
  });

  const csrf = session.status === "authenticated" ? session.csrfToken : "";
  const deleteName = deleteConfirmId ? instances.find((i) => i.id === deleteConfirmId)?.name ?? "" : "";

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

      {disconnectConfirmId ? (
        <ConfirmModal
          title="Disconnect linked account?"
          confirmLabel="Disconnect"
          confirmBusy={busy}
          onCancel={() => setDisconnectConfirmId(null)}
          onConfirm={() => {
            const id = disconnectConfirmId;
            setDisconnectConfirmId(null);
            void runDisconnect(id);
          }}
        >
          <p>
            The broker will clear stored tokens for this connection. API clients that rely on a linked account may fail until
            someone signs in again.
          </p>
        </ConfirmModal>
      ) : null}

      {deleteConfirmId ? (
        <ConfirmModal
          title="Delete connection?"
          confirmLabel="Delete connection"
          confirmBusy={busy}
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => {
            if (deleteConfirmId) void runDeleteConnection(deleteConfirmId);
          }}
        >
          <p>
            You are about to delete <strong>{deleteName}</strong>. This removes the connection from the workspace. Access keys
            that target it will be marked invalid and clients can no longer authenticate with them.
          </p>
        </ConfirmModal>
      ) : null}

      {session.status === "authenticated" ? (
        <ConnectionDetailModal
          open={detailInstanceId !== null}
          instanceId={detailInstanceId}
          instanceVersion={instances.find((i) => i.id === detailInstanceId)?.updated_at ?? null}
          onClose={() => setDetailInstanceId(null)}
          busy={busy}
          isAdmin={isAdmin}
          onConnect={(id) => void connectOAuth(id)}
          onDisconnect={(id) => setDisconnectConfirmId(id)}
          onTest={(id) => void testConnection(id)}
          onEdit={
            isAdmin && detailInstanceId
              ? () => {
                  setEditInstanceId(detailInstanceId);
                  setDetailInstanceId(null);
                }
              : undefined
          }
          onDelete={isAdmin && detailInstanceId ? () => setDeleteConfirmId(detailInstanceId) : undefined}
        />
      ) : null}

      {session.status === "authenticated" ? (
        <ConnectionEditModal
          open={editInstanceId !== null}
          instanceId={editInstanceId}
          reloadVersion={instances.find((i) => i.id === editInstanceId)?.updated_at ?? null}
          integrations={integrations}
          csrfToken={csrf}
          onClose={() => setEditInstanceId(null)}
          onSaved={(row) => {
            setInstances((prev) => prev.map((x) => (x.id === row.id ? row : x)));
            notify({
              tone: "success",
              title: "Connection updated",
              description: "If security or routing changed, dependent access keys may have been marked invalid.",
            });
          }}
          onError={(message) => {
            if (message) notify({ tone: "error", title: "Could not update connection", description: message });
          }}
        />
      ) : null}

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
          wrapClassName="connections-table-wrap"
          tableClassName="data-table--connections"
          columnClasses={[
            "data-table-col--name",
            "data-table-col--integration",
            "data-table-col--auth",
            "data-table-col--traffic",
            "data-table-col--status",
            "data-table-col--actions",
          ]}
          emptyTitle="No connections yet"
          emptyBody="Create a connection to route traffic through the broker."
          onRowClick={(rowIndex) => {
            const id = instances[rowIndex]?.id;
            if (id) setDetailInstanceId(id);
          }}
          getRowAriaLabel={(rowIndex) => `Connection ${instances[rowIndex]?.name ?? ""}`}
        />
      </Card>
    </>
  );
}
