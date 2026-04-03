import { type FormEvent, type ReactNode, useMemo, useState } from "react";

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
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames("card", className)}>
      {title ? (
        <header className="card-header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
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
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
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
  const [revealed, setRevealed] = useState(false);
  const { notify } = useAppContext();
  const maskedValue = useMemo(() => "•".repeat(Math.max(18, value.length)), [value]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied to clipboard" : "Clipboard unavailable",
      description: ok ? "Store this value somewhere safe before you navigate away." : "Your browser did not allow the copy action.",
    });
  };

  return (
    <div className="secret-panel">
      <div className="secret-panel-header">
        <div>
          <p className="eyebrow">One-time secret</p>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={() => setRevealed((current) => !current)}>
            {revealed ? "Hide value" : "Reveal value"}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleCopy()}>
            Copy
          </button>
        </div>
      </div>
      <pre className="secret-value">{revealed ? value : maskedValue}</pre>
    </div>
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
