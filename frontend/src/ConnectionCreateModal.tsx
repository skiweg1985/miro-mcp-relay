import { useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "./api";
import { Field, Modal } from "./components";
import type { IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import { integrationTypeLabel } from "./integrationLabels";

type Step = 1 | 2;

type Props = {
  open: boolean;
  onClose: () => void;
  integrations: IntegrationV2Out[];
  defaultIntegrationId?: string;
  onCreated: (created: IntegrationInstanceV2Out) => void;
  onError: (message: string) => void;
  csrfToken: string;
};

export function ConnectionCreateModal({
  open,
  onClose,
  integrations,
  defaultIntegrationId,
  onCreated,
  onError,
  csrfToken,
}: Props) {
  const [step, setStep] = useState<Step>(1);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [step2AuthMode, setStep2AuthMode] = useState("none");
  const [accessMode, setAccessMode] = useState("relay");
  const [apiKeyHeader, setApiKeyHeader] = useState("Authorization");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [sharedHeaders, setSharedHeaders] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedIntegration = useMemo(
    () => integrations.find((i) => i.id === selectedIntegrationId) ?? null,
    [integrations, selectedIntegrationId],
  );

  const authModeOptions = useMemo(() => {
    const t = selectedIntegration?.type;
    if (t === "oauth_provider") {
      return [{ value: "oauth", label: "Sign-in with provider" }];
    }
    return [
      { value: "none", label: "No authentication required" },
      { value: "oauth", label: "Sign-in with provider" },
      { value: "api_key", label: "API key" },
      { value: "shared_credentials", label: "Shared account" },
    ];
  }, [selectedIntegration?.type]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    const initial = defaultIntegrationId && integrations.some((i) => i.id === defaultIntegrationId)
      ? defaultIntegrationId
      : integrations[0]?.id ?? "";
    setSelectedIntegrationId(initial);
    setInstanceName("");
    setStep2AuthMode("none");
    setAccessMode("relay");
    setApiKeyHeader("Authorization");
    setApiKeyValue("");
    setSharedHeaders("");
  }, [open, defaultIntegrationId, integrations]);

  useEffect(() => {
    const first = authModeOptions[0]?.value ?? "none";
    setStep2AuthMode(first);
  }, [authModeOptions, selectedIntegrationId]);

  if (!open) {
    return null;
  }

  const goNext = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedIntegrationId) return;
    setStep(2);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedIntegrationId || !instanceName.trim()) return;
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
      const created = await api.createIntegrationInstanceV2(csrfToken, {
        name: instanceName.trim(),
        integration_id: selectedIntegrationId,
        auth_mode: step2AuthMode,
        auth_config: authConfig,
        access_mode: accessMode,
        access_config: {},
      });
      onCreated(created);
      onClose();
    } catch (error) {
      onError(isApiError(error) ? error.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New connection"
      description="Link an integration so apps and access keys can use it."
      wide
      onClose={onClose}
    >
      {step === 1 ? (
        <form className="stack-form" onSubmit={goNext}>
          <Field label="Integration">
            <select
              value={selectedIntegrationId}
              onChange={(event) => setSelectedIntegrationId(event.target.value)}
              required
            >
              <option value="">Choose…</option>
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name} · {integrationTypeLabel(integration.type)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Connection name">
            <input
              value={instanceName}
              onChange={(event) => setInstanceName(event.target.value)}
              placeholder="e.g. Production MCP"
              required
            />
          </Field>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={!selectedIntegrationId}>
              Continue
            </button>
          </div>
        </form>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          <p className="muted-copy">
            {selectedIntegration ? (
              <>
                <strong>{selectedIntegration.name}</strong> · {integrationTypeLabel(selectedIntegration.type)}
              </>
            ) : null}
          </p>
          <div className="form-grid">
            <Field label="Authentication">
              <select value={step2AuthMode} onChange={(event) => setStep2AuthMode(event.target.value)}>
                {authModeOptions.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Traffic">
              <select value={accessMode} onChange={(event) => setAccessMode(event.target.value)}>
                <option value="relay">Via broker (recommended)</option>
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
              <Field label="Shared headers (Name: value per line)">
                <textarea value={sharedHeaders} onChange={(event) => setSharedHeaders(event.target.value)} />
              </Field>
            ) : null}
          </div>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(1)}>
              Back
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              Create connection
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
