import { useEffect, useMemo, useState } from "react";

import { SetupDrawer, SummaryRow, type WizardStep } from "./admin/SetupDrawer";
import { useAppContext } from "./app-context";
import { api } from "./api";
import { connectionAccessDetailsFromMiroLegacy } from "./accessCredentialMappers";
import { TEMPLATE_MIRO, TEMPLATE_MS_LOGIN } from "./admin/constants";
import { AccessCredentialSummary } from "./AccessCredentialSummary";
import {
  Card,
  ConfirmModal,
  EmptyState,
  LoadingScreen,
  PageIntro,
  StatusBadge,
} from "./components";
import { isApiError } from "./errors";
import type {
  ConnectedAccountOut,
  ConnectionAccessDetails,
  ConnectionProbeResult,
  ProviderAppOut,
  ProviderDefinitionOut,
} from "./types";
import { formatDateTime, relativeTime } from "./utils";

const CONNECT_WIZARD_STEPS: WizardStep[] = [
  { id: "intro", label: "Overview" },
  { id: "provider", label: "App" },
];

const DETAILS_WIZARD_STEPS: WizardStep[] = [
  { id: "identity", label: "Account" },
  { id: "session", label: "Connection" },
];

function connectionTone(connection: ConnectedAccountOut): "neutral" | "success" | "warn" | "danger" {
  if (connection.status === "revoked") return "warn";
  if (connection.last_error) return "danger";
  if (connection.status === "connected") return "success";
  return "neutral";
}

function connectionStatusLabel(connection: ConnectedAccountOut): string {
  if (connection.status === "revoked") return "Disconnected";
  if (connection.status === "connected" && connection.last_error) return "Needs review";
  if (connection.status === "connected") return "Connected";
  return connection.status;
}

function friendlyBrokerMessage(raw: string | null | undefined): string {
  const message = (raw ?? "").trim();
  if (!message) return "Something went wrong. Please try again.";
  if (message === "Invalid or expired OAuth state") return "Your Miro sign-in timed out. Start the connection again.";
  if (message === "Missing or expired Miro callback parameters") return "Miro did not return a usable sign-in result. Please try again.";
  if (message === "Miro authorization was denied.") return "Miro sign-in was cancelled before your account could be connected.";
  if (message.includes("did not match expected email")) return "The Miro account did not match the expected user. Sign in with the correct Miro account.";
  if (message.startsWith("miro_token_exchange_failed")) return "Miro accepted the login but we could not finish connecting. Please try again.";
  if (message.startsWith("miro_refresh_failed") || message.startsWith("oauth_refresh_failed"))
    return "We could not refresh your Miro connection. Reconnect the account.";
  if (message.startsWith("token_context_")) return "We reached Miro but could not verify the connection. Try again, or reconnect if it keeps happening.";
  if (message.startsWith("microsoft_graph_refresh_failed")) return "We could not refresh your Microsoft connection. Reconnect the account.";
  if (message.startsWith("graph_me_")) return "We reached Microsoft but could not verify the signed-in account.";
  return message;
}

/** Active Miro OAuth link only — revoked rows are ignored so the workspace looks unset after disconnect. */
function findConnectedMiroConnection(
  connections: ConnectedAccountOut[],
  providerAppById: Record<string, ProviderAppOut>,
): ConnectedAccountOut | undefined {
  return connections.find(
    (connection) =>
      providerAppById[connection.provider_app_id]?.template_key === TEMPLATE_MIRO && connection.status === "connected",
  );
}

function templateDescription(definitions: ProviderDefinitionOut[], templateKey: string | null): string {
  if (!templateKey) return "";
  for (const def of definitions) {
    const templates = def.metadata?.templates as Array<{ template_key: string; description?: string }> | undefined;
    if (!templates) continue;
    const match = templates.find((t) => t.template_key === templateKey);
    if (match?.description) return match.description;
  }
  return "";
}

