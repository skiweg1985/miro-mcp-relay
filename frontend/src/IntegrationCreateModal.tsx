import { useEffect, useState, type FormEvent } from "react";

import { api } from "./api";
import { Field, Modal } from "./components";
import type { IntegrationV2Out } from "./types";
import { isApiError } from "./errors";
import { integrationTypeLabel } from "./integrationLabels";

const TYPES = [
  { value: "mcp_server" as const, label: "MCP server", hint: "Model Context Protocol tools and resources." },
  { value: "oauth_provider" as const, label: "OAuth provider", hint: "Sign-in flows for external services." },
  { value: "api" as const, label: "API", hint: "HTTP APIs exposed through the broker." },
];

type Step = 1 | 2;

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (created: IntegrationV2Out) => void;
  onError: (message: string) => void;
  csrfToken: string;
};

export function IntegrationCreateModal({ open, onClose, onCreated, onError, csrfToken }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [step1Type, setStep1Type] = useState<(typeof TYPES)[number]["value"]>("mcp_server");
  const [integrationName, setIntegrationName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setStep1Type("mcp_server");
    setIntegrationName("");
    setEndpoint("");
  }, [open]);

  if (!open) {
    return null;
  }

  const goNext = (event: FormEvent) => {
    event.preventDefault();
    setStep(2);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api.createIntegrationV2(csrfToken, {
        name: integrationName.trim(),
        type: step1Type,
        config: { endpoint: endpoint.trim() },
        mcp_enabled: step1Type === "mcp_server",
      });
      onCreated(created);
      onClose();
    } catch (error) {
      onError(isApiError(error) ? error.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add integration"
      description="An integration is the definition of an external system. You add connections to use it."
      wide
      onClose={onClose}
    >
      {step === 1 ? (
        <form className="stack-form" onSubmit={goNext}>
          <div className="form-grid">
            <Field label="Kind">
              <select
                value={step1Type}
                onChange={(event) => setStep1Type(event.target.value as (typeof TYPES)[number]["value"])}
              >
                {TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="muted-copy">{TYPES.find((t) => t.value === step1Type)?.hint}</p>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Continue
            </button>
          </div>
        </form>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          <p className="muted-copy">Kind: {integrationTypeLabel(step1Type)}</p>
          <div className="form-grid">
            <Field label="Name">
              <input value={integrationName} onChange={(event) => setIntegrationName(event.target.value)} required />
            </Field>
            <Field label="Endpoint URL">
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://example.local/mcp"
                required
              />
            </Field>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(1)}>
              Back
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              Save integration
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
