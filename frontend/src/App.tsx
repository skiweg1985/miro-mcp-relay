import { startTransition, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { AppProvider, useAppContext } from "./app-context";
import { api } from "./api";
import {
  CapabilityGate,
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
  ServiceClientCreateResult,
  ServiceClientFormValues,
  ServiceClientOut,
  UserOut,
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

function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { capabilities, login, notify } = useAppContext();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("change-me-admin-password");
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      await login(email, password);
      onSuccess();
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

  return (
    <main className="login-layout">
      <section className="hero-card login-hero">
        <p className="eyebrow">Broker Platform</p>
        <h1>Admin-first control plane for provider access, delegation, and future end-user onboarding.</h1>
        <p className="lede">
          The new broker UI is now the central shell for operating provider apps, connected accounts,
          service clients, and delegation grants. User-facing journeys are already reserved in the
          information architecture and will light up as FastAPI capabilities land.
        </p>
        <div className="hero-chip-row">
          <StatusBadge tone="success">FastAPI-backed admin surfaces</StatusBadge>
          <StatusBadge tone={capabilities.microsoftBrokerAuth ? "success" : "warn"}>
            Microsoft broker login {capabilities.microsoftBrokerAuth ? "enabled" : "planned"}
          </StatusBadge>
          <StatusBadge tone={capabilities.providerOAuthConnect ? "success" : "warn"}>
            Provider connect {capabilities.providerOAuthConnect ? "enabled" : "planned"}
          </StatusBadge>
        </div>
      </section>

      <section className="login-panel">
        <div className="auth-card-list">
          <Card title="Local admin login" description="Use the seeded broker admin to operate the platform today.">
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
              <FormActions pending={pending} submitLabel="Sign in" />
            </form>
          </Card>

          <Card
            title="Microsoft broker login"
            description="Route shape and capability model are reserved, but the backend flow is not active yet."
          >
            <CapabilityGate
              title="Broker auth is planned"
              body="The UI is already structured for a second login provider, but the FastAPI auth initiation and callback endpoints still need to be implemented."
            />
          </Card>
        </div>
      </section>
    </main>
  );
}

function Shell({
  currentPath,
  onNavigate,
  children,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
}) {
  const { logout, session } = useAppContext();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-kicker">OAuth Broker</span>
          <strong>Control deck</strong>
          <small>Admin-first orchestration</small>
        </div>

        <nav className="sidebar-nav">
          <NavLink currentPath={currentPath} href="/app" label="Overview" onNavigate={onNavigate} />
          <NavLink currentPath={currentPath} href="/app/providers" label="Providers" onNavigate={onNavigate} />
          <NavLink currentPath={currentPath} href="/app/connections" label="Connections" onNavigate={onNavigate} />
          <NavLink currentPath={currentPath} href="/app/service-clients" label="Service clients" onNavigate={onNavigate} />
          <NavLink currentPath={currentPath} href="/app/delegation" label="Delegation" onNavigate={onNavigate} />
          <NavLink currentPath={currentPath} href="/app/audit" label="Audit" onNavigate={onNavigate} />
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
        description="Track the current platform footprint, then dive into providers, connections, service clients, delegation grants, and audit events without leaving the new shell."
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

function MetricCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
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

  const definitionLabel = useMemo(
    () => Object.fromEntries(definitions.map((definition) => [definition.key, definition.display_name])),
    [definitions],
  );
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

function ConnectionsPage() {
  const { notify, session } = useAppContext();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [pending, setPending] = useState(false);
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
      api.connectedAccounts(session.csrfToken),
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

  const userById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const appById = useMemo(() => Object.fromEntries(providerApps.map((app) => [app.id, app])), [providerApps]);

  return (
    <>
      <PageIntro
        eyebrow="Connections"
        title="Store and inspect delegated account state"
        description="Today the new backend supports manual connection creation for migration and bootstrap. The UI keeps that flow usable and ready for later OAuth-based onboarding."
      />
      <div className="two-column">
        <Card title="Connected accounts" description="Current broker-held identities and their status.">
          <DataTable
            columns={["User", "Provider app", "External email", "Connected", "Status"]}
            rows={connections.map((connection) => [
              userById[connection.user_id]?.email ?? connection.user_id,
              appById[connection.provider_app_id]?.display_name ?? connection.provider_app_id,
              connection.external_email ?? "Not set",
              formatDateTime(connection.connected_at),
              <StatusBadge
                key={connection.id}
                tone={connection.status === "connected" ? "success" : connection.status === "revoked" ? "warn" : "neutral"}
              >
                {connection.status}
              </StatusBadge>,
            ])}
            emptyTitle="No connected accounts"
            emptyBody="Use the manual bootstrap form to seed the first broker-held accounts."
          />
        </Card>
        <Card title="Manual connection bootstrap" description="Store provider tokens in the broker for migration or initial setup.">
          <InlineForm
            title="New connected account"
            description="This path mirrors the current FastAPI admin endpoint and keeps refresh tokens inside the broker."
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

function DelegationPage() {
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
        description="Create broker-side grants that bind a user, provider app, service client, optional connection, and access-mode/scope policy into one operator-managed artifact."
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
                tone={grant.revoked_at ? "warn" : grant.is_enabled ? "success" : "neutral"}
              >
                {grant.revoked_at ? "Revoked" : grant.is_enabled ? "Active" : "Disabled"}
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
            description="The current backend supports direct-token delegation policy today; user-facing setup flows can attach later."
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
  const [limit, setLimit] = useState(200);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (requestedLimit: number) => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    try {
      const data = await api.auditEvents(session.csrfToken, requestedLimit);
      setEvents(data);
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
  }, [limit, notify, session]);

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

function FuturePage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <>
      <PageIntro eyebrow="Reserved route" title={title} description={body} />
      <Card title="Capability status" description="This route is intentionally present now so the frontend architecture does not need a later rewrite.">
        <CapabilityGate title={title} body={body} cta={action} />
      </Card>
    </>
  );
}

function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <main className="login-layout">
      <Card title="Route not found" description="This path is not part of the broker frontend.">
        <EmptyState
          title="Unknown page"
          body="Use the control deck navigation to return to the broker surfaces that are currently implemented."
        />
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => onNavigate("/app")}>
            Go to overview
          </button>
        </div>
      </Card>
    </main>
  );
}

