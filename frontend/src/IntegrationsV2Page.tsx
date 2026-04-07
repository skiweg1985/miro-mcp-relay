import { useCallback, useEffect, useMemo, useState } from "react";

import { useAppContext } from "./app-context";
import { classNames } from "./utils";
import { api } from "./api";
import { ConnectionCreateModal } from "./ConnectionCreateModal";
import { GraphOAuthSettingsModal } from "./GraphOAuthSettingsModal";
import { IntegrationCreateModal } from "./IntegrationCreateModal";
import { IntegrationInspectModal } from "./IntegrationInspectModal";
import { PageIntro, StatusBadge } from "./components";
import type { IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import {
  integrationCardDescription,
  integrationLifecycleBadge,
  integrationTypeLabel,
  isMicrosoftGraphIntegration,
} from "./integrationLabels";
import { formatOAuthCallbackMessage } from "./utils";

export function IntegrationsV2Page() {
  const { session, notify } = useAppContext();
  const isAdmin = session.status === "authenticated" && session.user.is_admin;
  const [integrations, setIntegrations] = useState<IntegrationV2Out[]>([]);
  const [instances, setInstances] = useState<IntegrationInstanceV2Out[]>([]);
  const [busy, setBusy] = useState(false);

  const [addIntegrationOpen, setAddIntegrationOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [connectionDefaultId, setConnectionDefaultId] = useState<string | undefined>(undefined);
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [detailIntegration, setDetailIntegration] = useState<IntegrationV2Out | null>(null);

  const graphIntegration = useMemo(
    () => integrations.find((i) => isMicrosoftGraphIntegration(i)),
    [integrations],
  );

  const countByIntegration = useMemo(() => {
    const m = new Map<string, number>();
    for (const ins of instances) {
      m.set(ins.integration_id, (m.get(ins.integration_id) ?? 0) + 1);
    }
    return m;
  }, [instances]);

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

  const testIntegration = async (integrationId: string) => {
    const first = instances.find((i) => i.integration_id === integrationId);
    if (!first) {
      notify({
        tone: "info",
        title: "Add a connection first",
        description: "Create a connection for this integration, then run a check from the Connections page.",
      });
      return;
    }
    setBusy(true);
    try {
      const tools = await api.discoverIntegrationToolsV2(first.id);
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
  };

  const openConnectionsFor = (integrationId: string) => {
    window.history.pushState({}, "", `/workspace/connections?for=${encodeURIComponent(integrationId)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const csrf = session.status === "authenticated" ? session.csrfToken : "";

  return (
    <>
      <PageIntro
        title="Integrations"
        description={
          isAdmin
            ? "Definitions describe what you can connect to. Use Connections to put them to work."
            : "Integrations available in your organization."
        }
        actions={
          isAdmin ? (
            <button type="button" className="primary-button" onClick={() => setAddIntegrationOpen(true)}>
              Add integration
            </button>
          ) : null
        }
      />

      {session.status === "authenticated" ? (
        <>
          <IntegrationCreateModal
            open={addIntegrationOpen}
            onClose={() => setAddIntegrationOpen(false)}
            csrfToken={csrf}
            onCreated={(created) => {
              setIntegrations((prev) => [created, ...prev]);
              notify({ tone: "success", title: "Integration created" });
            }}
            onError={(message) => notify({ tone: "error", title: "Could not create integration", description: message })}
          />
          <ConnectionCreateModal
            open={connectionModalOpen}
            onClose={() => {
              setConnectionModalOpen(false);
              setConnectionDefaultId(undefined);
            }}
            integrations={integrations}
            defaultIntegrationId={connectionDefaultId}
            csrfToken={csrf}
            onCreated={(created) => {
              setInstances((prev) => [created, ...prev]);
              notify({ tone: "success", title: "Connection created" });
            }}
            onError={(message) => notify({ tone: "error", title: "Could not create connection", description: message })}
          />
          {graphIntegration && isAdmin ? (
            <GraphOAuthSettingsModal
              open={graphModalOpen}
              onClose={() => setGraphModalOpen(false)}
              graphIntegration={graphIntegration}
              csrfToken={csrf}
              onSaved={load}
              onNotify={(payload) => notify(payload)}
            />
          ) : null}
        </>
      ) : null}

      {detailIntegration ? (
        <IntegrationInspectModal
          integration={detailIntegration}
          relatedInstances={instances.filter((i) => i.integration_id === detailIntegration.id)}
          isAdmin={isAdmin}
          onClose={() => setDetailIntegration(null)}
          onGoToConnections={() => {
            setDetailIntegration(null);
            openConnectionsFor(detailIntegration.id);
          }}
          onAddConnection={
            isAdmin
              ? () => {
                  setDetailIntegration(null);
                  setConnectionDefaultId(detailIntegration.id);
                  setConnectionModalOpen(true);
                }
              : undefined
          }
        />
      ) : null}

      <div className="integration-advanced-cols user-integration-grid">
        {integrations.map((integration) => {
          const n = countByIntegration.get(integration.id) ?? 0;
          const badge = integrationLifecycleBadge(integration, n);
          const isGraph = isMicrosoftGraphIntegration(integration);
          return (
            <article key={integration.id} className={classNames("integration-card", "user-integration-card")}>
              <div className="integration-card-head">
                <h2 className="integration-card-title">{integration.name}</h2>
                <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              </div>
              <div className="integration-card-body">
                <p className="integration-card-desc">{integrationCardDescription(integration)}</p>
                <p className="integration-card-meta">{integrationTypeLabel(integration.type)}</p>
              </div>
              <div className="integration-card-actions">
                <button type="button" className="ghost-button" onClick={() => setDetailIntegration(integration)}>
                  Open
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setConnectionDefaultId(integration.id);
                      setConnectionModalOpen(true);
                    }}
                  >
                    Add connection
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy}
                  onClick={() => void testIntegration(integration.id)}
                >
                  Test
                </button>
                {isGraph && isAdmin ? (
                  <button type="button" className="ghost-button" onClick={() => setGraphModalOpen(true)}>
                    Graph settings
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {!integrations.length ? (
        <p className="muted-copy">
          {isAdmin ? "Add an integration to define your first external system." : "No integrations are available yet."}
        </p>
      ) : null}
    </>
  );
}
