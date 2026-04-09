import { useEffect, useState } from "react";

import { api } from "./api";
import { Modal, StatusBadge } from "./components";
import { isApiError } from "./errors";
import type { AccessGrantOut, AccessUsageEventRow } from "./types";
import {
  accessGrantEffectiveStatusLabel,
  accessGrantInvalidationReasonLabel,
  accessGrantStatusLabel,
} from "./integrationLabels";
import { DetailRow, DetailSection, RawJsonDisclosure } from "./object-detail-ui";
import { formatDateTime, formatRelativeTime, parseApiDateTime } from "./utils";

type Props = {
  grant: AccessGrantOut;
  integrationName: string;
  onClose: () => void;
  onRevoke: () => void;
  onRemove?: () => void;
  onOpenUsage?: () => void;
  busy: boolean;
};

function outcomeTone(outcome: string): "success" | "danger" | "warn" | "neutral" {
  if (outcome === "success") return "success";
  if (outcome === "denied") return "danger";
  if (outcome === "error") return "warn";
  return "neutral";
}

function lastOutcomeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "success") return "Success";
  if (value === "denied") return "Denied";
  if (value === "error") return "Error";
  return value;
}

export function AccessGrantDetailModal({ grant, integrationName, onClose, onRevoke, onRemove, onOpenUsage, busy }: Props) {
  const eff = grant.effective_status ?? grant.status;
  const statusTone =
    eff === "active"
      ? "success"
      : eff === "revoked"
        ? "danger"
        : eff === "invalid"
          ? "warn"
          : "neutral";
  const tools =
    grant.allowed_tools?.length ? grant.allowed_tools.join(", ") : "All tools exposed by the connection";
  const invLabel = accessGrantInvalidationReasonLabel(grant.invalidation_reason);

  const [activity, setActivity] = useState<AccessUsageEventRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    void api
      .listAccessGrantUsageEvents(grant.id, {
        outcome: activityFilter || undefined,
        limit: 30,
      })
      .then((res) => {
        if (!cancelled) setActivity(res.events);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setActivity([]);
          setActivityError(isApiError(error) ? error.message : "Could not load activity.");
        }
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [grant.id, activityFilter]);

  const recentlyActive =
    grant.last_used_at &&
    Date.now() - parseApiDateTime(grant.last_used_at).getTime() < 24 * 3600 * 1000;

  return (
    <Modal title={grant.name} wide onClose={onClose}>
      <DetailSection title="Overview">
        <DetailRow label="Access" value={grant.name} />
        <DetailRow
          label="Status"
          value={<StatusBadge tone={statusTone}>{accessGrantEffectiveStatusLabel(eff)}</StatusBadge>}
        />
        <DetailRow label="Integration" value={integrationName} />
        <DetailRow label="Connection" value={grant.integration_instance_name} />
        <DetailRow label="Expires" value={formatDateTime(grant.expires_at)} />
      </DetailSection>

      <DetailSection title="Activity">
        <DetailRow label="Last used" value={grant.last_used_at ? formatRelativeTime(grant.last_used_at) : "—"} />
        <DetailRow
          label="Total uses"
          value={typeof grant.usage_count_total === "number" ? String(grant.usage_count_total) : "—"}
        />
        <DetailRow label="Last result" value={lastOutcomeLabel(grant.last_outcome)} />
        <DetailRow
          label="Recent volume"
          value={`${grant.usage_count_24h ?? 0} / ${grant.usage_count_7d ?? 0} / ${grant.usage_count_30d ?? 0} (24h / 7d / 30d)`}
        />
        {recentlyActive ? (
          <p className="muted-copy">This key had traffic in the last 24 hours.</p>
        ) : grant.last_used_at ? (
          <p className="muted-copy">No traffic in the last 24 hours.</p>
        ) : (
          <p className="muted-copy">Not used yet.</p>
        )}

        <div style={{ marginTop: "0.75rem" }}>
          <label className="admin-users-label" htmlFor="access-activity-filter">
            Show
          </label>
          <select
            id="access-activity-filter"
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          >
            <option value="">All outcomes</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="error">Error</option>
          </select>
        </div>
        {activityLoading ? <p className="muted-copy">Loading activity…</p> : null}
        {activityError ? (
          <p className="muted-copy" role="alert">
            {activityError}
          </p>
        ) : null}
        {!activityLoading && !activityError && activity.length === 0 ? (
          <p className="muted-copy">No matching events yet.</p>
        ) : null}
        <ul className="access-activity-list" style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
          {activity.map((ev) => (
            <li
              key={ev.id}
              style={{
                borderBottom: "1px solid var(--border-subtle, #eee)",
                padding: "0.5rem 0",
                display: "grid",
                gap: "0.25rem",
              }}
            >
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <StatusBadge tone={outcomeTone(ev.outcome)}>{ev.outcome}</StatusBadge>
                <time dateTime={ev.created_at} className="muted-copy">
                  {formatRelativeTime(ev.created_at)}
                </time>
              </div>
              <div>{ev.summary}</div>
            </li>
          ))}
        </ul>
      </DetailSection>

      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Technical details</summary>
        <div className="grant-detail-disclosure-body">
          <DetailRow label="Record status" value={accessGrantStatusLabel(grant.status)} />
          <DetailRow label="Key prefix" value={grant.key_prefix} />
          <DetailRow label="Created" value={formatDateTime(grant.created_at)} />
          <DetailRow label="Last used (exact)" value={formatDateTime(grant.last_used_at)} />
          {grant.invalidated_at ? <DetailRow label="Invalidated" value={formatDateTime(grant.invalidated_at)} /> : null}
          {invLabel ? <DetailRow label="Reason" value={invLabel} /> : null}
          <DetailRow
            label="Bound account"
            value={
              grant.user_connection_id ? (
                <span title={grant.user_connection_id}>Linked account</span>
              ) : (
                "Not bound to a specific linked account"
              )
            }
          />
          <DetailRow label="Allowed tools" value={tools} />
          <DetailRow label="Upstream token API" value={grant.direct_token_access ? "On" : "Off"} />
          <DetailRow label="Policy reference" value={grant.policy_ref ?? "—"} />
          <DetailRow label="Notes" value={grant.notes ?? "—"} />
        </div>
      </details>

      <RawJsonDisclosure title="Raw details" data={grant} />

      <div className="modal-form-actions">
        {onOpenUsage ? (
          <button type="button" className="ghost-button" onClick={() => onOpenUsage()}>
            How to use
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" className="ghost-button" disabled={busy} onClick={() => onRemove()}>
            Remove from list
          </button>
        ) : null}
        <button
          type="button"
          className="ghost-button"
          disabled={busy || grant.status !== "active"}
          onClick={() => onRevoke()}
        >
          Revoke access
        </button>
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
