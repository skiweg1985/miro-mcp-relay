import { type FormEvent, type ReactNode, useEffect, useId, useState, type Key } from "react";

import { useAppContext } from "./app-context";
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
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
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
        <div className="modal-panel-body compact-form">
          {description ? <p className="modal-panel-desc">{description}</p> : null}
          {children ?? null}
        </div>
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
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
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
  rowClassName,
  wrapKey,
  onRowClick,
  getRowAriaLabel,
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyTitle: string;
  emptyBody: string;
  tableClassName?: string;
  wrapClassName?: string;
  columnClasses?: string[];
  rowKey?: (rowIndex: number) => Key;
  rowClassName?: (rowIndex: number) => string | undefined;
  wrapKey?: string;
  onRowClick?: (rowIndex: number) => void;
  getRowAriaLabel?: (rowIndex: number) => string;
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <div key={wrapKey} className={classNames("table-wrap", wrapClassName)}>
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
            <tr
              key={rowKey?.(rowIndex) ?? rowIndex}
              className={classNames(
                onRowClick && "data-table-row--clickable",
                rowClassName?.(rowIndex),
              )}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? getRowAriaLabel?.(rowIndex) ?? "Open details" : undefined}
              onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(rowIndex);
                      }
                    }
                  : undefined
              }
            >
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
    <Modal title={title} description={body} wide onClose={() => setOpen(false)}>
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

export function CredentialRevealModal({ sections }: { sections: SecretModalSection[] }) {
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
    <Modal
      title="Connection details"
      description="Copy these values now. They will not be shown again."
      wide
      onClose={() => setOpen(false)}
    >
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

export const MiroConnectionSecretsModal = CredentialRevealModal;

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
