import { useCallback, useEffect, useState } from "react";

import { useAppContext } from "./app-context";
import { api } from "./api";
import { Card, ConfirmModal, Field, Modal, PageIntro } from "./components";
import { isApiError } from "./errors";
import type {
  AdminUserDetailResponse,
  AdminUserLifecycleCounts,
  AdminUserListRow,
} from "./types";

function formatDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function OptionalTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="admin-users-meta">—</span>;
  return <time dateTime={iso}>{formatDt(iso)}</time>;
}

function formatAccountStatus(accountStatus: string): string {
  if (accountStatus === "active") return "Active";
  if (accountStatus === "disabled") return "Deactivated";
  if (accountStatus === "deleted") return "Removed";
  return accountStatus;
}

function statusBadgeClass(accountStatus: string): string {
  if (accountStatus === "active") return "success";
  if (accountStatus === "disabled") return "warn";
  return "danger";
}

function ImpactSummary({
  displayName,
  email,
  counts,
  verb,
}: {
  displayName: string;
  email: string;
  counts: AdminUserLifecycleCounts;
  verb: string;
}) {
  return (
    <div className="admin-users-impact">
      <p className="admin-users-body">
        {verb} <strong>{displayName}</strong> ({email}): end{" "}
        <strong>{counts.active_sessions}</strong> session{counts.active_sessions === 1 ? "" : "s"}, revoke{" "}
        <strong>{counts.access_keys_active}</strong> key{counts.access_keys_active === 1 ? "" : "s"}, clear tokens on{" "}
        <strong>{counts.connections_with_stored_oauth}</strong> connection{counts.connections_with_stored_oauth === 1 ? "" : "s"} (
        {counts.connections_total} total).
      </p>
    </div>
  );
}

