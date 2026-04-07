import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { brokerUi } from "../brokerTerminology";
import { Card, ConfirmModal, EmptyState, StatusBadge } from "../components";
import { isApiError } from "../errors";
import type { SharedCredentialOut } from "../types";
import { formatDateTime } from "../utils";

export function SharedCredentialsPanel({
  appId,
  providerAppKey,
  csrfToken,
  onNotify,
}: {
  appId: string;
  providerAppKey: string;
  csrfToken: string;
  onNotify: (toast: { tone: "success" | "error" | "info"; title: string; description?: string }) => void;
}) {
  const [credentials, setCredentials] = useState<SharedCredentialOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.sharedCredentials(csrfToken, appId);
      setCredentials(data);
    } catch {
      // keep empty state
    } finally {
      setLoading(false);
    }
  }, [appId, csrfToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (id: string) => {
    setRevoking(true);
    try {
      await api.revokeSharedCredential(csrfToken, id);
      onNotify({ tone: "info", title: "Shared credential revoked" });
      await load();
    } catch (error) {
      onNotify({
        tone: "error",
        title: "Revoke failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setRevoking(false);
      setRevokeId(null);
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshing((prev) => new Set(prev).add(id));
    try {
      await api.refreshSharedCredential(csrfToken, id);
      onNotify({ tone: "success", title: "Token refreshed" });
      await load();
    } catch (error) {
      onNotify({
        tone: "error",
        title: "Refresh failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <Card title={brokerUi.sharedCredential}>
        <p className="muted">Loading…</p>
      </Card>
    );
  }

  return (
    <>
      <Card title="Shared credentials">
        {credentials.length === 0 ? (
          <EmptyState title="No shared credentials" body="Shared credentials allow all users to access this integration through admin-managed accounts." />
        ) : (
          <div className="stack-list">
            {credentials.map((cred) => (
              <div key={cred.id} className="stack-cell" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{cred.display_name || cred.external_email || cred.external_account_ref || cred.id}</strong>
                  <span className="muted" style={{ display: "block", fontSize: "0.85em" }}>
                    <StatusBadge tone={cred.status === "connected" ? "success" : "warn"}>{cred.status}</StatusBadge>
                    {" "}Managed by {cred.managed_by_display_name || "admin"} · {formatDateTime(cred.connected_at)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {cred.status === "connected" ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={refreshing.has(cred.id)}
                        onClick={() => handleRefresh(cred.id)}
                      >
                        {refreshing.has(cred.id) ? "Refreshing…" : "Refresh"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setRevokeId(cred.id)}
                      >
                        Revoke
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {revokeId ? (
        <ConfirmModal
          title="Revoke shared credential"
          confirmLabel="Revoke"
          confirmBusy={revoking}
          onCancel={() => setRevokeId(null)}
          onConfirm={() => void handleRevoke(revokeId)}
        >
          <p className="lede">
            This will revoke the shared credential. Users relying on shared access for this integration will lose access.
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
