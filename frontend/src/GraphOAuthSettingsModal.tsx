import { useEffect, useState, type FormEvent } from "react";

import { api } from "./api";
import { Field, Modal } from "./components";
import type { IntegrationV2Out } from "./types";
import { isApiError } from "./errors";

type Props = {
  open: boolean;
  onClose: () => void;
  graphIntegration: IntegrationV2Out;
  csrfToken: string;
  onSaved: () => Promise<void>;
  onNotify: (payload: { tone: "success" | "error"; title: string; description?: string }) => void;
};

export function GraphOAuthSettingsModal({
  open,
  onClose,
  graphIntegration,
  csrfToken,
  onSaved,
  onNotify,
}: Props) {
  const [graphBrokerDefaults, setGraphBrokerDefaults] = useState(true);
  const [graphAuthority, setGraphAuthority] = useState("");
  const [graphTenant, setGraphTenant] = useState("");
  const [graphClientId, setGraphClientId] = useState("");
  const [graphScope, setGraphScope] = useState("");
  const [graphSecret, setGraphSecret] = useState("");
  const [graphClearSecret, setGraphClearSecret] = useState(false);
  const [graphRedirectUri, setGraphRedirectUri] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = graphIntegration.config as Record<string, unknown>;
    setGraphBrokerDefaults(c.graph_oauth_use_broker_defaults !== false);
    setGraphAuthority(typeof c.graph_oauth_authority_base === "string" ? c.graph_oauth_authority_base : "");
    setGraphTenant(typeof c.graph_oauth_tenant_id === "string" ? c.graph_oauth_tenant_id : "");
    setGraphClientId(typeof c.graph_oauth_client_id === "string" ? c.graph_oauth_client_id : "");
    setGraphScope(typeof c.graph_oauth_scope === "string" ? c.graph_oauth_scope : "");
    setGraphRedirectUri(typeof c.graph_oauth_redirect_uri === "string" ? c.graph_oauth_redirect_uri : "");
    setGraphSecret("");
    setGraphClearSecret(false);
  }, [open, graphIntegration]);

  if (!open) {
    return null;
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patchIntegrationV2(csrfToken, graphIntegration.id, {
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
      await onSaved();
      setGraphSecret("");
      setGraphClearSecret(false);
      onNotify({ tone: "success", title: "Microsoft Graph settings saved" });
      onClose();
    } catch (error) {
      onNotify({
        tone: "error",
        title: "Could not save",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Microsoft Graph"
      description="Application settings for Graph API access. Use the redirect URI from Entra with this integration."
      wide
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={save}>
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
          <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
