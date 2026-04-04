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
import { formatDateTime, parseLines, relativeTime } from "../utils";

function grantState(grant: DelegationGrantOut): string {
  if (grant.revoked_at) return "Revoked";
  if (!grant.is_enabled) return "Disabled";
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

function accessModeLabel(mode: string): string {
  if (mode === "relay") return "Proxy path";
  if (mode === "direct_token") return "Direct token";
  if (mode === "hybrid") return "Hybrid";
  return mode;
}

function grantTone(grant: DelegationGrantOut): "neutral" | "success" | "warn" | "danger" {
  const state = grantState(grant);
  if (state === "Active") return "success";
  if (state === "Expired") return "danger";
  if (state === "Revoked") return "warn";
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
  const [form, setForm] = useState<DelegationGrantFormValues>({
    user_email: "",
    service_client_key: "",
    provider_app_key: "",
    connected_account_id: "",
    allowed_access_modes: ["direct_token"],
    scope_ceiling_text: "",
    environment: "",
    expires_in_hours: 24,
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

  const toggleMode = (mode: string) => {
    setForm((current) => ({
      ...current,
      allowed_access_modes: current.allowed_access_modes.includes(mode)
        ? current.allowed_access_modes.filter((entry) => entry !== mode)
        : [...current.allowed_access_modes, mode],
    }));
  };

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
        allowed_access_modes: form.allowed_access_modes,
        scope_ceiling: parseLines(form.scope_ceiling_text),
        environment: form.environment || null,
        expires_in_hours: form.expires_in_hours,
        capabilities: parseLines(form.capabilities_text),
      });
      setCreatedResult(result);
      notify({ tone: "success", title: "Access granted" });
      setForm((current) => ({
        ...current,
        connected_account_id: "",
        scope_ceiling_text: "",
        environment: "",
        expires_in_hours: 24,
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
      notify({ tone: "success", title: "Access revoked" });
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

  return (
    <>
      <PageIntro
        eyebrow="Access"
        title="Service permissions"
        description="Time-bound access from internal services to user-connected integrations."
        actions={
          <button type="button" className="primary-button" onClick={() => setGrantModalOpen(true)}>
            Grant access
          </button>
        }
      />
      {createdResult ? (
        <SecretPanel
          title="Access credential"
          body={`Store this value for grant ${createdResult.delegation_grant.id}. It cannot be shown again.`}
          value={createdResult.delegated_credential}
        />
      ) : null}

      <Card title="Active access" description="Permissions issued to internal services.">
        <DataTable
          columns={["Person", "Service", "Integration", "Expires", "Status", ""]}
          rows={grants.map((grant) => [
            userById[grant.user_id]?.email ?? grant.user_id,
            grant.service_client_id
              ? serviceClientById[grant.service_client_id]?.display_name ?? grant.service_client_id
              : "Credential only",
            providerAppById[grant.provider_app_id]?.display_name ?? grant.provider_app_id,
            `${formatDateTime(grant.expires_at)} (${relativeTime(grant.expires_at)})`,
            <StatusBadge key={grant.id} tone={grantTone(grant)}>
              {grantState(grant)}
            </StatusBadge>,
            grant.revoked_at ? (
              "—"
            ) : (
              <button type="button" className="ghost-button" onClick={() => setGrantRevokeConfirmId(grant.id)}>
                Revoke
              </button>
            ),
          ])}
          emptyTitle="No access rules"
          emptyBody="Create access when an internal service needs to act for a user."
        />
      </Card>

      {grantModalOpen ? (
        <Modal title="Grant access" wide onClose={() => setGrantModalOpen(false)}>
          <form className="stack-form" onSubmit={handleSubmit}>
            <p className="lede">The person must have connected the integration in their workspace when required.</p>
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
                  <option value="">Credential only</option>
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
              <Field label="Access modes">
                <div className="check-grid compact">
                  {["relay", "direct_token", "hybrid"].map((mode) => (
                    <label key={mode} className="check-option">
                      <input
                        type="checkbox"
                        checked={form.allowed_access_modes.includes(mode)}
                        onChange={() => toggleMode(mode)}
                      />
                      <span>{accessModeLabel(mode)}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Expiry (hours)">
                <input
                  value={form.expires_in_hours}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) || 24 }))
                  }
                  min={1}
                  max={24 * 365}
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
                  <Field label="Scope ceiling" hint="Comma or newline separated">
                    <textarea
                      value={form.scope_ceiling_text}
                      onChange={(event) => setForm((current) => ({ ...current, scope_ceiling_text: event.target.value }))}
                    />
                  </Field>
                  <Field label="Capabilities" hint="Comma or newline separated">
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
          title="Revoke access"
          confirmLabel="Revoke"
          confirmBusy={grantRevokePending}
          onCancel={() => setGrantRevokeConfirmId(null)}
          onConfirm={() => void revokeGrant(grantRevokeConfirmId)}
        >
          <p className="lede">
            {grantRevokeTarget ? (
              <>
                The service loses access for <strong>{providerAppById[grantRevokeTarget.provider_app_id]?.display_name ?? "this integration"}</strong> until you issue a new grant.
              </>
            ) : (
              "The service loses access until you issue a new grant."
            )}
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
