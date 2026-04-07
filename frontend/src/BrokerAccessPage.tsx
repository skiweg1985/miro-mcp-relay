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
        title: "Laden fehlgeschlagen",
        description: isApiError(error) ? error.message : "Unbekannter Fehler",
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
      notify({ tone: "success", title: "Access Key erstellt" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Access Key fehlgeschlagen",
        description: isApiError(error) ? error.message : "Unbekannter Fehler",
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
      notify({ tone: "success", title: "Access Grant widerrufen" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Widerruf fehlgeschlagen",
        description: isApiError(error) ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageIntro
        title="Broker-Zugang"
        description="Access Keys berechtigen Clients gegen diesen Broker. Sie ersetzen keine OAuth- oder API-Anmeldedaten des Zielsystems."
      />

      <Card title="Access Key erstellen">
        <form className="stack-form" onSubmit={createGrant}>
          <div className="form-grid">
            <Field label="Integration Instance">
              <select value={instanceId} onChange={(event) => setInstanceId(event.target.value)} required>
                <option value="">Bitte wählen</option>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bezeichnung">
              <input value={label} onChange={(event) => setLabel(event.target.value)} required />
            </Field>
            <Field label="Erlaubte Tools (optional)">
              <textarea
                value={allowedTools}
                onChange={(event) => setAllowedTools(event.target.value)}
                placeholder="Komma- oder zeilengetrennt; leer = keine zusätzliche Einschränkung"
              />
            </Field>
          </div>
          <div className="modal-form-actions">
            <button type="submit" className="primary-button" disabled={busy || !instances.length}>
              Access Key erzeugen
            </button>
          </div>
        </form>
      </Card>

      {revealedKey ? (
        <Card title="Access Key (einmalig)">
          <p className="muted">
            Der vollständige Key wird nur in diesem Schritt angezeigt. Er authentifiziert Anfragen an diesen Broker, nicht
            das Zielsystem.
          </p>
          <pre className="grant-code-block">{revealedKey}</pre>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" onClick={() => void copyToClipboard(revealedKey).then(() => notify({ tone: "info", title: "Kopiert" }))}>
              Kopieren
            </button>
            <button type="button" className="primary-button" onClick={() => setRevealedKey(null)}>
              Schließen
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Access Grants">
        <div className="stack-list">
          {grants.map((grant) => (
            <div className="stack-cell" key={grant.id}>
              <div>
                <strong>{grant.name}</strong>
                <span>
                  {grant.integration_instance_name} · {grant.key_prefix}… · {grant.status}
                </span>
                <span className="muted">
                  zuletzt: {formatDateTime(grant.last_used_at)} · ablauf: {formatDateTime(grant.expires_at)}
                </span>
              </div>
              <button type="button" className="ghost-button" disabled={busy || grant.status !== "active"} onClick={() => void revoke(grant.id)}>
                Widerrufen
              </button>
            </div>
          ))}
          {!grants.length ? <p className="muted">Keine Access Grants vorhanden.</p> : null}
        </div>
      </Card>
    </>
  );
}
