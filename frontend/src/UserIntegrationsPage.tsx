import { useEffect, useMemo, useState } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { TEMPLATE_MIRO, TEMPLATE_MS_LOGIN } from "./admin/constants";
import {
  Card,
  EmptyState,
  LoadingScreen,
  MiroAccessCard,
  PageIntro,
  StatusBadge,
} from "./components";
import { isApiError } from "./errors";
import type {
  ConnectedAccountOut,
  ConnectionProbeResult,
  MiroRelayAccess,
  ProviderAppOut,
  ProviderDefinitionOut,
} from "./types";
import { formatDateTime, relativeTime } from "./utils";

function connectionTone(connection: ConnectedAccountOut): "neutral" | "success" | "warn" | "danger" {
  if (connection.status === "revoked") return "warn";
  if (connection.last_error) return "danger";
  if (connection.status === "connected") return "success";
  return "neutral";
}

function friendlyBrokerMessage(raw: string | null | undefined): string {
  const message = (raw ?? "").trim();
  if (!message) return "The broker could not complete the request.";
  if (message === "Invalid or expired OAuth state") return "The Miro session expired before the callback returned. Start the connection again.";
  if (message === "Missing or expired Miro callback parameters") return "The Miro callback did not include a usable authorization result. Please try again.";
  if (message === "Miro authorization was denied.") return "Miro authorization was cancelled before the broker could connect your account.";
  if (message.includes("did not match expected email")) return "The signed-in Miro identity did not match the expected account. Retry with the correct Miro user.";
  if (message.startsWith("miro_token_exchange_failed")) return "Miro accepted the login but the broker could not finish token exchange. Please retry.";
  if (message.startsWith("miro_refresh_failed")) return "The broker could not refresh the stored Miro credentials. Reconnect the account.";
  if (message.startsWith("token_context_")) return "The broker reached Miro but could not verify the token context. Retry once, then reconnect if needed.";
  if (message.startsWith("microsoft_graph_refresh_failed")) return "The broker could not refresh the stored Microsoft Graph credentials. Reconnect the account.";
  if (message.startsWith("graph_me_")) return "The broker reached Microsoft Graph but could not verify the current account identity.";
  return message;
}

