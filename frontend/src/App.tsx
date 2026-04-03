import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { AppProvider, useAppContext } from "./app-context";
import { AccessPage } from "./admin/AccessPage";
import { DashboardPage } from "./admin/DashboardPage";
import { IntegrationsPage } from "./admin/IntegrationsPage";
import { LogsPage } from "./admin/LogsPage";
import { ServicesPage } from "./admin/ServicesPage";
import { UsersPage } from "./admin/UsersPage";
import { api } from "./api";
import {
  Card,
  DataTable,
  EmptyState,
  Field,
  FormActions,
  InlineForm,
  LoadingScreen,
  PageIntro,
  SecretPanel,
  StatusBadge,
  ToastViewport,
} from "./components";
import type {
  ConnectedAccountOut,
  ConnectionProbeResult,
  DelegationGrantCreateResult,
  DelegationGrantFormValues,
  DelegationGrantOut,
  MiroRelayAccess,
  ProviderAppOut,
  ProviderInstanceOut,
  RouteMatch,
  SelfServiceDelegationGrantCreateResult,
  SelfServiceDelegationGrantFormValues,
  SelfServiceDelegationGrantOut,
  ServiceClientCreateResult,
  ServiceClientFormValues,
  ServiceClientOut,
  TokenIssueEventOut,
  UserOut,
  VisibleServiceClientOut,
} from "./types";
import { isApiError } from "./errors";
import {
  formatDateTime,
  formatJson,
  matchesRoute,
  replaceLegacyAdminPath,
  parseLines,
  relativeTime,
  toIsoDateTime,
} from "./utils";

function connectionTone(connection: ConnectedAccountOut): "neutral" | "success" | "warn" | "danger" {
  if (connection.status === "revoked") return "warn";
  if (connection.last_error) return "danger";
  if (connection.status === "connected") return "success";
  return "neutral";
}

