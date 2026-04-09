import { Modal, StatusBadge } from "./components";
import type { AccessGrantOut } from "./types";
import {
  accessGrantEffectiveStatusLabel,
  accessGrantInvalidationReasonLabel,
  accessGrantStatusLabel,
} from "./integrationLabels";
import { DetailRow, DetailSection, RawJsonDisclosure } from "./object-detail-ui";
import { formatDateTime } from "./utils";

type Props = {
  grant: AccessGrantOut;
  integrationName: string;
  onClose: () => void;
  onRevoke: () => void;
  onRemove?: () => void;
  onOpenUsage?: () => void;
  busy: boolean;
};

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

      <details className="grant-disclosure grant-disclosure--nested">
        <summary className="grant-disclosure-summary grant-disclosure-summary--sub">Technical details</summary>
        <div className="grant-detail-disclosure-body">
          <DetailRow label="Record status" value={accessGrantStatusLabel(grant.status)} />
          <DetailRow label="Key prefix" value={grant.key_prefix} />
          <DetailRow label="Created" value={formatDateTime(grant.created_at)} />
          <DetailRow label="Last used" value={formatDateTime(grant.last_used_at)} />
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
