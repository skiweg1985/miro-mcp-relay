import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { Card, Field, PageIntro } from "./components";
import type { IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";

const INTEGRATION_TYPES = [
  { value: "mcp_server", label: "MCP Server" },
  { value: "oauth_provider", label: "OAuth Provider" },
  { value: "api", label: "API Service" },
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

  const authModeOptions = useMemo(() => {
    if (step1Type === "oauth_provider") {
      return [{ value: "oauth", label: "oauth" }];
    }
    return [
      { value: "none", label: "none" },
      { value: "oauth", label: "oauth" },
      { value: "api_key", label: "api_key" },
      { value: "shared_credentials", label: "shared_credentials" },
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
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      notify({
        tone: "error",
        title: "Laden fehlgeschlagen",
        description: isApiError(error) ? error.message : "Unbekannter Fehler",
      });
    });
  }, [session.status]);

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
      notify({ tone: "success", title: "Integration erstellt" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Integration fehlgeschlagen",
        description: isApiError(error) ? error.message : "Unbekannter Fehler",
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
      notify({ tone: "success", title: "Instanz erstellt" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Instanz fehlgeschlagen",
        description: isApiError(error) ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageIntro
        title="Integrations V2"
        description={
          isAdmin
            ? "Neue Integrationen und Instanzen anlegen (Admin)."
            : "Verfügbare Integrationen und Instanzen der Organisation."
        }
      />

      {isAdmin ? (
      <Card title="Neue Integration">
        <form className="stack-form" onSubmit={createIntegration}>
          <div className="form-grid">
            <Field label="Schritt 1: Integration Type">
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
              Anlegen
            </button>
          </div>
        </form>
      </Card>
      ) : null}

      {isAdmin ? (
      <Card title="Neue Integration Instance">
        <form className="stack-form" onSubmit={createInstance}>
          <div className="form-grid">
            <Field label="Integration">
              <select value={selectedIntegrationId} onChange={(event) => setSelectedIntegrationId(event.target.value)} required>
                <option value="">Bitte wählen</option>
                {integrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.name} ({integration.type})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Instance Name">
              <input value={instanceName} onChange={(event) => setInstanceName(event.target.value)} required />
            </Field>
            <Field label="Schritt 2: Auth Mode">
              <select value={step2AuthMode} onChange={(event) => setStep2AuthMode(event.target.value)}>
                {authModeOptions.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Access Mode">
              <select value={accessMode} onChange={(event) => setAccessMode(event.target.value)}>
                <option value="relay">relay</option>
                <option value="direct">direct</option>
              </select>
            </Field>
            {step2AuthMode === "api_key" ? (
              <>
                <Field label="API Key Header">
                  <input value={apiKeyHeader} onChange={(event) => setApiKeyHeader(event.target.value)} />
                </Field>
                <Field label="API Key Value">
                  <input value={apiKeyValue} onChange={(event) => setApiKeyValue(event.target.value)} required />
                </Field>
              </>
            ) : null}
            {step2AuthMode === "shared_credentials" ? (
              <Field label="Shared Headers (Header: Value)">
                <textarea value={sharedHeaders} onChange={(event) => setSharedHeaders(event.target.value)} />
              </Field>
            ) : null}
          </div>
          <div className="modal-form-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              Instanz anlegen
            </button>
          </div>
        </form>
      </Card>
      ) : null}

      <Card title="Bestehende Instanzen">
        <div className="stack-list">
          {instances.map((instance) => (
            <div className="stack-cell" key={instance.id}>
              <strong>{instance.name}</strong>
              <span>
                auth={instance.auth_mode}, access={instance.access_mode}, integration={instance.integration_id}
              </span>
            </div>
          ))}
          {!instances.length ? <p className="muted">Keine Instanzen vorhanden.</p> : null}
        </div>
      </Card>
    </>
  );
}
