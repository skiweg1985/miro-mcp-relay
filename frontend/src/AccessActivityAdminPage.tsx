import { useCallback, useEffect, useState } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { Card, Field, PageIntro, StatusBadge } from "./components";
import { isApiError } from "./errors";
import type { AccessUsageEventRow } from "./types";
import { formatDateTime, formatRelativeTime } from "./utils";

function outcomeTone(outcome: string): "success" | "danger" | "warn" | "neutral" {
  if (outcome === "success") return "success";
  if (outcome === "denied") return "danger";
  if (outcome === "error") return "warn";
  return "neutral";
}

type Filters = {
  userId: string;
  integrationId: string;
  accessGrantId: string;
  usageType: string;
  outcome: string;
  fromIso: string;
  toIso: string;
};

const defaultFilters = (): Filters => ({
  userId: "",
  integrationId: "",
  accessGrantId: "",
  usageType: "",
  outcome: "",
  fromIso: "",
  toIso: "",
});

export function AccessActivityAdminPage() {
  const { notify } = useAppContext();
  const [rows, setRows] = useState<AccessUsageEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.listAdminAccessUsageEvents({
        user_id: applied.userId.trim() || undefined,
        integration_id: applied.integrationId.trim() || undefined,
        access_grant_id: applied.accessGrantId.trim() || undefined,
        usage_type: applied.usageType.trim() || undefined,
        outcome: applied.outcome.trim() || undefined,
        from: applied.fromIso.trim() || undefined,
        to: applied.toIso.trim() || undefined,
        limit,
        offset,
      });
      setRows(res.events);
      setTotal(res.total);
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not load activity",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
      setRows([]);
      setTotal(0);
    } finally {
      setBusy(false);
    }
  }, [notify, applied, limit, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = () => {
    setApplied({ ...draft });
    setOffset(0);
  };

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <>
      <PageIntro
        eyebrow="Admin"
        title="Access activity"
        description="Structured access key usage across the organization. Filters apply when you choose Apply filters. The time range defaults to the last 7 days if From/To are empty."
      />

      <Card className="admin-users-panel">
        <div className="admin-users-toolbar" role="search" aria-label="Filter activity">
          <Field label="User ID">
            <input
              value={draft.userId}
              onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field label="Integration ID">
            <input
              value={draft.integrationId}
              onChange={(e) => setDraft((d) => ({ ...d, integrationId: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field label="Access grant ID">
            <input
              value={draft.accessGrantId}
              onChange={(e) => setDraft((d) => ({ ...d, accessGrantId: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field label="Usage type">
            <input
              value={draft.usageType}
              onChange={(e) => setDraft((d) => ({ ...d, usageType: e.target.value }))}
              placeholder="mcp, direct_token, …"
              autoComplete="off"
            />
          </Field>
          <Field label="Outcome">
            <select value={draft.outcome} onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value }))}>
              <option value="">Any</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="error">Error</option>
            </select>
          </Field>
          <Field label="From (ISO)">
            <input
              value={draft.fromIso}
              onChange={(e) => setDraft((d) => ({ ...d, fromIso: e.target.value }))}
              placeholder="UTC start"
              autoComplete="off"
            />
          </Field>
          <Field label="To (ISO)">
            <input
              value={draft.toIso}
              onChange={(e) => setDraft((d) => ({ ...d, toIso: e.target.value }))}
              placeholder="UTC end"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="modal-form-actions" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="primary-button" onClick={applyFilters}>
            Apply filters
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setDraft(defaultFilters());
              setApplied(defaultFilters());
              setOffset(0);
            }}
          >
            Reset
          </button>
        </div>
        <p className="muted-copy" style={{ marginTop: "0.75rem" }}>
          Long-term retention is configurable by operators. Request IDs correlate with gateways without storing secrets.
        </p>

        <div className="table-wrap" style={{ marginTop: "1rem" }}>
          <table className="data-table" aria-busy={busy}>
            <caption className="sr-only">Access usage events</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Outcome</th>
                <th scope="col">Usage</th>
                <th scope="col">Summary</th>
                <th scope="col">Access</th>
                <th scope="col">User</th>
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <span className="admin-users-meta">Loading…</span>
                  </td>
                </tr>
              ) : null}
              {!busy && rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <span className="admin-users-meta">No events for the current filters.</span>
                  </td>
                </tr>
              ) : null}
              {rows.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    <time dateTime={ev.created_at} title={formatDateTime(ev.created_at)}>
                      {formatRelativeTime(ev.created_at)}
                    </time>
                  </td>
                  <td>
                    <StatusBadge tone={outcomeTone(ev.outcome)}>{ev.outcome}</StatusBadge>
                  </td>
                  <td>
                    <code className="inline-code">{ev.usage_type}</code>
                  </td>
                  <td>{ev.summary}</td>
                  <td>
                    <code className="inline-code admin-users-truncate" title={ev.access_grant_id}>
                      {ev.access_grant_id}
                    </code>
                  </td>
                  <td>
                    <code className="inline-code admin-users-truncate" title={ev.user_id}>
                      {ev.user_id}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-users-pager">
          <span className="admin-users-meta" aria-live="polite">
            {total === 0 ? "0 events" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
          </span>
          <div className="admin-users-pager-actions">
            <button type="button" className="ghost-button" disabled={!canPrev || busy} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
              Previous
            </button>
            <button type="button" className="ghost-button" disabled={!canNext || busy} onClick={() => setOffset((o) => o + limit)}>
              Next
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}
