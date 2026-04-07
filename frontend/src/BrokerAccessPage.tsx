import { useEffect, useState, type FormEvent } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { Card, Field, PageIntro } from "./components";
import type { AccessGrantCreatedResponse, AccessGrantOut, IntegrationInstanceV2Out } from "./types";
import { copyToClipboard, formatDateTime } from "./utils";
import { isApiError } from "./errors";

export function BrokerAccessPage() {
  const { session, notify } = useAppContext();
  const [instances, setInstances] = useState<IntegrationInstanceV2Out[]>([]);
  const [grants, setGrants] = useState<AccessGrantOut[]>([]);
  const [instanceId, setInstanceId] = useState("");
  const [label, setLabel] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const load = async () => {
    const [ins, g] = await Promise.all([api.integrationInstancesV2(), api.accessGrants()]);
    setInstances(ins);
    setGrants(g);
    if (!instanceId && ins[0]) {
      setInstanceId(ins[0].id);
    }
  };

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      notify({
        tone: "error",
        title: "Could not load data",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    });
  }, [session.status]);

  const createGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== "authenticated" || !instanceId) return;
    setBusy(true);
    try {
      const tools = allowedTools
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const created: AccessGrantCreatedResponse = await api.createAccessGrant(session.csrfToken, {
        integration_instance_id: instanceId,
        name: label.trim(),
        allowed_tools: tools,
      });
      setGrants((prev) => [created.grant, ...prev]);
      setLabel("");
      setAllowedTools("");
      setRevealedKey(created.access_key);
      notify({ tone: "success", title: "Access key created" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create access key",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (grantId: string) => {
    if (session.status !== "authenticated") return;
    setBusy(true);
    try {
      const updated = await api.revokeAccessGrant(session.csrfToken, grantId);
      setGrants((prev) => prev.map((row) => (row.id === grantId ? updated : row)));
      notify({ tone: "success", title: "Access revoked" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not revoke",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageIntro
        title="Access"
        description="Access keys authorize clients to this broker. They do not replace sign-in to the upstream system."
      />

      <Card title="New access key">
        <form className="stack-form" onSubmit={createGrant}>
          <div className="form-grid">
            <Field label="Connection">
              <select value={instanceId} onChange={(event) => setInstanceId(event.target.value)} required>
                <option value="">Select…</option>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input value={label} onChange={(event) => setLabel(event.target.value)} required />
            </Field>
            <Field label="Allowed tools" hint="Comma or line separated. Leave empty for no extra restriction.">
              <textarea
                value={allowedTools}
                onChange={(event) => setAllowedTools(event.target.value)}
                placeholder="tool_a, tool_b"
              />
            </Field>
          </div>
          <div className="modal-form-actions">
            <button type="submit" className="primary-button" disabled={busy || !instances.length}>
              Create access key
            </button>
          </div>
        </form>
      </Card>

      {revealedKey ? (
        <Card title="Access key">
          <p className="muted-copy">
            This value is shown only once. It authenticates requests to the broker, not to the upstream service.
          </p>
          <pre className="secret-value">{revealedKey}</pre>
          <div className="modal-form-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                void copyToClipboard(revealedKey).then(() => notify({ tone: "success", title: "Copied" }))
              }
            >
              Copy
            </button>
            <button type="button" className="primary-button" onClick={() => setRevealedKey(null)}>
              Done
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Access grants">
        <div className="stack-list">
          {grants.map((grant) => (
            <div className="stack-cell stack-cell--row" key={grant.id}>
              <div>
                <strong>{grant.name}</strong>
                <span className="muted-copy">
                  {grant.integration_instance_name} · {grant.key_prefix}… · {grant.status}
                </span>
                <span className="muted-copy">
                  Last used {formatDateTime(grant.last_used_at)} · Expires {formatDateTime(grant.expires_at)}
                </span>
              </div>
              <button
                type="button"
                className="ghost-button"
                disabled={busy || grant.status !== "active"}
                onClick={() => void revoke(grant.id)}
              >
                Revoke
              </button>
            </div>
          ))}
          {!grants.length ? <p className="muted-copy">No access grants yet.</p> : null}
        </div>
      </Card>
    </>
  );
}
