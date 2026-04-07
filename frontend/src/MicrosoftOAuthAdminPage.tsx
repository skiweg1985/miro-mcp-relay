import { useEffect, useState, type FormEvent } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { Card, Field, PageIntro } from "./components";
import type { MicrosoftOAuthAdminOut } from "./types";
import { copyToClipboard } from "./utils";
import { isApiError } from "./errors";

function sourceLabel(source: MicrosoftOAuthAdminOut["effective_source"]): string {
  if (source === "database") return "Database";
  if (source === "environment") return "Environment variables";
  return "Not configured";
}

export function MicrosoftOAuthAdminPage() {
  const { session, notify } = useAppContext();
  const [data, setData] = useState<MicrosoftOAuthAdminOut | null>(null);
  const [authorityBase, setAuthorityBase] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [scope, setScope] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const row = await api.getMicrosoftOAuthAdmin();
    setData(row);
    setAuthorityBase(row.authority_base);
    setTenantId(row.tenant_id);
    setClientId(row.client_id);
    setScope(row.scope);
    setClientSecret("");
    setClearSecret(false);
  };

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      notify({
        tone: "error",
        title: "Load failed",
        description: isApiError(error) ? error.message : "Unexpected error",
      });
    });
  }, [session.status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        authority_base: authorityBase.trim(),
        tenant_id: tenantId.trim(),
        client_id: clientId.trim(),
        scope: scope.trim(),
      };
      if (clearSecret) {
        body.client_secret = "";
      } else if (clientSecret.trim()) {
        body.client_secret = clientSecret.trim();
      }
      const updated = await api.putMicrosoftOAuthAdmin(session.csrfToken, body);
      setData(updated);
      setClientSecret("");
      setClearSecret(false);
      notify({ tone: "success", title: "Saved", description: "Microsoft sign-in settings were updated." });
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

  const copyRedirect = async () => {
    if (!data?.redirect_uri) return;
    const ok = await copyToClipboard(data.redirect_uri);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied" : "Copy failed",
      description: ok ? "Redirect URI copied to clipboard." : "Clipboard is not available.",
    });
  };

  return (
    <>
      <PageIntro
        title="Microsoft sign-in"
        description="Register the broker redirect URI in Microsoft Entra ID and store the application credentials here."
      />

      {data ? (
        <Card title="Status">
          <p className="lede">
            Active configuration: <strong>{sourceLabel(data.effective_source)}</strong>
          </p>
          <p className="lede">
            End-user sign-in: <strong>{data.microsoft_login_enabled ? "enabled" : "disabled"}</strong>
          </p>
          <p className="lede">
            Client secret stored: <strong>{data.has_client_secret ? "yes" : "no"}</strong>
          </p>
        </Card>
      ) : null}

      <Card title="Redirect URI">
        <p className="lede">Use this value as a web redirect URI in your Entra app registration.</p>
        <div className="form-grid">
          <pre className="secret-value">{data?.redirect_uri ?? "—"}</pre>
        </div>
        <div className="modal-form-actions">
          <button type="button" className="ghost-button" onClick={() => void copyRedirect()} disabled={!data?.redirect_uri}>
            Copy
          </button>
        </div>
      </Card>

      <Card title="Application settings">
        <form className="stack-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-grid">
            <Field label="Authority URL">
              <input
                value={authorityBase}
                onChange={(e) => setAuthorityBase(e.target.value)}
                type="url"
                name="authority_base"
                placeholder="https://login.microsoftonline.com"
                autoComplete="off"
              />
            </Field>
            <Field label="Directory (tenant) ID">
              <input
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                name="tenant_id"
                placeholder="common or your tenant GUID"
                autoComplete="off"
              />
            </Field>
            <Field label="Application (client) ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} name="client_id" autoComplete="off" />
            </Field>
            <Field label="Scopes">
              <input
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                name="scope"
                placeholder="openid profile email User.Read"
                autoComplete="off"
              />
            </Field>
            <Field label="Client secret">
              <input
                value={clientSecret}
                onChange={(e) => {
                  setClientSecret(e.target.value);
                  setClearSecret(false);
                }}
                type="password"
                name="client_secret"
                placeholder={data?.has_client_secret ? "Leave blank to keep the current secret" : "Client secret value"}
                autoComplete="new-password"
                disabled={clearSecret}
              />
            </Field>
          </div>
          {data?.has_client_secret ? (
            <div className="lede">
              <label>
                <input
                  type="checkbox"
                  checked={clearSecret}
                  onChange={(e) => {
                    setClearSecret(e.target.checked);
                    if (e.target.checked) setClientSecret("");
                  }}
                />{" "}
                Remove stored client secret
              </label>
            </div>
          ) : null}
          <div className="modal-form-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