function findMiroConnection(
  connections: ConnectedAccountOut[],
  providerAppById: Record<string, ProviderAppOut>,
): ConnectedAccountOut | undefined {
  return connections.find((connection) => providerAppById[connection.provider_app_id]?.template_key === TEMPLATE_MIRO);
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
  const [miroAccess, setMiroAccess] = useState<MiroRelayAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [tokenPending, setTokenPending] = useState(false);
  const [setupPending, setSetupPending] = useState(false);
  const [probeById, setProbeById] = useState<Record<string, ConnectionProbeResult>>({});

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
      const miroConn = findMiroConnection(connectionData, providerMap);
      if (miroConn) {
        setMiroAccess(await api.miroAccess(miroConn.id));
      } else {
        setMiroAccess(null);
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

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const setupToken = new URLSearchParams(window.location.search).get("miro_setup");
    if (!setupToken) return;

    setSetupPending(true);
    void api
      .exchangeMiroSetup(session.csrfToken, setupToken)
      .then((result) => {
        setMiroAccess(result);
        notify({
          tone: "success",
          title: "Miro MCP config ready",
          description: "Copy the relay token or the full MCP config before leaving this page.",
        });
      })
      .catch((error) => {
        notify({
          tone: "error",
          title: "Could not load the one-time Miro setup bundle",
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
    await runBusy(`revoke:${connectionId}`, async () => {
      await api.revokeConnection(session.csrfToken, connectionId);
      notify({ tone: "info", title: "Disconnected" });
      await load();
    });
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
        title: result.ok ? "Probe succeeded" : "Probe failed",
        description: result.ok ? "The broker could reach the provider with the stored credentials." : friendlyBrokerMessage(result.message),
      });
      await load();
    });
  };

  const handleRotateMiroToken = async (miroConnectionId: string) => {
    if (session.status !== "authenticated") return;
    setTokenPending(true);
    try {
      const result = await api.resetMiroAccess(session.csrfToken, miroConnectionId);
      setMiroAccess(result);
      notify({
        tone: "success",
        title: "Fresh relay token issued",
        description: "Copy the MCP config now. The previous relay token is no longer valid.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not mint a new relay token",
        description: isApiError(error) ? friendlyBrokerMessage(error.message) : "Unexpected error.",
      });
    } finally {
      setTokenPending(false);
    }
  };

  if (loading) return <LoadingScreen label="Loading integrations…" />;

  const existingMiro = findMiroConnection(connections, providerAppById);

  return (
    <>
      <PageIntro
        eyebrow="Integrations"
        title="Connected apps"
        description="Connect third-party accounts the broker can use for relay access, delegated tokens, and approved automation."
      />

      {setupPending ? <LoadingScreen label="Preparing your one-time Miro MCP config…" /> : null}

      {connectableApps.length === 0 ? (
        <Card title="No integrations available" description="Your organization has not published any connectable apps yet.">
          <EmptyState title="Nothing to connect" body="Ask an administrator to register provider apps for your organization." />
        </Card>
      ) : (
        <div className="integration-grid user-integration-grid">
          {connectableApps.map((app) => {
            const connection = connections.find(
              (c) => c.provider_app_id === app.id && c.status !== "revoked",
            );
            const active =
              connection ?? connections.find((c) => c.provider_app_id === app.id && c.status === "revoked");
            const desc = templateDescription(definitions, app.template_key) || "OAuth connection managed by the broker.";
            const primaryDisabled = busy.has(`oauth:${app.id}`);
            const canDisconnect = Boolean(connection && connection.status === "connected");
            const showReconnect = Boolean(connection && connection.status !== "revoked");

            return (
              <article key={app.id} className="integration-card user-integration-card">
                <div className="integration-card-head">
                  <span className="integration-card-title">{app.display_name}</span>
                  {active ? (
                    <StatusBadge tone={connectionTone(active)}>
                      {active.status === "connected" && active.last_error ? "attention" : active.status}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">not connected</StatusBadge>
                  )}
                </div>
                <p className="integration-card-desc">{desc}</p>

                {active ? (
                  <div className="user-integration-meta">
                    <div className="stack-cell">
                      <strong>Account</strong>
                      <span>{active.display_name || active.external_email || active.external_account_ref || active.id}</span>
                    </div>
                    <div className="stack-cell">
                      <strong>Connected</strong>
                      <span>{formatDateTime(active.connected_at)}</span>
                    </div>
                    {active.access_token_expires_at ? (
                      <div className="stack-cell">
                        <strong>Access token valid until</strong>
                        <span>
                          {formatDateTime(active.access_token_expires_at)} ({relativeTime(active.access_token_expires_at)})
                        </span>
                      </div>
                    ) : null}
                    {active.refresh_token_expires_at ? (
                      <div className="stack-cell">
                        <strong>Refresh token valid until</strong>
                        <span>{formatDateTime(active.refresh_token_expires_at)}</span>
                      </div>
                    ) : null}
                    <div className="stack-cell">
                      <strong>Last token update</strong>
                      <span>
                        {active.token_material_updated_at ? formatDateTime(active.token_material_updated_at) : "Not recorded"}
                      </span>
                    </div>
                    <div className="stack-cell">
                      <strong>Refresh possible</strong>
                      <span>{active.refresh_token_available === true ? "Yes" : "No"}</span>
                    </div>
                    {active.last_error ? (
                      <div className="stack-cell user-integration-error">
                        <strong>Broker note</strong>
                        <span>{friendlyBrokerMessage(active.last_error)}</span>
                      </div>
                    ) : null}
                    {probeById[active.id] ? (
                      <div className="stack-cell">
                        <strong>Last probe</strong>
                        <span>
                          {probeById[active.id].ok ? "Healthy" : friendlyBrokerMessage(probeById[active.id].message)} —{" "}
                          {formatDateTime(probeById[active.id].checked_at)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="integration-card-actions user-integration-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={primaryDisabled || !app.is_enabled}
                    onClick={() => void startConnect(app, connection)}
                  >
                    {primaryDisabled ? "Redirecting…" : showReconnect ? "Reconnect" : "Connect"}
                  </button>
                  {canDisconnect && connection ? (
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={busy.has(`revoke:${connection.id}`)}
                      onClick={() => void handleRevoke(connection.id)}
                    >
                      {busy.has(`revoke:${connection.id}`) ? "Disconnecting…" : "Disconnect"}
                    </button>
                  ) : null}
                  {connection && connection.status === "connected" ? (
                    <>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={busy.has(`refresh:${connection.id}`)}
                        onClick={() => void handleRefresh(connection.id)}
                      >
                        {busy.has(`refresh:${connection.id}`) ? "Refreshing…" : "Refresh token"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={busy.has(`probe:${connection.id}`)}
                        onClick={() => void handleProbe(connection.id)}
                      >
                        {busy.has(`probe:${connection.id}`) ? "Probing…" : "Probe"}
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {existingMiro ? (
        <MiroAccessCard
          access={miroAccess}
          pending={tokenPending}
          onIssueToken={() => void handleRotateMiroToken(existingMiro.id)}
          title="Miro MCP handoff"
          description="Copy the broker MCP endpoint and relay token for your MCP client."
        />
      ) : null}
    </>
  );
}
