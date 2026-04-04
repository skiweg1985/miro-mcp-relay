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
import { ThemeToggle } from "./theme-toggle";
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
  LoadingScreen,
  Modal,
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
import { UserIntegrationsPage } from "./UserIntegrationsPage";
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

function isWorkspaceSelfServiceRoute(route: RouteMatch): boolean {
  if (
    route.name === "workspace" ||
    route.name === "workspaceIntegrations" ||
    route.name === "grants" ||
    route.name === "tokenAccess"
  ) {
    return true;
  }
  if (route.name === "connect" && templateKeyForRoute(route.params.providerKey)) {
    return true;
  }
  return false;
}

function userAccessModeLabel(mode: string): string {
  if (mode === "relay") return "Proxy path";
  if (mode === "direct_token") return "Direct token";
  return mode;
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
          <ThemeToggle className="landing-theme-toggle" id="landing-theme" />
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
          <ThemeToggle id="shell-theme" />
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

function WorkspacePage() {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    void Promise.all([api.providerAppsForUser(), api.myConnections()])
      .then(([providerAppData, connectionData]) => {
        setProviderApps(providerAppData);
        setConnections(connectionData);
      })
      .catch((error) =>
        notify({
          tone: "error",
          title: "Failed to load workspace",
          description: isApiError(error) ? error.message : "Unexpected workspace loading error.",
        }),
      )
      .finally(() => setLoading(false));
  }, [notify, session]);

  if (loading) return <LoadingScreen label="Loading your workspace..." />;

  const connectableCount = providerApps.filter((app) => app.template_key && app.template_key !== "microsoft-broker-login").length;

  return (
    <>
      <PageIntro
        eyebrow="Workspace"
        title="Your broker workspace"
        description="Review connection health at a glance. Use Integrations to connect or disconnect provider accounts."
      />

      <div className="metric-grid workspace-metric-grid">
        <MetricCard
          label="Active connections"
          value={String(connections.filter((c) => c.status === "connected").length)}
          caption="Currently usable accounts"
        />
        <MetricCard label="Integrations available" value={String(connectableCount)} caption="Published provider apps" />
        <MetricCard
          label="Attention"
          value={String(connections.filter((c) => Boolean(c.last_error)).length)}
          caption="Connections with stored issues"
        />
        <MetricCard label="Workspace status" value="Ready" caption="Self-service is active" />
      </div>
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
  const [grantModalOpen, setGrantModalOpen] = useState(false);
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
      setGrantModalOpen(false);
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
        actions={
          <button type="button" className="primary-button" onClick={() => setGrantModalOpen(true)}>
            New grant
          </button>
        }
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

      {grantModalOpen ? (
        <Modal title="New grant" wide onClose={() => setGrantModalOpen(false)}>
          <form className="stack-form" onSubmit={handleSubmit}>
            <p className="lede">Optionally pick a service client for governance. Leave unset to rely on the delegated credential alone.</p>
            <div className="form-grid">
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
            </div>
            <div className="modal-form-actions">
              <button type="button" className="ghost-button" onClick={() => setGrantModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={pending}>
                {pending ? "Working…" : "Create delegated credential"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
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
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [probeModalOpen, setProbeModalOpen] = useState(false);

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
      if (!connectionData.length) {
        setProbeResult(null);
      }
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
      if (result.ok) {
        setProbeModalOpen(false);
      }
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
            <button type="button" className="ghost-button" onClick={() => setFilterModalOpen(true)}>
              Filter history
            </button>
            <button type="button" className="ghost-button" onClick={() => setProbeModalOpen(true)}>
              Test connection
            </button>
            <button type="button" className="ghost-button" onClick={() => void load()}>
              Reload
            </button>
          </div>
        }
      />

      {probeResult ? (
        <Card title="Latest probe" description="The probe checks broker-to-provider access and never exposes raw access tokens.">
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
        </Card>
      ) : null}

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

      {filterModalOpen ? (
        <Modal title="Filter history" onClose={() => setFilterModalOpen(false)}>
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
          <div className="modal-form-actions">
            <button type="button" className="primary-button" onClick={() => setFilterModalOpen(false)}>
              Done
            </button>
          </div>
        </Modal>
      ) : null}

      {probeModalOpen ? (
        <Modal title="Test connection" onClose={() => setProbeModalOpen(false)}>
          <div className="stack-form">
            <Field label="Connection">
              <select value={probeConnectionId} onChange={(event) => setProbeConnectionId(event.target.value)}>
                {connections.length ? (
                  connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.display_name || connection.external_email || connection.id}
                    </option>
                  ))
                ) : (
                  <option value="">No connections</option>
                )}
              </select>
            </Field>
            <div className="inline-actions">
              <button type="button" className="primary-button" disabled={probePending || !probeConnectionId} onClick={() => void runProbe()}>
                {probePending ? "Probing…" : "Run probe"}
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
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" onClick={() => setProbeModalOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}
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

const USER_WORKSPACE_NAV = [
  { href: "/workspace", label: "Workspace" },
  { href: "/workspace/integrations", label: "Integrations" },
  { href: "/grants", label: "My Grants" },
  { href: "/token-access", label: "Token Access" },
];

function AuthenticatedApp() {
  const { route, navigate } = usePathname();
  const { notify, session } = useAppContext();

  useEffect(() => {
    if (session.status !== "authenticated") return;
    if (route.name !== "connect") return;
    if (!templateKeyForRoute(route.params.providerKey)) return;
    navigate(`/workspace/integrations${window.location.search}`);
  }, [session.status, route, navigate]);

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

    const onIntegrationsReturn =
      route.name === "workspaceIntegrations" || route.name === "connect" || route.name === "workspace";

    if (providerStatus === "connected" && onIntegrationsReturn) {
      notify({
        tone: "success",
        title:
          route.name === "connect"
            ? `${providerRouteLabel(route.params.providerKey)} connected`
            : "Provider connected",
        description: connectedAccountId ? `Connection ${connectedAccountId} is now available in your workspace.` : "Your provider account is now connected.",
      });
    }

    if (providerStatus === "error" && onIntegrationsReturn) {
      notify({
        tone: "error",
        title:
          route.name === "connect"
            ? `${providerRouteLabel(route.params.providerKey)} connect failed`
            : "Provider connect failed",
        description: friendlyMessage,
      });
    }

    if (!miroSetup) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [notify, route.path, route.name, session.status]);

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

  if (route.name === "connect" && templateKeyForRoute(route.params.providerKey)) {
    return <LoadingScreen label="Opening integrations…" />;
  }

  const userWorkspaceMain = (
    <>
      {route.name === "workspace" ? <WorkspacePage /> : null}
      {route.name === "workspaceIntegrations" ? <UserIntegrationsPage /> : null}
      {route.name === "grants" ? <GrantsPage /> : null}
      {route.name === "tokenAccess" ? <TokenAccessPage /> : null}
    </>
  );

  if (session.user.is_admin && isWorkspaceSelfServiceRoute(route)) {
    if (route.name === "notFound") {
      return <NotFoundPage onNavigate={navigate} fallbackPath="/workspace" />;
    }

    return (
      <Shell
        currentPath={route.path}
        navItems={USER_WORKSPACE_NAV}
        onNavigate={navigate}
        kicker="Broker Workspace"
        title="Self-service suite"
        subtitle="Connections, grants, and diagnostics"
      >
        {userWorkspaceMain}
      </Shell>
    );
  }

  if (session.user.is_admin) {
    if (route.name === "notFound") {
      return <NotFoundPage onNavigate={navigate} fallbackPath="/app" />;
    }

    return (
      <Shell
        currentPath={route.path}
        navItems={[
          { href: "/workspace", label: "Workspace" },
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
      navItems={USER_WORKSPACE_NAV}
      onNavigate={navigate}
      kicker="Broker Workspace"
      title="Self-service suite"
      subtitle="Connections, grants, and diagnostics"
    >
      {userWorkspaceMain}
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
