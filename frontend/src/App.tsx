import { startTransition, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { AppProvider, useAppContext } from "./app-context";
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
  ApiError,
  AuditEventOut,
  ConnectedAccountFormValues,
  ConnectedAccountOut,
  ConnectionProbeResult,
  DelegationGrantCreateResult,
  DelegationGrantFormValues,
  DelegationGrantOut,
  Health,
  ProviderAppFormValues,
  ProviderAppOut,
  ProviderDefinitionOut,
  ProviderInstanceFormValues,
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
import {
  formatDateTime,
  formatJson,
  matchesRoute,
  parseLines,
  relativeTime,
  toIsoDateTime,
} from "./utils";

function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && "message" in error;
}

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
  return message;
}

function usePathname() {
  const [route, setRoute] = useState<RouteMatch>(() => matchesRoute(window.location.pathname));

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
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("change-me-admin-password");
  const [pending, setPending] = useState(false);
  const [microsoftPending, setMicrosoftPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      await login(email, password);
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
    <main className="login-layout">
      <section className="hero-card login-hero">
        <p className="eyebrow">OAuth Broker</p>
        <h1>End-user workspace for brokered connections, grants, and access diagnostics.</h1>
        <p className="lede">
          Users sign in with Microsoft, connect Miro, create their own delegated credentials for approved service
          clients, and inspect token access without ever seeing raw secrets.
        </p>
        <div className="hero-chip-row">
          <StatusBadge tone="success">Microsoft user login</StatusBadge>
          <StatusBadge tone="success">Miro self-service connect</StatusBadge>
          <StatusBadge tone="success">Grant and probe workflows</StatusBadge>
        </div>
      </section>

      <section className="login-panel">
        <div className="auth-card-list">
          <Card
            title="User sign-in"
            description="Primary end-user entry point. The backend creates or links your broker account on the Microsoft callback."
          >
            <div className="stack-form">
              <p className="lede">
                Use your Microsoft identity to enter the workspace, manage your own provider connections, and create
                grants for approved broker consumers.
              </p>
              <div className="inline-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={microsoftPending}
                  onClick={() => void handleMicrosoftLogin()}
                >
                  {microsoftPending ? "Redirecting..." : "Continue with Microsoft"}
                </button>
              </div>
            </div>
          </Card>

          <Card title="Admin local login" description="Operator-only path for the control deck and platform governance.">
            <form className="stack-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                <Field label="Email">
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
                </Field>
                <Field label="Password">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    required
                  />
                </Field>
              </div>
              <FormActions pending={pending} submitLabel="Sign in as admin" />
            </form>
          </Card>
        </div>
      </section>
    </main>
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

function DashboardPage() {
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
          title: "Failed to load dashboard",
          description: isApiError(error) ? error.message : "Unexpected dashboard error.",
        });
      })
      .finally(() => setLoading(false));
  }, [notify, session]);

  if (loading) return <LoadingScreen label="Loading broker overview..." />;

  return (
    <>
      <PageIntro
        eyebrow="Overview"
        title="Operate the broker from one place"
        description="Track the current platform footprint, then dive into providers, connections, service clients, delegation grants, and audit events without leaving the control deck."
      />
      <div className="metric-grid">
        <MetricCard label="Backend status" value={health?.ok ? "Online" : "Unavailable"} caption={health?.service ?? "Health unknown"} />
        <MetricCard label="Provider apps" value={String(providerApps.length)} caption="Configured downstream apps" />
        <MetricCard label="Connected accounts" value={String(connections.length)} caption="Stored delegated identities" />
        <MetricCard label="Service clients" value={String(serviceClients.length)} caption="Trusted broker consumers" />
        <MetricCard label="Delegation grants" value={String(grants.length)} caption="Active service permissions" />
      </div>

      <Card title="Recent audit activity" description="A quick pulse of the latest broker operations.">
        <DataTable
          columns={["Time", "Action", "Actor", "Metadata"]}
          rows={audit.map((event) => [
            formatDateTime(event.created_at),
            event.action,
            event.actor_type,
            <code className="inline-code" key={event.id}>
              {formatJson(event.metadata_json)}
            </code>,
          ])}
          emptyTitle="No audit events yet"
          emptyBody="Once actions happen in the broker, the latest items will surface here."
        />
      </Card>
    </>
  );
}

