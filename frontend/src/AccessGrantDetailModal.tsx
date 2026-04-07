import { Modal, StatusBadge } from "./components";
import type { AccessGrantOut } from "./types";
import { accessGrantStatusLabel } from "./integrationLabels";
import { DetailRow, DetailSection, RawJsonDisclosure } from "./object-detail-ui";
import { formatDateTime } from "./utils";

type Props = {
  grant: AccessGrantOut;
  integrationName: string;
  onClose: () => void;
  onRevoke: () => void;
  busy: boolean;
};

export function AccessGrantDetailModal({ grant, integrationName, onClose, onRevoke, busy }: Props) {
  const statusTone =
    grant.status === "active" ? "success" : grant.status === "revoked" ? "danger" : "neutral";
  const tools =
    grant.allowed_tools?.length ? grant.allowed_tools.join(", ") : "All tools exposed by the connection";

  return (
    <Modal title={grant.name} description="Broker-issued access for an API client." wide onClose={onClose}>
      <DetailSection title="Summary">
        <DetailRow label="Client or app" value={grant.name} />
        <DetailRow label="Status" value={<StatusBadge tone={statusTone}>{accessGrantStatusLabel(grant.status)}</StatusBadge>} />
        <DetailRow label="Key prefix" value={grant.key_prefix} />
        <DetailRow label="Created" value={formatDateTime(grant.created_at)} />
        <DetailRow label="Expires" value={formatDateTime(grant.expires_at)} />
        <DetailRow label="Last used" value={formatDateTime(grant.last_used_at)} />
      </DetailSection>

      <DetailSection title="Routing">
        <DetailRow label="Integration" value={integrationName} />
        <DetailRow label="Connection" value={grant.integration_instance_name} />
        <DetailRow
          label="Bound connection"
          value={
            grant.user_connection_id ? (
              <span title={grant.user_connection_id}>Linked account</span>
            ) : (
              "Not bound to a specific linked account"
            )
          }
        />
      </DetailSection>

      <DetailSection title="Policy">
        <DetailRow label="Allowed tools" value={tools} />
        <DetailRow label="Policy reference" value={grant.policy_ref ?? "—"} />
        <DetailRow label="Notes" value={grant.notes ?? "—"} />
      </DetailSection>

      <RawJsonDisclosure title="Raw details" data={grant} />

      <div className="modal-form-actions">
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
