import { useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "./api";
import { Field, Modal } from "./components";
import type { IntegrationInstanceInspectOut, IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import { integrationTypeLabel } from "./integrationLabels";

type Props = {
  open: boolean;
  instanceId: string | null;
  reloadVersion?: string | null;
  integrations: IntegrationV2Out[];
  csrfToken: string;
  onClose: () => void;
  onSaved: (row: IntegrationInstanceV2Out) => void;
  onError: (message: string) => void;
};

export function ConnectionEditModal({
  open,
  instanceId,
  reloadVersion,
  integrations,
  csrfToken,
  onClose,
  onSaved,
  onError,
}: Props) {
  const [data, setData] = useState<IntegrationInstanceInspectOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsAck, setNeedsAck] = useState(false);

  const [name, setName] = useState("");
  const [authMode, setAuthMode] = useState("none");
  const [accessMode, setAccessMode] = useState("relay");
  const [apiKeyHeader, setApiKeyHeader] = useState("Authorization");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [sharedHeaders, setSharedHeaders] = useState("");

  useEffect(() => {
    if (!open || !instanceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api
      .integrationInstanceInspect(instanceId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setName(res.instance.name);
        setAuthMode(res.instance.auth_mode);
        setAccessMode(res.instance.access_mode);
        const ac = res.instance.auth_config as Record<string, unknown>;
        setApiKeyHeader(typeof ac.header_name === "string" ? ac.header_name : "Authorization");
        setApiKeyValue(typeof ac.api_key === "string" ? ac.api_key : "");
        if (res.instance.auth_mode === "shared_credentials" && ac.headers && typeof ac.headers === "object") {
          const lines = Object.entries(ac.headers as Record<string, string>).map(([k, v]) => `${k}: ${v}`);
          setSharedHeaders(lines.join("\n"));
        } else {
          setSharedHeaders("");
        }
        setNeedsAck(false);
      })
      .catch((e) => {
        if (!cancelled) onError(isApiError(e) ? e.message : "Could not load connection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, instanceId, reloadVersion, onError]);

  const integration = useMemo(() => {
    if (!data) return null;
    return integrations.find((i) => i.id === data.instance.integration_id) ?? null;
  }, [data, integrations]);

  const authModeOptions = useMemo(() => {
    const t = integration?.type;
    if (t === "oauth_provider") {
      return [{ value: "oauth", label: "Sign-in with provider" }];
    }
    return [
      { value: "none", label: "No authentication required" },
      { value: "oauth", label: "Sign-in with provider" },
      { value: "api_key", label: "API key" },
      { value: "shared_credentials", label: "Shared account" },
    ];
  }, [integration?.type]);

  const buildAuthConfig = (): Record<string, unknown> => {
    const authConfig: Record<string, unknown> = {};
    if (!data) return authConfig;
    if (authMode === "api_key") {
      authConfig.header_name = apiKeyHeader.trim() || "Authorization";
      const key = apiKeyValue.trim();
      if (key) {
        authConfig.api_key = key;
      } else {
        const old = data.instance.auth_config as Record<string, unknown>;
        if (typeof old.api_key === "string") authConfig.api_key = old.api_key;
      }
    } else if (authMode === "shared_credentials") {
      const headers: Record<string, string> = {};
      for (const line of sharedHeaders.split("\n")) {
        const [k, ...rest] = line.split(":");
        if (!k || !rest.length) continue;
        headers[k.trim()] = rest.join(":").trim();
      }
      authConfig.headers = headers;
    }
    return authConfig;
  };

  const doSubmit = async (ack: boolean) => {
    if (!instanceId || !data) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        auth_mode: authMode,
        auth_config: buildAuthConfig(),
        access_mode: accessMode,
        access_config: data.instance.access_config ?? {},
        acknowledge_critical_change: ack,
      };
      const updated = await api.patchIntegrationInstanceV2(csrfToken, instanceId, body);
      onSaved(updated);
      onClose();
    } catch (error) {
      const msg = isApiError(error) ? error.message : "Unexpected error.";
      if (msg === "critical_change_requires_confirmation") {
        setNeedsAck(true);
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void doSubmit(needsAck);
  };

  if (!open || !instanceId) {
    return null;
  }

  return (
    <Modal
      title="Edit connection"
      description="Changes to authentication or routing can invalidate access keys that depend on this connection."
      wide
      onClose={onClose}
    >
      {loading ? <p className="muted-copy">Loading…</p> : null}
      {data && integration ? (
        <form className="stack-form" onSubmit={submit}>
          <p className="muted-copy">
            <strong>{integration.name}</strong> · {integrationTypeLabel(integration.type)}
          </p>
          <div className="form-grid">
            <Field label="Connection name">
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Authentication">
              <select value={authMode} onChange={(event) => setAuthMode(event.target.value)}>
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
            {authMode === "api_key" ? (
              <>
                <Field label="API key header">
                  <input value={apiKeyHeader} onChange={(event) => setApiKeyHeader(event.target.value)} />
                </Field>
                <Field label="API key" hint="Leave blank to keep the current key.">
                  <input value={apiKeyValue} onChange={(event) => setApiKeyValue(event.target.value)} placeholder="••••••••" />
                </Field>
              </>
            ) : null}
            {authMode === "shared_credentials" ? (
              <Field label="Shared headers (Name: value per line)">
                <textarea value={sharedHeaders} onChange={(event) => setSharedHeaders(event.target.value)} />
              </Field>
            ) : null}
          </div>
          {needsAck ? (
            <p className="muted-copy">
              This update changes security or routing settings. Active access keys for this connection will be marked invalid
              unless you confirm.
            </p>
          ) : null}
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {needsAck ? "Confirm and save" : "Save"}
            </button>
          </div>
        </form>
      ) : (
        !loading && <p className="muted-copy">No data.</p>
      )}
    </Modal>
  );
}
