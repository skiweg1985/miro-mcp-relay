import { type FormEvent, type ReactNode, useEffect, useId, useState, type Key } from "react";

import { useAppContext } from "./app-context";
import type { MiroRelayAccess } from "./types";
import { classNames, copyToClipboard } from "./utils";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="splash-screen">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ zIndex: 85 }}>
      <button type="button" className="modal-backdrop" aria-label="Dismiss" onClick={onClose} />
      <div className={classNames("modal-panel", wide && "modal-panel--wide")}>
        <div className="modal-panel-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="modal-panel-body compact-form">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirmBusy,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmBusy?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmBusy) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, confirmBusy]);

  return (
    <div
      className="modal-root confirm-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={confirmBusy ? "true" : undefined}
    >
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Dismiss"
        disabled={confirmBusy}
        onClick={() => {
          if (!confirmBusy) onCancel();
        }}
      />
      <div className="modal-panel modal-panel--confirm">
        <div className="modal-panel-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="modal-panel-body compact-form">
          {children}
          <div className="confirm-modal-actions">
            <button type="button" className="secondary-button" disabled={confirmBusy} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className="primary-button primary-button--danger" disabled={confirmBusy} onClick={onConfirm}>
              {confirmBusy ? "…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  description,
  children,
  className,
  headerActions,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerActions?: ReactNode;
}) {
  return (
    <section className={classNames("card", className)}>
      {title ? (
        <header className={classNames("card-header", headerActions ? "card-header--with-actions" : null)}>
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {headerActions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function DataTable({
  columns,
  rows,
  emptyTitle,
  emptyBody,
  tableClassName,
  wrapClassName,
  columnClasses,
  rowKey,
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyTitle: string;
  emptyBody: string;
  tableClassName?: string;
  wrapClassName?: string;
  columnClasses?: string[];
  rowKey?: (rowIndex: number) => Key;
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <div className={classNames("table-wrap", wrapClassName)}>
      <table className={classNames("data-table", tableClassName)}>
        <thead>
          <tr>
            {columns.map((column, columnIndex) => (
              <th key={columnIndex} className={columnClasses?.[columnIndex]}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowKey?.(rowIndex) ?? rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className={columnClasses?.[cellIndex]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export function SecretPanel({
  title,
  body,
  value,
}: {
  title: string;
  body: string;
  value: string;
}) {
  const [open, setOpen] = useState(true);
  const { notify } = useAppContext();

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied to clipboard" : "Clipboard unavailable",
      description: ok ? "Store this value somewhere safe before you navigate away." : "Your browser did not allow the copy action.",
    });
  };

  if (!open) {
    return null;
  }

  return (
    <Modal title={title} wide onClose={() => setOpen(false)}>
      <p className="eyebrow">Private</p>
      <p className="lede">{body}</p>
      <pre className="secret-value">{value}</pre>
      <div className="modal-form-actions">
        <button type="button" className="ghost-button" onClick={() => setOpen(false)}>
          Close
        </button>
        <button type="button" className="primary-button" onClick={() => void handleCopy()}>
          Copy
        </button>
      </div>
    </Modal>
  );
}

export type SecretModalSection = { title: string; body: string; value: string };

export function MiroConnectionSecretsModal({ sections }: { sections: SecretModalSection[] }) {
  const [open, setOpen] = useState(true);
  const { notify } = useAppContext();

  const copySection = async (value: string) => {
    const ok = await copyToClipboard(value);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied to clipboard" : "Clipboard unavailable",
      description: ok ? "Store this value somewhere safe before you navigate away." : "Your browser did not allow the copy action.",
    });
  };

  if (!open) {
    return null;
  }

  return (
    <Modal title="Miro connection details" wide onClose={() => setOpen(false)}>
      <p className="eyebrow">Private</p>
      <p className="lede">Copy these values now. They will not be shown again.</p>
      {sections.map((section, index) => (
        <div key={`${section.title}-${index}`} className="secret-modal-section">
          <h3>{section.title}</h3>
          <p>{section.body}</p>
          <pre className="secret-value">{section.value}</pre>
          <div className="secret-modal-section-actions">
            <button type="button" className="ghost-button" onClick={() => void copySection(section.value)}>
              Copy
            </button>
          </div>
        </div>
      ))}
      <div className="modal-form-actions">
        <button type="button" className="primary-button" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function CapabilityGate({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: ReactNode;
}) {
  return (
    <div className="capability-gate">
      <p className="eyebrow">Reserved capability</p>
      <h2>{title}</h2>
      <p>{body}</p>
      {cta ? <div className="inline-actions">{cta}</div> : null}
    </div>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warn" | "danger";
  children: ReactNode;
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint ? <span className="field-hint">{hint}</span> : null}
      {children}
    </label>
  );
}

export function FormActions({
  pending,
  submitLabel,
  onReset,
}: {
  pending: boolean;
  submitLabel: string;
  onReset?: () => void;
}) {
  return (
    <div className="form-actions">
      {onReset ? (
        <button type="button" className="ghost-button" onClick={onReset}>
          Reset
        </button>
      ) : null}
      <button type="submit" className="primary-button" disabled={pending}>
        {pending ? "Working..." : submitLabel}
      </button>
    </div>
  );
}

export function InlineForm({
  title,
  description,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return (
    <form className="stack-form" onSubmit={onSubmit}>
      <div className="stack-form-header">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="form-grid">{children}</div>
    </form>
  );
}

export function ToastViewport() {
  const { dismissToast, toasts } = useAppContext();
  return (
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast ${toast.tone}`}
          onClick={() => dismissToast(toast.id)}
        >
          <strong>{toast.title}</strong>
          {toast.description ? <span>{toast.description}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function MiroAccessCard({
  access,
  pending,
  onIssueToken,
  title = "Use Miro in other apps",
  description = "Copy the connection address and access key for the app that should use your Miro account.",
}: {
  access: MiroRelayAccess | null;
  pending: boolean;
  onIssueToken?: () => void;
  title?: string;
  description?: string;
}) {
  if (!access) {
    return (
      <Card title={title} description={description}>
        <EmptyState
          title="Miro not connected yet"
          body="Connect Miro first. Then this panel shows the connection address and lets you create a new access key when needed."
        />
      </Card>
    );
  }

  const tokenState = access.relay_token
    ? "New one-time access key ready"
    : access.has_relay_token
      ? "An access key exists but cannot be shown again"
      : "No access key yet";

  return (
    <Card title={title} description={description}>
      <div className="stack-list">
        <div className="stack-cell">
          <strong>Connection</strong>
          <span>{access.display_name || access.external_email || access.connected_account_id}</span>
        </div>
        <div className="stack-cell">
          <strong>Workspace ID</strong>
          <code className="inline-code">{access.profile_id}</code>
        </div>
        <div className="stack-cell">
          <strong>Connection address</strong>
          <code className="inline-code">{access.mcp_url}</code>
        </div>
        <div className="stack-cell">
          <strong>Access key</strong>
          <span>{tokenState}</span>
        </div>
        <div className="stack-cell">
          <strong>Status</strong>
          <span>{access.connection_status}</span>
        </div>
      </div>

      {onIssueToken ? (
        <div className="inline-actions">
          <button type="button" className="primary-button" disabled={pending} onClick={onIssueToken}>
            {pending ? "Working…" : access.has_relay_token ? "New access key" : "Create access key"}
          </button>
        </div>
      ) : null}

      {!access.relay_token && access.has_relay_token ? (
        <p className="lede">
          Other apps can keep using the current key, but it cannot be shown again here. Create a new access key when you need to copy
          fresh details from this page.
        </p>
      ) : null}

      {access.relay_token ? (
        <MiroConnectionSecretsModal
          sections={[
            {
              title: "Access key",
              body: "This value is shown only once. Save it in your app before you leave the page.",
              value: access.relay_token,
            },
            ...(access.mcp_config_json
              ? [
                  {
                    title: "App configuration (JSON)",
                    body: "Paste this into your app’s settings to use the Miro connection from this service.",
                    value: access.mcp_config_json,
                  },
                ]
              : []),
            ...(access.credentials_bundle_json
              ? [
                  {
                    title: "Combined setup (JSON)",
                    body: "Includes workspace ID and access key together for apps that need one block to paste.",
                    value: access.credentials_bundle_json,
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </Card>
  );
}
