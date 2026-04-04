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
  ConfirmModal,
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
  relativeTimeCompact,
  toIsoDateTime,
} from "./utils";

function connectionTone(connection: ConnectedAccountOut): "neutral" | "success" | "warn" | "danger" {
  if (connection.status === "revoked") return "warn";
  if (connection.last_error) return "danger";
  if (connection.status === "connected") return "success";
  return "neutral";
}

function grantState(grant: SelfServiceDelegationGrantOut | DelegationGrantOut): string {
  if (grant.revoked_at) return "Removed";
  if (!grant.is_enabled) return "Off";
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

function grantTone(grant: SelfServiceDelegationGrantOut | DelegationGrantOut): "neutral" | "success" | "warn" | "danger" {
  const state = grantState(grant);
  if (state === "Active") return "success";
  if (state === "Expired") return "danger";
  if (state === "Removed") return "warn";
  return "neutral";
}

function decisionTone(decision: string): "neutral" | "success" | "warn" | "danger" {
  if (decision === "issued" || decision === "relayed") return "success";
  if (decision === "blocked") return "warn";
  if (decision === "error") return "danger";
  return "neutral";
}

function userIssueDecisionLabel(decision: string): string {
  if (decision === "issued") return "Allowed";
  if (decision === "relayed") return "Forwarded";
  if (decision === "blocked") return "Blocked";
  if (decision === "error") return "Error";
  return decision;
}

function friendlyBrokerMessage(raw: string | null | undefined): string {
  const message = (raw ?? "").trim();
  if (!message) return "Something went wrong. Please try again.";
  if (message === "Invalid or expired OAuth state") return "Your Miro sign-in timed out. Start the connection again.";
  if (message === "Missing or expired Miro callback parameters") return "Miro did not return a usable sign-in result. Please try again.";
  if (message === "Miro authorization was denied.") return "Miro sign-in was cancelled before your account could be connected.";
  if (message.includes("did not match expected email")) return "The Miro account did not match the expected user. Sign in with the correct Miro account.";
  if (message.startsWith("miro_token_exchange_failed")) return "Miro accepted the login but we could not finish connecting. Please try again.";
  if (message.startsWith("miro_refresh_failed")) return "We could not refresh your Miro connection. Reconnect the account.";
  if (message.startsWith("token_context_")) return "We reached Miro but could not verify the connection. Try again, or reconnect if it keeps happening.";
  if (message.startsWith("microsoft_graph_refresh_failed")) return "We could not refresh your Microsoft connection. Reconnect the account.";
  if (message.startsWith("graph_me_")) return "We reached Microsoft but could not verify the signed-in account.";
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
  if (mode === "relay") return "Through the app service";
  if (mode === "direct_token") return "Direct connection";
  return mode;
}

function splitConnectionLabel(raw: string): { primary: string; secondary?: string } {
  const t = raw.trim();
  const idx = t.indexOf(" - ");
  if (idx === -1) return { primary: t };
  const primary = t.slice(0, idx).trim();
  const secondary = t.slice(idx + 3).trim();
  if (!secondary) return { primary };
  return { primary, secondary };
}

function grantPolicySummary(grant: SelfServiceDelegationGrantOut): string {
  const sc = grant.scope_ceiling.length;
  const cap = grant.capabilities.length;
  if (sc === 0 && cap === 0) return "Default";
  if (sc > 0 && cap === 0) return sc === 1 ? "1 limit" : `${sc} limits`;
  if (sc === 0 && cap > 0) return "Custom";
  return `${sc} limits + extras`;
}

function GrantConnectionCell({ grant }: { grant: SelfServiceDelegationGrantOut }) {
  if (!grant.connected_account_display_name) {
    return (
      <div className="table-cell-stack">
        <strong className="table-cell-primary">Auto-select</strong>
        <span className="table-cell-secondary muted">Uses matching connection when used</span>
      </div>
    );
  }
  const parts = splitConnectionLabel(grant.connected_account_display_name);
  if (!parts.secondary) {
    return (
      <div className="table-cell-stack">
        <strong className="table-cell-primary">{parts.primary}</strong>
      </div>
    );
  }
  return (
    <div className="table-cell-stack">
      <strong className="table-cell-primary">{parts.primary}</strong>
      <span className="table-cell-secondary muted">{parts.secondary}</span>
    </div>
  );
}

function GrantExpiresCell({ grant }: { grant: SelfServiceDelegationGrantOut }) {
  return (
    <div className="grants-expires-cell">
      <span className="grants-expires-primary">{relativeTimeCompact(grant.expires_at)}</span>
      <span className="grants-expires-secondary muted">
        {grant.expires_at ? formatDateTime(grant.expires_at) : "No expiry"}
      </span>
    </div>
  );
}

function GrantPolicyCell({
  grant,
  onView,
}: {
  grant: SelfServiceDelegationGrantOut;
  onView: () => void;
}) {
  return (
    <div className="grants-policy-cell">
      <span className="grants-policy-summary">{grantPolicySummary(grant)}</span>
      <button type="button" className="ghost-button grants-inline-btn" onClick={onView}>
        View
      </button>
    </div>
  );
}

function GrantDetailPanel({ grant }: { grant: SelfServiceDelegationGrantOut }) {
  return (
    <div className="grant-detail-panel stack-list">
      <div className="stack-cell">
        <strong>App</strong>
        <span>{grant.service_client_display_name ?? "Any app (no name)"}</span>
      </div>
      <div className="stack-cell">
        <strong>Integration</strong>
        <span>{grant.provider_app_display_name}</span>
      </div>
      <div className="stack-cell">
        <strong>Connection</strong>
        <span>{grant.connected_account_display_name ?? "Pick automatically when used"}</span>
      </div>
      <div className="stack-cell">
        <strong>Status</strong>
        <span>
          <StatusBadge tone={grantTone(grant)}>{grantState(grant)}</StatusBadge>
        </span>
      </div>
      <div className="stack-cell">
        <strong>Expires</strong>
        <span>
          {grant.expires_at ? `${formatDateTime(grant.expires_at)} (${relativeTime(grant.expires_at)})` : "No expiry"}
        </span>
      </div>
      <div className="stack-cell">
        <strong>How access works</strong>
        <span>{grant.allowed_access_modes.map((m) => userAccessModeLabel(m)).join(", ")}</span>
      </div>
      <div className="stack-cell">
        <strong>Permission limits</strong>
        <span>{grant.scope_ceiling.length ? grant.scope_ceiling.join(", ") : "Same as the integration"}</span>
      </div>
      <div className="stack-cell">
        <strong>Extra access</strong>
        <span>{grant.capabilities.length ? grant.capabilities.join(", ") : "None"}</span>
      </div>
      {grant.environment ? (
        <div className="stack-cell">
          <strong>Environment</strong>
          <span>{grant.environment}</span>
        </div>
      ) : null}
    </div>
  );
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
        title="Overview"
        description="See how your connected accounts are doing. Open Integrations to connect or disconnect apps."
      />

      <div className="metric-grid workspace-metric-grid">
        <MetricCard
          label="Active connections"
          value={String(connections.filter((c) => c.status === "connected").length)}
          caption="Currently usable accounts"
        />
        <MetricCard label="Integrations available" value={String(connectableCount)} caption="Apps you can connect" />
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
  const [grantRevokeConfirmId, setGrantRevokeConfirmId] = useState<string | null>(null);
  const [grantRevokePending, setGrantRevokePending] = useState(false);
  const [grantDetailId, setGrantDetailId] = useState<string | null>(null);
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
        title: "Could not load app access",
        description: isApiError(error) ? error.message : "Something went wrong while loading.",
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

  const grantRevokeTarget = useMemo(() => {
    if (!grantRevokeConfirmId) return null;
    return grants.find((grant) => grant.id === grantRevokeConfirmId) ?? null;
  }, [grantRevokeConfirmId, grants]);

  const grantDetailGrant = useMemo(() => {
    if (!grantDetailId) return null;
    return grants.find((grant) => grant.id === grantDetailId) ?? null;
  }, [grantDetailId, grants]);

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
      notify({ tone: "success", title: "App access added" });
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
        title: "Could not add app access",
        description: isApiError(error) ? error.message : "Something went wrong while saving.",
      });
    } finally {
      setPending(false);
    }
  };

  const revokeGrant = async (grantId: string) => {
    if (session.status !== "authenticated") return;
    setGrantRevokePending(true);
    try {
      await api.revokeMyDelegationGrant(session.csrfToken, grantId);
      notify({ tone: "info", title: "Access removed" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not remove access",
        description: isApiError(error) ? error.message : "Something went wrong.",
      });
    } finally {
      setGrantRevokePending(false);
      setGrantRevokeConfirmId(null);
    }
  };

  if (loading) return <LoadingScreen label="Loading app access…" />;

  return (
    <>
      <PageIntro
        eyebrow="App access"
        title="Apps that can use your account"
        description="Let other apps use your connected accounts on your behalf. You can add access for a named app or leave the app unset."
        actions={
          <button type="button" className="primary-button" onClick={() => setGrantModalOpen(true)}>
            Add access
          </button>
        }
      />

      {createdResult ? (
        <SecretPanel
          title="Save your connection details"
          body={`Copy this value${
            createdResult.delegation_grant.service_client_display_name
              ? ` for ${createdResult.delegation_grant.service_client_display_name}`
              : ""
          } now. It will not be shown again.`}
          value={createdResult.delegated_credential}
        />
      ) : null}

      <Card title="Your app access" description="Only your entries appear here. Remove access when an app should no longer reach your account.">
        <DataTable
          tableClassName="grants-table"
          wrapClassName="grants-table-wrap"
          columnClasses={[
            "grants-col--client",
            "grants-col--provider",
            "grants-col--conn",
            "grants-col--status",
            "grants-col--exp",
            "grants-col--policy",
            "grants-col--actions",
          ]}
          rowKey={(rowIndex) => grants[rowIndex]?.id ?? rowIndex}
          columns={["App", "Integration", "Connection", "Status", "Expires", "Limits", "Actions"]}
          rows={grants.map((grant) => {
            const clientLabel = grant.service_client_display_name ?? "Any app";
            const providerLabel = grant.provider_app_display_name;
            return [
              <span className="grants-cell-ellipsis" title={clientLabel}>
                {clientLabel}
              </span>,
              <span className="grants-cell-ellipsis" title={providerLabel}>
                {providerLabel}
              </span>,
              <GrantConnectionCell grant={grant} />,
              <StatusBadge tone={grantTone(grant)}>{grantState(grant)}</StatusBadge>,
              <GrantExpiresCell grant={grant} />,
              <GrantPolicyCell grant={grant} onView={() => setGrantDetailId(grant.id)} />,
              <div className="grants-actions-cell">
                {grant.revoked_at ? (
                  <span className="grants-action-placeholder muted" aria-label="No action">
                    —
                  </span>
                ) : (
                  <button type="button" className="ghost-button grants-inline-btn" onClick={() => setGrantRevokeConfirmId(grant.id)}>
                    Remove access
                  </button>
                )}
              </div>,
            ];
          })}
          emptyTitle="No app access yet"
          emptyBody="Connect an integration first, then add access for an app that should use your account."
        />
      </Card>

      {grantDetailId && grantDetailGrant ? (
        <Modal title="Access details" wide onClose={() => setGrantDetailId(null)}>
          <GrantDetailPanel grant={grantDetailGrant} />
        </Modal>
      ) : null}

      {grantModalOpen ? (
        <Modal title="Add app access" wide onClose={() => setGrantModalOpen(false)}>
          <form className="stack-form" onSubmit={handleSubmit}>
            <p className="lede">Optionally choose a specific app. Leave empty to allow any app that is allowed to use this access.</p>
            <div className="form-grid">
              <Field label="App" hint="Optional">
                <select
                  value={form.service_client_key}
                  onChange={(event) => setForm((current) => ({ ...current, service_client_key: event.target.value }))}
                >
                  <option value="">Any app</option>
                  {serviceClients.map((client) => (
                    <option key={client.id} value={client.key}>
                      {client.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Integration">
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
                  <option value="">Choose automatically from active connections</option>
                  {eligibleConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.display_name || connection.external_email || connection.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="How the app connects">
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
              <Field label="Permission limits" hint="Comma or newline separated">
                <textarea
                  value={form.scope_ceiling_text}
                  onChange={(event) => setForm((current) => ({ ...current, scope_ceiling_text: event.target.value }))}
                />
              </Field>
              <Field label="Extra access" hint="Comma or newline separated">
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
                {pending ? "Working…" : "Create access"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {grantRevokeConfirmId ? (
        <ConfirmModal
          title="Remove access"
          confirmLabel="Remove access"
          confirmBusy={grantRevokePending}
          onCancel={() => setGrantRevokeConfirmId(null)}
          onConfirm={() => void revokeGrant(grantRevokeConfirmId)}
        >
          <p className="lede">
            {grantRevokeTarget ? (
              <>
                Apps that used this access for <strong>{grantRevokeTarget.provider_app_display_name}</strong> stop working until you add
                access again.
              </>
            ) : (
              "Apps that used this access stop working until you add access again."
            )}
          </p>
        </ConfirmModal>
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
        title: "Could not load activity",
        description: isApiError(error) ? error.message : "Something went wrong while loading.",
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
        title: result.ok ? "Connection test succeeded" : "Connection test failed",
        description: result.ok ? "We could reach the service using your saved connection." : friendlyBrokerMessage(result.message),
      });
      await load();
      if (result.ok) {
        setProbeModalOpen(false);
      }
    } catch (error) {
      notify({
        tone: "error",
        title: "Connection test failed",
        description: isApiError(error) ? error.message : "Something went wrong.",
      });
    } finally {
      setProbePending(false);
    }
  };

  if (loading) return <LoadingScreen label="Loading activity…" />;

  return (
    <>
      <PageIntro
        eyebrow="Activity"
        title="Recent activity and connection tests"
        description="See what happened when apps used your access. Run a connection test if something looks wrong."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => setFilterModalOpen(true)}>
              Filter activity
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
        <Card title="Last connection test" description="This checks that we can reach the service with your saved connection. It does not show private sign-in data.">
          <div className="stack-list">
            <div className="stack-cell">
              <strong>Status</strong>
              <span>{probeResult.ok ? "Connection OK" : friendlyBrokerMessage(probeResult.message)}</span>
            </div>
            <div className="stack-cell">
              <strong>Checked</strong>
              <span>{formatDateTime(probeResult.checked_at)}</span>
            </div>
            <div className="stack-cell">
              <strong>Account</strong>
              <span>{probeResult.external_user_name || probeResult.external_user_id || "Not returned"}</span>
            </div>
          </div>
        </Card>
      ) : null}

      <Card title="Access activity" description="Read-only list of how apps used your app access.">
        <DataTable
          columns={["Time", "App", "Access entry", "Integration", "Result", "Permissions", "Details"]}
          rows={filteredIssues.map((issue) => [
            formatDateTime(issue.created_at),
            issue.service_client_display_name ?? issue.service_client_id ?? "Unknown",
            issue.delegation_grant_id ?? "Unknown",
            issue.provider_app_display_name ?? issue.provider_app_id ?? "Unknown",
            <StatusBadge key={issue.id} tone={decisionTone(issue.decision)}>
              {issue.reason
                ? `${userIssueDecisionLabel(issue.decision)}: ${friendlyBrokerMessage(issue.reason)}`
                : userIssueDecisionLabel(issue.decision)}
            </StatusBadge>,
            issue.scopes.length ? issue.scopes.join(", ") : "Default",
            <pre className="audit-metadata" key={`${issue.id}-metadata`}>
              {JSON.stringify(issue.metadata, null, 2)}
            </pre>,
          ])}
          emptyTitle="No activity yet"
          emptyBody="When an app uses your app access, a row appears here."
        />
      </Card>

      {filterModalOpen ? (
        <Modal title="Filter activity" onClose={() => setFilterModalOpen(false)}>
          <div className="stack-form">
            <Field label="App">
              <select value={serviceClientFilter} onChange={(event) => setServiceClientFilter(event.target.value)}>
                <option value="">All apps</option>
                {serviceClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="App access">
              <select value={grantFilter} onChange={(event) => setGrantFilter(event.target.value)}>
                <option value="">All entries</option>
                {grants.map((grant) => (
                  <option key={grant.id} value={grant.id}>
                    {(grant.service_client_display_name ?? "Any app") + " · " + grant.provider_app_display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Result">
              <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}>
                <option value="">All results</option>
                <option value="issued">Allowed</option>
                <option value="relayed">Forwarded</option>
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
                {probePending ? "Testing…" : "Run test"}
              </button>
            </div>
            {probeResult ? (
              <div className="stack-list">
                <div className="stack-cell">
                  <strong>Status</strong>
                  <span>{probeResult.ok ? "Connection OK" : friendlyBrokerMessage(probeResult.message)}</span>
                </div>
                <div className="stack-cell">
                  <strong>Checked</strong>
                  <span>{formatDateTime(probeResult.checked_at)}</span>
                </div>
                <div className="stack-cell">
                  <strong>Account</strong>
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
      <Card title="Page not found" description="This address is not available in this app.">
        <EmptyState
          title="Unknown page"
          body="Use the menu to open a supported page."
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
  { href: "/grants", label: "App access" },
  { href: "/token-access", label: "Activity" },
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
        description: "You are signed in.",
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
        description: connectedAccountId ? `Your connection ${connectedAccountId} is ready in your workspace.` : "Your Miro account is now connected.",
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
            : "Connected",
        description: connectedAccountId ? `Your connection ${connectedAccountId} is ready in your workspace.` : "Your account is now connected.",
      });
    }

    if (providerStatus === "error" && onIntegrationsReturn) {
      notify({
        tone: "error",
        title:
          route.name === "connect"
            ? `${providerRouteLabel(route.params.providerKey)} connect failed`
            : "Connection failed",
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
    return <LoadingScreen label="Restoring your session…" />;
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
        kicker="Workspace"
        title="Your account"
        subtitle="Connections, app access, and activity"
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
      kicker="Workspace"
      title="Your account"
      subtitle="Connections, app access, and activity"
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
