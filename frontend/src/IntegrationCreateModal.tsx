import { useEffect, useState, type FormEvent } from "react";

import { api } from "./api";
import { Field, Modal } from "./components";
import type { IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import { integrationTypeLabel } from "./integrationLabels";

const TYPES = [
  { value: "mcp_server" as const, label: "MCP server", hint: "Model Context Protocol tools and resources." },
  {
    value: "oauth_provider" as const,
    label: "External OAuth / OIDC",
    hint: "Users authorize an external provider; the broker stores per-connection tokens for API and relay use.",
  },
  { value: "api" as const, label: "API", hint: "HTTP APIs exposed through the broker." },
];

type Step = 1 | 2;

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (created: IntegrationV2Out) => void;
  onError: (message: string) => void;
  csrfToken: string;
};

export function IntegrationCreateModal({ open, onClose, onCreated, onError, csrfToken }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [step1Type, setStep1Type] = useState<(typeof TYPES)[number]["value"]>("mcp_server");
  const [integrationName, setIntegrationName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [authzUrl, setAuthzUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [userinfoUrl, setUserinfoUrl] = useState("");
  const [issuer, setIssuer] = useState("");
  const [resourceBase, setResourceBase] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScopes, setOauthScopes] = useState("openid profile email");
  const [oauthPkce, setOauthPkce] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setStep1Type("mcp_server");
    setIntegrationName("");
    setEndpoint("");
    setAuthzUrl("");
    setTokenUrl("");
    setUserinfoUrl("");
    setIssuer("");
    setResourceBase("");
    setOauthClientId("");
    setOauthClientSecret("");
    setOauthScopes("openid profile email");
    setOauthPkce(true);
  }, [open]);

  if (!open) {
    return null;
  }

  const goNext = (event: FormEvent) => {
    event.preventDefault();
    setStep(2);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (step1Type === "oauth_provider") {
        const created = await api.createIntegrationV2(csrfToken, {
          name: integrationName.trim(),
          type: "oauth_provider",
          mcp_enabled: false,
          oauth_integration_client_secret: oauthClientSecret.trim(),
          config: {
            template_key: "generic_oauth",
            oauth_authorization_endpoint: authzUrl.trim(),
            oauth_token_endpoint: tokenUrl.trim(),
            ...(userinfoUrl.trim() ? { oauth_userinfo_endpoint: userinfoUrl.trim() } : {}),
            ...(issuer.trim() ? { oauth_issuer: issuer.trim() } : {}),
            ...(resourceBase.trim() ? { resource_api_base_url: resourceBase.trim() } : {}),
            oauth_client_id: oauthClientId.trim(),
            oauth_scopes: oauthScopes.trim(),
            oauth_pkce_enabled: oauthPkce,
            oauth_claim_mapping: {
              subject: "sub",
              email: "email",
              display_name: "name",
              preferred_username: "preferred_username",
            },
          },
        });
        onCreated(created);
      } else {
        const created = await api.createIntegrationV2(csrfToken, {
          name: integrationName.trim(),
          type: step1Type,
          config: { endpoint: endpoint.trim() },
          mcp_enabled: step1Type === "mcp_server",
        });
        onCreated(created);
      }
      onClose();
    } catch (error) {
      onError(isApiError(error) ? error.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add integration"
      description="An integration is the definition of an external system. You add connections to use it."
      wide
      onClose={onClose}
    >
      {step === 1 ? (
        <form className="stack-form" onSubmit={goNext}>
          <div className="form-grid">
            <Field label="Kind">
              <select
                value={step1Type}
                onChange={(event) => setStep1Type(event.target.value as (typeof TYPES)[number]["value"])}
              >
                {TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="muted-copy">{TYPES.find((t) => t.value === step1Type)?.hint}</p>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Continue
            </button>
          </div>
        </form>
      ) : step1Type === "oauth_provider" ? (
        <form className="stack-form" onSubmit={submit}>
          <p className="muted-copy">Kind: {integrationTypeLabel("oauth_provider")}</p>
          <p className="muted-copy">
            After saving, open integration details to copy the callback URL and register it at the provider.
          </p>
          <div className="form-grid">
            <Field label="Name">
              <input value={integrationName} onChange={(event) => setIntegrationName(event.target.value)} required />
            </Field>
            <Field label="Authorization URL">
              <input value={authzUrl} onChange={(event) => setAuthzUrl(event.target.value)} required />
            </Field>
            <Field label="Token URL">
              <input value={tokenUrl} onChange={(event) => setTokenUrl(event.target.value)} required />
            </Field>
            <Field label="Userinfo URL">
              <input value={userinfoUrl} onChange={(event) => setUserinfoUrl(event.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Issuer">
              <input value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="Optional metadata" />
            </Field>
            <Field label="API base URL">
              <input
                value={resourceBase}
                onChange={(event) => setResourceBase(event.target.value)}
                placeholder="Optional — for broker execute"
              />
            </Field>
            <Field label="Client ID">
              <input value={oauthClientId} onChange={(event) => setOauthClientId(event.target.value)} required />
            </Field>
            <Field label="Client secret">
              <input
                type="password"
                value={oauthClientSecret}
                onChange={(event) => setOauthClientSecret(event.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Scopes">
              <input value={oauthScopes} onChange={(event) => setOauthScopes(event.target.value)} />
            </Field>
            <div className="field">
              <span className="field-label">PKCE</span>
              <label className="lede">
                <input
                  type="checkbox"
                  checked={oauthPkce}
                  onChange={(event) => setOauthPkce(event.target.checked)}
                />{" "}
                Require PKCE
              </label>
            </div>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(1)}>
              Back
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              Save integration
            </button>
          </div>
        </form>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          <p className="muted-copy">Kind: {integrationTypeLabel(step1Type)}</p>
          <div className="form-grid">
            <Field label="Name">
              <input value={integrationName} onChange={(event) => setIntegrationName(event.target.value)} required />
            </Field>
            <Field label="Endpoint URL">
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://example.local/mcp"
                required
              />
            </Field>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(1)}>
              Back
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              Save integration
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
