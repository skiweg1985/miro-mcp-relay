import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { Card, ConfirmModal, DataTable, Field, Modal, PageIntro, SecretPanel, StatusBadge } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type {
  ConnectedAccountOut,
  DelegationGrantCreateResult,
  DelegationGrantFormValues,
  DelegationGrantOut,
  ProviderAppOut,
  ServiceClientOut,
  UserOut,
} from "../types";
import { formatDateTime, parseApiDateTime, parseLines, relativeTime } from "../utils";

type AdminGrantUiState = "active" | "expired" | "paused" | "ended";

function adminGrantUiState(grant: DelegationGrantOut): AdminGrantUiState {
  if (grant.revoked_at) return "ended";
  if (!grant.is_enabled) return "paused";
  if (grant.expires_at && parseApiDateTime(grant.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

function adminGrantLabel(grant: DelegationGrantOut): string {
  const s = adminGrantUiState(grant);
  if (s === "ended") return "Removed";
  if (s === "paused") return "Paused";
  if (s === "expired") return "Expired";
  return "Active";
}

function adminGrantTone(grant: DelegationGrantOut): "neutral" | "success" | "warn" | "danger" {
  const s = adminGrantUiState(grant);
  if (s === "active") return "success";
  if (s === "expired") return "warn";
  if (s === "ended") return "neutral";
  return "neutral";
}

export function AccessPage() {
  const { notify, session } = useAppContext();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [serviceClients, setServiceClients] = useState<ServiceClientOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [grants, setGrants] = useState<DelegationGrantOut[]>([]);
  const [pending, setPending] = useState(false);
  const [grantRevokeConfirmId, setGrantRevokeConfirmId] = useState<string | null>(null);
  const [grantRevokePending, setGrantRevokePending] = useState(false);
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [createdResult, setCreatedResult] = useState<DelegationGrantCreateResult | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [showInactiveRules, setShowInactiveRules] = useState(false);
  const [form, setForm] = useState<DelegationGrantFormValues>({
    user_email: "",
    service_client_key: "",
    provider_app_key: "",
    connected_account_id: "",
    scope_ceiling_text: "",
    environment: "",
    expires_in_days: 365,
    capabilities_text: "",
  });

  const load = async () => {
    if (session.status !== "authenticated") return;
    const [userData, providerAppData, serviceClientData, connectionData, grantData] = await Promise.all([
      api.adminUsers(session.csrfToken),
      api.providerApps(session.csrfToken),
      api.serviceClients(session.csrfToken),
      api.connectedAccounts(session.csrfToken),
      api.delegationGrants(session.csrfToken),
    ]);
    setUsers(userData);
    setProviderApps(providerAppData);
    setServiceClients(serviceClientData);
    setConnections(connectionData);
    setGrants(grantData);
    setForm((current) => ({
      ...current,
      user_email: current.user_email || userData[0]?.email || "",
      provider_app_key: current.provider_app_key || providerAppData[0]?.key || "",
    }));
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Could not load access rules",
        description: isApiError(error) ? error.message : "Unexpected error.",
      }),
    );
  }, [notify, session]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      const scKey = form.service_client_key.trim();
      const result = await api.createDelegationGrant(session.csrfToken, {
        user_email: form.user_email,
        ...(scKey ? { service_client_key: scKey } : {}),
        provider_app_key: form.provider_app_key,
        connected_account_id: form.connected_account_id || null,
        allowed_access_modes: [],
        scope_ceiling: parseLines(form.scope_ceiling_text),
        environment: form.environment || null,
        expires_in_days: form.expires_in_days,
        capabilities: parseLines(form.capabilities_text),
      });
      setCreatedResult(result);
      notify({ tone: "success", title: "Access added" });
      setForm((current) => ({
        ...current,
        connected_account_id: "",
        scope_ceiling_text: "",
        environment: "",
        expires_in_days: 365,
        capabilities_text: "",
      }));
      setGrantModalOpen(false);
      setAdvanced(false);
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create access",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const revokeGrant = async (grantId: string) => {
    if (session.status !== "authenticated") return;
    setGrantRevokePending(true);
    try {
      await api.revokeDelegationGrant(session.csrfToken, grantId);
      notify({ tone: "success", title: "Access removed" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not revoke",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setGrantRevokePending(false);
      setGrantRevokeConfirmId(null);
    }
  };

  const userById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const serviceClientById = useMemo(
    () => Object.fromEntries(serviceClients.map((client) => [client.id, client])),
    [serviceClients],
  );
  const providerAppById = useMemo(() => Object.fromEntries(providerApps.map((app) => [app.id, app])), [providerApps]);

  const grantRevokeTarget = useMemo(() => {
    if (!grantRevokeConfirmId) return null;
    return grants.find((grant) => grant.id === grantRevokeConfirmId) ?? null;
  }, [grantRevokeConfirmId, grants]);

  const eligibleConnections = connections.filter(
    (connection) => !form.provider_app_key || providerAppById[connection.provider_app_id]?.key === form.provider_app_key,
  );

  const visibleGrants = useMemo(() => {
    if (showInactiveRules) return grants;
    return grants.filter((grant) => adminGrantUiState(grant) === "active");
  }, [grants, showInactiveRules]);

  const rulesEmptyTitle =
    grants.length === 0 ? "Nothing here yet" : visibleGrants.length === 0 ? "No active rules yet" : "";
  const rulesEmptyBody =
    grants.length === 0
      ? "Add access when an internal app should act for a user."
      : visibleGrants.length === 0
        ? "Add access, or switch to Show inactive to see paused, expired, or removed rules."
        : "";

  return (
    <>
      <PageIntro
        title="Access"
        description="Which internal apps may use a person’s connections."
        actions={
          <button type="button" className="primary-button" onClick={() => setGrantModalOpen(true)}>
            Add access
          </button>
        }
      />
      {createdResult ? (
        <SecretPanel
          title="Save this value"
          body="Copy now. It cannot be shown again."
          value={createdResult.access_credential}
        />
      ) : null}

      <Card title="Rules">
        <div className="grants-filter-bar">
          <button
            type="button"
            className={showInactiveRules ? "grants-filter-toggle grants-filter-toggle--on" : "grants-filter-toggle"}
            aria-pressed={showInactiveRules}
            onClick={() => setShowInactiveRules((v) => !v)}
          >
            {showInactiveRules ? "Active only" : "Show inactive"}
          </button>
        </div>
        <DataTable
          tableClassName="admin-rules-table"
          wrapClassName="grants-table-wrap grants-table-wrap--animate"
          wrapKey={showInactiveRules ? "all" : "active"}
          columns={["Person", "Service", "Integration", "Expires", "Status", ""]}
          rowKey={(rowIndex) => visibleGrants[rowIndex]?.id ?? rowIndex}
          rowClassName={(rowIndex) => {
            const g = visibleGrants[rowIndex];
            if (!g) return undefined;
            return adminGrantUiState(g) !== "active" ? "data-table-row--grant-muted" : undefined;
          }}
          rows={visibleGrants.map((grant) => [
            userById[grant.user_id]?.email ?? grant.user_id,
            grant.service_client_id
              ? serviceClientById[grant.service_client_id]?.display_name ?? grant.service_client_id
              : "Any service",
            providerAppById[grant.provider_app_id]?.display_name ?? grant.provider_app_id,
            <span
              key={`${grant.id}-exp`}
              className="admin-expires-cell"
              title={grant.expires_at ? `${formatDateTime(grant.expires_at)} · ${relativeTime(grant.expires_at)}` : undefined}
            >
              {grant.expires_at ? formatDateTime(grant.expires_at) : "—"}
            </span>,
            <StatusBadge key={grant.id} tone={adminGrantTone(grant)}>
              {adminGrantLabel(grant)}
            </StatusBadge>,
            grant.revoked_at ? (
              "—"
            ) : (
              <button type="button" className="ghost-button grants-inline-btn" onClick={() => setGrantRevokeConfirmId(grant.id)}>
                Remove
              </button>
            ),
          ])}
          emptyTitle={rulesEmptyTitle}
          emptyBody={rulesEmptyBody}
        />
      </Card>

      {grantModalOpen ? (
        <Modal
          title="Add access"
          description="The person must have connected the app in their workspace when required."
          wide
          onClose={() => setGrantModalOpen(false)}
        >
          <form className="stack-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Person">
                <>
                  <input
                    list="access-users"
                    value={form.user_email}
                    onChange={(event) => setForm((current) => ({ ...current, user_email: event.target.value }))}
                    required
                  />
                  <datalist id="access-users">
                    {users.map((user) => (
                      <option key={user.id} value={user.email} />
                    ))}
                  </datalist>
                </>
              </Field>
              <Field label="Service" hint="Optional">
                <select
                  value={form.service_client_key}
                  onChange={(event) => setForm((current) => ({ ...current, service_client_key: event.target.value }))}
                >
                  <option value="">Any service</option>
                  {serviceClients.map((client) => (
                    <option key={client.id} value={client.key}>
                      {client.display_name}
                    </option>
                  ))}
                </select>
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
              <Field label="Connected account">
                <select
                  value={form.connected_account_id}
                  onChange={(event) => setForm((current) => ({ ...current, connected_account_id: event.target.value }))}
                >
                  <option value="">Match automatically</option>
                  {eligibleConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.display_name || connection.external_email || connection.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Expiry (days)">
                <input
                  value={form.expires_in_days}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, expires_in_days: Number(event.target.value) || 365 }))
                  }
                  min={1}
                  max={365}
                  type="number"
                />
              </Field>
              <Field label="Environment">
                <input
                  value={form.environment}
                  onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                  placeholder="production"
                />
              </Field>
              <button type="button" className="ghost-button advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
                Advanced settings
              </button>
              {advanced ? (
                <>
                  <Field label="Permission limit" hint="One per line or comma-separated">
                    <textarea
                      value={form.scope_ceiling_text}
                      onChange={(event) => setForm((current) => ({ ...current, scope_ceiling_text: event.target.value }))}
                    />
                  </Field>
                  <Field label="Extra permissions" hint="One per line or comma-separated">
                    <textarea
                      value={form.capabilities_text}
                      onChange={(event) => setForm((current) => ({ ...current, capabilities_text: event.target.value }))}
                    />
                  </Field>
                </>
              ) : null}
            </div>
            <div className="modal-form-actions">
              <button type="button" className="ghost-button" onClick={() => setGrantModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={pending}>
                {pending ? "Working…" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {grantRevokeConfirmId ? (
        <ConfirmModal
          title="Remove access"
          confirmLabel="Remove"
          confirmBusy={grantRevokePending}
          onCancel={() => setGrantRevokeConfirmId(null)}
          onConfirm={() => void revokeGrant(grantRevokeConfirmId)}
        >
          <p className="lede">
            {grantRevokeTarget ? (
              <>
                The app loses access to <strong>{providerAppById[grantRevokeTarget.provider_app_id]?.display_name ?? "this integration"}</strong> until you add new access.
              </>
            ) : (
              "The app loses access until you add new access."
            )}
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
