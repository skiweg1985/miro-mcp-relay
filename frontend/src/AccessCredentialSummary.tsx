import { useMemo } from "react";

import { Card, CredentialRevealModal } from "./components";
import { useAppContext } from "./app-context";
import type { ConnectionAccessDetails } from "./types";
import { copyToClipboard } from "./utils";

function keyStatusDisplay(
  section: NonNullable<ConnectionAccessDetails["key_section"]>,
  canRotate: boolean,
): string {
  switch (section.status) {
    case "ready":
      return "New key ready — use Copy in the dialog";
    case "stored":
      if (!canRotate) {
        return "Not shown in the browser";
      }
      return "Hidden — create a new key to copy";
    case "none":
      return "No key yet";
    default:
      return "—";
  }
}

function AccessDetailRowView({
  label,
  value,
  copyable,
  monospace,
}: {
  label: string;
  value: string | null;
  copyable?: boolean;
  monospace?: boolean;
}) {
  const { notify } = useAppContext();
  const display = value ?? "—";

  const handleCopy = async () => {
    if (!value) return;
    const ok = await copyToClipboard(value);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied to clipboard" : "Clipboard unavailable",
      description: ok ? "Store this value somewhere safe before you navigate away." : "Your browser did not allow the copy action.",
    });
  };

  return (
    <div className="stack-cell access-credential-row">
      <strong>{label}</strong>
      <span className="access-credential-row-value">
        {monospace ? <code className="inline-code">{display}</code> : <span>{display}</span>}
        {copyable && value ? (
          <button type="button" className="ghost-button access-credential-copy-inline" onClick={() => void handleCopy()}>
            Copy
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function AccessCredentialSummary({
  details,
  loading,
  onRotate,
  rotatePending,
  cardTitle,
  cardDescription,
}: {
  details: ConnectionAccessDetails | null;
  loading?: boolean;
  onRotate?: () => void;
  rotatePending?: boolean;
  cardTitle?: string;
  cardDescription?: string;
}) {
  const revealSections = useMemo(() => {
    const plaintext = details?.key_section?.plaintext;
    if (!details?.supported || !plaintext) return null;
    const key = details.key_section;
    const sections: { title: string; body: string; value: string }[] = [
      {
        title: key?.label || "Key",
        body: "This value is shown only once. Save it in your app before you leave the page.",
        value: plaintext,
      },
    ];
    for (const block of details.extra_blocks) {
      sections.push({ title: block.title, body: block.body, value: block.value });
    }
    return sections;
  }, [details]);

  if (loading) {
    return (
      <Card title={cardTitle ?? "Connection details"} description={cardDescription ?? "Endpoint and key for tools that use this connection."}>
        <p className="muted">Loading…</p>
      </Card>
    );
  }

  if (!details || !details.supported) {
    return null;
  }

  const title = cardTitle ?? details.section_title ?? "Connection details";
  const metaLine = [details.connection_type_label, details.provider_display_name].filter(Boolean).join(" · ");
  const description = cardDescription ?? (metaLine || "Endpoint and key for tools that use this connection.");

  const key = details.key_section;
  const showRotate = Boolean(onRotate && details.can_rotate);
  const showStoredHint = key?.status === "stored" && !key.plaintext;

  return (
    <Card title={title} description={description}>
      {details.connection_summary ? (
        <p className="lede access-credential-summary-line">{details.connection_summary}</p>
      ) : null}

      <div className="stack-list">
        {details.rows.map((row, index) => (
          <AccessDetailRowView
            key={`${row.label}-${index}`}
            label={row.label}
            value={row.value}
            copyable={row.copyable}
            monospace={row.monospace}
          />
        ))}
        {key ? (
          <div className="stack-cell access-credential-row">
            <strong>{key.label || "Key"}</strong>
            <span className="access-credential-row-value">
              <span>{keyStatusDisplay(key, details.can_rotate)}</span>
            </span>
          </div>
        ) : null}
        <div className="stack-cell access-credential-row">
          <strong>Access</strong>
          <span>{details.connection_status_label ?? "—"}</span>
        </div>
      </div>

      {showRotate ? (
        <div className="inline-actions">
          <button type="button" className="primary-button" disabled={rotatePending} onClick={onRotate}>
            {rotatePending ? "Working…" : "Create new key"}
          </button>
          {details.manage_path ? (
            <a className="ghost-button" href={details.manage_path}>
              Manage connection
            </a>
          ) : null}
        </div>
      ) : details.manage_path ? (
        <div className="inline-actions">
          <a className="ghost-button" href={details.manage_path}>
            Manage connection
          </a>
        </div>
      ) : null}

      {showStoredHint && showRotate ? (
        <p className="lede">The current key still works elsewhere. Create a new key when you need to copy it again.</p>
      ) : null}

      {revealSections ? <CredentialRevealModal sections={revealSections} /> : null}
    </Card>
  );
}

/** Renders a neutral hint when no connection is selected yet (Add access flow). */
export function AccessCredentialConnectionHint() {
  return (
    <p className="muted form-hint access-credential-hint">Choose a connection to preview endpoint and key status when this integration supports it.</p>
  );
}