function grantState(grant: SelfServiceDelegationGrantOut | DelegationGrantOut): string {
  if (grant.revoked_at) return "Revoked";
  if (!grant.is_enabled) return "Disabled";
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

function grantTone(grant: SelfServiceDelegationGrantOut | DelegationGrantOut): "neutral" | "success" | "warn" | "danger" {
  const state = grantState(grant);
  if (state === "Active") return "success";
  if (state === "Expired") return "danger";
  if (state === "Revoked") return "warn";
  return "neutral";
}

function decisionTone(decision: string): "neutral" | "success" | "warn" | "danger" {
  if (decision === "issued" || decision === "relayed") return "success";
  if (decision === "blocked") return "warn";
  if (decision === "error") return "danger";
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
  return connections.find((connection) => providerAppById[connection.provider_app_id]?.template_key === "miro-relay");
}

function findProviderAppByTemplate(providerApps: ProviderAppOut[], templateKey: string): ProviderAppOut | undefined {
  return providerApps.find((providerApp) => providerApp.template_key === templateKey);
}

function findConnectionByTemplate(
  connections: ConnectedAccountOut[],
  providerAppById: Record<string, ProviderAppOut>,
  templateKey: string,
): ConnectedAccountOut | undefined {
  return connections.find((connection) => providerAppById[connection.provider_app_id]?.template_key === templateKey);
}

function templateKeyForRoute(providerKey: string): string | null {
  if (providerKey === "miro") return "miro-relay";
  if (providerKey === "microsoft-graph") return "microsoft-graph-direct";
  return null;
}

function providerRouteLabel(providerKey: string): string {
  if (providerKey === "miro") return "Miro";
  if (providerKey === "microsoft-graph") return "Microsoft Graph";
  return providerKey;
}

function userAccessModeLabel(mode: string): string {
  if (mode === "relay") return "Proxy path";
  if (mode === "direct_token") return "Direct token";
  return mode;
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

function usePathname() {
  const [route, setRoute] = useState<RouteMatch>(() => matchesRoute(window.location.pathname));

  useEffect(() => {
    const canonical = replaceLegacyAdminPath(window.location.pathname);
    if (canonical) {
      window.history.replaceState({}, "", canonical);
      startTransition(() => {
        setRoute(matchesRoute(canonical));
      });
    }
  }, []);

  useEffect(() => {
    const handle = () => {
      startTransition(() => {
        setRoute(matchesRoute(window.location.pathname));
      });
    };
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, []);

  const navigate = (path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, "", path);
    startTransition(() => {
      setRoute(matchesRoute(path));
    });
  };

  return { route, navigate };
}

function NavLink({
  currentPath,
  href,
  label,
  onNavigate,
}: {
  currentPath: string;
  href: string;
  label: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={currentPath === href ? "nav-link active" : "nav-link"}
      onClick={() => onNavigate(href)}
    >
      {label}
    </button>
  );
}

function LoginPage({ onSuccess }: { onSuccess: (path: string) => void }) {
  const { login, notify } = useAppContext();
  const adminUsernameRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [microsoftPending, setMicrosoftPending] = useState(false);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);

  useEffect(() => {
    void api
      .loginOptions()
      .then((result) => {
        setMicrosoftEnabled(result.microsoft_enabled);
      })
      .catch(() => {
        setMicrosoftEnabled(false);
      });
  }, []);

  useEffect(() => {
    if (!adminModalOpen) return;
    const id = window.setTimeout(() => {
      adminUsernameRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [adminModalOpen]);

  useEffect(() => {
    if (!adminModalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAdminModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminModalOpen]);

  const closeAdminModal = () => {
    setPassword("");
    setAdminModalOpen(false);
  };

  const handleAdminSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      await login(email, password);
      closeAdminModal();
      onSuccess("/app");
    } catch (error) {
      notify({
        tone: "error",
        title: "Sign-in failed",
        description: isApiError(error) ? error.message : "Unexpected login error.",
      });
    } finally {
      setPending(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setMicrosoftPending(true);
    try {
      const result = await api.startMicrosoftLogin();
      window.location.assign(result.auth_url);
    } catch (error) {
      setMicrosoftPending(false);
      notify({
        tone: "error",
        title: "Microsoft sign-in unavailable",
        description: isApiError(error) ? error.message : "Unexpected Microsoft login error.",
      });
    }
  };

  return (
    <>
      <main className="landing">
        <div className="landing-inner">
          <h1 className="landing-title">Sign in to continue</h1>
          <p className="landing-sub">Access your integrations</p>
          <div className="landing-cta-wrap">
            <button
              type="button"
              className="primary-button landing-cta"
              disabled={microsoftPending || !microsoftEnabled}
              aria-busy={microsoftPending}
              onClick={() => void handleMicrosoftLogin()}
            >
              {microsoftPending ? "Redirecting…" : "Log in"}
            </button>
          </div>
          {!microsoftEnabled ? <p className="landing-hint">Sign-in is not configured.</p> : null}
          <button type="button" className="landing-admin" onClick={() => setAdminModalOpen(true)}>
            Administrator sign-in
          </button>
        </div>
      </main>

      {adminModalOpen ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="landing-admin-login-title">
          <button type="button" className="modal-backdrop" aria-label="Dismiss" onClick={closeAdminModal} />
          <div className="modal-panel landing-admin-modal">
            <div className="modal-panel-header">
              <h2 id="landing-admin-login-title">Administrator sign-in</h2>
            </div>
            <div className="modal-panel-body">
              <form className="landing-modal-form" onSubmit={handleAdminSubmit}>
                <Field label="Username">
                  <input
                    ref={adminUsernameRef}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    name="username"
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field label="Password">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <div className="landing-modal-actions">
                  <button type="button" className="ghost-button" onClick={closeAdminModal}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button" disabled={pending}>
                    {pending ? "Signing in…" : "Sign in"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Shell({
  currentPath,
  navItems,
  onNavigate,
  children,
  kicker,
  title,
  subtitle,
}: {
  currentPath: string;
  navItems: Array<{ href: string; label: string }>;
  onNavigate: (path: string) => void;
  children: ReactNode;
  kicker: string;
  title: string;
  subtitle: string;
}) {
  const { logout, session } = useAppContext();

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-kicker">{kicker}</span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              currentPath={currentPath}
              href={item.href}
              label={item.label}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="session-panel">
            <p className="eyebrow">Signed in</p>
            <strong>{session.status === "authenticated" ? session.user.display_name : "Guest"}</strong>
            <span>{session.status === "authenticated" ? session.user.email : "No active session"}</span>
          </div>
          <button type="button" className="ghost-button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="page-shell">{children}</main>
    </div>
  );
}

function MetricCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

function MiroAccessCard({
  access,
  pending,
  onIssueToken,
  title = "Miro MCP access",
  description = "Use this broker-managed endpoint and relay token in your MCP client.",
}: {
  access: MiroRelayAccess | null;
  pending: boolean;
  onIssueToken?: () => void;
  title?: string;
  description?: string;
}) {
  if (!access) {
    return (
      <Card title={title} description={description}>
        <EmptyState
          title="No Miro relay access yet"
          body="Connect Miro first. Once the broker has a connected account, this panel will show the MCP endpoint and let you mint a new relay token."
        />
      </Card>
    );
  }

  const tokenState = access.relay_token
    ? "New one-time relay token ready"
    : access.has_relay_token
      ? "A relay token exists but cannot be shown again"
      : "No relay token exists yet";

  return (
    <Card title={title} description={description}>
      <div className="stack-list">
        <div className="stack-cell">
          <strong>Connection</strong>
          <span>{access.display_name || access.external_email || access.connected_account_id}</span>
        </div>
        <div className="stack-cell">
          <strong>Profile ID</strong>
          <code className="inline-code">{access.profile_id}</code>
        </div>
        <div className="stack-cell">
          <strong>MCP endpoint</strong>
          <code className="inline-code">{access.mcp_url}</code>
        </div>
        <div className="stack-cell">
          <strong>Relay token state</strong>
          <span>{tokenState}</span>
        </div>
        <div className="stack-cell">
          <strong>Broker status</strong>
          <span>{access.connection_status}</span>
        </div>
      </div>

      {onIssueToken ? (
        <div className="inline-actions">
          <button type="button" className="primary-button" disabled={pending} onClick={onIssueToken}>
            {pending ? "Generating..." : access.has_relay_token ? "Generate new relay token" : "Create relay token"}
          </button>
        </div>
      ) : null}

      {!access.relay_token && access.has_relay_token ? (
        <p className="lede">
          Existing MCP clients can keep using the current token, but the broker cannot reveal it again. Generate a new token
          when you want to copy a fresh config from the UI.
        </p>
      ) : null}

      {access.relay_token ? (
        <>
          <SecretPanel
            title="Relay token"
            body="This token is shown only for this issuance. Store it in your MCP client before leaving the page."
            value={access.relay_token}
          />
          {access.mcp_config_json ? (
            <SecretPanel
              title="Ready-to-paste MCP config"
              body="Paste this JSON into your MCP client configuration to use the brokered Miro endpoint."
              value={access.mcp_config_json}
            />
          ) : null}
          {access.credentials_bundle_json ? (
            <SecretPanel
              title="Backup credentials bundle"
              body="This compact bundle mirrors the old flow and is useful when you need profile ID plus relay token together."
              value={access.credentials_bundle_json}
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}


function WorkspacePage() {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [miroAccess, setMiroAccess] = useState<MiroRelayAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [probeResult, setProbeResult] = useState<ConnectionProbeResult | null>(null);
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
  const [tokenPending, setTokenPending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [providerAppData, connectionData] = await Promise.all([api.providerAppsForUser(), api.myConnections()]);
      setProviderApps(providerAppData);
      setConnections(connectionData);
      const providerMap = Object.fromEntries(providerAppData.map((app) => [app.id, app]));
      const existingMiro = findMiroConnection(connectionData, providerMap);
      if (existingMiro) {
        setMiroAccess(await api.miroAccess(existingMiro.id));
      } else {
        setMiroAccess(null);
      }
    } catch (error) {
      notify({
        tone: "error",
        title: "Failed to load workspace",
        description: isApiError(error) ? error.message : "Unexpected workspace loading error.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load();
  }, [notify, session]);

  const providerAppById = useMemo(
    () => Object.fromEntries(providerApps.map((app) => [app.id, app])),
    [providerApps],
  );
  const existingMiro = findMiroConnection(connections, providerAppById);

  const runAction = async (actionKey: string, fn: () => Promise<void>) => {
    setBusyActions((prev) => new Set(prev).add(actionKey));
    try {
      await fn();
    } catch (error) {
      notify({
        tone: "error",
        title: "Action failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusyActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const handleRefresh = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runAction(`refresh:${connectionId}`, async () => {
      await api.refreshConnection(session.csrfToken, connectionId);
      notify({ tone: "success", title: "Connection refreshed" });
      await load();
    });
  };

  const handleProbe = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runAction(`probe:${connectionId}`, async () => {
      const result = await api.probeConnection(session.csrfToken, connectionId);
      setProbeResult(result);
      notify({
        tone: result.ok ? "success" : "error",
        title: result.ok ? "Connection probe succeeded" : "Connection probe failed",
        description: result.ok ? "The broker could reach the provider with the stored credentials." : friendlyBrokerMessage(result.message),
      });
      await load();
    });
  };

  const handleRevoke = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runAction(`revoke:${connectionId}`, async () => {
      await api.revokeConnection(session.csrfToken, connectionId);
      notify({ tone: "info", title: "Connection revoked" });
      await load();
    });
  };

  const handleRotateMiroToken = async () => {
    if (session.status !== "authenticated" || !existingMiro) return;
    setTokenPending(true);
    try {
      const result = await api.resetMiroAccess(session.csrfToken, existingMiro.id);
      setMiroAccess(result);
      notify({
        tone: "success",
        title: "New Miro relay token ready",
        description: "Copy the MCP config now. The previous relay token is no longer valid.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not issue a new relay token",
        description: isApiError(error) ? error.message : "Unexpected Miro access error.",
      });
    } finally {
      setTokenPending(false);
    }
  };

  if (loading) return <LoadingScreen label="Loading your workspace..." />;

  return (
    <>
      <PageIntro
        eyebrow="Workspace"
        title="Manage your provider access"
        description="See your broker-held provider connections, refresh or revoke them, and run a safe connectivity probe before downstream consumers request access."
      />

      <div className="metric-grid">
        <MetricCard label="Active connections" value={String(connections.filter((connection) => connection.status === "connected").length)} caption="Currently usable accounts" />
        <MetricCard label="Provider apps" value={String(providerApps.length)} caption="Visible self-service targets" />
        <MetricCard
          label="Last probe"
          value={probeResult ? (probeResult.ok ? "Healthy" : "Needs attention") : "Not run"}
          caption={probeResult ? formatDateTime(probeResult.checked_at) : "Run a probe from a connection row"}
        />
        <MetricCard
          label="Errors"
          value={String(connections.filter((connection) => Boolean(connection.last_error)).length)}
          caption="Connections with stored issues"
        />
        <MetricCard label="Workspace status" value="Ready" caption="User self-service is active" />
      </div>

      {probeResult ? (
        <Card title="Latest probe result" description="The probe uses the broker backend and never returns raw provider tokens.">
          <div className="stack-list">
            <div className="stack-cell">
              <strong>Status</strong>
              <span>{probeResult.ok ? "Connected successfully" : probeResult.message ?? "Probe failed"}</span>
            </div>
            <div className="stack-cell">
              <strong>Checked</strong>
              <span>{formatDateTime(probeResult.checked_at)}</span>
            </div>
            <div className="stack-cell">
              <strong>Provider identity</strong>
              <span>{probeResult.external_user_name || probeResult.external_user_id || "Not returned"}</span>
            </div>
          </div>
        </Card>
      ) : null}

      <MiroAccessCard
        access={miroAccess}
        pending={tokenPending}
        onIssueToken={existingMiro ? () => void handleRotateMiroToken() : undefined}
        description="This is the new-app replacement for the old Miro relay handoff. Use it to copy the broker MCP config whenever you need a fresh token."
      />

      <Card title="Your connections" description="Refresh keeps credentials current, probe checks connectivity, and revoke removes access from the broker.">
          <DataTable
            columns={["Provider", "Account", "Connected", "Status", "Last error", "Actions"]}
            rows={connections.map((connection) => [
              providerAppById[connection.provider_app_id]?.display_name ?? connection.provider_app_id,
              connection.display_name || connection.external_email || connection.external_account_ref || connection.id,
              formatDateTime(connection.connected_at),
              <StatusBadge
                key={connection.id}
                tone={connectionTone(connection)}
              >
                {connection.status === "connected" && connection.last_error ? "attention" : connection.status}
              </StatusBadge>,
              connection.last_error ? friendlyBrokerMessage(connection.last_error) : "No recent error",
              <div className="inline-actions" key={`${connection.id}-actions`}>
              <button
                type="button"
                className="ghost-button"
                disabled={busyActions.has(`refresh:${connection.id}`)}
                onClick={() => void handleRefresh(connection.id)}
              >
                {busyActions.has(`refresh:${connection.id}`) ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={busyActions.has(`probe:${connection.id}`)}
                onClick={() => void handleProbe(connection.id)}
              >
                {busyActions.has(`probe:${connection.id}`) ? "Probing..." : "Probe"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={busyActions.has(`revoke:${connection.id}`)}
                onClick={() => void handleRevoke(connection.id)}
              >
                {busyActions.has(`revoke:${connection.id}`) ? "Revoking..." : "Revoke"}
              </button>
            </div>,
          ])}
          emptyTitle="No provider connections yet"
          emptyBody="Start by connecting one of the configured provider apps so the broker can refresh, relay, or issue delegated access for your account."
        />
      </Card>
    </>
  );
}

function ConnectProviderPage({ onNavigate, providerKey }: { onNavigate: (path: string) => void; providerKey: string }) {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [miroAccess, setMiroAccess] = useState<MiroRelayAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [setupPending, setSetupPending] = useState(false);
  const [tokenPending, setTokenPending] = useState(false);
  const templateKey = templateKeyForRoute(providerKey);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    Promise.all([api.providerAppsForUser(), api.myConnections()])
      .then(([providerAppData, connectionData]) => {
        setProviderApps(providerAppData);
        setConnections(connectionData);
        const providerMap = Object.fromEntries(providerAppData.map((app) => [app.id, app]));
        const existingMiroConnection = templateKey === "miro-relay" ? findMiroConnection(connectionData, providerMap) : undefined;
        if (existingMiroConnection && templateKey === "miro-relay") {
          void api
            .miroAccess(existingMiroConnection.id)
            .then((result) => setMiroAccess(result))
            .catch(() => setMiroAccess(null));
        } else {
          setMiroAccess(null);
        }
      })
      .catch((error) =>
        notify({
          tone: "error",
          title: "Failed to load connect flow",
          description: isApiError(error) ? error.message : "Unexpected connect loading error.",
        }),
      )
      .finally(() => setLoading(false));
  }, [notify, session, templateKey]);

  const providerAppById = useMemo(
    () => Object.fromEntries(providerApps.map((app) => [app.id, app])),
    [providerApps],
  );
  const selectedProviderApp = templateKey ? findProviderAppByTemplate(providerApps, templateKey) : undefined;
  const existingConnection = templateKey ? findConnectionByTemplate(connections, providerAppById, templateKey) : undefined;
  const existingMiro = templateKey === "miro-relay" ? existingConnection : undefined;

  useEffect(() => {
    if (session.status !== "authenticated" || templateKey !== "miro-relay") return;
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
      });
  }, [notify, session, templateKey]);

  const startConnect = async () => {
    if (session.status !== "authenticated" || !selectedProviderApp) return;
    setPending(true);
    try {
      const result = await api.startProviderConnection(session.csrfToken, selectedProviderApp.key, existingConnection?.id);
      window.location.assign(result.auth_url);
    } catch (error) {
      setPending(false);
      notify({
        tone: "error",
        title: `Could not start ${providerRouteLabel(providerKey)} connect`,
        description: isApiError(error) ? friendlyBrokerMessage(error.message) : "Unexpected provider connect error.",
      });
    }
  };

  const handleRotateMiroToken = async () => {
    if (session.status !== "authenticated" || !existingMiro) return;
    setTokenPending(true);
    try {
      const result = await api.resetMiroAccess(session.csrfToken, existingMiro.id);
      setMiroAccess(result);
      notify({
        tone: "success",
        title: "Fresh Miro relay token issued",
        description: "The previous relay token is now invalid. Copy the new MCP config before you leave.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not mint a new Miro relay token",
        description: isApiError(error) ? friendlyBrokerMessage(error.message) : "Unexpected Miro token error.",
      });
    } finally {
      setTokenPending(false);
    }
  };

  if (loading) return <LoadingScreen label={`Preparing ${providerRouteLabel(providerKey)} connect...`} />;
  if (!templateKey || !selectedProviderApp) {
    return (
      <EmptyState
        title="Provider not configured"
        body="This connect target has not been created by an admin yet. Ask an admin to create it from a template in the Providers section."
      />
    );
  }

  return (
    <>
      <PageIntro
        eyebrow="Connect"
        title={`Connect your ${providerRouteLabel(providerKey)} account`}
        description="The broker stores provider token material server-side, then returns you to the workspace with a verified connection state."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => onNavigate("/workspace")}>
              Back to workspace
            </button>
          </div>
        }
      />

      <div className="two-column">
        <Card title={`${providerRouteLabel(providerKey)} authorization`} description="This flow uses the broker backend callback and comes back into your workspace automatically.">
          <div className="stack-form">
            <p className="lede">
              {existingConnection
                ? `An existing ${providerRouteLabel(providerKey)} connection was found. Reconnect to refresh stored credentials and keep the same broker-side identity.`
                : `No ${providerRouteLabel(providerKey)} connection exists yet. Start the flow to create your first broker-held account.`}
            </p>
            <div className="inline-actions">
              <button type="button" className="primary-button" disabled={pending} onClick={() => void startConnect()}>
                {pending ? "Redirecting..." : existingConnection ? `Reconnect ${providerRouteLabel(providerKey)}` : `Connect ${providerRouteLabel(providerKey)}`}
              </button>
            </div>
          </div>
        </Card>

        <Card title="Current provider state" description="If you already have a connection, you can see the current broker-held record before reconnecting.">
          {existingConnection ? (
            <div className="stack-list">
              <div className="stack-cell">
                <strong>Account</strong>
                <span>{existingConnection.display_name || existingConnection.external_email || existingConnection.id}</span>
              </div>
              <div className="stack-cell">
                <strong>Status</strong>
                <span>{existingConnection.status === "connected" && existingConnection.last_error ? "Connected with attention needed" : existingConnection.status}</span>
              </div>
              <div className="stack-cell">
                <strong>Connected</strong>
                <span>{formatDateTime(existingConnection.connected_at)}</span>
              </div>
              <div className="stack-cell">
                <strong>Last broker note</strong>
                <span>{existingConnection.last_error ? friendlyBrokerMessage(existingConnection.last_error) : "No recent issue recorded"}</span>
              </div>
            </div>
          ) : (
            <EmptyState
              title={`No ${providerRouteLabel(providerKey)} connection yet`}
              body={`Start the authorization flow to create a broker-managed ${providerRouteLabel(providerKey)} connection for your workspace.`}
            />
          )}
        </Card>
      </div>

      {templateKey === "miro-relay" ? (
        <>
          {setupPending ? <LoadingScreen label="Preparing your one-time Miro MCP config..." /> : null}
          <MiroAccessCard
            access={miroAccess}
            pending={tokenPending}
            onIssueToken={existingMiro ? () => void handleRotateMiroToken() : undefined}
            title="Miro MCP handoff"
            description="This replaces the old relay success page. You can copy the ready-to-paste MCP config directly from here."
          />
        </>
      ) : (
        <Card title="Direct token readiness" description="After this connection exists, you can create grants that let approved service clients request current tokens for your account.">
          <p className="lede">
            This provider is configured for direct-token use. Once connected, the broker stores and refreshes tokens server-side so your approved agents can request delegated access through a grant.
          </p>
        </Card>
      )}
    </>
  );
}

function GrantsPage() {
  const { notify, session } = useAppContext();
  const [serviceClients, setServiceClients] = useState<VisibleServiceClientOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [grants, setGrants] = useState<SelfServiceDelegationGrantOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [createdResult, setCreatedResult] = useState<SelfServiceDelegationGrantCreateResult | null>(null);
  const [form, setForm] = useState<SelfServiceDelegationGrantFormValues>({
    service_client_key: "",
    provider_app_key: "",
    connected_account_id: "",
    allowed_access_modes: ["direct_token"],
    scope_ceiling_text: "",
    environment: "",
    expires_in_hours: 24,
    capabilities_text: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [serviceClientData, providerAppData, connectionData, grantData] = await Promise.all([
        api.visibleServiceClients(),
        api.providerAppsForUser(),
        api.myConnections(),
        api.myDelegationGrants(),
      ]);
      setServiceClients(serviceClientData);
      setProviderApps(providerAppData);
      setConnections(connectionData);
      setGrants(grantData);

      const firstProviderApp =
        providerAppData.find((app) => connectionData.some((connection) => connection.provider_app_id === app.id))?.key ?? "";
      setForm((current) => ({
        ...current,
        provider_app_key: current.provider_app_key || firstProviderApp,
      }));
    } catch (error) {
      notify({
        tone: "error",
        title: "Failed to load grants",
        description: isApiError(error) ? error.message : "Unexpected grant loading error.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load();
  }, [notify, session]);

  const providerAppById = useMemo(
    () => Object.fromEntries(providerApps.map((app) => [app.id, app])),
    [providerApps],
  );
  const availableProviderApps = providerApps.filter((app) =>
    connections.some((connection) => connection.provider_app_id === app.id && connection.status === "connected"),
  );
  const eligibleConnections = connections.filter(
    (connection) => !form.provider_app_key || providerAppById[connection.provider_app_id]?.key === form.provider_app_key,
  );

  const toggleMode = (mode: string) => {
    setForm((current) => ({
      ...current,
      allowed_access_modes: current.allowed_access_modes.includes(mode)
        ? current.allowed_access_modes.filter((entry) => entry !== mode)
        : [...current.allowed_access_modes, mode],
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      const scKey = form.service_client_key.trim();
      const result = await api.createMyDelegationGrant(session.csrfToken, {
        ...(scKey ? { service_client_key: scKey } : {}),
        provider_app_key: form.provider_app_key,
        connected_account_id: form.connected_account_id || null,
        allowed_access_modes: form.allowed_access_modes,
        scope_ceiling: parseLines(form.scope_ceiling_text),
        environment: form.environment || null,
        expires_in_hours: form.expires_in_hours,
        capabilities: parseLines(form.capabilities_text),
      });
      setCreatedResult(result);
      notify({ tone: "success", title: "Delegated credential created" });
      setForm((current) => ({
        ...current,
        connected_account_id: "",
        scope_ceiling_text: "",
        environment: "",
        expires_in_hours: 24,
        capabilities_text: "",
      }));
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create grant",
        description: isApiError(error) ? error.message : "Unexpected grant creation error.",
      });
    } finally {
      setPending(false);
    }
  };

  const revokeGrant = async (grantId: string) => {
    if (session.status !== "authenticated") return;
    try {
      await api.revokeMyDelegationGrant(session.csrfToken, grantId);
      notify({ tone: "info", title: "Grant revoked" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not revoke grant",
        description: isApiError(error) ? error.message : "Unexpected revoke error.",
      });
    }
  };

  if (loading) return <LoadingScreen label="Loading your grants..." />;

  return (
    <>
      <PageIntro
        eyebrow="My Grants"
        title="Delegated access"
        description="Optionally restrict a grant to a registered service client, or leave it unset to use only the delegated credential when calling the broker."
      />

      {createdResult ? (
        <SecretPanel
          title="Delegated credential available"
          body={`Store this delegated credential${
            createdResult.delegation_grant.service_client_display_name
              ? ` for ${createdResult.delegation_grant.service_client_display_name}`
              : ""
          } now. It will not be shown again later.`}
          value={createdResult.delegated_credential}
        />
      ) : null}

      <div className="two-column">
        <Card title="Your grants" description="Only your own grants appear here, and you can revoke them whenever a downstream consumer should lose access.">
          <DataTable
            columns={["Service client", "Provider", "Connection", "Modes", "State", "Expires", "Policy", "Action"]}
            rows={grants.map((grant) => [
              grant.service_client_display_name ?? "Credential only",
              grant.provider_app_display_name,
              grant.connected_account_display_name ?? "Auto-select at issue time",
              grant.allowed_access_modes.join(", "),
              <StatusBadge key={`${grant.id}-state`} tone={grantTone(grant)}>
                {grantState(grant)}
              </StatusBadge>,
              `${formatDateTime(grant.expires_at)} (${relativeTime(grant.expires_at)})`,
              <div className="stack-cell" key={`${grant.id}-policy`}>
                <strong>Scopes</strong>
                <span>{grant.scope_ceiling.length ? grant.scope_ceiling.join(", ") : "Inherited from provider app"}</span>
                <strong>Capabilities</strong>
                <span>{grant.capabilities.length ? grant.capabilities.join(", ") : "No extra capabilities"}</span>
              </div>,
              grant.revoked_at ? (
                "Closed"
              ) : (
                <button type="button" className="ghost-button" onClick={() => void revokeGrant(grant.id)}>
                  Revoke
                </button>
              ),
            ])}
            emptyTitle="No grants yet"
            emptyBody="Create a delegated credential once you have a provider connection."
          />
        </Card>

        <Card title="Create a grant" description="This creates a one-time delegated credential for your own connected account.">
          <InlineForm
            title="New self-service grant"
            description="Optionally pick a service client for governance. Leave unset to rely on the delegated credential alone."
            onSubmit={handleSubmit}
          >
            <Field label="Service client" hint="Optional">
              <select
                value={form.service_client_key}
                onChange={(event) => setForm((current) => ({ ...current, service_client_key: event.target.value }))}
              >
                <option value="">Credential only</option>
                {serviceClients.map((client) => (
                  <option key={client.id} value={client.key}>
                    {client.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Provider app">
              <select
                value={form.provider_app_key}
                onChange={(event) => setForm((current) => ({ ...current, provider_app_key: event.target.value, connected_account_id: "" }))}
              >
                {availableProviderApps.map((app) => (
                  <option key={app.id} value={app.key}>
                    {app.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Connection">
              <select
                value={form.connected_account_id}
                onChange={(event) => setForm((current) => ({ ...current, connected_account_id: event.target.value }))}
              >
                <option value="">Auto-select matching active connection</option>
                {eligibleConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.display_name || connection.external_email || connection.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Allowed access modes">
              <div className="check-grid compact">
                {["relay", "direct_token"].map((mode) => (
                  <label key={mode} className="check-option">
                    <input
                      type="checkbox"
                      checked={form.allowed_access_modes.includes(mode)}
                      onChange={() => toggleMode(mode)}
                    />
                    <span>{userAccessModeLabel(mode)}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Scope ceiling" hint="Comma or newline separated">
              <textarea
                value={form.scope_ceiling_text}
                onChange={(event) => setForm((current) => ({ ...current, scope_ceiling_text: event.target.value }))}
              />
            </Field>
            <Field label="Capabilities" hint="Comma or newline separated">
              <textarea
                value={form.capabilities_text}
                onChange={(event) => setForm((current) => ({ ...current, capabilities_text: event.target.value }))}
              />
            </Field>
            <Field label="Environment">
              <input
                value={form.environment}
                onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                placeholder="production"
              />
            </Field>
            <Field label="Expiry (hours)">
              <input
                type="number"
                min={1}
                max={24 * 365}
                value={form.expires_in_hours}
                onChange={(event) =>
                  setForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) || 24 }))
                }
              />
            </Field>
            <FormActions pending={pending} submitLabel="Create delegated credential" />
          </InlineForm>
        </Card>
      </div>
    </>
  );
}

function TokenAccessPage() {
  const { notify, session } = useAppContext();
  const [serviceClients, setServiceClients] = useState<VisibleServiceClientOut[]>([]);
  const [grants, setGrants] = useState<SelfServiceDelegationGrantOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [issues, setIssues] = useState<TokenIssueEventOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [probePending, setProbePending] = useState(false);
  const [probeConnectionId, setProbeConnectionId] = useState("");
  const [probeResult, setProbeResult] = useState<ConnectionProbeResult | null>(null);
  const [serviceClientFilter, setServiceClientFilter] = useState("");
  const [grantFilter, setGrantFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [clientData, grantData, connectionData, issueData] = await Promise.all([
        api.visibleServiceClients(),
        api.myDelegationGrants(),
        api.myConnections(),
        api.myTokenIssues({
          serviceClientId: serviceClientFilter || undefined,
          delegationGrantId: grantFilter || undefined,
          limit: 200,
        }),
      ]);
      setServiceClients(clientData);
      setGrants(grantData);
      setConnections(connectionData);
      setIssues(issueData);
      setProbeConnectionId((current) => current || connectionData[0]?.id || "");
    } catch (error) {
      notify({
        tone: "error",
        title: "Failed to load token access diagnostics",
        description: isApiError(error) ? error.message : "Unexpected diagnostics loading error.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load();
  }, [notify, session, serviceClientFilter, grantFilter]);

  const filteredIssues = issues.filter((issue) => (decisionFilter ? issue.decision === decisionFilter : true));

  const runProbe = async () => {
    if (session.status !== "authenticated" || !probeConnectionId) return;
    setProbePending(true);
    try {
      const result = await api.probeConnection(session.csrfToken, probeConnectionId);
      setProbeResult(result);
      notify({
        tone: result.ok ? "success" : "error",
        title: result.ok ? "Probe successful" : "Probe failed",
        description: result.ok ? "The broker could reach the provider using the stored connection." : friendlyBrokerMessage(result.message),
      });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Probe request failed",
        description: isApiError(error) ? error.message : "Unexpected probe request error.",
      });
    } finally {
      setProbePending(false);
    }
  };

  if (loading) return <LoadingScreen label="Loading token access diagnostics..." />;

  return (
    <>
      <PageIntro
        eyebrow="Token Access"
        title="Inspect access history and verify your connection"
        description="Review token issuance history for your grants and run a safe probe against a current connection when something looks wrong."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => void load()}>
              Reload
            </button>
          </div>
        }
      />

      <div className="two-column">
        <Card title="Filters" description="Limit the history to a specific service client or grant.">
          <div className="stack-form">
            <Field label="Service client">
              <select value={serviceClientFilter} onChange={(event) => setServiceClientFilter(event.target.value)}>
                <option value="">All service clients</option>
                {serviceClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grant">
              <select value={grantFilter} onChange={(event) => setGrantFilter(event.target.value)}>
                <option value="">All grants</option>
                {grants.map((grant) => (
                  <option key={grant.id} value={grant.id}>
                    {(grant.service_client_display_name ?? "Credential only") + " · " + grant.provider_app_display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Decision">
              <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}>
                <option value="">All decisions</option>
                <option value="issued">Issued</option>
                <option value="relayed">Relayed</option>
                <option value="blocked">Blocked</option>
                <option value="error">Error</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card title="Connection probe" description="The probe checks broker-to-provider access and never exposes raw access tokens.">
          <div className="stack-form">
            <Field label="Connection">
              <select value={probeConnectionId} onChange={(event) => setProbeConnectionId(event.target.value)}>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.display_name || connection.external_email || connection.id}
                  </option>
                ))}
              </select>
            </Field>
            <div className="inline-actions">
              <button type="button" className="primary-button" disabled={probePending || !probeConnectionId} onClick={() => void runProbe()}>
                {probePending ? "Probing..." : "Run probe"}
              </button>
            </div>
            {probeResult ? (
              <div className="stack-list">
                <div className="stack-cell">
                  <strong>Status</strong>
                  <span>{probeResult.ok ? "Healthy connection" : friendlyBrokerMessage(probeResult.message)}</span>
                </div>
                <div className="stack-cell">
                  <strong>Checked</strong>
                  <span>{formatDateTime(probeResult.checked_at)}</span>
                </div>
                <div className="stack-cell">
                  <strong>Resolved provider identity</strong>
                  <span>{probeResult.external_user_name || probeResult.external_user_id || "Not returned"}</span>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card title="Token issue history" description="Read-only audit trail of broker token issuance decisions for your own grants.">
        <DataTable
          columns={["Time", "Service client", "Grant", "Provider", "Decision", "Scopes", "Metadata"]}
          rows={filteredIssues.map((issue) => [
            formatDateTime(issue.created_at),
            issue.service_client_display_name ?? issue.service_client_id ?? "Unknown",
            issue.delegation_grant_id ?? "Unknown",
            issue.provider_app_display_name ?? issue.provider_app_id ?? "Unknown",
            <StatusBadge key={issue.id} tone={decisionTone(issue.decision)}>
              {issue.reason ? `${issue.decision}: ${friendlyBrokerMessage(issue.reason)}` : issue.decision}
            </StatusBadge>,
            issue.scopes.length ? issue.scopes.join(", ") : "Inherited",
            <pre className="audit-metadata" key={`${issue.id}-metadata`}>
              {JSON.stringify(issue.metadata, null, 2)}
            </pre>,
          ])}
          emptyTitle="No token issues recorded"
          emptyBody="Once a service client uses one of your grants, the broker records the issuance result here."
        />
      </Card>
    </>
  );
}

function NotFoundPage({ onNavigate, fallbackPath }: { onNavigate: (path: string) => void; fallbackPath: string }) {
  return (
    <main className="login-layout">
      <Card title="Route not found" description="This path is not part of the broker frontend.">
        <EmptyState
          title="Unknown page"
          body="Use the current shell navigation to return to a supported broker surface."
        />
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => onNavigate(fallbackPath)}>
            Go back
          </button>
        </div>
      </Card>
    </main>
  );
}

function AuthenticatedApp() {
  const { route, navigate } = usePathname();
  const { notify, session } = useAppContext();

  useEffect(() => {
    if (session.status === "booting") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return;

    const loginStatus = params.get("login_status");
    const miroStatus = params.get("miro_status");
    const providerStatus = params.get("provider_status");
    const miroSetup = params.get("miro_setup");
    const message = params.get("message");
    const connectedAccountId = params.get("connected_account_id");
    const friendlyMessage = friendlyBrokerMessage(message);

    if (loginStatus === "success") {
      notify({
        tone: "success",
        title: "Signed in with Microsoft",
        description: "Your broker workspace session is ready.",
      });
    }

    if (loginStatus === "error") {
      notify({
        tone: "error",
        title: "Microsoft sign-in failed",
        description: friendlyMessage,
      });
    }

    if (miroStatus === "connected") {
      notify({
        tone: "success",
        title: "Miro connected",
        description: connectedAccountId ? `Connection ${connectedAccountId} is now available in your workspace.` : "Your Miro account is now connected.",
      });
    }

    if (miroStatus === "error") {
      notify({
        tone: "error",
        title: "Miro connect failed",
        description: friendlyMessage,
      });
    }

    if (providerStatus === "connected" && route.name === "connect") {
      notify({
        tone: "success",
        title: `${providerRouteLabel(route.params.providerKey)} connected`,
        description: connectedAccountId ? `Connection ${connectedAccountId} is now available in your workspace.` : "Your provider account is now connected.",
      });
    }

    if (providerStatus === "error" && route.name === "connect") {
      notify({
        tone: "error",
        title: `${providerRouteLabel(route.params.providerKey)} connect failed`,
        description: friendlyMessage,
      });
    }

    if (!miroSetup) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [notify, route.path, session.status]);

  useEffect(() => {
    if (session.status !== "authenticated") return;

    if (session.user.is_admin) {
      if (route.name === "login") {
        navigate("/app");
      }
      return;
    }

    if (
      route.name === "login" ||
      route.name === "dashboard" ||
      route.name === "integrations" ||
      route.name === "users" ||
      route.name === "services" ||
      route.name === "access" ||
      route.name === "logs"
    ) {
      navigate("/workspace");
    }
  }, [navigate, route.name, session]);

  if (session.status === "booting") {
    return <LoadingScreen label="Restoring broker session..." />;
  }

  if (session.status === "anonymous") {
    return <LoginPage onSuccess={navigate} />;
  }

  if (route.name === "login") {
    return <LoadingScreen label="Redirecting to your workspace..." />;
  }

  if (session.user.is_admin) {
    if (route.name === "notFound") {
      return <NotFoundPage onNavigate={navigate} fallbackPath="/app" />;
    }

    return (
      <Shell
        currentPath={route.path}
        navItems={[
          { href: "/app", label: "Dashboard" },
          { href: "/app/integrations", label: "Integrations" },
          { href: "/app/users", label: "Users" },
          { href: "/app/services", label: "Services" },
          { href: "/app/access", label: "Access" },
          { href: "/app/logs", label: "Logs" },
        ]}
        onNavigate={navigate}
        kicker="OAuth integration broker"
        title="Admin console"
        subtitle="Organization configuration"
      >
        {route.name === "dashboard" ? <DashboardPage /> : null}
        {route.name === "integrations" ? <IntegrationsPage /> : null}
        {route.name === "users" ? <UsersPage /> : null}
        {route.name === "services" ? <ServicesPage /> : null}
        {route.name === "access" ? <AccessPage /> : null}
        {route.name === "logs" ? <LogsPage /> : null}
      </Shell>
    );
  }

  if (route.name === "notFound") {
    return <NotFoundPage onNavigate={navigate} fallbackPath="/workspace" />;
  }

  if (
    route.name === "dashboard" ||
    route.name === "integrations" ||
    route.name === "users" ||
    route.name === "services" ||
    route.name === "access" ||
    route.name === "logs"
  ) {
    return <LoadingScreen label="Redirecting to your workspace..." />;
  }

  if (route.name === "connect" && !templateKeyForRoute(route.params.providerKey)) {
    return <NotFoundPage onNavigate={navigate} fallbackPath="/workspace" />;
  }

  return (
    <Shell
      currentPath={route.path}
      navItems={[
        { href: "/workspace", label: "Workspace" },
        { href: "/connect/miro", label: "Connect Miro" },
        { href: "/connect/microsoft-graph", label: "Connect Microsoft Graph" },
        { href: "/grants", label: "My Grants" },
        { href: "/token-access", label: "Token Access" },
      ]}
      onNavigate={navigate}
      kicker="Broker Workspace"
      title="Self-service suite"
      subtitle="Connections, grants, and diagnostics"
    >
      {route.name === "workspace" ? <WorkspacePage /> : null}
      {route.name === "connect" ? <ConnectProviderPage onNavigate={navigate} providerKey={route.params.providerKey} /> : null}
      {route.name === "grants" ? <GrantsPage /> : null}
      {route.name === "tokenAccess" ? <TokenAccessPage /> : null}
    </Shell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AuthenticatedApp />
      <ToastViewport />
    </AppProvider>
  );
}