function ProvidersPage() {
  const { notify, session } = useAppContext();
  const [definitions, setDefinitions] = useState<ProviderDefinitionOut[]>([]);
  const [instances, setInstances] = useState<ProviderInstanceOut[]>([]);
  const [apps, setApps] = useState<ProviderAppOut[]>([]);
  const [pendingInstance, setPendingInstance] = useState(false);
  const [pendingApp, setPendingApp] = useState(false);
  const [instanceForm, setInstanceForm] = useState<ProviderInstanceFormValues>({
    key: "",
    display_name: "",
    provider_definition_key: "miro",
    role: "downstream_oauth",
    issuer: "",
    authorization_endpoint: "",
    token_endpoint: "",
    userinfo_endpoint: "",
    is_enabled: true,
  });
  const [appForm, setAppForm] = useState<ProviderAppFormValues>({
    provider_instance_key: "",
    key: "",
    display_name: "",
    client_id: "",
    client_secret: "",
    redirect_uris_text: "",
    default_scopes_text: "",
    scope_ceiling_text: "",
    access_mode: "relay",
    allow_relay: true,
    allow_direct_token_return: false,
    relay_protocol: "",
    is_enabled: true,
  });

  const load = async () => {
    if (session.status !== "authenticated") return;
    const [definitionData, instanceData, appData] = await Promise.all([
      api.providerDefinitions(),
      api.providerInstances(session.csrfToken),
      api.providerApps(session.csrfToken),
    ]);
    setDefinitions(definitionData);
    setInstances(instanceData);
    setApps(appData);
    setAppForm((current) => ({
      ...current,
      provider_instance_key: current.provider_instance_key || instanceData[0]?.key || "",
    }));
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Failed to load providers",
        description: isApiError(error) ? error.message : "Unexpected provider loading error.",
      }),
    );
  }, [notify, session]);

  const handleCreateInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPendingInstance(true);
    try {
      await api.createProviderInstance(session.csrfToken, {
        ...instanceForm,
        issuer: instanceForm.issuer || null,
        authorization_endpoint: instanceForm.authorization_endpoint || null,
        token_endpoint: instanceForm.token_endpoint || null,
        userinfo_endpoint: instanceForm.userinfo_endpoint || null,
      });
      notify({ tone: "success", title: "Provider instance created" });
      setInstanceForm({
        key: "",
        display_name: "",
        provider_definition_key: instanceForm.provider_definition_key,
        role: instanceForm.role,
        issuer: "",
        authorization_endpoint: "",
        token_endpoint: "",
        userinfo_endpoint: "",
        is_enabled: true,
      });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Provider instance failed",
        description: isApiError(error) ? error.message : "Unexpected provider instance error.",
      });
    } finally {
      setPendingInstance(false);
    }
  };

  const handleCreateApp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPendingApp(true);
    try {
      await api.createProviderApp(session.csrfToken, {
        provider_instance_key: appForm.provider_instance_key,
        key: appForm.key,
        display_name: appForm.display_name,
        client_id: appForm.client_id || null,
        client_secret: appForm.client_secret || null,
        redirect_uris: parseLines(appForm.redirect_uris_text),
        default_scopes: parseLines(appForm.default_scopes_text),
        scope_ceiling: parseLines(appForm.scope_ceiling_text),
        access_mode: appForm.access_mode,
        allow_relay: appForm.allow_relay,
        allow_direct_token_return: appForm.allow_direct_token_return,
        relay_protocol: appForm.relay_protocol || null,
        is_enabled: appForm.is_enabled,
      });
      notify({ tone: "success", title: "Provider app created" });
      setAppForm((current) => ({
        ...current,
        key: "",
        display_name: "",
        client_id: "",
        client_secret: "",
        redirect_uris_text: "",
        default_scopes_text: "",
        scope_ceiling_text: "",
        relay_protocol: "",
        is_enabled: true,
      }));
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Provider app failed",
        description: isApiError(error) ? error.message : "Unexpected provider app error.",
      });
    } finally {
      setPendingApp(false);
    }
  };

  const instanceLabelById = useMemo(
    () => Object.fromEntries(instances.map((instance) => [instance.id, instance.display_name])),
    [instances],
  );

  return (
    <>
      <PageIntro
        eyebrow="Providers"
        title="Shape downstream access policy"
        description="Configure broker-aware provider instances and the apps that define relay policy, token return rules, and scope ceilings."
      />

      <div className="two-column">
        <Card title="Provider definitions" description="Seeded provider families currently known to the broker.">
          <DataTable
            columns={["Name", "Protocol", "Broker auth", "Downstream OAuth"]}
            rows={definitions.map((definition) => [
              definition.display_name,
              definition.protocol,
              definition.supports_broker_auth ? "Yes" : "No",
              definition.supports_downstream_oauth ? "Yes" : "No",
            ])}
            emptyTitle="No provider definitions"
            emptyBody="Definitions should appear once the backend seed runs."
          />
        </Card>

        <Card title="Create provider instance" description="Register a concrete identity or downstream OAuth surface inside your organization.">
          <InlineForm
            title="New instance"
            description="Use a stable key; future apps and flows will reference it."
            onSubmit={handleCreateInstance}
          >
            <Field label="Definition">
              <select
                value={instanceForm.provider_definition_key}
                onChange={(event) =>
                  setInstanceForm((current) => ({ ...current, provider_definition_key: event.target.value }))
                }
              >
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.key}>
                    {definition.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Key">
              <input
                value={instanceForm.key}
                onChange={(event) => setInstanceForm((current) => ({ ...current, key: event.target.value }))}
                required
              />
            </Field>
            <Field label="Display name">
              <input
                value={instanceForm.display_name}
                onChange={(event) => setInstanceForm((current) => ({ ...current, display_name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Role">
              <select
                value={instanceForm.role}
                onChange={(event) => setInstanceForm((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="downstream_oauth">Downstream OAuth</option>
                <option value="broker_auth">Broker auth</option>
              </select>
            </Field>
            <Field label="Issuer">
              <input
                value={instanceForm.issuer}
                onChange={(event) => setInstanceForm((current) => ({ ...current, issuer: event.target.value }))}
                placeholder="https://login.example.com"
              />
            </Field>
            <Field label="Authorization endpoint">
              <input
                value={instanceForm.authorization_endpoint}
                onChange={(event) =>
                  setInstanceForm((current) => ({ ...current, authorization_endpoint: event.target.value }))
                }
                placeholder="https://..."
              />
            </Field>
            <Field label="Token endpoint">
              <input
                value={instanceForm.token_endpoint}
                onChange={(event) => setInstanceForm((current) => ({ ...current, token_endpoint: event.target.value }))}
                placeholder="https://..."
              />
            </Field>
            <Field label="Userinfo endpoint">
              <input
                value={instanceForm.userinfo_endpoint}
                onChange={(event) =>
                  setInstanceForm((current) => ({ ...current, userinfo_endpoint: event.target.value }))
                }
                placeholder="https://..."
              />
            </Field>
            <Field label="Enabled">
              <input
                checked={instanceForm.is_enabled}
                onChange={(event) => setInstanceForm((current) => ({ ...current, is_enabled: event.target.checked }))}
                type="checkbox"
              />
            </Field>
            <FormActions pending={pendingInstance} submitLabel="Create instance" />
          </InlineForm>
        </Card>
      </div>

      <Card title="Provider instances" description="Current organization-specific provider surfaces.">
        <DataTable
          columns={["Name", "Instance key", "Role", "Issuer", "Status"]}
          rows={instances.map((instance) => [
            instance.display_name,
            instance.key,
            instance.role,
            instance.issuer ?? "Not set",
            <StatusBadge key={instance.id} tone={instance.is_enabled ? "success" : "warn"}>
              {instance.is_enabled ? "Enabled" : "Disabled"}
            </StatusBadge>,
          ])}
          emptyTitle="No provider instances"
          emptyBody="Create your first provider instance to start shaping provider policy."
        />
      </Card>

      <div className="two-column">
        <Card title="Provider apps" description="Downstream applications with relay and token-return policy.">
          <DataTable
            columns={["Name", "Instance", "Mode", "Relay", "Direct token"]}
            rows={apps.map((app) => [
              app.display_name,
              instanceLabelById[app.provider_instance_id] ?? app.provider_instance_id,
              app.access_mode,
              app.allow_relay ? "Yes" : "No",
              app.allow_direct_token_return ? "Yes" : "No",
            ])}
            emptyTitle="No provider apps"
            emptyBody="Create provider apps to make downstream access policy visible to operators."
          />
        </Card>

        <Card title="Create provider app" description="Set access mode, relay capability, scope defaults, and redirect topology.">
          <InlineForm
            title="New provider app"
            description="Provider apps are the policy surface the broker evaluates during token issuance and relayed access."
            onSubmit={handleCreateApp}
          >
            <Field label="Provider instance">
              <select
                value={appForm.provider_instance_key}
                onChange={(event) => setAppForm((current) => ({ ...current, provider_instance_key: event.target.value }))}
              >
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.key}>
                    {instance.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Key">
              <input value={appForm.key} onChange={(event) => setAppForm((current) => ({ ...current, key: event.target.value }))} required />
            </Field>
            <Field label="Display name">
              <input
                value={appForm.display_name}
                onChange={(event) => setAppForm((current) => ({ ...current, display_name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Client ID">
              <input
                value={appForm.client_id}
                onChange={(event) => setAppForm((current) => ({ ...current, client_id: event.target.value }))}
              />
            </Field>
            <Field label="Client secret">
              <input
                value={appForm.client_secret}
                onChange={(event) => setAppForm((current) => ({ ...current, client_secret: event.target.value }))}
              />
            </Field>
            <Field label="Redirect URIs" hint="Comma or newline separated">
              <textarea
                value={appForm.redirect_uris_text}
                onChange={(event) => setAppForm((current) => ({ ...current, redirect_uris_text: event.target.value }))}
              />
            </Field>
            <Field label="Default scopes" hint="Comma or newline separated">
              <textarea
                value={appForm.default_scopes_text}
                onChange={(event) => setAppForm((current) => ({ ...current, default_scopes_text: event.target.value }))}
              />
            </Field>
            <Field label="Scope ceiling" hint="Comma or newline separated">
              <textarea
                value={appForm.scope_ceiling_text}
                onChange={(event) => setAppForm((current) => ({ ...current, scope_ceiling_text: event.target.value }))}
              />
            </Field>
            <Field label="Access mode">
              <select
                value={appForm.access_mode}
                onChange={(event) => setAppForm((current) => ({ ...current, access_mode: event.target.value }))}
              >
                <option value="relay">Relay</option>
                <option value="direct_token">Direct token</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </Field>
            <Field label="Relay protocol">
              <input
                value={appForm.relay_protocol}
                onChange={(event) => setAppForm((current) => ({ ...current, relay_protocol: event.target.value }))}
                placeholder="mcp_streamable_http"
              />
            </Field>
            <Field label="Allow relay">
              <input
                checked={appForm.allow_relay}
                onChange={(event) => setAppForm((current) => ({ ...current, allow_relay: event.target.checked }))}
                type="checkbox"
              />
            </Field>
            <Field label="Allow direct token return">
              <input
                checked={appForm.allow_direct_token_return}
                onChange={(event) =>
                  setAppForm((current) => ({ ...current, allow_direct_token_return: event.target.checked }))
                }
                type="checkbox"
              />
            </Field>
            <Field label="Enabled">
              <input
                checked={appForm.is_enabled}
                onChange={(event) => setAppForm((current) => ({ ...current, is_enabled: event.target.checked }))}
                type="checkbox"
              />
            </Field>
            <FormActions pending={pendingApp} submitLabel="Create provider app" />
          </InlineForm>
        </Card>
      </div>
    </>
  );
}

function AdminConnectionsPage() {
  const { notify, session } = useAppContext();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [probeResult, setProbeResult] = useState<ConnectionProbeResult | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [pending, setPending] = useState(false);
  const [filters, setFilters] = useState({
    userEmail: "",
    providerAppKey: "",
    status: "",
  });
  const [form, setForm] = useState<ConnectedAccountFormValues>({
    user_email: "",
    provider_app_key: "",
    external_account_ref: "",
    external_email: "",
    display_name: "",
    consented_scopes_text: "",
    access_token: "",
    refresh_token: "",
    token_type: "Bearer",
    expires_at: "",
    refresh_expires_at: "",
  });

  const load = async () => {
    if (session.status !== "authenticated") return;
    const [userData, providerAppData, connectionData] = await Promise.all([
      api.adminUsers(session.csrfToken),
      api.providerApps(session.csrfToken),
      api.filteredConnectedAccounts(session.csrfToken, filters),
    ]);
    setUsers(userData);
    setProviderApps(providerAppData);
    setConnections(connectionData);
    setForm((current) => ({
      ...current,
      user_email: current.user_email || userData[0]?.email || "",
      provider_app_key: current.provider_app_key || providerAppData[0]?.key || "",
    }));
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Failed to load connections",
        description: isApiError(error) ? error.message : "Unexpected connection loading error.",
      }),
    );
  }, [notify, session]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Failed to apply connection filters",
        description: isApiError(error) ? error.message : "Unexpected connection filter error.",
      }),
    );
  }, [filters, notify, session]);

  const runAction = async (actionKey: string, action: () => Promise<void>) => {
    setBusyAction(actionKey);
    try {
      await action();
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      await api.createConnectedAccount(session.csrfToken, {
        user_email: form.user_email,
        provider_app_key: form.provider_app_key,
        external_account_ref: form.external_account_ref || null,
        external_email: form.external_email || null,
        display_name: form.display_name || null,
        consented_scopes: parseLines(form.consented_scopes_text),
        access_token: form.access_token,
        refresh_token: form.refresh_token || null,
        token_type: form.token_type || "Bearer",
        expires_at: toIsoDateTime(form.expires_at),
        refresh_expires_at: toIsoDateTime(form.refresh_expires_at),
      });
      notify({ tone: "success", title: "Connected account stored" });
      setForm((current) => ({
        ...current,
        external_account_ref: "",
        external_email: "",
        display_name: "",
        consented_scopes_text: "",
        access_token: "",
        refresh_token: "",
        token_type: "Bearer",
        expires_at: "",
        refresh_expires_at: "",
      }));
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Connected account failed",
        description: isApiError(error) ? error.message : "Unexpected connected-account error.",
      });
    } finally {
      setPending(false);
    }
  };

  const handleRefresh = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runAction(`refresh:${connectionId}`, async () => {
      await api.refreshConnection(session.csrfToken, connectionId);
      notify({ tone: "success", title: "Connected account refreshed" });
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
        description: result.ok ? "The broker could still reach the provider with the stored credentials." : friendlyBrokerMessage(result.message),
      });
      await load();
    });
  };

  const handleRevoke = async (connectionId: string) => {
    if (session.status !== "authenticated") return;
    await runAction(`revoke:${connectionId}`, async () => {
      await api.revokeConnection(session.csrfToken, connectionId);
      notify({ tone: "info", title: "Connected account revoked" });
      await load();
    });
  };

  const userById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const appById = useMemo(() => Object.fromEntries(providerApps.map((app) => [app.id, app])), [providerApps]);

  return (
    <>
      <PageIntro
        eyebrow="Connections"
        title="Store and inspect delegated account state"
        description="Manage connected accounts as an operator surface: filter the broker-held inventory, test live credentials, and fall back to manual bootstrap only when migration or recovery requires it."
      />
      <div className="two-column">
        <Card title="Connected accounts" description="Current broker-held identities, filterable by user, provider app, and lifecycle state.">
          <div className="filter-row">
            <Field label="User">
              <select value={filters.userEmail} onChange={(event) => setFilters((current) => ({ ...current, userEmail: event.target.value }))}>
                <option value="">All users</option>
                {users.map((user) => (
                  <option key={user.id} value={user.email}>
                    {user.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Provider app">
              <select value={filters.providerAppKey} onChange={(event) => setFilters((current) => ({ ...current, providerAppKey: event.target.value }))}>
                <option value="">All provider apps</option>
                {providerApps.map((app) => (
                  <option key={app.id} value={app.key}>
                    {app.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="">All states</option>
                <option value="connected">Connected</option>
                <option value="revoked">Revoked</option>
              </select>
            </Field>
          </div>
          <DataTable
            columns={["User", "Provider app", "Account", "Connected", "Status", "Last error", "Actions"]}
            rows={connections.map((connection) => [
              userById[connection.user_id]?.email ?? connection.user_id,
              appById[connection.provider_app_id]?.display_name ?? connection.provider_app_id,
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
                  disabled={busyAction === `refresh:${connection.id}`}
                  onClick={() => void handleRefresh(connection.id)}
                >
                  {busyAction === `refresh:${connection.id}` ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busyAction === `probe:${connection.id}`}
                  onClick={() => void handleProbe(connection.id)}
                >
                  {busyAction === `probe:${connection.id}` ? "Probing..." : "Probe"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busyAction === `revoke:${connection.id}`}
                  onClick={() => void handleRevoke(connection.id)}
                >
                  {busyAction === `revoke:${connection.id}` ? "Revoking..." : "Revoke"}
                </button>
              </div>,
            ])}
            emptyTitle="No connected accounts"
            emptyBody="Adjust the filters or use the fallback bootstrap form if you still need to seed a first broker-held account."
          />
        </Card>
        <Card title="Manual connection bootstrap" description="Fallback path for migration and recovery when a self-service or refresh path is not available.">
          <InlineForm
            title="New connected account"
            description="This stores provider token material in the broker directly. Prefer normal end-user connect whenever possible."
            onSubmit={handleSubmit}
          >
            <Field label="User email">
              <>
                <input
                  list="user-emails"
                  value={form.user_email}
                  onChange={(event) => setForm((current) => ({ ...current, user_email: event.target.value }))}
                  required
                />
                <datalist id="user-emails">
                  {users.map((user) => (
                    <option key={user.id} value={user.email} />
                  ))}
                </datalist>
              </>
            </Field>
            <Field label="Provider app">
              <select
                value={form.provider_app_key}
                onChange={(event) => setForm((current) => ({ ...current, provider_app_key: event.target.value }))}
              >
                {providerApps.map((app) => (
                  <option key={app.id} value={app.key}>
                    {app.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Display name">
              <input
                value={form.display_name}
                onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
              />
            </Field>
            <Field label="External account ref">
              <input
                value={form.external_account_ref}
                onChange={(event) => setForm((current) => ({ ...current, external_account_ref: event.target.value }))}
              />
            </Field>
            <Field label="External email">
              <input
                value={form.external_email}
                onChange={(event) => setForm((current) => ({ ...current, external_email: event.target.value }))}
                type="email"
              />
            </Field>
            <Field label="Consented scopes" hint="Comma or newline separated">
              <textarea
                value={form.consented_scopes_text}
                onChange={(event) => setForm((current) => ({ ...current, consented_scopes_text: event.target.value }))}
              />
            </Field>
            <Field label="Access token">
              <textarea
                value={form.access_token}
                onChange={(event) => setForm((current) => ({ ...current, access_token: event.target.value }))}
                required
              />
            </Field>
            <Field label="Refresh token">
              <textarea
                value={form.refresh_token}
                onChange={(event) => setForm((current) => ({ ...current, refresh_token: event.target.value }))}
              />
            </Field>
            <Field label="Token type">
              <input
                value={form.token_type}
                onChange={(event) => setForm((current) => ({ ...current, token_type: event.target.value }))}
              />
            </Field>
            <Field label="Access token expiry">
              <input
                value={form.expires_at}
                onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value }))}
                type="datetime-local"
              />
            </Field>
            <Field label="Refresh token expiry">
              <input
                value={form.refresh_expires_at}
                onChange={(event) => setForm((current) => ({ ...current, refresh_expires_at: event.target.value }))}
                type="datetime-local"
              />
            </Field>
            <FormActions pending={pending} submitLabel="Store connected account" />
          </InlineForm>
        </Card>
      </div>
      {probeResult ? (
        <Card title="Latest probe result" description="Operator-facing result from the most recent admin probe action.">
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
    </>
  );
}

function ServiceClientsPage() {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [clients, setClients] = useState<ServiceClientOut[]>([]);
  const [pending, setPending] = useState(false);
  const [createdResult, setCreatedResult] = useState<ServiceClientCreateResult | null>(null);
  const [form, setForm] = useState<ServiceClientFormValues>({
    key: "",
    display_name: "",
    environment: "",
    allowed_provider_app_keys: [],
  });

  const load = async () => {
    if (session.status !== "authenticated") return;
    const [providerAppData, clientData] = await Promise.all([
      api.providerApps(session.csrfToken),
      api.serviceClients(session.csrfToken),
    ]);
    setProviderApps(providerAppData);
    setClients(clientData);
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Failed to load service clients",
        description: isApiError(error) ? error.message : "Unexpected service-client loading error.",
      }),
    );
  }, [notify, session]);

  const toggleProviderApp = (providerAppKey: string) => {
    setForm((current) => ({
      ...current,
      allowed_provider_app_keys: current.allowed_provider_app_keys.includes(providerAppKey)
        ? current.allowed_provider_app_keys.filter((key) => key !== providerAppKey)
        : [...current.allowed_provider_app_keys, providerAppKey],
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      const result = await api.createServiceClient(session.csrfToken, form);
      setCreatedResult(result);
      setForm({
        key: "",
        display_name: "",
        environment: "",
        allowed_provider_app_keys: [],
      });
      notify({ tone: "success", title: "Service client created" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Service client failed",
        description: isApiError(error) ? error.message : "Unexpected service-client error.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Service Clients"
        title="Issue trusted credentials for broker consumers"
        description="Service clients identify internal or partner systems that can ask the broker for relayed or delegated access under explicit policy."
      />
      {createdResult ? (
        <SecretPanel
          title="Client secret available"
          body={`Store the shared secret for ${createdResult.service_client.display_name} now. The broker only returns it at creation time.`}
          value={createdResult.client_secret}
        />
      ) : null}
      <div className="two-column">
        <Card title="Service clients" description="Current services that can authenticate to the broker.">
          <DataTable
            columns={["Name", "Key", "Environment", "Auth method", "Created"]}
            rows={clients.map((client) => [
              client.display_name,
              client.key,
              client.environment ?? "Not set",
              client.auth_method,
              formatDateTime(client.created_at),
            ])}
            emptyTitle="No service clients"
            emptyBody="Create the first service client to issue secrets for trusted services."
          />
        </Card>

        <Card title="Create service client" description="Grant a service a broker-facing identity and scope its allowed provider apps.">
          <InlineForm
            title="New service client"
            description="This creates a shared secret that is only revealable in the current session flow."
            onSubmit={handleSubmit}
          >
            <Field label="Key">
              <input value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} required />
            </Field>
            <Field label="Display name">
              <input
                value={form.display_name}
                onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Environment">
              <input
                value={form.environment}
                onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                placeholder="production"
              />
            </Field>
            <Field label="Allowed provider apps">
              <div className="check-grid">
                {providerApps.map((app) => (
                  <label key={app.id} className="check-option">
                    <input
                      type="checkbox"
                      checked={form.allowed_provider_app_keys.includes(app.key)}
                      onChange={() => toggleProviderApp(app.key)}
                    />
                    <span>{app.display_name}</span>
                  </label>
                ))}
              </div>
            </Field>
            <FormActions pending={pending} submitLabel="Create service client" />
          </InlineForm>
        </Card>
      </div>
    </>
  );
}

function AdminDelegationPage() {
  const { notify, session } = useAppContext();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [serviceClients, setServiceClients] = useState<ServiceClientOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [grants, setGrants] = useState<DelegationGrantOut[]>([]);
  const [pending, setPending] = useState(false);
  const [createdResult, setCreatedResult] = useState<DelegationGrantCreateResult | null>(null);
  const [form, setForm] = useState<DelegationGrantFormValues>({
    user_email: "",
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
    if (session.status !== "authenticated") return;
    const [userData, providerAppData, serviceClientData, connectionData, grantData] = await Promise.all([
      api.adminUsers(session.csrfToken),
      api.providerApps(session.csrfToken),
      api.serviceClients(session.csrfToken),
      api.connectedAccounts(session.csrfToken),
      api.delegationGrants(session.csrfToken),
    ]);
    setUsers(userData);
    setProviderApps(providerAppData);
    setServiceClients(serviceClientData);
    setConnections(connectionData);
    setGrants(grantData);
    setForm((current) => ({
      ...current,
      user_email: current.user_email || userData[0]?.email || "",
      service_client_key: current.service_client_key || serviceClientData[0]?.key || "",
      provider_app_key: current.provider_app_key || providerAppData[0]?.key || "",
    }));
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Failed to load delegation",
        description: isApiError(error) ? error.message : "Unexpected delegation loading error.",
      }),
    );
  }, [notify, session]);

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
      const result = await api.createDelegationGrant(session.csrfToken, {
        user_email: form.user_email,
        service_client_key: form.service_client_key,
        provider_app_key: form.provider_app_key,
        connected_account_id: form.connected_account_id || null,
        allowed_access_modes: form.allowed_access_modes,
        scope_ceiling: parseLines(form.scope_ceiling_text),
        environment: form.environment || null,
        expires_in_hours: form.expires_in_hours,
        capabilities: parseLines(form.capabilities_text),
      });
      setCreatedResult(result);
      notify({ tone: "success", title: "Delegation grant created" });
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
        title: "Delegation grant failed",
        description: isApiError(error) ? error.message : "Unexpected delegation error.",
      });
    } finally {
      setPending(false);
    }
  };

  const revokeGrant = async (grantId: string) => {
    if (session.status !== "authenticated") return;
    try {
      await api.revokeDelegationGrant(session.csrfToken, grantId);
      notify({ tone: "success", title: "Delegation revoked" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Revoke failed",
        description: isApiError(error) ? error.message : "Unexpected revoke error.",
      });
    }
  };

  const userById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const serviceClientById = useMemo(
    () => Object.fromEntries(serviceClients.map((client) => [client.id, client])),
    [serviceClients],
  );
  const providerAppById = useMemo(() => Object.fromEntries(providerApps.map((app) => [app.id, app])), [providerApps]);
  const eligibleConnections = connections.filter(
    (connection) => !form.provider_app_key || providerAppById[connection.provider_app_id]?.key === form.provider_app_key,
  );

  return (
    <>
      <PageIntro
        eyebrow="Delegation"
        title="Issue constrained delegated credentials"
        description="Create broker-side grants that bind a user, provider app, service client, optional connection, and access-mode or scope policy into one operator-managed artifact."
      />
      {createdResult ? (
        <SecretPanel
          title="Delegated credential available"
          body={`Store the delegated credential for grant ${createdResult.delegation_grant.id} now. The raw value is not recoverable later.`}
          value={createdResult.delegated_credential}
        />
      ) : null}

      <div className="two-column">
        <Card title="Delegation grants" description="Live broker-issued access contracts for service clients.">
          <DataTable
            columns={["User", "Service client", "Provider app", "Expiry", "State", "Action"]}
            rows={grants.map((grant) => [
              userById[grant.user_id]?.email ?? grant.user_id,
              serviceClientById[grant.service_client_id]?.display_name ?? grant.service_client_id,
              providerAppById[grant.provider_app_id]?.display_name ?? grant.provider_app_id,
              `${formatDateTime(grant.expires_at)} (${relativeTime(grant.expires_at)})`,
              <StatusBadge
                key={grant.id}
                tone={grantTone(grant)}
              >
                {grantState(grant)}
              </StatusBadge>,
              grant.revoked_at ? (
                "Closed"
              ) : (
                <button type="button" className="ghost-button" onClick={() => void revokeGrant(grant.id)}>
                  Revoke
                </button>
              ),
            ])}
            emptyTitle="No delegation grants"
            emptyBody="Create the first grant to issue delegated credentials to a service client."
          />
        </Card>

        <Card title="Create delegation grant" description="Bind a service to a provider app and access policy on behalf of a user.">
          <InlineForm
            title="New delegation grant"
            description="The user-facing workspace now owns self-service grants; this admin path remains available for operator setup and bootstrap."
            onSubmit={handleSubmit}
          >
            <Field label="User email">
              <>
                <input
                  list="delegation-users"
                  value={form.user_email}
                  onChange={(event) => setForm((current) => ({ ...current, user_email: event.target.value }))}
                  required
                />
                <datalist id="delegation-users">
                  {users.map((user) => (
                    <option key={user.id} value={user.email} />
                  ))}
                </datalist>
              </>
            </Field>
            <Field label="Service client">
              <select
                value={form.service_client_key}
                onChange={(event) => setForm((current) => ({ ...current, service_client_key: event.target.value }))}
              >
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
                onChange={(event) => setForm((current) => ({ ...current, provider_app_key: event.target.value }))}
              >
                {providerApps.map((app) => (
                  <option key={app.id} value={app.key}>
                    {app.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Connected account">
              <select
                value={form.connected_account_id}
                onChange={(event) => setForm((current) => ({ ...current, connected_account_id: event.target.value }))}
              >
                <option value="">Auto-select matching account</option>
                {eligibleConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.display_name || connection.external_email || connection.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Allowed access modes">
              <div className="check-grid compact">
                {["relay", "direct_token", "hybrid"].map((mode) => (
                  <label key={mode} className="check-option">
                    <input
                      type="checkbox"
                      checked={form.allowed_access_modes.includes(mode)}
                      onChange={() => toggleMode(mode)}
                    />
                    <span>{mode}</span>
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
                value={form.expires_in_hours}
                onChange={(event) =>
                  setForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) || 24 }))
                }
                min={1}
                max={24 * 365}
                type="number"
              />
            </Field>
            <FormActions pending={pending} submitLabel="Create delegation grant" />
          </InlineForm>
        </Card>
      </div>
    </>
  );
}

function AuditPage() {
  const { notify, session } = useAppContext();
  const [events, setEvents] = useState<AuditEventOut[]>([]);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [serviceClients, setServiceClients] = useState<ServiceClientOut[]>([]);
  const [tokenIssues, setTokenIssues] = useState<TokenIssueEventOut[]>([]);
  const [limit, setLimit] = useState(200);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [tokenIssueUserId, setTokenIssueUserId] = useState("");
  const [tokenIssueServiceClientId, setTokenIssueServiceClientId] = useState("");
  const [tokenIssueProviderAppId, setTokenIssueProviderAppId] = useState("");
  const [tokenIssueDecision, setTokenIssueDecision] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (requestedLimit: number) => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    try {
      const [auditData, userData, providerAppData, serviceClientData, tokenIssueData] = await Promise.all([
        api.auditEvents(session.csrfToken, requestedLimit),
        api.adminUsers(session.csrfToken),
        api.providerApps(session.csrfToken),
        api.serviceClients(session.csrfToken),
        api.adminTokenIssues(session.csrfToken, {
          userId: tokenIssueUserId || undefined,
          serviceClientId: tokenIssueServiceClientId || undefined,
          providerAppId: tokenIssueProviderAppId || undefined,
          decision: tokenIssueDecision || undefined,
          limit: requestedLimit,
        }),
      ]);
      setEvents(auditData);
      setUsers(userData);
      setProviderApps(providerAppData);
      setServiceClients(serviceClientData);
      setTokenIssues(tokenIssueData);
    } catch (error) {
      notify({
        tone: "error",
        title: "Failed to load audit",
        description: isApiError(error) ? error.message : "Unexpected audit loading error.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(limit);
  }, [limit, notify, session, tokenIssueDecision, tokenIssueProviderAppId, tokenIssueServiceClientId, tokenIssueUserId]);

  const filtered = events.filter((event) => {
    const actionMatches = actionFilter ? event.action.toLowerCase().includes(actionFilter.toLowerCase()) : true;
    const actorMatches = actorFilter ? event.actor_type === actorFilter : true;
    return actionMatches && actorMatches;
  });

  return (
    <>
      <PageIntro
        eyebrow="Audit"
        title="Inspect the broker event trail"
        description="Filter the recent operational history and inspect recorded metadata without dropping into raw JSON files."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => void load(limit)}>
              Reload
            </button>
          </div>
        }
      />
      <Card title="Audit filters" description="Narrow down the broker event stream.">
        <div className="filter-row">
          <Field label="Limit">
            <input type="number" min={1} max={1000} value={limit} onChange={(event) => setLimit(Number(event.target.value) || 200)} />
          </Field>
          <Field label="Action contains">
            <input value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} />
          </Field>
          <Field label="Actor type">
            <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
              <option value="">All actors</option>
              <option value="user">User</option>
              <option value="service_client">Service client</option>
            </select>
          </Field>
        </div>
      </Card>
      <Card title="Token issue diagnostics" description="Operator view of issued, blocked, and errored access decisions across the organization.">
        <div className="filter-row">
          <Field label="User">
            <select value={tokenIssueUserId} onChange={(event) => setTokenIssueUserId(event.target.value)}>
              <option value="">All users</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service client">
            <select value={tokenIssueServiceClientId} onChange={(event) => setTokenIssueServiceClientId(event.target.value)}>
              <option value="">All service clients</option>
              {serviceClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Provider app">
            <select value={tokenIssueProviderAppId} onChange={(event) => setTokenIssueProviderAppId(event.target.value)}>
              <option value="">All provider apps</option>
              {providerApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Decision">
            <select value={tokenIssueDecision} onChange={(event) => setTokenIssueDecision(event.target.value)}>
              <option value="">All decisions</option>
              <option value="issued">Issued</option>
              <option value="relayed">Relayed</option>
              <option value="blocked">Blocked</option>
              <option value="error">Error</option>
            </select>
          </Field>
        </div>
        {loading ? (
          <LoadingScreen label="Loading token issue diagnostics..." />
        ) : (
          <DataTable
            columns={["Time", "Service client", "Provider", "Connection", "Decision", "Scopes", "Metadata"]}
            rows={tokenIssues.map((issue) => [
              formatDateTime(issue.created_at),
              issue.service_client_display_name ?? issue.service_client_id ?? "Unknown",
              issue.provider_app_display_name ?? issue.provider_app_id ?? "Unknown",
              issue.connected_account_display_name ?? issue.connected_account_id ?? "Auto-select",
              <StatusBadge key={issue.id} tone={decisionTone(issue.decision)}>
                {issue.reason ? `${issue.decision}: ${issue.reason}` : issue.decision}
              </StatusBadge>,
              issue.scopes.length ? issue.scopes.join(", ") : "Inherited",
              <pre className="audit-metadata" key={`${issue.id}-metadata`}>
                {JSON.stringify(issue.metadata, null, 2)}
              </pre>,
            ])}
            emptyTitle="No token issue diagnostics"
            emptyBody="Run a token issuance or relay flow to populate operator-facing diagnostics."
          />
        )}
      </Card>
      <Card title="Audit events" description="Events are recorded by the backend on state-changing operations.">
        {loading ? (
          <LoadingScreen label="Loading audit events..." />
        ) : (
          <DataTable
            columns={["Time", "Actor", "Action", "Metadata"]}
            rows={filtered.map((event) => [
              formatDateTime(event.created_at),
              `${event.actor_type}${event.actor_id ? ` · ${event.actor_id}` : ""}`,
              event.action,
              <pre className="audit-metadata" key={event.id}>
                {formatJson(event.metadata_json)}
              </pre>,
            ])}
            emptyTitle="No matching audit events"
            emptyBody="Try a wider limit or clear the filters to inspect more platform history."
          />
        )}
      </Card>
    </>
  );
}

function WorkspacePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [probeResult, setProbeResult] = useState<ConnectionProbeResult | null>(null);
  const [busyAction, setBusyAction] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [providerAppData, connectionData] = await Promise.all([api.providerAppsForUser(), api.myConnections()]);
      setProviderApps(providerAppData);
      setConnections(connectionData);
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

  const runAction = async (actionKey: string, fn: () => Promise<void>) => {
    setBusyAction(actionKey);
    try {
      await fn();
    } finally {
      setBusyAction("");
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

  if (loading) return <LoadingScreen label="Loading your workspace..." />;

  return (
    <>
      <PageIntro
        eyebrow="Workspace"
        title="Manage your provider access"
        description="See your broker-held provider connections, refresh or revoke them, and run a safe connectivity probe before downstream consumers request access."
        actions={
          <div className="inline-actions">
            <button type="button" className="primary-button" onClick={() => onNavigate("/connect/miro")}>
              Connect Miro
            </button>
          </div>
        }
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
                disabled={busyAction === `refresh:${connection.id}`}
                onClick={() => void handleRefresh(connection.id)}
              >
                {busyAction === `refresh:${connection.id}` ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={busyAction === `probe:${connection.id}`}
                onClick={() => void handleProbe(connection.id)}
              >
                {busyAction === `probe:${connection.id}` ? "Probing..." : "Probe"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={busyAction === `revoke:${connection.id}`}
                onClick={() => void handleRevoke(connection.id)}
              >
                {busyAction === `revoke:${connection.id}` ? "Revoking..." : "Revoke"}
              </button>
            </div>,
          ])}
          emptyTitle="No provider connections yet"
          emptyBody="Start with Miro to give the broker an account it can refresh, relay, and issue against for your downstream service grants."
        />
      </Card>
    </>
  );
}

function ConnectMiroPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    Promise.all([api.providerAppsForUser(), api.myConnections()])
      .then(([providerAppData, connectionData]) => {
        setProviderApps(providerAppData);
        setConnections(connectionData);
      })
      .catch((error) =>
        notify({
          tone: "error",
          title: "Failed to load connect flow",
          description: isApiError(error) ? error.message : "Unexpected connect loading error.",
        }),
      )
      .finally(() => setLoading(false));
  }, [notify, session]);

  const providerAppById = useMemo(
    () => Object.fromEntries(providerApps.map((app) => [app.id, app])),
    [providerApps],
  );
  const existingMiro = connections.find((connection) => providerAppById[connection.provider_app_id]?.key === "miro-default");

  const startConnect = async () => {
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      const result = await api.startMiroConnection(session.csrfToken, existingMiro ? { connected_account_id: existingMiro.id } : {});
      window.location.assign(result.auth_url);
    } catch (error) {
      setPending(false);
      notify({
        tone: "error",
        title: "Could not start Miro connect",
        description: isApiError(error) ? friendlyBrokerMessage(error.message) : "Unexpected Miro connect error.",
      });
    }
  };

  if (loading) return <LoadingScreen label="Preparing Miro connect..." />;

  return (
    <>
      <PageIntro
        eyebrow="Connect"
        title="Connect your Miro account"
        description="The broker stores the provider token material server-side, then returns you to the workspace with a verified connection state."
        actions={
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => onNavigate("/workspace")}>
              Back to workspace
            </button>
          </div>
        }
      />

      <div className="two-column">
        <Card title="Miro authorization" description="This flow uses the broker backend callback and comes back into your workspace automatically.">
          <div className="stack-form">
            <p className="lede">
              {existingMiro
                ? "An existing Miro connection was found. Reconnect to refresh stored credentials and keep the same broker-side identity."
                : "No Miro connection exists yet. Start the flow to create your first broker-held account."}
            </p>
            <div className="inline-actions">
              <button type="button" className="primary-button" disabled={pending} onClick={() => void startConnect()}>
                {pending ? "Redirecting..." : existingMiro ? "Reconnect Miro" : "Connect Miro"}
              </button>
            </div>
          </div>
        </Card>

        <Card title="Current Miro state" description="If you already have a connection, you can see the current broker-held record before reconnecting.">
          {existingMiro ? (
            <div className="stack-list">
              <div className="stack-cell">
                <strong>Account</strong>
                <span>{existingMiro.display_name || existingMiro.external_email || existingMiro.id}</span>
              </div>
              <div className="stack-cell">
                <strong>Status</strong>
                <span>{existingMiro.status === "connected" && existingMiro.last_error ? "Connected with attention needed" : existingMiro.status}</span>
              </div>
              <div className="stack-cell">
                <strong>Connected</strong>
                <span>{formatDateTime(existingMiro.connected_at)}</span>
              </div>
              <div className="stack-cell">
                <strong>Last broker note</strong>
                <span>{existingMiro.last_error ? friendlyBrokerMessage(existingMiro.last_error) : "No recent issue recorded"}</span>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No Miro connection yet"
              body="Start the authorization flow to create a broker-managed Miro connection for your workspace."
            />
          )}
        </Card>
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
        service_client_key: current.service_client_key || serviceClientData[0]?.key || "",
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
      const result = await api.createMyDelegationGrant(session.csrfToken, {
        service_client_key: form.service_client_key,
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
        title="Create delegated access for approved service clients"
        description="Choose one of the service clients your organization has already approved, bind it to your own connection, and define the access modes and scope ceiling it can use."
      />

      {createdResult ? (
        <SecretPanel
          title="Delegated credential available"
          body={`Store the delegated credential for ${createdResult.delegation_grant.service_client_display_name} now. It will not be shown again later.`}
          value={createdResult.delegated_credential}
        />
      ) : null}

      <div className="two-column">
        <Card title="Your grants" description="Only your own grants appear here, and you can revoke them whenever a downstream consumer should lose access.">
          <DataTable
            columns={["Service client", "Provider", "Connection", "Modes", "State", "Expires", "Policy", "Action"]}
            rows={grants.map((grant) => [
              grant.service_client_display_name,
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
            emptyBody="Create your first delegated credential once you have a provider connection and an approved service client to target."
          />
        </Card>

        <Card title="Create a grant" description="This creates a one-time delegated credential for your own connected account.">
          <InlineForm
            title="New self-service grant"
            description="Service clients are pre-created by admins. You choose the provider app, access modes, and any narrower scope ceiling."
            onSubmit={handleSubmit}
          >
            <Field label="Service client">
              <select
                value={form.service_client_key}
                onChange={(event) => setForm((current) => ({ ...current, service_client_key: event.target.value }))}
              >
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
                    <span>{mode}</span>
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
                    {grant.service_client_display_name} · {grant.provider_app_display_name}
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

    window.history.replaceState({}, "", window.location.pathname);
  }, [notify, route.path, session.status]);

  useEffect(() => {
    if (session.status !== "authenticated") return;

    if (session.user.is_admin) {
      if (route.name === "login" || route.name === "workspace" || route.name === "connect" || route.name === "grants" || route.name === "tokenAccess") {
        navigate("/app");
      }
      return;
    }

    if (
      route.name === "login" ||
      route.name === "dashboard" ||
      route.name === "providers" ||
      route.name === "connections" ||
      route.name === "serviceClients" ||
      route.name === "delegation" ||
      route.name === "audit"
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
    if (route.name === "workspace" || route.name === "connect" || route.name === "grants" || route.name === "tokenAccess") {
      return <LoadingScreen label="Redirecting to the control deck..." />;
    }

    if (route.name === "notFound") {
      return <NotFoundPage onNavigate={navigate} fallbackPath="/app" />;
    }

    return (
      <Shell
        currentPath={route.path}
        navItems={[
          { href: "/app", label: "Overview" },
          { href: "/app/providers", label: "Providers" },
          { href: "/app/connections", label: "Connections" },
          { href: "/app/service-clients", label: "Service clients" },
          { href: "/app/delegation", label: "Delegation" },
          { href: "/app/audit", label: "Audit" },
        ]}
        onNavigate={navigate}
        kicker="OAuth Broker"
        title="Control deck"
        subtitle="Admin-first orchestration"
      >
        {route.name === "dashboard" ? <DashboardPage /> : null}
        {route.name === "providers" ? <ProvidersPage /> : null}
        {route.name === "connections" ? <AdminConnectionsPage /> : null}
        {route.name === "serviceClients" ? <ServiceClientsPage /> : null}
        {route.name === "delegation" ? <AdminDelegationPage /> : null}
        {route.name === "audit" ? <AuditPage /> : null}
      </Shell>
    );
  }

  if (route.name === "notFound") {
    return <NotFoundPage onNavigate={navigate} fallbackPath="/workspace" />;
  }

  if (
    route.name === "dashboard" ||
    route.name === "providers" ||
    route.name === "connections" ||
    route.name === "serviceClients" ||
    route.name === "delegation" ||
    route.name === "audit"
  ) {
    return <LoadingScreen label="Redirecting to your workspace..." />;
  }

  if (route.name === "connect" && route.params.providerKey !== "miro") {
    return <NotFoundPage onNavigate={navigate} fallbackPath="/workspace" />;
  }

  return (
    <Shell
      currentPath={route.path}
      navItems={[
        { href: "/workspace", label: "Workspace" },
        { href: "/connect/miro", label: "Connect Miro" },
        { href: "/grants", label: "My Grants" },
        { href: "/token-access", label: "Token Access" },
      ]}
      onNavigate={navigate}
      kicker="Broker Workspace"
      title="Self-service suite"
      subtitle="Connections, grants, and diagnostics"
    >
      {route.name === "workspace" ? <WorkspacePage onNavigate={navigate} /> : null}
      {route.name === "connect" ? <ConnectMiroPage onNavigate={navigate} /> : null}
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
