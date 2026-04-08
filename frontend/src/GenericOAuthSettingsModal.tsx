import { useEffect, useState, type FormEvent } from "react";

import { api } from "./api";
import { Field, Modal } from "./components";
import type { IntegrationV2Out } from "./types";
import { isApiError } from "./errors";

type Props = {
  open: boolean;
  onClose: () => void;
  integration: IntegrationV2Out;
  csrfToken: string;
  onSaved: () => Promise<void>;
  onNotify: (payload: { tone: "success" | "error"; title: string; description?: string }) => void;
};

export function GenericOAuthSettingsModal({
  open,
  onClose,
  integration,
  csrfToken,
  onSaved,
  onNotify,
}: Props) {
  const [authzUrl, setAuthzUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [userinfoUrl, setUserinfoUrl] = useState("");
  const [issuer, setIssuer] = useState("");
  const [resourceBase, setResourceBase] = useState("");
  const [clientId, setClientId] = useState("");
  const [scopes, setScopes] = useState("openid profile email");
  const [pkce, setPkce] = useState(true);
  const [tokenAuth, setTokenAuth] = useState<"client_secret_post" | "client_secret_basic">("client_secret_post");
  const [mapSubject, setMapSubject] = useState("sub");
  const [mapEmail, setMapEmail] = useState("email");
  const [mapName, setMapName] = useState("name");
  const [mapPreferred, setMapPreferred] = useState("preferred_username");
  const [clientSecret, setClientSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = integration.config as Record<string, unknown>;
    setAuthzUrl(typeof c.oauth_authorization_endpoint === "string" ? c.oauth_authorization_endpoint : "");
    setTokenUrl(typeof c.oauth_token_endpoint === "string" ? c.oauth_token_endpoint : "");
    setUserinfoUrl(typeof c.oauth_userinfo_endpoint === "string" ? c.oauth_userinfo_endpoint : "");
    setIssuer(typeof c.oauth_issuer === "string" ? c.oauth_issuer : "");
    setResourceBase(typeof c.resource_api_base_url === "string" ? c.resource_api_base_url : "");
    setClientId(typeof c.oauth_client_id === "string" ? c.oauth_client_id : "");
    setScopes(
      Array.isArray(c.oauth_scopes)
        ? (c.oauth_scopes as unknown[]).map(String).join(" ")
        : typeof c.oauth_scopes === "string"
          ? c.oauth_scopes
          : "openid profile email",
    );
    setPkce(c.oauth_pkce_enabled !== false);
    setTokenAuth(
      c.oauth_token_endpoint_auth_method === "client_secret_basic" ? "client_secret_basic" : "client_secret_post",
    );
    const m = c.oauth_claim_mapping as Record<string, unknown> | undefined;
    setMapSubject(typeof m?.subject === "string" ? m.subject : "sub");
    setMapEmail(typeof m?.email === "string" ? m.email : "email");
    setMapName(typeof m?.display_name === "string" ? m.display_name : "name");
    setMapPreferred(typeof m?.preferred_username === "string" ? m.preferred_username : "preferred_username");
    setClientSecret("");
    setClearSecret(false);
  }, [open, integration]);

  if (!open) {
    return null;
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patchIntegrationV2(csrfToken, integration.id, {
        config: {
          template_key: "generic_oauth",
          oauth_authorization_endpoint: authzUrl.trim(),
          oauth_token_endpoint: tokenUrl.trim(),
          oauth_userinfo_endpoint: userinfoUrl.trim(),
          oauth_issuer: issuer.trim(),
          resource_api_base_url: resourceBase.trim(),
          oauth_client_id: clientId.trim(),
          oauth_scopes: scopes.trim(),
          oauth_pkce_enabled: pkce,
          oauth_token_endpoint_auth_method: tokenAuth,
          oauth_claim_mapping: {
            subject: mapSubject.trim() || "sub",
            email: mapEmail.trim() || "email",
            display_name: mapName.trim() || "name",
            preferred_username: mapPreferred.trim() || "preferred_username",
          },
        },
        clear_oauth_integration_client_secret: clearSecret,
        ...(clientSecret.trim() ? { oauth_integration_client_secret: clientSecret.trim() } : {}),
      });
      await onSaved();
      setClientSecret("");
      setClearSecret(false);
      onNotify({ tone: "success", title: "External OAuth settings saved" });
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
      title="External OAuth / OIDC"
      description="User connections use this provider for consent and tokens. Register the callback URL on the provider. This is not broker login."
      wide
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={save}>
        <p className="muted-copy">
          Callback URL for this integration: <code className="inline-code">{integration.integration_oauth_callback_url}</code>
        </p>
        <div className="form-grid">
          <Field label="Authorization URL">
            <input value={authzUrl} onChange={(e) => setAuthzUrl(e.target.value)} required />
          </Field>
          <Field label="Token URL">
            <input value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} required />
          </Field>
          <Field label="Userinfo URL">
            <input
              value={userinfoUrl}
              onChange={(e) => setUserinfoUrl(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Issuer (optional)">
            <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="OIDC issuer, stored as metadata" />
          </Field>
          <Field label="API base URL">
            <input
              value={resourceBase}
              onChange={(e) => setResourceBase(e.target.value)}
              placeholder="Optional — target for broker execute when not using MCP"
            />
          </Field>
          <Field label="Client ID">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} required />
          </Field>
          <Field label="Client secret">
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={integration.oauth_client_secret_configured ? "Leave blank to keep current" : "Required once"}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Scopes">
            <input value={scopes} onChange={(e) => setScopes(e.target.value)} />
          </Field>
          <div className="field">
            <span className="field-label">PKCE</span>
            <label className="lede">
              <input type="checkbox" checked={pkce} onChange={(e) => setPkce(e.target.checked)} /> Require PKCE for authorization
            </label>
          </div>
          <Field label="Token endpoint auth">
            <select value={tokenAuth} onChange={(e) => setTokenAuth(e.target.value as typeof tokenAuth)}>
              <option value="client_secret_post">Client secret in request body</option>
              <option value="client_secret_basic">HTTP Basic (client id + secret)</option>
            </select>
          </Field>
        </div>
        <details className="raw-json-disclosure">
          <summary>Claim paths</summary>
          <p className="muted-copy">
            Dotted paths into ID token and userinfo JSON (for example <code className="inline-code">sub</code> or{" "}
            <code className="inline-code">user.email</code>).
          </p>
          <div className="form-grid">
            <Field label="Subject">
              <input value={mapSubject} onChange={(e) => setMapSubject(e.target.value)} required />
            </Field>
            <Field label="Email">
              <input value={mapEmail} onChange={(e) => setMapEmail(e.target.value)} />
            </Field>
            <Field label="Display name">
              <input value={mapName} onChange={(e) => setMapName(e.target.value)} />
            </Field>
            <Field label="Preferred username">
              <input value={mapPreferred} onChange={(e) => setMapPreferred(e.target.value)} />
            </Field>
          </div>
        </details>
        <div className="lede">
          <label>
            <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} /> Remove stored client
            secret
          </label>
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