function AuthenticatedApp() {
  const { route, navigate } = usePathname();
  const { capabilities, session } = useAppContext();

  useEffect(() => {
    if (session.status === "authenticated" && route.name === "login") {
      navigate("/app");
    }
  }, [navigate, route.name, session.status]);

  if (session.status === "booting") {
    return <LoadingScreen label="Restoring broker session..." />;
  }

  if (session.status === "anonymous") {
    return <LoginPage onSuccess={() => navigate("/app")} />;
  }

  if (route.name === "login") {
    return <LoadingScreen label="Redirecting to your workspace..." />;
  }

  if (route.name === "notFound") {
    return <NotFoundPage onNavigate={navigate} />;
  }

  return (
    <Shell currentPath={route.path} onNavigate={navigate}>
      {route.name === "dashboard" ? <DashboardPage /> : null}
      {route.name === "providers" ? <ProvidersPage /> : null}
      {route.name === "connections" ? <ConnectionsPage /> : null}
      {route.name === "serviceClients" ? <ServiceClientsPage /> : null}
      {route.name === "delegation" ? <DelegationPage /> : null}
      {route.name === "audit" ? <AuditPage /> : null}
      {route.name === "workspace" ? (
        <FuturePage
          title="User workspace"
          body={
            capabilities.userWorkspace
              ? "The broker workspace capability is enabled."
              : "End-user connected-account and grant self-service views will land once the backend exposes the necessary detail endpoints."
          }
        />
      ) : null}
      {route.name === "connect" ? (
        <FuturePage
          title={`Connect provider · ${route.params.providerKey}`}
          body={
            capabilities.providerOAuthConnect
              ? "OAuth connection flow is enabled."
              : "Provider onboarding will become active here when FastAPI adds provider connect initiation and callback endpoints."
          }
        />
      ) : null}
      {route.name === "tokenAccess" ? (
        <FuturePage
          title="Token access diagnostics"
          body={
            capabilities.tokenAccessDiagnostics
              ? "Token access diagnostics are enabled."
              : "Diagnostic token-issuance views will be added once the backend exposes the supporting introspection endpoints."
          }
        />
      ) : null}
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
