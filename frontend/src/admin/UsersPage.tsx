import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { Card, DataTable, Field, FormActions, InlineForm, LoadingScreen, PageIntro, StatusBadge } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type {
  ConnectedAccountFormValues,
  ConnectedAccountOut,
  ConnectionProbeResult,
  ProviderAppOut,
  UserOut,
} from "../types";
import { formatDateTime, parseLines, toIsoDateTime } from "../utils";

function connectionTone(connection: ConnectedAccountOut): "neutral" | "success" | "warn" | "danger" {
  if (connection.status === "revoked") return "warn";
  if (connection.last_error) return "danger";
  if (connection.status === "connected") return "success";
  return "neutral";
}

function friendlyMessage(raw: string | null | undefined): string {
  const message = (raw ?? "").trim();
  if (!message) return "The request could not be completed.";
  if (message === "Invalid or expired OAuth state") return "The session expired. Start the connection again.";
  if (message.includes("did not match expected email")) return "The signed-in identity did not match the expected account.";
  if (message.startsWith("microsoft_graph_refresh_failed")) return "Could not refresh Microsoft credentials. Reconnect the account.";
  if (message.startsWith("miro_token_exchange_failed")) return "Token exchange failed. Try again.";
  if (message.startsWith("miro_refresh_failed")) return "Could not refresh stored credentials. Reconnect the account.";
  return message;
}

