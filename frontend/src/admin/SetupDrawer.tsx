import { type ReactNode } from "react";

import { useAppContext } from "../app-context";
import { classNames, copyToClipboard } from "../utils";

export type WizardStep = { id: string; label: string };

export function SetupDrawer({
  title,
  subtitle,
  steps,
  activeStepIndex,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  activeStepIndex: number;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button type="button" className="drawer-backdrop" aria-label="Close" onClick={onClose} />
      <div className={classNames("drawer-panel", wide && "drawer-panel-wide")}>
        <header className="drawer-header">
          <div>
            <p className="drawer-kicker">Configuration</p>
            <h2 id="drawer-title">{title}</h2>
            {subtitle ? <p className="drawer-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="drawer-close" onClick={onClose}>
            Close
          </button>
        </header>

        <nav className="wizard-progress" aria-label="Steps">
          <ol>
            {steps.map((step, index) => {
              const done = index < activeStepIndex;
              const current = index === activeStepIndex;
              return (
                <li key={step.id} className={classNames("wizard-step", done && "wizard-step-done", current && "wizard-step-current")}>
                  <span className="wizard-step-index">{index + 1}</span>
                  <span className="wizard-step-label">{step.label}</span>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="drawer-body">{children}</div>
        <footer className="drawer-footer">{footer}</footer>
      </div>
    </div>
  );
}

export function ReadOnlyCopyField({ label, value }: { label: string; value: string }) {
  const { notify } = useAppContext();
  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    notify({
      tone: ok ? "success" : "error",
      title: ok ? "Copied" : "Copy failed",
      description: ok ? "Paste it into your provider configuration." : "Your browser blocked clipboard access.",
    });
  };
  return (
    <label className="readonly-copy-field">
      <span className="field-label">{label}</span>
      <div className="readonly-copy-row">
        <input readOnly value={value} className="readonly-input" />
        <button type="button" className="secondary-button" onClick={() => void handleCopy()}>
          Copy
        </button>
      </div>
      <p className="field-hint">Register this exact URL in your identity provider. It cannot be changed here.</p>
    </label>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{value}</span>
    </div>
  );
}
