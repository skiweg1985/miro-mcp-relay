import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { AccessGrantDetailModal } from "./AccessGrantDetailModal";
import { AccessGrantUsageModal } from "./AccessGrantUsageModal";
import { Card, ConfirmModal, DataTable, Field, Modal, PageIntro, StatusBadge } from "./components";
import type { AccessGrantCreatedResponse, AccessGrantOut, IntegrationInstanceV2Out, IntegrationV2Out } from "./types";
import { copyToClipboard, formatDateTime } from "./utils";
import { isApiError } from "./errors";
import { accessGrantEffectiveStatusLabel, canRemoveAccessGrant } from "./integrationLabels";

function AccessKeyCreateModal({
  open,
  onClose,
  instances,
  integrations,
  csrfToken,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  instances: IntegrationInstanceV2Out[];
  integrations: IntegrationV2Out[];
  csrfToken: string;
  onCreated: (payload: AccessGrantCreatedResponse) => void;
  onError: (message: string) => void;
}) {
  const [instanceId, setInstanceId] = useState("");
  const [label, setLabel] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [busy, setBusy] = useState(false);

  const maxExpiryDays = 3650;

  useEffect(() => {
    if (!open) return;
    setInstanceId(instances[0]?.id ?? "");
    setLabel("");
    setAllowedTools("");
    setExpiryDays("");
  }, [open, instances]);

  if (!open) {
    return null;
  }

  const integrationLabel = (ins: IntegrationInstanceV2Out) => {
    const int = integrations.find((i) => i.id === ins.integration_id);
    return int ? `${ins.name} · ${int.name}` : ins.name;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!instanceId) return;
    setBusy(true);
    try {
      const tools = allowedTools
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const trimmedDays = expiryDays.trim();
      let expiresAt: string | undefined;
      if (trimmedDays !== "") {
        const days = Number.parseInt(trimmedDays, 10);
        if (!Number.isFinite(days) || days < 1) {
          onError("Expiry must be a whole number of days, at least 1.");
          return;
        }
        if (days > maxExpiryDays) {
          onError(`Expiry cannot exceed ${maxExpiryDays} days.`);
          return;
        }
        expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      }
      const created = await api.createAccessGrant(csrfToken, {
        integration_instance_id: instanceId,
        name: label.trim(),
        allowed_tools: tools,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      });
      onCreated(created);
      onClose();
    } catch (error) {
      onError(isApiError(error) ? error.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New access key"
      description="Keys let a client call this broker on behalf of a connection. Store them like passwords."
      wide
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Connection">
            <select value={instanceId} onChange={(event) => setInstanceId(event.target.value)} required>
              <option value="">Choose…</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {integrationLabel(instance)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Client or app name">
            <input value={label} onChange={(event) => setLabel(event.target.value)} required />
          </Field>
          <Field label="Allowed tools" hint="Comma or line separated. Leave empty to allow all tools the connection exposes.">
            <textarea
              value={allowedTools}
              onChange={(event) => setAllowedTools(event.target.value)}
              placeholder="tool_a, tool_b"
            />
          </Field>
          <Field
            label="Expires after (days)"
            hint={`Whole days from now (1–${maxExpiryDays}). Leave blank for no expiry.`}
          >
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value.replace(/\s/g, ""))}
            />
          </Field>
        </div>
        <div className="modal-form-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy || !instances.length}>
            Create key
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function BrokerAccessPage() {
  const { session, notify } = useAppContext();
  const [instances, setInstances] = useState<IntegrationInstanceV2Out[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationV2Out[]>([]);
  const [grants, setGrants] = useState<AccessGrantOut[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [lastCreatedGrantId, setLastCreatedGrantId] = useState<string | null>(null);
  const [detailGrant, setDetailGrant] = useState<AccessGrantOut | null>(null);
  const [usageGrant, setUsageGrant] = useState<AccessGrantOut | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AccessGrantOut | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AccessGrantOut | null>(null);

  const load = useCallback(async () => {
    const [ins, i, g] = await Promise.all([
      api.integrationInstancesV2(),
      api.integrationsV2(),
      api.accessGrants(),
    ]);
    setInstances(ins);
    setIntegrations(i);
    setGrants(g);
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void load().catch((error) => {
      notify({
        tone: "error",
        title: "Could not load data",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    });
  }, [session.status, load, notify]);

  const integrationNameForInstance = useCallback(
    (instanceId: string) => {
      const inst = instances.find((x) => x.id === instanceId);
      if (!inst) return "—";
      const int = integrations.find((x) => x.id === inst.integration_id);
      return int?.name ?? "—";
    },
    [instances, integrations],
  );

  const instanceForGrant = useCallback(
    (grant: AccessGrantOut) => instances.find((row) => row.id === grant.integration_instance_id) ?? null,
    [instances],
  );

  const integrationForInstance = useCallback(
    (instance: IntegrationInstanceV2Out | null) =>
      instance ? integrations.find((row) => row.id === instance.integration_id) ?? null : null,
    [integrations],
  );

  const performRevoke = useCallback(
    async (grantId: string) => {
      if (session.status !== "authenticated") return;
      setBusy(true);
      try {
        const updated = await api.revokeAccessGrant(session.csrfToken, grantId);
        setGrants((prev) => prev.map((row) => (row.id === grantId ? updated : row)));
        notify({ tone: "success", title: "Access key revoked", description: "Clients using this key can no longer authenticate." });
        setDetailGrant((g) => (g?.id === grantId ? updated : g));
      } catch (error) {
        notify({
          tone: "error",
          title: "Could not revoke",
          description: isApiError(error) ? error.message : "Unexpected error.",
        });
      } finally {
        setBusy(false);
      }
    },
    [session, notify],
  );

  const performRemove = useCallback(
    async (grantId: string) => {
      if (session.status !== "authenticated") return;
      setBusy(true);
      try {
        await api.deleteAccessGrant(session.csrfToken, grantId);
        setGrants((prev) => prev.filter((row) => row.id !== grantId));
        notify({ tone: "success", title: "Access key removed from list" });
        setDetailGrant((g) => (g?.id === grantId ? null : g));
      } catch (error) {
        notify({
          tone: "error",
          title: "Could not remove",
          description: isApiError(error) ? error.message : "Unexpected error.",
        });
      } finally {
        setBusy(false);
      }
    },
    [session, notify],
  );

  const rows = useMemo(() => {
    return grants.map((grant) => {
      const intName = integrationNameForInstance(grant.integration_instance_id);
      const eff = grant.effective_status ?? grant.status;
      const statusTone =
        eff === "active"
          ? "success"
          : eff === "revoked"
            ? "danger"
            : eff === "invalid"
              ? "warn"
              : "neutral";
      return [
        <span key="n">{grant.name}</span>,
        <span key="i">{intName}</span>,
        <span key="c">{grant.integration_instance_name}</span>,
        <StatusBadge key="s" tone={statusTone}>
          {accessGrantEffectiveStatusLabel(eff)}
        </StatusBadge>,
        <span key="e">{formatDateTime(grant.expires_at)}</span>,
        <div key="a" className="inline-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="ghost-button" onClick={() => setUsageGrant(grant)} aria-label="Usage instructions">
            Usage
          </button>
          <button type="button" className="ghost-button" onClick={() => setDetailGrant(grant)}>
            Open
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={busy || grant.status !== "active"}
            onClick={() => setRevokeTarget(grant)}
          >
            Revoke
          </button>
          {canRemoveAccessGrant(grant) ? (
            <button type="button" className="ghost-button" disabled={busy} onClick={() => setRemoveTarget(grant)}>
              Remove
            </button>
          ) : null}
        </div>,
      ];
    });
  }, [grants, integrationNameForInstance, busy]);

  const csrf = session.status === "authenticated" ? session.csrfToken : "";

  return (
    <>
      {revokeTarget ? (
        <ConfirmModal
          title="Revoke access key?"
          confirmLabel="Revoke key"
          confirmBusy={busy}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={() => {
            const id = revokeTarget.id;
            setRevokeTarget(null);
            void performRevoke(id);
          }}
        >
          <p>
            You are about to revoke <strong>{revokeTarget.name}</strong>. Clients using this key will no longer be able to
            authenticate to the broker. This does not remove upstream OAuth tokens from provider systems.
          </p>
        </ConfirmModal>
      ) : null}

      {removeTarget ? (
        <ConfirmModal
          title="Remove access key from list?"
          confirmLabel="Remove"
          confirmBusy={busy}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => {
            const id = removeTarget.id;
            setRemoveTarget(null);
            void performRemove(id);
          }}
        >
          <p>
            This removes the record for <strong>{removeTarget.name}</strong> from your workspace. Revoked or invalid keys can be
            removed safely when you no longer need the history.
          </p>
        </ConfirmModal>
      ) : null}

      <PageIntro
        title="Access"
        description="Access keys authorize API clients to this broker. They are not the same as user sign-in to an upstream system."
        actions={
          <button type="button" className="primary-button" onClick={() => setCreateOpen(true)} disabled={!instances.length}>
            New access key
          </button>
        }
      />

      {usageGrant ? (
        <AccessGrantUsageModal
          grant={usageGrant}
          integration={integrationForInstance(instanceForGrant(usageGrant))}
          instance={instanceForGrant(usageGrant)}
          onClose={() => setUsageGrant(null)}
        />
      ) : null}

      {detailGrant ? (
        <AccessGrantDetailModal
          grant={detailGrant}
          integrationName={integrationNameForInstance(detailGrant.integration_instance_id)}
          onClose={() => setDetailGrant(null)}
          onRevoke={() => setRevokeTarget(detailGrant)}
          onRemove={canRemoveAccessGrant(detailGrant) ? () => setRemoveTarget(detailGrant) : undefined}
          onOpenUsage={() => {
            setUsageGrant(detailGrant);
            setDetailGrant(null);
          }}
          busy={busy}
        />
      ) : null}

      {session.status === "authenticated" ? (
        <AccessKeyCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          instances={instances}
          integrations={integrations}
          csrfToken={csrf}
          onCreated={(created) => {
            setGrants((prev) => [created.grant, ...prev]);
            setRevealedKey(created.access_key);
            setLastCreatedGrantId(created.grant.id);
            notify({ tone: "success", title: "Access key created" });
          }}
          onError={(message) => notify({ tone: "error", title: "Could not create access key", description: message })}
        />
      ) : null}

      {revealedKey ? (
        <Card title="Your new key">
          <p className="muted-copy">Shown once. It authenticates the client to the broker.</p>
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
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                const g = lastCreatedGrantId ? grants.find((row) => row.id === lastCreatedGrantId) : null;
                if (g) setUsageGrant(g);
              }}
            >
              How to use
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setRevealedKey(null);
                setLastCreatedGrantId(null);
              }}
            >
              Done
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Access keys">
        <DataTable
          columns={["Client or app", "Integration", "Connection", "Status", "Expires", "Actions"]}
          rows={rows}
          emptyTitle="No access keys"
          emptyBody="Create a key and give it to the app that should call the broker."
          onRowClick={(rowIndex) => {
            const g = grants[rowIndex];
            if (g) setDetailGrant(g);
          }}
          getRowAriaLabel={(rowIndex) => `Access key ${grants[rowIndex]?.name ?? ""}`}
        />
      </Card>
    </>
  );
}