export function UsersPage() {
  const { notify, session } = useAppContext();
  const [tab, setTab] = useState<"people" | "connections">("people");
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [probeResult, setProbeResult] = useState<ConnectionProbeResult | null>(null);
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [advancedManual, setAdvancedManual] = useState(false);
  const [filters, setFilters] = useState({
    userEmail: "",
    providerAppKey: "",
    status: "",
  });
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
      api.filteredConnectedAccounts(session.csrfToken, filters),
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
    if (session.status !== "authenticated") return;
    setLoading(true);
    void load()
      .catch((error) =>
        notify({
          tone: "error",
          title: "Could not load users",
          description: isApiError(error) ? error.message : "Unexpected error.",
        }),
      )
      .finally(() => setLoading(false));
  }, [filters, notify, session]);

  const runAction = async (actionKey: string, action: () => Promise<void>) => {
    setBusyActions((prev) => new Set(prev).add(actionKey));
    try {
      await action();
    } catch (error) {
      notify({
        tone: "error",
        title: "Action failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusyActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

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
      notify({ tone: "success", title: "Account stored" });
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
        title: "Could not store account",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const userById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const appById = useMemo(() => Object.fromEntries(providerApps.map((app) => [app.id, app])), [providerApps]);

  if (loading) return <LoadingScreen label="Loading…" />;

  return (
    <>
      <PageIntro
        eyebrow="Users"
        title="People and connections"
        description="Who can sign in and which external accounts are linked."
      />

      <div className="tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "people"}
          className={tab === "people" ? "tab tab-active" : "tab"}
          onClick={() => setTab("people")}
        >
          People
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "connections"}
          className={tab === "connections" ? "tab tab-active" : "tab"}
          onClick={() => setTab("connections")}
        >
          Connected accounts
        </button>
      </div>

      {tab === "people" ? (
        <Card title="People" description="Accounts that can sign in to this workspace.">
          <DataTable
            columns={["Email", "Name", "Role", "Status"]}
            rows={users.map((user) => [
              user.email,
              user.display_name,
              user.is_admin ? "Administrator" : "User",
              <StatusBadge key={user.id} tone={user.is_active ? "success" : "warn"}>
                {user.is_active ? "Active" : "Inactive"}
              </StatusBadge>,
            ])}
            emptyTitle="No people yet"
            emptyBody="Invite or create users in your identity setup."
          />
        </Card>
      ) : (
        <>
          <Card title="Connected accounts" description="External identities linked to people in your organization.">
            <div className="filter-row">
              <Field label="Person">
                <select value={filters.userEmail} onChange={(event) => setFilters((current) => ({ ...current, userEmail: event.target.value }))}>
                  <option value="">Everyone</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.email}>
                      {user.email}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Integration">
                <select value={filters.providerAppKey} onChange={(event) => setFilters((current) => ({ ...current, providerAppKey: event.target.value }))}>
                  <option value="">All integrations</option>
                  {providerApps.map((app) => (
                    <option key={app.id} value={app.key}>
                      {app.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="">Any</option>
                  <option value="connected">Connected</option>
                  <option value="revoked">Revoked</option>
                </select>
              </Field>
            </div>
            <DataTable
              columns={["Person", "Integration", "Account", "Connected", "Status", "Actions"]}
              rows={connections.map((connection) => [
                userById[connection.user_id]?.email ?? connection.user_id,
                appById[connection.provider_app_id]?.display_name ?? connection.provider_app_id,
                connection.display_name || connection.external_email || connection.external_account_ref || connection.id,
                formatDateTime(connection.connected_at),
                <StatusBadge key={connection.id} tone={connectionTone(connection)}>
                  {connection.status === "connected" && connection.last_error ? "Issue" : connection.status}
                </StatusBadge>,
                <div className="inline-actions" key={`${connection.id}-actions`}>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busyActions.has(`refresh:${connection.id}`)}
                    onClick={() =>
                      void runAction(`refresh:${connection.id}`, async () => {
                        await api.refreshConnection(session.csrfToken, connection.id);
                        notify({ tone: "success", title: "Refreshed" });
                        await load();
                      })
                    }
                  >
                    {busyActions.has(`refresh:${connection.id}`) ? "…" : "Refresh"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busyActions.has(`probe:${connection.id}`)}
                    onClick={() =>
                      void runAction(`probe:${connection.id}`, async () => {
                        const result = await api.probeConnection(session.csrfToken, connection.id);
                        setProbeResult(result);
                        notify({
                          tone: result.ok ? "success" : "error",
                          title: result.ok ? "Check succeeded" : "Check failed",
                          description: result.ok ? "The provider accepted stored credentials." : friendlyMessage(result.message),
                        });
                        await load();
                      })
                    }
                  >
                    {busyActions.has(`probe:${connection.id}`) ? "…" : "Test access"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busyActions.has(`revoke:${connection.id}`)}
                    onClick={() =>
                      void runAction(`revoke:${connection.id}`, async () => {
                        await api.revokeConnection(session.csrfToken, connection.id);
                        notify({ tone: "info", title: "Access removed" });
                        await load();
                      })
                    }
                  >
                    {busyActions.has(`revoke:${connection.id}`) ? "…" : "Remove"}
                  </button>
                </div>,
              ])}
              emptyTitle="No connected accounts"
              emptyBody="Users connect integrations from their workspace."
            />
          </Card>

          {probeResult ? (
            <Card title="Latest access check" description="Result of the most recent test.">
              <div className="stack-list">
                <div className="stack-cell">
                  <strong>Outcome</strong>
                  <span>{probeResult.ok ? "OK" : friendlyMessage(probeResult.message)}</span>
                </div>
                <div className="stack-cell">
                  <strong>Checked at</strong>
                  <span>{formatDateTime(probeResult.checked_at)}</span>
                </div>
                <div className="stack-cell">
                  <strong>External identity</strong>
                  <span>{probeResult.external_user_name || probeResult.external_user_id || "—"}</span>
                </div>
              </div>
            </Card>
          ) : null}

          <Card title="Manual token import" description="For migration or recovery when the normal sign-in flow is not available.">
            <button type="button" className="ghost-button advanced-toggle" onClick={() => setAdvancedManual((v) => !v)}>
              Advanced settings
            </button>
            {advancedManual ? (
              <InlineForm title="Store tokens" description="Pastes provider tokens into secure storage for a user." onSubmit={handleSubmit}>
                <Field label="Email">
                  <>
                    <input
                      list="user-emails-tab"
                      value={form.user_email}
                      onChange={(event) => setForm((current) => ({ ...current, user_email: event.target.value }))}
                      required
                    />
                    <datalist id="user-emails-tab">
                      {users.map((user) => (
                        <option key={user.id} value={user.email} />
                      ))}
                    </datalist>
                  </>
                </Field>
                <Field label="Integration">
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
                  <input value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} />
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
                  <textarea value={form.refresh_token} onChange={(event) => setForm((current) => ({ ...current, refresh_token: event.target.value }))} />
                </Field>
                <Field label="Token type">
                  <input value={form.token_type} onChange={(event) => setForm((current) => ({ ...current, token_type: event.target.value }))} />
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
                <FormActions pending={pending} submitLabel="Store" />
              </InlineForm>
            ) : (
              <p className="lede">Open advanced settings to import tokens manually.</p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
