import { type FormEvent, useEffect, useState } from "react";

import { api } from "./api";
import { Card, ConfirmModal, DataTable, Field, Modal, PageIntro, SecretPanel } from "./components";
import { copyToClipboard } from "./utils";
import { useAppContext } from "./app-context";
import { isApiError } from "./errors";
import type { ProviderAppOut, ServiceClientCreateResult, ServiceClientFormValues, ServiceClientOut } from "./types";
import { formatDateTime } from "./utils";

export function MyClientsPage() {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [clients, setClients] = useState<ServiceClientOut[]>([]);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [createdResult, setCreatedResult] = useState<ServiceClientCreateResult | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceClientFormValues>({
    display_name: "",
    environment: "",
    allowed_provider_app_keys: [],
    client_secret: "",
  });
  const [editForm, setEditForm] = useState<{
    display_name: string;
    environment: string;
    allowed_provider_app_keys: string[];
    is_enabled: boolean;
  }>({
    display_name: "",
    environment: "",
    allowed_provider_app_keys: [],
    is_enabled: true,
  });

  const load = async () => {
    if (session.status !== "authenticated") return;
    const [providerAppData, clientData] = await Promise.all([
      api.providerAppsForUser(),
      api.myServiceClients(),
    ]);
    setProviderApps(providerAppData);
    setClients(clientData);
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Could not load clients",
        description: isApiError(error) ? error.message : "Unexpected error.",
      }),
    );
  }, [notify, session]);

  const toggleProviderApp = (providerAppKey: string) => {
    setForm((current) => ({
      ...current,
      allowed_provider_app_keys: current.allowed_provider_app_keys.includes(providerAppKey)
        ? current.allowed_provider_app_keys.filter((key) => key !== providerAppKey)
        : [...current.allowed_provider_app_keys, providerAppKey],
    }));
  };

  const toggleEditProviderApp = (providerAppKey: string) => {
    setEditForm((current) => ({
      ...current,
      allowed_provider_app_keys: current.allowed_provider_app_keys.includes(providerAppKey)
        ? current.allowed_provider_app_keys.filter((key) => key !== providerAppKey)
        : [...current.allowed_provider_app_keys, providerAppKey],
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      const body: Record<string, unknown> = {
        display_name: form.display_name.trim(),
        environment: form.environment.trim() || null,
        allowed_provider_app_keys: form.allowed_provider_app_keys,
      };
      const cs = form.client_secret.trim();
      if (cs) body.client_secret = cs;
      const result = await api.createMyServiceClient(session.csrfToken, body);
      setCreatedResult(result);
      setForm({
        display_name: "",
        environment: "",
        allowed_provider_app_keys: [],
        client_secret: "",
      });
      setCreateOpen(false);
      notify({ tone: "success", title: "Client created" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create client",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const openEdit = (client: ServiceClientOut) => {
    setEditId(client.id);
    setEditForm({
      display_name: client.display_name,
      environment: client.environment ?? "",
      allowed_provider_app_keys: client.allowed_provider_app_keys ?? [],
      is_enabled: client.is_enabled,
    });
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated" || !editId) return;
    setPending(true);
    try {
      await api.updateMyServiceClient(session.csrfToken, editId, {
        display_name: editForm.display_name.trim(),
        environment: editForm.environment.trim() || null,
        allowed_provider_app_keys: editForm.allowed_provider_app_keys,
        is_enabled: editForm.is_enabled,
      });
      setEditId(null);
      notify({ tone: "success", title: "Client updated" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not update client",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const performRemove = async () => {
    if (!removeId || session.status !== "authenticated") return;
    setRemoveBusy(true);
    try {
      await api.deleteMyServiceClient(session.csrfToken, removeId);
      notify({ tone: "success", title: "Client removed" });
      setRemoveId(null);
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not remove client",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setRemoveBusy(false);
    }
  };

  const performRotate = async () => {
    if (!rotateId || session.status !== "authenticated") return;
    setRotateBusy(true);
    try {
      const result = await api.rotateMyServiceClientSecret(session.csrfToken, rotateId);
      setRotatedSecret(result.client_secret);
      setRotateId(null);
      notify({ tone: "success", title: "Secret rotated" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not rotate secret",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setRotateBusy(false);
    }
  };

  const removeTarget = clients.find((c) => c.id === removeId) ?? null;
  const rotateTarget = clients.find((c) => c.id === rotateId) ?? null;
  const editTarget = editId ? (clients.find((c) => c.id === editId) ?? null) : null;

  return (
    <>
      <PageIntro
        title="Clients"
        description="Named callers that use your access keys with an extra client secret when you bind access to them."
        actions={
          <button type="button" className="primary-button" onClick={() => setCreateOpen(true)}>
            Add client
          </button>
        }
      />
      {createdResult ? (
        <SecretPanel
          title="Save this client secret"
          body={`Store for ${createdResult.service_client.display_name} now. Shown once.`}
          value={createdResult.client_secret}
        />
      ) : null}
      {rotatedSecret ? (
        <Modal
          title="New client secret"
          description="Copy now. It will not be shown again."
          wide
          onClose={() => setRotatedSecret(null)}
        >
          <pre className="secret-value">{rotatedSecret}</pre>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" onClick={() => setRotatedSecret(null)}>
              Close
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                void copyToClipboard(rotatedSecret).then((ok) =>
                  notify({
                    tone: ok ? "success" : "error",
                    title: ok ? "Copied to clipboard" : "Clipboard unavailable",
                  }),
                )
              }
            >
              Copy
            </button>
          </div>
        </Modal>
      ) : null}

      <Card title="Your clients">
        <DataTable
          columns={["Name", "Client ID", "Status", "Environment", "Created", ""]}
          rowKey={(rowIndex) => clients[rowIndex]?.id ?? rowIndex}
          rows={clients.map((client) => [
            client.display_name,
            client.key,
            client.is_enabled ? "Active" : "Disabled",
            client.environment ?? "—",
            formatDateTime(client.created_at),
            <span key={`${client.id}-actions`} className="inline-actions">
              <button type="button" className="ghost-button grants-inline-btn" onClick={() => openEdit(client)}>
                Edit
              </button>
              <button type="button" className="ghost-button grants-inline-btn" onClick={() => setRotateId(client.id)}>
                New secret
              </button>
              <button type="button" className="ghost-button grants-inline-btn" onClick={() => setRemoveId(client.id)}>
                Remove
              </button>
            </span>,
          ])}
          emptyTitle="No clients yet"
          emptyBody="Create a client, then bind it when you add access."
        />
      </Card>

      {createOpen ? (
        <Modal
          title="Add client"
          description="Choose which integrations this caller may use. Leave all unchecked to allow any integration in your organization."
          wide
          onClose={() => setCreateOpen(false)}
        >
          <form className="stack-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Name" hint="Shown in lists and when you bind access">
                <input
                  value={form.display_name}
                  onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                  required
                />
              </Field>
              <Field
                label="Client secret"
                hint="Leave empty to generate one. At least 16 characters if you set your own."
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.client_secret}
                  onChange={(event) => setForm((current) => ({ ...current, client_secret: event.target.value }))}
                />
              </Field>
              <Field label="Environment">
                <input
                  value={form.environment}
                  onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                  placeholder="production"
                />
              </Field>
              <Field label="Allowed integrations">
                <div className="check-grid">
                  {providerApps.map((app) => (
                    <label key={app.id} className="check-option">
                      <input
                        type="checkbox"
                        checked={form.allowed_provider_app_keys.includes(app.key)}
                        onChange={() => toggleProviderApp(app.key)}
                      />
                      <span>{app.display_name}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="modal-form-actions">
              <button type="button" className="ghost-button" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={pending}>
                {pending ? "Working…" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editId && editTarget ? (
        <Modal title="Edit client" description={editTarget.display_name} wide onClose={() => setEditId(null)}>
          <form className="stack-form" onSubmit={handleEditSubmit}>
            <div className="form-grid">
              <Field label="Client ID">
                <code className="inline-code">{editTarget.key}</code>
              </Field>
              <Field label="Name">
                <input
                  value={editForm.display_name}
                  onChange={(event) => setEditForm((current) => ({ ...current, display_name: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Environment">
                <input
                  value={editForm.environment}
                  onChange={(event) => setEditForm((current) => ({ ...current, environment: event.target.value }))}
                  placeholder="production"
                />
              </Field>
              <Field label="Status">
                <label className="check-option">
                  <input
                    type="checkbox"
                    checked={editForm.is_enabled}
                    onChange={(event) => setEditForm((current) => ({ ...current, is_enabled: event.target.checked }))}
                  />
                  <span>Enabled</span>
                </label>
              </Field>
              <Field label="Allowed integrations">
                <div className="check-grid">
                  {providerApps.map((app) => (
                    <label key={app.id} className="check-option">
                      <input
                        type="checkbox"
                        checked={editForm.allowed_provider_app_keys.includes(app.key)}
                        onChange={() => toggleEditProviderApp(app.key)}
                      />
                      <span>{app.display_name}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="modal-form-actions">
              <button type="button" className="ghost-button" onClick={() => setEditId(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={pending}>
                {pending ? "Working…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {removeId ? (
        <ConfirmModal
          title="Remove client"
          confirmLabel="Remove"
          confirmBusy={removeBusy}
          onCancel={() => setRemoveId(null)}
          onConfirm={() => void performRemove()}
        >
          <p className="lede">
            {removeTarget ? (
              <>
                <strong>{removeTarget.display_name}</strong> ({removeTarget.key}) will stop working for API calls that still reference it.
              </>
            ) : (
              "This client will be removed."
            )}
          </p>
          <p className="confirm-modal-hint muted">If Access still shows active rules for this client, remove or change them first.</p>
        </ConfirmModal>
      ) : null}

      {rotateId ? (
        <ConfirmModal
          title="Rotate client secret"
          confirmLabel="Rotate"
          confirmBusy={rotateBusy}
          onCancel={() => setRotateId(null)}
          onConfirm={() => void performRotate()}
        >
          <p className="lede">
            {rotateTarget ? (
              <>
                A new secret will be generated for <strong>{rotateTarget.display_name}</strong>. Update any scripts that use the old secret.
              </>
            ) : (
              "A new secret will be generated."
            )}
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
