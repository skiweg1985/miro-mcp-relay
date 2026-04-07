import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAppContext } from "./app-context";
import { classNames } from "./utils";
import { api } from "./api";
import { Card, Field, PageIntro } from "./components";
import type { IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import { formatOAuthCallbackMessage } from "./utils";

const INTEGRATION_TYPES = [
  { value: "mcp_server", label: "MCP server" },
  { value: "oauth_provider", label: "OAuth provider" },
  { value: "api", label: "API" },
] as const;

export function IntegrationsV2Page() {
  const { session, notify } = useAppContext();
  const isAdmin = session.status === "authenticated" && session.user.is_admin;
  const [integrations, setIntegrations] = useState<IntegrationV2Out[]>([]);
  const [instances, setInstances] = useState<IntegrationInstanceV2Out[]>([]);
  const [step1Type, setStep1Type] = useState<(typeof INTEGRATION_TYPES)[number]["value"]>("mcp_server");
  const [step2AuthMode, setStep2AuthMode] = useState("none");
  const [integrationName, setIntegrationName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [accessMode, setAccessMode] = useState("relay");
  const [apiKeyHeader, setApiKeyHeader] = useState("Authorization");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [sharedHeaders, setSharedHeaders] = useState("");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [busy, setBusy] = useState(false);

  const graphIntegration = useMemo(
    () => integrations.find((i) => i.config?.template_key === "microsoft_graph_default"),
    [integrations],
  );
  const [graphBrokerDefaults, setGraphBrokerDefaults] = useState(true);
  const [graphAuthority, setGraphAuthority] = useState("");
  const [graphTenant, setGraphTenant] = useState("");
  const [graphClientId, setGraphClientId] = useState("");
  const [graphScope, setGraphScope] = useState("");
  const [graphSecret, setGraphSecret] = useState("");
  const [graphClearSecret, setGraphClearSecret] = useState(false);
  const [graphRedirectUri, setGraphRedirectUri] = useState("");

  const authModeOptions = useMemo(() => {
    if (step1Type === "oauth_provider") {
      return [{ value: "oauth", label: "OAuth" }];
    }
    return [
      { value: "none", label: "None" },
      { value: "oauth", label: "OAuth" },
      { value: "api_key", label: "API key" },
      { value: "shared_credentials", label: "Shared credentials" },
    ];
  }, [step1Type]);

  useEffect(() => {
    setStep2AuthMode(authModeOptions[0]?.value ?? "none");
  }, [authModeOptions]);

  const load = async () => {
    const [i, ins] = await Promise.all([api.integrationsV2(), api.integrationInstancesV2()]);
    setIntegrations(i);
    setInstances(ins);
    if (!selectedIntegrationId && i[0]) {
      setSelectedIntegrationId(i[0].id);
    }
  };

  useEffect(() => {
    if (!graphIntegration) return;
    const c = graphIntegration.config;
    setGraphBrokerDefaults(c.graph_oauth_use_broker_defaults !== false);
    setGraphAuthority(typeof c.graph_oauth_authority_base === "string" ? c.graph_oauth_authority_base : "");
    setGraphTenant(typeof c.graph_oauth_tenant_id === "string" ? c.graph_oauth_tenant_id : "");
    setGraphClientId(typeof c.graph_oauth_client_id === "string" ? c.graph_oauth_client_id : "");
    setGraphScope(typeof c.graph_oauth_scope === "string" ? c.graph_oauth_scope : "");
    setGraphRedirectUri(typeof c.graph_oauth_redirect_uri === "string" ? c.graph_oauth_redirect_uri : "");
    setGraphSecret("");
    setGraphClearSecret(false);
  }, [graphIntegration]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      notify({
        tone: "error",
        title: "Could not load data",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    });
  }, [session.status]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const params = new URLSearchParams(window.location.search);
    const connectionStatus = params.get("connection_status");
    if (connectionStatus === "connected") {
      notify({ tone: "success", title: "Connection saved" });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (connectionStatus === "error") {
      notify({
        tone: "error",
        title: "Connection failed",
        description: formatOAuthCallbackMessage(params.get("message")),
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [session.status, notify]);

  const createIntegration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated" || !isAdmin) return;
    setBusy(true);
    try {
      const created = await api.createIntegrationV2(session.csrfToken, {
        name: integrationName.trim(),
        type: step1Type,
        config: { endpoint: endpoint.trim() },
        mcp_enabled: step1Type === "mcp_server",
      });
      setIntegrations((prev) => [created, ...prev]);
      setSelectedIntegrationId(created.id);
      setIntegrationName("");
      setEndpoint("");
      notify({ tone: "success", title: "Integration created" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create integration",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  };

  const createInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated" || !isAdmin || !selectedIntegrationId) return;
    setBusy(true);
    try {
      const authConfig: Record<string, unknown> = {};
      if (step2AuthMode === "api_key") {
        authConfig.header_name = apiKeyHeader.trim() || "Authorization";
        authConfig.api_key = apiKeyValue.trim();
      } else if (step2AuthMode === "shared_credentials") {
        const headers: Record<string, string> = {};
        for (const line of sharedHeaders.split("\n")) {
          const [k, ...rest] = line.split(":");
          if (!k || !rest.length) continue;
          headers[k.trim()] = rest.join(":").trim();
        }
        authConfig.headers = headers;
      }
      const created = await api.createIntegrationInstanceV2(session.csrfToken, {
        name: instanceName.trim(),
        integration_id: selectedIntegrationId,
        auth_mode: step2AuthMode,
        auth_config: authConfig,
        access_mode: accessMode,
        access_config: {},
      });
      setInstances((prev) => [created, ...prev]);
      setInstanceName("");
      setApiKeyValue("");
      setSharedHeaders("");
      notify({ tone: "success", title: "Connection created" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create connection",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  };

  const connectOAuth = async (instanceId: string) => {
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
  };

  const saveGraphOAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated" || !isAdmin || !graphIntegration) return;
    setBusy(true);
    try {
      await api.patchIntegrationV2(session.csrfToken, graphIntegration.id, {
        config: {
          graph_oauth_use_broker_defaults: graphBrokerDefaults,
          graph_oauth_authority_base: graphAuthority.trim(),
          graph_oauth_tenant_id: graphTenant.trim(),
          graph_oauth_client_id: graphClientId.trim(),
          graph_oauth_scope: graphScope.trim(),
          graph_oauth_redirect_uri: graphRedirectUri.trim(),
        },
        clear_graph_oauth_client_secret: graphClearSecret,
        ...(graphSecret.trim() ? { graph_oauth_client_secret: graphSecret.trim() } : {}),
      });
      await load();
      setGraphSecret("");
      setGraphClearSecret(false);
      notify({ tone: "success", title: "Microsoft Graph settings saved" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not save",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  };

  const disconnectOAuth = async (instanceId: string) => {
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
  };

  return (
    <>
      <PageIntro
        title="Integrations"
        description={
          isAdmin
            ? "Create integrations and connections for your organization."
            : "Connections available to your organization."
        }
      />

      {isAdmin ? (
      <Card title="New integration">
        <form className="stack-form" onSubmit={createIntegration}>
          <div className="form-grid">
            <Field label="Type">
              <select value={step1Type} onChange={(event) => setStep1Type(event.target.value as "mcp_server" | "oauth_provider" | "api")}>
                {INTEGRATION_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input value={integrationName} onChange={(event) => setIntegrationName(event.target.value)} required />
            </Field>
            <Field label="Endpoint URL">
              <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.local/mcp" required />
            </Field>
          </div>
          <div className="modal-form-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              Create
            </button>
          </div>
        </form>
      </Card>
      ) : null}

      {isAdmin ? (
      <Card title="New connection">
        <form className="stack-form" onSubmit={createInstance}>
          <div className="form-grid">
            <Field label="Integration">
              <select value={selectedIntegrationId} onChange={(event) => setSelectedIntegrationId(event.target.value)} required>
                <option value="">Select…</option>
                {integrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.name} ({integration.type})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input value={instanceName} onChange={(event) => setInstanceName(event.target.value)} required />
            </Field>
            <Field label="Authentication">
              <select value={step2AuthMode} onChange={(event) => setStep2AuthMode(event.target.value)}>
                {authModeOptions.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Access mode">
              <select value={accessMode} onChange={(event) => setAccessMode(event.target.value)}>
                <option value="relay">Relay</option>
                <option value="direct">Direct</option>
              </select>
            </Field>
            {step2AuthMode === "api_key" ? (
              <>
                <Field label="API key header">
                  <input value={apiKeyHeader} onChange={(event) => setApiKeyHeader(event.target.value)} />
                </Field>
                <Field label="API key">
                  <input value={apiKeyValue} onChange={(event) => setApiKeyValue(event.target.value)} required />
                </Field>
              </>
            ) : null}
            {step2AuthMode === "shared_credentials" ? (
              <Field label="Headers (Name: value per line)">
                <textarea value={sharedHeaders} onChange={(event) => setSharedHeaders(event.target.value)} />
              </Field>
            ) : null}
          </div>
          <div className="modal-form-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              Create connection
            </button>
          </div>
        </form>
      </Card>
      ) : null}

      {isAdmin && graphIntegration ? (
        <Card title="Microsoft Graph">
          <form className="stack-form" onSubmit={saveGraphOAuth}>
            <p className="muted-copy">
              Redirect URI (Entra): {graphIntegration.integration_oauth_callback_url || "—"}
            </p>
            <div className="form-grid">
              <Field label="Redirect URI override">
                <input
                  value={graphRedirectUri}
                  onChange={(event) => setGraphRedirectUri(event.target.value)}
                  placeholder="https://broker.example/api/v1/connections/microsoft-graph/callback"
                  autoComplete="off"
                />
              </Field>
              <div className="field">
                <span className="field-label">Microsoft app</span>
                <label className="lede">
                  <input
                    type="checkbox"
                    checked={graphBrokerDefaults}
                    onChange={(event) => setGraphBrokerDefaults(event.target.checked)}
                  />{" "}
                  Same app as workspace sign-in
                </label>
              </div>
              {!graphBrokerDefaults ? (
                <>
                  <Field label="Authority URL">
                    <input
                      value={graphAuthority}
                      onChange={(event) => setGraphAuthority(event.target.value)}
                      placeholder="https://login.microsoftonline.com"
                    />
                  </Field>
                  <Field label="Directory (tenant) ID">
                    <input value={graphTenant} onChange={(event) => setGraphTenant(event.target.value)} placeholder="common" />
                  </Field>
                  <Field label="Application (client) ID">
                    <input value={graphClientId} onChange={(event) => setGraphClientId(event.target.value)} />
                  </Field>
                  <Field label="Scopes">
                    <input value={graphScope} onChange={(event) => setGraphScope(event.target.value)} />
                  </Field>
                  <Field label="Client secret">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={graphSecret}
                      onChange={(event) => {
                        setGraphSecret(event.target.value);
                        setGraphClearSecret(false);
                      }}
                      placeholder={graphIntegration.oauth_client_secret_configured ? "••••••••" : ""}
                    />
                  </Field>
                  <div className="lede">
                    <label>
                      <input
                        type="checkbox"
                        checked={graphClearSecret}
                        onChange={(event) => {
                          setGraphClearSecret(event.target.checked);
                          if (event.target.checked) setGraphSecret("");
                        }}
                      />{" "}
                      Remove stored client secret
                    </label>
                  </div>
                </>
              ) : null}
            </div>
            <div className="modal-form-actions">
              <button type="submit" className="primary-button" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Connections">
        <div className="stack-list">
          {instances.map((instance) => (
            <div
              className={classNames("stack-cell", instance.auth_mode === "oauth" && "stack-cell--row")}
              key={instance.id}
            >
              <div>
                <strong>{instance.name}</strong>
                <span className="muted-copy">
                  {instance.auth_mode} · {instance.access_mode}
                  {instance.auth_mode === "oauth" ? (
                    <> · {instance.oauth_connected ? "Connected" : "Not connected"}</>
                  ) : null}
                </span>
              </div>
              {instance.auth_mode === "oauth" ? (
                <div className="modal-form-actions">
                  {instance.oauth_connected ? (
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
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {!instances.length ? <p className="muted-copy">No connections yet.</p> : null}
        </div>
      </Card>
    </>
  );
}
