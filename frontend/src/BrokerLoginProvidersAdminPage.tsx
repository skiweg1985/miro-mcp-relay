import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { Card, ConfirmModal, Field, Modal, PageIntro } from "./components";
import type { BrokerLoginProviderOut } from "./types";
import { copyToClipboard } from "./utils";
import { isApiError } from "./errors";

const DEFAULT_MAPPING = {
  subject: "sub",
  email: "email",
  display_name: "name",
  preferred_username: "preferred_username",
  locale: "locale",
  zoneinfo: "zoneinfo",
};

function isHttpUrl(raw: string, required: boolean): boolean {
  const s = raw.trim();
  if (!s) return !required;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

type FormMode = "create" | "edit";

export function BrokerLoginProvidersAdminPage() {
  const { session, notify } = useAppContext();
  const [rows, setRows] = useState<BrokerLoginProviderOut[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BrokerLoginProviderOut | null>(null);

  const [providerKey, setProviderKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [issuer, setIssuer] = useState("");
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [userinfoEndpoint, setUserinfoEndpoint] = useState("");
  const [jwksUri, setJwksUri] = useState("");
  const [scopesText, setScopesText] = useState("openid profile email");
  const [mapSubject, setMapSubject] = useState(DEFAULT_MAPPING.subject);
  const [mapEmail, setMapEmail] = useState(DEFAULT_MAPPING.email);
  const [mapDisplayName, setMapDisplayName] = useState(DEFAULT_MAPPING.display_name);
  const [mapPreferredUsername, setMapPreferredUsername] = useState(DEFAULT_MAPPING.preferred_username);
  const [mapLocale, setMapLocale] = useState(DEFAULT_MAPPING.locale);
  const [mapZoneinfo, setMapZoneinfo] = useState(DEFAULT_MAPPING.zoneinfo);

  const load = useCallback(async () => {
    setLoadError(null);
    const list = await api.listBrokerLoginProviders();
    setRows(list);
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      setLoadError(isApiError(error) ? error.message : "Unexpected error");
    });
  }, [session.status, load]);

  const resetFormForCreate = () => {
    setFormMode("create");
    setEditingKey(null);
    setProviderKey("");
    setDisplayName("");
    setEnabled(true);
    setClientId("");
    setClientSecret("");
    setIssuer("");
    setAuthorizationEndpoint("");
    setTokenEndpoint("");
    setUserinfoEndpoint("");
    setJwksUri("");
    setScopesText("openid profile email");
    setMapSubject(DEFAULT_MAPPING.subject);
    setMapEmail(DEFAULT_MAPPING.email);
    setMapDisplayName(DEFAULT_MAPPING.display_name);
    setMapPreferredUsername(DEFAULT_MAPPING.preferred_username);
    setMapLocale(DEFAULT_MAPPING.locale);
    setMapZoneinfo(DEFAULT_MAPPING.zoneinfo);
  };

  const openCreate = () => {
    resetFormForCreate();
    setModalOpen(true);
  };

  const openEdit = (row: BrokerLoginProviderOut) => {
    setFormMode("edit");
    setEditingKey(row.provider_key);
    setProviderKey(row.provider_key);
    setDisplayName(row.display_name);
    setEnabled(row.enabled);
    setClientId(row.client_id);
    setClientSecret("");
    const o = row.oidc;
    setIssuer(o.issuer ?? "");
    setAuthorizationEndpoint(o.authorization_endpoint);
    setTokenEndpoint(o.token_endpoint);
    setUserinfoEndpoint(o.userinfo_endpoint ?? "");
    setJwksUri(o.jwks_uri ?? "");
    setScopesText(o.scopes.join(" "));
    const m = o.claim_mapping || {};
    setMapSubject(m.subject ?? DEFAULT_MAPPING.subject);
    setMapEmail(m.email ?? DEFAULT_MAPPING.email);
    setMapDisplayName(m.display_name ?? DEFAULT_MAPPING.display_name);
    setMapPreferredUsername(m.preferred_username ?? DEFAULT_MAPPING.preferred_username);
    setMapLocale(m.locale ?? DEFAULT_MAPPING.locale);
    setMapZoneinfo(m.zoneinfo ?? DEFAULT_MAPPING.zoneinfo);
    setModalOpen(true);
  };

  const validateForm = (): string | null => {
    if (formMode === "create") {
      const pk = providerKey.trim();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(pk)) {
        return "Provider id: use lowercase letters, digits, hyphen or underscore (starts with letter or digit).";
      }
      if (!clientSecret.trim()) {
        return "Client secret is required for a new provider.";
      }
    }
    if (!displayName.trim()) return "Display name is required.";
    if (!clientId.trim()) return "Client id is required.";
    if (!isHttpUrl(authorizationEndpoint, true)) return "Authorization URL must be http(s).";
    if (!isHttpUrl(tokenEndpoint, true)) return "Token URL must be http(s).";
    if (userinfoEndpoint.trim() && !isHttpUrl(userinfoEndpoint, true)) return "Userinfo URL must be http(s) or empty.";
    if (jwksUri.trim() && !isHttpUrl(jwksUri, true)) return "JWKS URL must be http(s) or empty.";
    if (!issuer.trim()) {
      /* optional */
    } else if (!isHttpUrl(issuer, true)) return "Issuer should be a valid http(s) URL (or leave empty).";
    if (!mapSubject.trim() || !mapEmail.trim()) {
      return "Claim paths for subject and email are required (e.g. sub and email).";
    }
    const scopes = scopesText.trim().split(/\s+/).filter(Boolean);
    if (scopes.length === 0) return "Add at least one scope (e.g. openid email profile).";
    return null;
  };

  const buildOidcBody = () => ({
    issuer: issuer.trim(),
    authorization_endpoint: authorizationEndpoint.trim(),
    token_endpoint: tokenEndpoint.trim(),
    userinfo_endpoint: userinfoEndpoint.trim() || null,
    jwks_uri: jwksUri.trim() || null,
    scopes: scopesText.trim().split(/\s+/).filter(Boolean),
    claim_mapping: {
      subject: mapSubject.trim(),
      email: mapEmail.trim(),
      display_name: mapDisplayName.trim() || "name",
      preferred_username: mapPreferredUsername.trim() || "preferred_username",
      locale: mapLocale.trim() || "locale",
      zoneinfo: mapZoneinfo.trim() || "zoneinfo",
    },
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const err = validateForm();
    if (err) {
      notify({ tone: "error", title: "Check form", description: err });
      return;
    }
    setBusy(true);
    try {
      if (formMode === "create") {
        await api.createBrokerLoginProvider(session.csrfToken, {
          provider_key: providerKey.trim(),
          display_name: displayName.trim(),
          enabled,
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          oidc: buildOidcBody(),
        });
        notify({ tone: "success", title: "Created", description: "Sign-in provider was added." });
      } else if (editingKey) {
        const body: Record<string, unknown> = {
          display_name: displayName.trim(),
          enabled,
          client_id: clientId.trim(),
          oidc: buildOidcBody(),
        };
        if (clientSecret.trim()) {
          body.client_secret = clientSecret.trim();
        }
        await api.patchBrokerLoginProvider(session.csrfToken, editingKey, body);
        notify({ tone: "success", title: "Saved", description: "Sign-in provider was updated." });
      }
      setModalOpen(false);
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Save failed",
        description: isApiError(error) ? error.message : "Unexpected error",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || session.status !== "authenticated") return;
    setBusy(true);
    try {
      await api.deleteBrokerLoginProvider(session.csrfToken, deleteTarget.provider_key);
      notify({ tone: "success", title: "Removed", description: "Provider was deleted." });
      setDeleteTarget(null);
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Delete failed",
        description: isApiError(error) ? error.message : "Unexpected error",
      });
    } finally {
      setBusy(false);
    }
  };

  const copyCb = async (value: string) => {
    const ok = await copyToClipboard(value);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied" : "Copy failed",
      description: ok ? "Redirect URI copied." : "Clipboard is not available.",
    });
  };

  return (
    <>
      <PageIntro
        title="Sign-in providers (OIDC)"
        description="Configure OpenID Connect providers for broker workspace login. This is separate from integration OAuth (connections to Miro, Microsoft Graph, and other products). Register each callback URL on the identity provider."
      />

      <Card title="Overview">
        <p className="lede">
          <strong>Broker login</strong> authenticates users into this broker UI. <strong>Integration OAuth</strong> links user accounts to external tools under Connections — different clients, redirect URIs, and tokens.
        </p>
      </Card>

      <Card
        title="Generic OIDC providers"
        headerActions={
          <button type="button" className="primary-button" onClick={openCreate}>
            Add provider
          </button>
        }
      >
        {loadError ? <p className="lede">{loadError}</p> : null}
        {rows.length === 0 && !loadError ? <p className="lede">No generic providers yet. Microsoft Entra remains under Microsoft sign-in.</p> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider id</th>
                  <th>Display name</th>
                  <th>Enabled</th>
                  <th>Callback</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.provider_key}>
                    <td>
                      <code>{r.provider_key}</code>
                    </td>
                    <td>{r.display_name}</td>
                    <td>{r.enabled ? "Yes" : "No"}</td>
                    <td>
                      <button type="button" className="ghost-button" onClick={() => void copyCb(r.callback_redirect_uri)}>
                        Copy redirect
                      </button>
                    </td>
                    <td>
                      <button type="button" className="ghost-button" onClick={() => openEdit(r)}>
                        Edit
                      </button>{" "}
                      <button type="button" className="ghost-button" onClick={() => setDeleteTarget(r)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {modalOpen ? (
        <Modal
          title={formMode === "create" ? "Add OIDC provider" : "Edit OIDC provider"}
          description="Use issuer and endpoint URLs from your IdP discovery document. Claim paths select fields from the id_token and userinfo response."
          wide
          onClose={() => setModalOpen(false)}
        >
          <form className="stack-form" onSubmit={(e) => void handleSubmit(e)}>
            <div className="form-grid">
              {formMode === "create" ? (
                <Field label="Provider id (URL segment)">
                  <input
                    value={providerKey}
                    onChange={(e) => setProviderKey(e.target.value)}
                    placeholder="e.g. keycloak"
                    autoComplete="off"
                    required
                  />
                </Field>
              ) : (
                <Field label="Provider id">
                  <input value={providerKey} readOnly />
                </Field>
              )}
              <Field label="Display name">
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoComplete="off" />
              </Field>
              <Field label="Enabled">
                <label>
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Active for sign-in
                </label>
              </Field>
              <Field label="Client id">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} required autoComplete="off" />
              </Field>
              <Field label="Client secret">
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={formMode === "edit" ? "Leave blank to keep current secret" : ""}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Issuer (optional)">
                <input value={issuer} onChange={(e) => setIssuer(e.target.value)} type="url" placeholder="https://idp.example/realms/myrealm" autoComplete="off" />
              </Field>
              <Field label="Authorization URL">
                <input value={authorizationEndpoint} onChange={(e) => setAuthorizationEndpoint(e.target.value)} type="url" required autoComplete="off" />
              </Field>
              <Field label="Token URL">
                <input value={tokenEndpoint} onChange={(e) => setTokenEndpoint(e.target.value)} type="url" required autoComplete="off" />
              </Field>
              <Field label="Userinfo URL (optional)">
                <input value={userinfoEndpoint} onChange={(e) => setUserinfoEndpoint(e.target.value)} type="url" autoComplete="off" />
              </Field>
              <Field label="JWKS URL (optional)">
                <input value={jwksUri} onChange={(e) => setJwksUri(e.target.value)} type="url" autoComplete="off" />
              </Field>
              <Field label="Scopes (space-separated)">
                <input value={scopesText} onChange={(e) => setScopesText(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <p className="lede">
              <strong>Claim paths.</strong> Subject and email are required for account linking.
            </p>
            <div className="form-grid">
              <Field label="Subject claim">
                <input value={mapSubject} onChange={(e) => setMapSubject(e.target.value)} placeholder="sub" required autoComplete="off" />
              </Field>
              <Field label="Email claim">
                <input value={mapEmail} onChange={(e) => setMapEmail(e.target.value)} placeholder="email" required autoComplete="off" />
              </Field>
              <Field label="Display name claim">
                <input value={mapDisplayName} onChange={(e) => setMapDisplayName(e.target.value)} placeholder="name" autoComplete="off" />
              </Field>
              <Field label="Preferred username">
                <input value={mapPreferredUsername} onChange={(e) => setMapPreferredUsername(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Locale">
                <input value={mapLocale} onChange={(e) => setMapLocale(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Zoneinfo">
                <input value={mapZoneinfo} onChange={(e) => setMapZoneinfo(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <div className="modal-form-actions">
              <button type="button" className="ghost-button" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Saving…" : formMode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <ConfirmModal
          title="Remove provider?"
          confirmLabel="Remove"
          confirmBusy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>
            Delete “{deleteTarget.display_name}” ({deleteTarget.provider_key})? Users can no longer sign in with this provider.
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
