import { type FormEvent, useEffect, useState } from "react";

import { api } from "../api";
import { Card, DataTable, Field, Modal, PageIntro, SecretPanel } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type { ProviderAppOut, ServiceClientCreateResult, ServiceClientFormValues, ServiceClientOut } from "../types";
import { formatDateTime } from "../utils";

export function ServicesPage() {
  const { notify, session } = useAppContext();
  const [providerApps, setProviderApps] = useState<ProviderAppOut[]>([]);
  const [clients, setClients] = useState<ServiceClientOut[]>([]);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdResult, setCreatedResult] = useState<ServiceClientCreateResult | null>(null);
  const [form, setForm] = useState<ServiceClientFormValues>({
    key: "",
    display_name: "",
    environment: "",
    allowed_provider_app_keys: [],
  });

  const load = async () => {
    if (session.status !== "authenticated") return;
    const [providerAppData, clientData] = await Promise.all([
      api.providerApps(session.csrfToken),
      api.serviceClients(session.csrfToken),
    ]);
    setProviderApps(providerAppData);
    setClients(clientData);
  };

  useEffect(() => {
    void load().catch((error) =>
      notify({
        tone: "error",
        title: "Could not load services",
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    setPending(true);
    try {
      const result = await api.createServiceClient(session.csrfToken, form);
      setCreatedResult(result);
      setForm({
        key: "",
        display_name: "",
        environment: "",
        allowed_provider_app_keys: [],
      });
      setCreateOpen(false);
      notify({ tone: "success", title: "Service created" });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create service",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageIntro
        title="Services"
        description="Internal apps authenticated with a shared secret."
        actions={
          <button type="button" className="primary-button" onClick={() => setCreateOpen(true)}>
            Add service
          </button>
        }
      />
      {createdResult ? (
        <SecretPanel
          title="Client secret"
          body={`Store this secret for ${createdResult.service_client.display_name} now. It is only shown once.`}
          value={createdResult.client_secret}
        />
      ) : null}

      <Card title="All services">
        <DataTable
          columns={["Name", "Key", "Environment", "Created"]}
          rows={clients.map((client) => [
            client.display_name,
            client.key,
            client.environment ?? "—",
            formatDateTime(client.created_at),
          ])}
          emptyTitle="No services"
          emptyBody="Create a service to obtain API credentials."
        />
      </Card>

      {createOpen ? (
        <Modal
          title="Add service"
          description="Pick which integrations this caller may use."
          wide
          onClose={() => setCreateOpen(false)}
        >
          <form className="stack-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Key">
                <input value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} required />
              </Field>
              <Field label="Display name">
                <input
                  value={form.display_name}
                  onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                  required
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
    </>
  );
}