export function UserManagementAdminPage() {
  const { session, notify } = useAppContext();
  const [rows, setRows] = useState<AdminUserListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState("active");
  const [providerKey, setProviderKey] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<AdminUserDetailResponse | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [providerOptions, setProviderOptions] = useState<{ key: string; label: string }[]>([]);

  const [confirmDeprovision, setConfirmDeprovision] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);
  const [confirmRevokeSessions, setConfirmRevokeSessions] = useState(false);
  const [confirmRevokeKeys, setConfirmRevokeKeys] = useState(false);
  const [hardDeleteEmail, setHardDeleteEmail] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchQ(searchDraft.trim()), 280);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const loadList = useCallback(async () => {
    setListBusy(true);
    setListError(null);
    try {
      const res = await api.listAdminUsers({
        status: statusFilter,
        q: searchQ || undefined,
        provider_key: providerKey || undefined,
        limit,
        offset,
      });
      setRows(res.users);
      setTotal(res.total);
    } catch (error) {
      const message = isApiError(error) ? error.message : "Something went wrong.";
      setListError(message);
      setRows([]);
      setTotal(0);
      notify({
        tone: "error",
        title: "Could not load directory",
        description: message,
      });
    } finally {
      setListBusy(false);
    }
  }, [limit, notify, offset, providerKey, searchQ, statusFilter]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void loadList();
  }, [loadList, session.status]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void api
      .listBrokerLoginProviders()
      .then((list) => {
        setProviderOptions(
          list.map((p) => ({
            key: p.provider_key,
            label: p.display_name || p.provider_key,
          })),
        );
      })
      .catch(() => setProviderOptions([]));
  }, [session.status]);

  const openDetail = async (userId: string) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailBusy(true);
    try {
      const d = await api.getAdminUserDetail(userId);
      setDetail(d);
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not open account",
        description: isApiError(error) ? error.message : "Unexpected error",
      });
      setDetailOpen(false);
    } finally {
      setDetailBusy(false);
    }
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetail(null);
    setHardDeleteEmail("");
    setConfirmDeprovision(false);
    setConfirmArchive(false);
    setConfirmHardDelete(false);
    setConfirmRevokeSessions(false);
    setConfirmRevokeKeys(false);
  };

  const runAction = async (fn: () => Promise<unknown>, successTitle: string, successBody?: string) => {
    if (session.status !== "authenticated") return;
    setActionBusy(true);
    try {
      await fn();
      notify({ tone: "success", title: successTitle, description: successBody });
      await loadList();
      if (detail?.id) {
        try {
          const d = await api.getAdminUserDetail(detail.id);
          setDetail(d);
        } catch {
          setDetail(null);
        }
      }
    } catch (error) {
      notify({
        tone: "error",
        title: "Action failed",
        description: isApiError(error) ? error.message : "Unexpected error",
      });
    } finally {
      setActionBusy(false);
      setConfirmDeprovision(false);
      setConfirmArchive(false);
      setConfirmHardDelete(false);
      setConfirmRevokeSessions(false);
      setConfirmRevokeKeys(false);
    }
  };

  const handleHardDelete = async () => {
    if (!detail || session.status !== "authenticated") return;
    const id = detail.id;
    setActionBusy(true);
    try {
      await api.adminHardDeleteUser(session.csrfToken, id, hardDeleteEmail);
      notify({ tone: "success", title: "Account removed", description: "Credentials and linked data were deleted." });
      closeDetail();
      await loadList();
    } catch (error) {
      notify({
        tone: "error",
        title: "Delete failed",
        description: isApiError(error) ? error.message : "Unexpected error",
      });
    } finally {
      setActionBusy(false);
      setConfirmHardDelete(false);
    }
  };

  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;

  return (
    <>
      <PageIntro
        eyebrow="Admin"
        title="Users"
        description="Search and manage member accounts, sessions, and access."
      />

      <Card className="admin-users-panel">
        {listError ? (
          <div className="admin-users-alert" role="alert">
            <p className="admin-users-body admin-users-body--tight">{listError}</p>
            <button type="button" className="secondary-button" onClick={() => void loadList()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="admin-users-toolbar" role="search" aria-label="Filter accounts">
          <Field label="Search">
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Name or email"
              autoComplete="off"
            />
          </Field>
          <Field label="Status">
            <select
              value={statusFilter}
              onChange={(e) => {
                setOffset(0);
                setStatusFilter(e.target.value);
              }}
            >
              <option value="active">Active</option>
              <option value="disabled">Deactivated</option>
              <option value="deleted">Removed</option>
              <option value="all">All</option>
            </select>
          </Field>
          <Field label="Sign-in">
            <select
              value={providerKey}
              onChange={(e) => {
                setOffset(0);
                setProviderKey(e.target.value);
              }}
            >
              <option value="">Any</option>
              {providerOptions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p id="admin-users-table-help" className="sr-only">
          Filter with search and status. Choose Details or activate a row to open the account.
        </p>
        <div className="table-wrap admin-users-table-wrap">
          <table className="data-table" aria-busy={listBusy} aria-describedby="admin-users-table-help">
            <caption className="sr-only">Member accounts</caption>
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Status</th>
                <th scope="col">Sign-in</th>
                <th scope="col">Last activity</th>
                <th scope="col">Access</th>
                <th scope="col" className="admin-users-col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listBusy && rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <span className="admin-users-meta">Loading…</span>
                  </td>
                </tr>
              ) : null}
              {!listBusy && !listError && rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="admin-users-empty">
                      <p className="admin-users-section-title">No matches</p>
                      <p className="admin-users-meta">Try another search or status filter.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
              {rows.map((u) => (
                <tr
                  key={u.id}
                  className="data-table-row--clickable"
                  tabIndex={0}
                  aria-label={`${u.display_name}, ${formatAccountStatus(u.account_status)}. Open details.`}
                  onClick={() => void openDetail(u.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openDetail(u.id);
                    }
                  }}
                >
                  <td className="table-cell-primary">
                    <div className="admin-users-cell-user">
                      <span className="admin-users-cell-name">{u.display_name}</span>
                      <span className="admin-users-meta admin-users-truncate" title={u.email}>
                        {u.email}
                      </span>
                      {u.is_admin ? (
                        <span className="status-badge neutral admin-users-role-badge" title="Administrator">
                          Admin
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(u.account_status)}`}>
                      {formatAccountStatus(u.account_status)}
                    </span>
                  </td>
                  <td>
                    <span className="admin-users-truncate" title={u.auth_summary}>
                      {u.auth_summary}
                    </span>
                  </td>
                  <td>
                    <OptionalTime iso={u.last_activity_at} />
                  </td>
                  <td>
                    <span className="admin-users-meta">
                      {u.access_keys_active} keys · {u.connections_total} connections
                    </span>
                  </td>
                  <td className="admin-users-col-actions">
                    <button
                      type="button"
                      className="ghost-button ghost-button--compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openDetail(u.id);
                      }}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-users-pager">
          <span className="admin-users-meta" aria-live="polite">
            {total === 0 ? "0 accounts" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
          </span>
          <div className="admin-users-pager-actions">
            <button type="button" className="ghost-button" disabled={!canGoPrev || listBusy} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
              Previous
            </button>
            <button type="button" className="ghost-button" disabled={!canGoNext || listBusy} onClick={() => setOffset((o) => o + limit)}>
              Next
            </button>
          </div>
        </div>
      </Card>

      {detailOpen ? (
        <Modal
          wide
          title={detail ? detail.display_name : "Account"}
          description={detail ? detail.email : undefined}
          onClose={() => {
            if (!actionBusy) closeDetail();
          }}
        >
          {detailBusy ? (
            <p className="admin-users-meta" aria-live="polite">
              Loading…
            </p>
          ) : null}
          {!detailBusy && detail ? (
            <div className="admin-users-detail">
              <section className="admin-users-detail-section" aria-labelledby="admin-users-profile-heading">
                <h3 id="admin-users-profile-heading" className="admin-users-section-title">
                  Profile
                </h3>
                <div className="admin-users-detail-grid">
                  <dl className="admin-users-dl">
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span className={`status-badge ${statusBadgeClass(detail.account_status)}`}>
                          {formatAccountStatus(detail.account_status)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Sign-in</dt>
                      <dd className="admin-users-truncate">{detail.auth_summary}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>
                        <OptionalTime iso={detail.created_at} />
                      </dd>
                    </div>
                    <div>
                      <dt>Last sign-in</dt>
                      <dd>
                        <OptionalTime iso={detail.last_login_at} />
                      </dd>
                    </div>
                    <div>
                      <dt>Last activity</dt>
                      <dd>
                        <OptionalTime iso={detail.last_activity_at} />
                      </dd>
                    </div>
                  </dl>
                  <ul className="admin-users-metrics" aria-label="Resource summary">
                    <li>
                      <span className="admin-users-metric-value">{detail.counts.active_sessions}</span>
                      <span className="admin-users-metric-label">Active sessions</span>
                    </li>
                    <li>
                      <span className="admin-users-metric-value">{detail.counts.access_keys_active}</span>
                      <span className="admin-users-metric-label">Usable keys</span>
                    </li>
                    <li>
                      <span className="admin-users-metric-value">
                        {detail.counts.access_keys_revoked} / {detail.counts.access_keys_invalid}
                      </span>
                      <span className="admin-users-metric-label">Revoked / invalid keys</span>
                    </li>
                    <li>
                      <span className="admin-users-metric-value">{detail.counts.connections_total}</span>
                      <span className="admin-users-metric-label">Connections</span>
                    </li>
                    <li>
                      <span className="admin-users-metric-value">{detail.counts.oauth_identities}</span>
                      <span className="admin-users-metric-label">Sign-in links</span>
                    </li>
                  </ul>
                </div>
              </section>

              <section className="admin-users-detail-section" aria-labelledby="admin-users-idp-heading">
                <h3 id="admin-users-idp-heading" className="admin-users-section-title">
                  Sign-in identities
                </h3>
                {detail.oauth_identities.length === 0 ? (
                  <p className="admin-users-meta">None (password or not linked).</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Provider</th>
                          <th scope="col">External ID</th>
                          <th scope="col">Email</th>
                          <th scope="col">Linked</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.oauth_identities.map((i) => (
                          <tr key={i.id}>
                            <td>{i.provider_key}</td>
                            <td>
                              <code className="inline-code admin-users-truncate" title={i.subject}>
                                {i.subject}
                              </code>
                            </td>
                            <td>
                              <span className="admin-users-truncate">{i.email ?? "—"}</span>
                            </td>
                            <td>
                              <OptionalTime iso={i.created_at} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="admin-users-detail-section" aria-labelledby="admin-users-sessions-heading">
                <h3 id="admin-users-sessions-heading" className="admin-users-section-title">
                  Sessions
                </h3>
                {detail.sessions.length === 0 ? (
                  <p className="admin-users-meta">None recorded.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">State</th>
                          <th scope="col">Started</th>
                          <th scope="col">Expires</th>
                          <th scope="col" className="admin-users-col-actions">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.sessions.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <span className={`status-badge ${s.is_active ? "success" : "neutral"}`}>
                                {s.is_active ? "Active" : "Ended"}
                              </span>
                            </td>
                            <td>
                              <OptionalTime iso={s.created_at} />
                            </td>
                            <td>
                              <OptionalTime iso={s.expires_at} />
                            </td>
                            <td className="admin-users-col-actions">
                              {s.is_active && session.status === "authenticated" ? (
                                <button
                                  type="button"
                                  className="ghost-button ghost-button--compact"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    void runAction(
                                      () => api.adminRevokeUserSession(session.csrfToken, detail.id, s.id),
                                      "Session ended",
                                    )
                                  }
                                >
                                  End
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="admin-users-detail-section" aria-labelledby="admin-users-conn-heading">
                <h3 id="admin-users-conn-heading" className="admin-users-section-title">
                  Connected integrations
                </h3>
                {detail.connections.length === 0 ? (
                  <p className="admin-users-meta">None.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Integration</th>
                          <th scope="col">Status</th>
                          <th scope="col">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.connections.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <span className="admin-users-truncate">{c.integration_instance_name}</span>
                            </td>
                            <td>{c.status}</td>
                            <td>{c.has_stored_oauth ? "Stored" : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="admin-users-detail-section" aria-labelledby="admin-users-keys-heading">
                <h3 id="admin-users-keys-heading" className="admin-users-section-title">
                  Access keys
                </h3>
                {detail.access_grants.length === 0 ? (
                  <p className="admin-users-meta">None.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Integration</th>
                          <th scope="col">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.access_grants.map((g) => (
                          <tr key={g.id} className={g.effective_status === "active" ? "" : "data-table-row--grant-muted"}>
                            <td className="table-cell-primary">
                              <span className="admin-users-truncate" title={`${g.name} · ${g.key_prefix}…`}>
                                {g.name}
                              </span>
                            </td>
                            <td>
                              <span className="admin-users-truncate">{g.integration_instance_name}</span>
                            </td>
                            <td>
                              <span className="status-badge neutral">{g.effective_status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {session.status === "authenticated" ? (
                <footer className="admin-users-footer">
                  <p className="admin-users-label">Actions</p>
                  <div className="admin-users-footer-actions">
                    {detail.account_status === "active" ? (
                      <>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmRevokeSessions(true)}>
                          End all sessions
                        </button>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmRevokeKeys(true)}>
                          Revoke all keys
                        </button>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmDeprovision(true)}>
                          Deactivate
                        </button>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmArchive(true)}>
                          Mark removed
                        </button>
                        <button type="button" className="ghost-button danger-text" disabled={actionBusy} onClick={() => setConfirmHardDelete(true)}>
                          Delete permanently…
                        </button>
                      </>
                    ) : null}
                    {detail.account_status === "disabled" ? (
                      <>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={actionBusy}
                          onClick={() =>
                            void runAction(() => api.adminReactivateUser(session.csrfToken, detail.id), "Account reactivated")
                          }
                        >
                          Reactivate
                        </button>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmArchive(true)}>
                          Mark removed
                        </button>
                        <button type="button" className="ghost-button danger-text" disabled={actionBusy} onClick={() => setConfirmHardDelete(true)}>
                          Delete permanently…
                        </button>
                      </>
                    ) : null}
                    {detail.account_status === "deleted" ? (
                      <>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={actionBusy}
                          onClick={() => void runAction(() => api.adminReactivateUser(session.csrfToken, detail.id), "Account restored")}
                        >
                          Restore
                        </button>
                        <button type="button" className="ghost-button danger-text" disabled={actionBusy} onClick={() => setConfirmHardDelete(true)}>
                          Delete permanently…
                        </button>
                      </>
                    ) : null}
                  </div>
                </footer>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}

      {confirmDeprovision && detail ? (
        <ConfirmModal
          title="Deactivate account?"
          confirmLabel="Deactivate"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmDeprovision(false)}
          onConfirm={() =>
            session.status === "authenticated"
              ? void runAction(
                  () => api.adminDeprovisionUser(session.csrfToken, detail.id),
                  "Account deactivated",
                  "Sessions ended, keys revoked, connections cleared.",
                )
              : undefined
          }
        >
          <ImpactSummary displayName={detail.display_name} email={detail.email} counts={detail.counts} verb="Deactivate" />
          <p className="admin-users-meta admin-users-body--tight">Sign-in stays blocked until an admin reactivates this account.</p>
        </ConfirmModal>
      ) : null}

      {confirmArchive && detail ? (
        <ConfirmModal
          title="Mark as removed?"
          confirmLabel="Mark removed"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmArchive(false)}
          onConfirm={() =>
            session.status === "authenticated"
              ? void runAction(
                  () => api.adminSoftDeleteUser(session.csrfToken, detail.id),
                  "Marked removed",
                  "Same cleanup as deactivation; record kept for audit.",
                )
              : undefined
          }
        >
          <ImpactSummary displayName={detail.display_name} email={detail.email} counts={detail.counts} verb="Mark removed" />
          <p className="admin-users-meta admin-users-body--tight">Sign-in blocked. You can restore the account later.</p>
        </ConfirmModal>
      ) : null}

      {confirmRevokeSessions && detail ? (
        <ConfirmModal
          title="End all sessions?"
          confirmLabel="End sessions"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmRevokeSessions(false)}
          onConfirm={() =>
            session.status === "authenticated"
              ? void runAction(
                  () => api.adminRevokeAllUserSessions(session.csrfToken, detail.id),
                  "Sessions ended",
                  `${detail.counts.active_sessions} session(s) closed.`,
                )
              : undefined
          }
        >
          <p className="admin-users-body">
            End <strong>{detail.counts.active_sessions}</strong> active session{detail.counts.active_sessions === 1 ? "" : "s"} for{" "}
            <strong>{detail.display_name}</strong>.
          </p>
        </ConfirmModal>
      ) : null}

      {confirmRevokeKeys && detail ? (
        <ConfirmModal
          title="Revoke all keys?"
          confirmLabel="Revoke keys"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmRevokeKeys(false)}
          onConfirm={() =>
            session.status === "authenticated"
              ? void runAction(
                  () => api.adminRevokeAllUserAccessKeys(session.csrfToken, detail.id),
                  "Keys revoked",
                  `${detail.counts.access_keys_active} key(s) revoked.`,
                )
              : undefined
          }
        >
          <p className="admin-users-body">
            Revoke <strong>{detail.counts.access_keys_active}</strong> usable key{detail.counts.access_keys_active === 1 ? "" : "s"} for{" "}
            <strong>{detail.display_name}</strong>. Connections stay linked.
          </p>
        </ConfirmModal>
      ) : null}

      {confirmHardDelete && detail ? (
        <ConfirmModal
          title="Delete permanently?"
          confirmLabel="Delete permanently"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmHardDelete(false)}
          onConfirm={() => void handleHardDelete()}
        >
          <ImpactSummary displayName={detail.display_name} email={detail.email} counts={detail.counts} verb="Permanently delete" />
          <p className="admin-users-body admin-users-body--danger">
            This cannot be undone. Sessions, identities, connections, and keys are deleted.
          </p>
          <Field label={`Confirm email (${detail.email})`}>
            <input
              type="email"
              value={hardDeleteEmail}
              onChange={(e) => setHardDeleteEmail(e.target.value)}
              autoComplete="off"
              placeholder={detail.email}
            />
          </Field>
        </ConfirmModal>
      ) : null}
    </>
  );
}