function replaceCurrentSearchParams(removals: string[]) {
  const url = new URL(window.location.href);
  let changed = false;
  removals.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (!changed) return;
  const search = url.searchParams.toString();
  window.history.replaceState({}, "", `${url.pathname}${search ? `?${search}` : ""}`);
}

export function UserIntegrationsPage() {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [definitions, setDefinitions] = useState<ProviderDefinitionOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [accessDetails, setAccessDetails] = useState<ConnectionAccessDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [tokenPending, setTokenPending] = useState(false);
  const [setupPending, setSetupPending] = useState(false);
  const [probeById, setProbeById] = useState<Record<string, ConnectionProbeResult>>({});

  const [connectWizardAppId, setConnectWizardAppId] = useState<string | null>(null);
  const [connectWizardStep, setConnectWizardStep] = useState(0);
  const [detailsConnectionId, setDetailsConnectionId] = useState<string | null>(null);
  const [detailsWizardStep, setDetailsWizardStep] = useState(0);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [appData, defData, connectionData] = await Promise.all([
        api.providerAppsForUser(),
        api.providerDefinitions(),
        api.myConnections(),
      ]);
      setProviderApps(appData);
      setDefinitions(defData);
      setConnections(connectionData);
      const providerMap = Object.fromEntries(appData.map((app) => [app.id, app]));
      const miroConn = findConnectedMiroConnection(connectionData, providerMap);
      if (miroConn) {
        try {
          setAccessDetails(await api.connectionAccessDetails(miroConn.id));
        } catch {
          setAccessDetails(null);
        }
      } else {
        setAccessDetails(null);
      }
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not load integrations",
        description: isApiError(error) ? error.message : "Unexpected loading error.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load();
  }, [notify, session.status]);

  const providerAppById = useMemo(
    () => Object.fromEntries(providerApps.map((app) => [app.id, app])),
    [providerApps],
  );

  const connectableApps = useMemo(
    () => providerApps.filter((app) => app.template_key && app.template_key !== TEMPLATE_MS_LOGIN),
    [providerApps],
  );

  const connectWizardApp = connectWizardAppId ? providerAppById[connectWizardAppId] : undefined;
  const connectWizardConnection = connectWizardApp
    ? connections.find((c) => c.provider_app_id === connectWizardApp.id && c.status !== "revoked")
    : undefined;
  const connectWizardIsActive = Boolean(
    connectWizardConnection && connectWizardConnection.status === "connected",
  );

  const detailsConnection = detailsConnectionId
    ? connections.find((c) => c.id === detailsConnectionId)
    : undefined;
  const detailsApp = detailsConnection ? providerAppById[detailsConnection.provider_app_id] : undefined;

  const revokeConfirmAppName = useMemo(() => {
    if (!revokeConfirmId) return "";
    const row = connections.find((c) => c.id === revokeConfirmId);
    const app = row ? providerAppById[row.provider_app_id] : undefined;
    return app?.display_name ?? "";
  }, [revokeConfirmId, connections, providerAppById]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const setupToken = new URLSearchParams(window.location.search).get("miro_setup");
    if (!setupToken) return;

    setSetupPending(true);
    void api
      .exchangeMiroSetup(session.csrfToken, setupToken)
      .then((result) => {
        setAccessDetails(connectionAccessDetailsFromMiroLegacy(result));
        notify({
          tone: "success",
          title: "Connection details ready",
          description: "Copy the details before you leave this page.",
        });
      })
      .catch((error) => {
        notify({
          tone: "error",
          title: "Could not load the one-time Miro setup",
          description: isApiError(error) ? friendlyBrokerMessage(error.message) : "Unexpected setup exchange error.",
        });
      })
      .finally(() => {
        setSetupPending(false);
        replaceCurrentSearchParams(["miro_setup", "miro_status", "connected_account_id", "message"]);
        void load();
      });
  }, [notify, session]);

  const runBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(key));
    try {
      await fn();
    } catch (error) {
      notify({
        tone: "error",
        title: "Action failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const closeConnectWizard = () => {
    setConnectWizardAppId(null);
    setConnectWizardStep(0);
  };

  const openConnectWizard = (appId: string) => {
    setConnectWizardAppId(appId);
    setConnectWizardStep(0);
  };

  const closeDetailsWizard = () => {
    setDetailsConnectionId(null);
    setDetailsWizardStep(0);
  };

  const openDetailsWizard = (connectionId: string) => {
    setDetailsConnectionId(connectionId);
    setDetailsWizardStep(0);
  };

  const startConnect = async (app: ProviderAppOut, existing: ConnectedAccountOut | undefined) => {
    if (session.status !== "authenticated") return;
    const key = `oauth:${app.id}`;
    await runBusy(key, async () => {
      const result = await api.startProviderConnection(session.csrfToken, app.key, existing?.id);
      window.location.assign(result.auth_url);
    });
  };

  const handleRevoke = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    try {
      await runBusy(`revoke:${connectionId}`, async () => {
        await api.revokeConnection(session.csrfToken, connectionId);
        notify({ tone: "info", title: "Disconnected" });
        if (detailsConnectionId === connectionId) closeDetailsWizard();
        await load();
      });
    } finally {
      setRevokeConfirmId(null);
    }
  };

  const handleRefresh = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runBusy(`refresh:${connectionId}`, async () => {
      await api.refreshConnection(session.csrfToken, connectionId);
      notify({ tone: "success", title: "Connection refreshed" });
      await load();
    });
  };

  const handleProbe = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runBusy(`probe:${connectionId}`, async () => {
      const result = await api.probeConnection(session.csrfToken, connectionId);
      setProbeById((prev) => ({ ...prev, [connectionId]: result }));
      notify({
        tone: result.ok ? "success" : "error",
        title: result.ok ? "Connection test succeeded" : "Connection test failed",
        description: result.ok ? "We could reach the service with your saved connection." : friendlyBrokerMessage(result.message),
      });
      await load();
    });
  };

  const handleRotateAccessKey = async (miroConnectionId: string) => {
    if (session.status !== "authenticated") return;
    setTokenPending(true);
    try {
      const result = await api.rotateConnectionAccess(session.csrfToken, miroConnectionId);
      setAccessDetails(result);
      notify({
        tone: "success",
        title: "New access key ready",
        description: "Copy the details now. The previous key no longer works.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create a new access key",
        description: isApiError(error) ? friendlyBrokerMessage(error.message) : "Unexpected error.",
      });
    } finally {
      setTokenPending(false);
    }
  };

  if (loading) return <LoadingScreen label="Loading integrations…" />;

  const existingMiro = findConnectedMiroConnection(connections, providerAppById);

  const lastConnectStep = connectWizardStep >= CONNECT_WIZARD_STEPS.length - 1;
  const lastDetailsStep = detailsWizardStep >= DETAILS_WIZARD_STEPS.length - 1;

  return (
    <>
      <PageIntro
        title="Integrations"
        description="Connect the apps you use. We only act on your behalf after you sign in."
      />

      {setupPending ? <LoadingScreen label="Preparing your one-time Miro setup…" /> : null}

      {connectableApps.length === 0 ? (
        <Card title="Nothing to connect" description="Your organization has not added any apps yet.">
          <EmptyState title="Empty" body="Ask an admin to add integrations." />
        </Card>
      ) : (
        <div className="integration-grid user-integration-grid">
          {connectableApps.map((app) => {
            const connection = connections.find(
              (c) => c.provider_app_id === app.id && c.status !== "revoked",
            );
            const desc = templateDescription(definitions, app.template_key) || "Sign in to connect your account.";
            const primaryDisabled = busy.has(`oauth:${app.id}`);
            const isConnected = Boolean(connection && connection.status === "connected");
            const canDisconnect = Boolean(isConnected && connection);
            const showReconnect = Boolean(connection && connection.status !== "revoked");

            return (
              <article key={app.id} className="integration-card user-integration-card">
                <div className="integration-card-head">
                  <span className="integration-card-title">{app.display_name}</span>
                  {connection ? (
                    <StatusBadge tone={connectionTone(connection)}>{connectionStatusLabel(connection)}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not connected</StatusBadge>
                  )}
                </div>
                <div className="integration-card-body">
                  <p className="integration-card-desc">{desc}</p>
                </div>

                <div className="integration-card-actions user-integration-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={primaryDisabled || !app.is_enabled}
                    onClick={() => openConnectWizard(app.id)}
                  >
                    {primaryDisabled ? "Redirecting…" : showReconnect ? "Reconnect" : "Connect"}
                  </button>
                  {isConnected && connection ? (
                    <button type="button" className="secondary-button" onClick={() => openDetailsWizard(connection.id)}>
                      Details
                    </button>
                  ) : null}
                  {canDisconnect && connection ? (
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={busy.has(`revoke:${connection.id}`)}
                      onClick={() => setRevokeConfirmId(connection.id)}
                    >
                      {busy.has(`revoke:${connection.id}`) ? "Disconnecting…" : "Disconnect"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {existingMiro ? (
        <AccessCredentialSummary
          details={accessDetails}
          rotatePending={tokenPending}
          onRotate={() => void handleRotateAccessKey(existingMiro.id)}
          cardTitle="Connection details"
          cardDescription="Endpoint and key for tools that use this connection."
        />
      ) : null}

      {connectWizardApp ? (
        <SetupDrawer
          title={connectWizardApp.display_name}
          subtitle="Sign in"
          steps={CONNECT_WIZARD_STEPS}
          activeStepIndex={connectWizardStep}
          onClose={closeConnectWizard}
          wide
          footer={
            <div className="drawer-footer-inner">
              <div>
                {connectWizardStep > 0 ? (
                  <button type="button" className="secondary-button" onClick={() => setConnectWizardStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
              </div>
              <div className="drawer-footer-actions">
                {!lastConnectStep ? (
                  <button type="button" className="primary-button" onClick={() => setConnectWizardStep((s) => s + 1)}>
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy.has(`oauth:${connectWizardApp.id}`) || !connectWizardApp.is_enabled}
                    onClick={() => void startConnect(connectWizardApp, connectWizardConnection)}
                  >
                    {busy.has(`oauth:${connectWizardApp.id}`) ? "Redirecting…" : "Continue to sign in"}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="wizard-step-body">
            {connectWizardStep === 0 ? (
              <>
                <p className="lede">
                  {connectWizardIsActive
                    ? "You will sign in again at the app. Your saved connection is updated when you finish."
                    : "We open the app’s sign-in so you can approve access. When sign-in finishes, you return here."}
                </p>
                <p className="field-hint field-hint--flush">
                  No extra fields are required — continue when you are ready to sign in.
                </p>
              </>
            ) : null}
            {connectWizardStep === 1 ? (
              <div className="summary-panel">
                <SummaryRow label="Integration" value={connectWizardApp.display_name} />
                <SummaryRow
                  label="Connection"
                  value={connectWizardIsActive ? "Existing link" : "New connection"}
                />
              </div>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}

      {detailsConnection && detailsApp ? (
        <SetupDrawer
          title={detailsApp.display_name}
          subtitle="Connection details"
          steps={DETAILS_WIZARD_STEPS}
          activeStepIndex={detailsWizardStep}
          onClose={closeDetailsWizard}
          wide
          footer={
            <div className="drawer-footer-inner">
              <div>
                {detailsWizardStep > 0 ? (
                  <button type="button" className="secondary-button" onClick={() => setDetailsWizardStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
              </div>
              <div className="drawer-footer-actions">
                {!lastDetailsStep ? (
                  <button type="button" className="primary-button" onClick={() => setDetailsWizardStep((s) => s + 1)}>
                    Next
                  </button>
                ) : (
                  <>
                    {detailsConnection.status === "connected" ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy.has(`refresh:${detailsConnection.id}`)}
                          onClick={() => void handleRefresh(detailsConnection.id)}
                        >
                          {busy.has(`refresh:${detailsConnection.id}`) ? "Refreshing…" : "Refresh connection"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy.has(`probe:${detailsConnection.id}`)}
                          onClick={() => void handleProbe(detailsConnection.id)}
                        >
                          {busy.has(`probe:${detailsConnection.id}`) ? "Testing…" : "Test connection"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={busy.has(`revoke:${detailsConnection.id}`)}
                          onClick={() => setRevokeConfirmId(detailsConnection.id)}
                        >
                          {busy.has(`revoke:${detailsConnection.id}`) ? "Disconnecting…" : "Disconnect"}
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="primary-button" onClick={closeDetailsWizard}>
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          }
        >
          <div className="wizard-step-body">
            {detailsWizardStep === 0 ? (
              <div className="stack-list">
                <div className="stack-cell">
                  <strong>Account</strong>
                  <span>
                    {detailsConnection.display_name ||
                      detailsConnection.external_email ||
                      detailsConnection.external_account_ref ||
                      detailsConnection.id}
                  </span>
                </div>
                <div className="stack-cell">
                  <strong>Connected</strong>
                  <span>{formatDateTime(detailsConnection.connected_at)}</span>
                </div>
              </div>
            ) : null}
            {detailsWizardStep === 1 ? (
              <div className="stack-list">
                {detailsConnection.access_token_expires_at ? (
                  <div className="stack-cell">
                    <strong>Connection valid until</strong>
                    <span>
                      {formatDateTime(detailsConnection.access_token_expires_at)} (
                      {relativeTime(detailsConnection.access_token_expires_at)})
                    </span>
                  </div>
                ) : null}
                {detailsConnection.refresh_token_expires_at ? (
                  <div className="stack-cell">
                    <strong>Renewal valid until</strong>
                    <span>{formatDateTime(detailsConnection.refresh_token_expires_at)}</span>
                  </div>
                ) : null}
                <div className="stack-cell">
                  <strong>Last sign-in refresh</strong>
                  <span>
                    {detailsConnection.token_material_updated_at
                      ? formatDateTime(detailsConnection.token_material_updated_at)
                      : "Not recorded"}
                  </span>
                </div>
                <div className="stack-cell">
                  <strong>Can renew automatically</strong>
                  <span>{detailsConnection.refresh_token_available === true ? "Yes" : "No"}</span>
                </div>
                {detailsConnection.last_error ? (
                  <div className="stack-cell user-integration-error">
                    <strong>Note</strong>
                    <span>{friendlyBrokerMessage(detailsConnection.last_error)}</span>
                  </div>
                ) : null}
                {probeById[detailsConnection.id] ? (
                  <div className="stack-cell">
                    <strong>Last connection test</strong>
                    <span>
                      {probeById[detailsConnection.id].ok ? "OK" : friendlyBrokerMessage(probeById[detailsConnection.id].message)}{" "}
                      — {formatDateTime(probeById[detailsConnection.id].checked_at)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}

      {revokeConfirmId ? (
        <ConfirmModal
          title="Disconnect"
          confirmLabel="Disconnect"
          confirmBusy={busy.has(`revoke:${revokeConfirmId}`)}
          onCancel={() => setRevokeConfirmId(null)}
          onConfirm={() => void handleRevoke(revokeConfirmId)}
        >
          <p className="lede">
            We remove saved access for <strong>{revokeConfirmAppName || "this integration"}</strong>. You can connect again later.
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
