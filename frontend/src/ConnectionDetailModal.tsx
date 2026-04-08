import { useEffect, useState } from "react";

import { api } from "./api";
import { Modal, StatusBadge } from "./components";
import type { IntegrationInstanceInspectOut } from "./types";
import { isApiError } from "./errors";
import {
  accessModeLabel,
  authModeLabel,
  connectionRowStatus,
  integrationTypeLabel,
  oauthProviderProductLabel,
  userConnectionStatusLabel,
} from "./integrationLabels";
import { DetailRow, DetailSection, RawJsonDisclosure } from "./object-detail-ui";
import { formatDateTime } from "./utils";

type Props = {
  open: boolean;
  instanceId: string | null;
  /** Bumps when the parent reloads the instance row (e.g. after connect/disconnect). */
  instanceVersion?: string | null;
  onClose: () => void;
  busy: boolean;
  isAdmin?: boolean;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onTest: (id: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function ConnectionDetailModal({
  open,
  instanceId,
  instanceVersion,
  onClose,
  busy,
  isAdmin,
  onConnect,
  onDisconnect,
  onTest,
  onEdit,
  onDelete,
}: Props) {
  const [data, setData] = useState<IntegrationInstanceInspectOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !instanceId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .integrationInstanceInspect(instanceId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(isApiError(e) ? e.message : "Could not load details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, instanceId, instanceVersion]);

  if (!open || !instanceId) {
    return null;
  }

  const inst = data?.instance;
  const intg = data?.integration;
  const uc = data?.user_connection;
  const profile = uc?.profile ?? {};
  const status = inst ? connectionRowStatus(inst) : { label: "…", tone: "neutral" as const };

  const summaryName =
    (typeof profile.display_name === "string" && profile.display_name.trim()) || inst?.name || "Connection";
  const summaryLine =
    (typeof profile.email === "string" && profile.email.trim()) ||
    (typeof profile.username === "string" && profile.username.trim()) ||
    null;
  const providerLabel = oauthProviderProductLabel(profile.provider);
  const oauthExpiresAt =
    typeof profile.oauth_expires_at === "string" && profile.oauth_expires_at.trim() ? profile.oauth_expires_at : null;
  const oauthLastRefreshAt =
    typeof profile.oauth_last_refresh_at === "string" && profile.oauth_last_refresh_at.trim()
      ? profile.oauth_last_refresh_at
      : null;

  return (
    <Modal
      title={summaryName}
      description={
        summaryLine
          ? `${summaryLine}${providerLabel ? ` · ${providerLabel}` : ""}`
          : intg
            ? `${intg.name} · ${integrationTypeLabel(intg.type)}`
            : undefined
      }
      wide
      onClose={onClose}
    >
      {loading ? <p className="muted-copy">Loading…</p> : null}
      {error ? <p className="muted-copy">{error}</p> : null}

      {inst && intg ? (
        <>
          <DetailSection title="Summary">
            <DetailRow label="Integration" value={intg.name} />
            <DetailRow label="Kind" value={integrationTypeLabel(intg.type)} />
            <DetailRow
              label="Connection status"
              value={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
            />
            <DetailRow label="Authentication" value={authModeLabel(inst.auth_mode)} />
            <DetailRow label="Traffic" value={accessModeLabel(inst.access_mode)} />
            <DetailRow label="Created" value={formatDateTime(inst.created_at)} />
            <DetailRow label="Last updated" value={formatDateTime(inst.updated_at)} />
          </DetailSection>

          {uc ? (
            <DetailSection title="Connected account">
              <DetailRow
                label="Link status"
                value={
                  <StatusBadge tone={uc.status === "active" ? "success" : "neutral"}>
                    {userConnectionStatusLabel(uc.status)}
                  </StatusBadge>
                }
              />
              <DetailRow label="Linked at" value={formatDateTime(uc.created_at)} />
              <DetailRow label="Last updated" value={formatDateTime(uc.updated_at)} />
              {typeof profile.display_name === "string" && profile.display_name.trim() ? (
                <DetailRow label="Display name" value={profile.display_name} />
              ) : null}
              {typeof profile.email === "string" && profile.email.trim() ? (
                <DetailRow label="Email" value={profile.email} />
              ) : null}
              {typeof profile.username === "string" && profile.username.trim() ? (
                <DetailRow label="Username" value={profile.username} />
              ) : null}
              {typeof profile.job_title === "string" && profile.job_title.trim() ? (
                <DetailRow label="Job title" value={profile.job_title} />
              ) : null}
              {typeof profile.scopes_granted === "string" && profile.scopes_granted.trim() ? (
                <DetailRow label="Granted scopes" value={<span className="detail-scopes">{profile.scopes_granted}</span>} />
              ) : null}
              <DetailRow
                label="Access token expires"
                value={oauthExpiresAt ? formatDateTime(oauthExpiresAt) : "Unknown"}
              />
              <DetailRow
                label="Last token refresh"
                value={oauthLastRefreshAt ? formatDateTime(oauthLastRefreshAt) : "Not refreshed yet"}
              />
              {typeof profile.tenant_id === "string" && profile.tenant_id.trim() ? (
                <DetailRow label="Tenant" value={profile.tenant_id} />
              ) : null}
            </DetailSection>
          ) : inst.auth_mode === "oauth" ? (
            <DetailSection title="Connected account">
              <p className="muted-copy">Sign in to link an account. Profile details appear here after a successful sign-in.</p>
            </DetailSection>
          ) : null}

          <RawJsonDisclosure
            title="Raw details"
            data={{
              instance: inst,
              integration: intg,
              user_connection: uc,
            }}
          />

          <div className="modal-form-actions">
            {isAdmin && onEdit ? (
              <button type="button" className="ghost-button" onClick={() => onEdit()} disabled={busy}>
                Edit
              </button>
            ) : null}
            {isAdmin && onDelete ? (
              <button type="button" className="ghost-button" onClick={() => onDelete()} disabled={busy}>
                Delete
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={() => onTest(instanceId)} disabled={busy}>
              Run check
            </button>
            {inst.auth_mode === "oauth" ? (
              inst.oauth_connected ? (
                <button type="button" className="ghost-button" onClick={() => onDisconnect(instanceId)} disabled={busy}>
                  Disconnect
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={() => onConnect(instanceId)} disabled={busy}>
                  Sign in
                </button>
              )
            ) : null}
            <button type="button" className="ghost-button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : !loading && !error ? (
        <p className="muted-copy">No data.</p>
      ) : null}
    </Modal>
  );
}
