import { type ReactNode, useState } from "react";

import { useAppContext } from "./app-context";
import { copyToClipboard } from "./utils";

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-modal-section">
      <h3 className="detail-modal-section-title">{title}</h3>
      {children}
    </section>
  );
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-modal-row">
      <span className="detail-modal-row-label">{label}</span>
      <div className="detail-modal-row-value">{value ?? "—"}</div>
    </div>
  );
}

export function RawJsonDisclosure({ title, data }: { title: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  const { notify } = useAppContext();
  const text = JSON.stringify(data ?? null, null, 2);

  const copy = async () => {
    const ok = await copyToClipboard(text);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied" : "Copy failed",
    });
  };

  return (
    <div className="raw-json-disclosure">
      <button type="button" className="raw-json-disclosure-toggle" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="raw-json-disclosure-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="raw-json-disclosure-body">
          <pre className="raw-json-pre">{text}</pre>
          <div className="raw-json-disclosure-actions">
            <button type="button" className="ghost-button" onClick={() => void copy()}>
              Copy JSON
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
