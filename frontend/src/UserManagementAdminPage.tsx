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
    <div className="user-admin-impact">
      <p className="lede">
        You are about to {verb} <strong>{displayName}</strong> ({email}).
      </p>
      <p className="lede">This will affect the following:</p>
      <ul className="user-admin-impact-list">
        <li>
          End <strong>{counts.active_sessions}</strong> active browser session{counts.active_sessions === 1 ? "" : "s"}.
        </li>
        <li>
          Revoke <strong>{counts.access_keys_active}</strong> usable access key{counts.access_keys_active === 1 ? "" : "s"}.
        </li>
        <li>
          Clear stored OAuth on <strong>{counts.connections_with_stored_oauth}</strong> connection
          {counts.connections_with_stored_oauth === 1 ? "" : "s"} ({counts.connections_total} total).
        </li>
      </ul>
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
      notify({
        tone: "error",
        title: "Could not load users",
        description: isApiError(error) ? error.message : "Unexpected error",
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
        title: "Could not load user",
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
      notify({ tone: "success", title: "User removed", description: "The account and related credentials were deleted." });
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
        title="Users"
        description="Search accounts, review access keys and connections, and control sign-in for your organization."
      />

      <Card title="Directory">
        <div className="user-admin-toolbar form-grid">
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
          <Field label="Sign-in provider">
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

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Sign-in</th>
                <th>Created</th>
                <th>Last activity</th>
                <th>Keys</th>
                <th>Connections</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listBusy && rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <span className="muted">Loading…</span>
                  </td>
                </tr>
              ) : null}
              {!listBusy && rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <span className="muted">No users match the current filters.</span>
                  </td>
                </tr>
              ) : null}
              {rows.map((u) => (
                <tr key={u.id} className="data-table-row--clickable">
                  <td className="table-cell-primary">
                    <strong>{u.display_name}</strong>
                    <div className="table-cell-sub muted">{u.email}</div>
                    {u.is_admin ? (
                      <span className="status-badge neutral" style={{ marginTop: 6, display: "inline-block" }}>
                        Admin
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(u.account_status)}`}>{u.account_status}</span>
                  </td>
                  <td>{u.auth_summary}</td>
                  <td>{formatDt(u.created_at)}</td>
                  <td>{formatDt(u.last_activity_at)}</td>
                  <td>
                    {u.access_keys_active} active
                    <div className="table-cell-sub muted">{u.access_keys_total} total</div>
                  </td>
                  <td>{u.connections_total}</td>
                  <td>
                    <button type="button" className="ghost-button" onClick={() => void openDetail(u.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-form-actions user-admin-pager">
          <span className="muted">
            {total === 0 ? "0 users" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
          </span>
          <div>
            <button type="button" className="ghost-button" disabled={!canGoPrev || listBusy} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
              Previous
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!canGoNext || listBusy}
              onClick={() => setOffset((o) => o + limit)}
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      {detailOpen ? (
        <Modal
          wide
          title={detail ? detail.display_name : "User"}
          description={detail ? detail.email : undefined}
          onClose={() => {
            if (!actionBusy) closeDetail();
          }}
        >
          {detailBusy ? <p className="muted">Loading…</p> : null}
          {!detailBusy && detail ? (
            <>
              <div className="user-admin-detail-grid">
                <Card title="Summary">
                  <dl className="user-admin-dl">
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span className={`status-badge ${statusBadgeClass(detail.account_status)}`}>{detail.account_status}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Sign-in</dt>
                      <dd>{detail.auth_summary}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatDt(detail.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Last sign-in</dt>
                      <dd>{formatDt(detail.last_login_at)}</dd>
                    </div>
                    <div>
                      <dt>Last activity</dt>
                      <dd>{formatDt(detail.last_activity_at)}</dd>
                    </div>
                  </dl>
                </Card>
                <Card title="Footprint">
                  <ul className="user-admin-metric-list">
                    <li>
                      <strong>{detail.counts.active_sessions}</strong> active sessions
                    </li>
                    <li>
                      <strong>{detail.counts.access_keys_active}</strong> usable access keys
                    </li>
                    <li>
                      <strong>{detail.counts.access_keys_revoked}</strong> revoked ·{" "}
                      <strong>{detail.counts.access_keys_invalid}</strong> invalid
                    </li>
                    <li>
                      <strong>{detail.counts.connections_total}</strong> connections (
                      {detail.counts.connections_with_stored_oauth} with stored OAuth)
                    </li>
                    <li>
                      <strong>{detail.counts.oauth_identities}</strong> broker login link{detail.counts.oauth_identities === 1 ? "" : "s"}
                    </li>
                  </ul>
                </Card>
              </div>

              <Card title="Broker login identities">
                {detail.oauth_identities.length === 0 ? (
                  <p className="muted">No OIDC identities (password-only or not yet linked).</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Provider</th>
                          <th>Subject</th>
                          <th>Linked email</th>
                          <th>Since</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.oauth_identities.map((i) => (
                          <tr key={i.id}>
                            <td>{i.provider_key}</td>
                            <td>
                              <code className="inline-code">{i.subject}</code>
                            </td>
                            <td>{i.email ?? "—"}</td>
                            <td>{formatDt(i.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="Sessions">
                {detail.sessions.length === 0 ? (
                  <p className="muted">No recent sessions recorded.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>State</th>
                          <th>Started</th>
                          <th>Expires</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {detail.sessions.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <span className={`status-badge ${s.is_active ? "success" : "neutral"}`}>
                                {s.is_active ? "active" : "ended"}
                              </span>
                            </td>
                            <td>{formatDt(s.created_at)}</td>
                            <td>{formatDt(s.expires_at)}</td>
                            <td>
                              {s.is_active && session.status === "authenticated" ? (
                                <button
                                  type="button"
                                  className="ghost-button"
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
              </Card>

              <Card title="Connections">
                {detail.connections.length === 0 ? (
                  <p className="muted">No integration connections.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Integration instance</th>
                          <th>Status</th>
                          <th>OAuth stored</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.connections.map((c) => (
                          <tr key={c.id}>
                            <td>{c.integration_instance_name}</td>
                            <td>{c.status}</td>
                            <td>{c.has_stored_oauth ? "yes" : "no"}</td>
                            <td>{formatDt(c.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="Access keys">
                {detail.access_grants.length === 0 ? (
                  <p className="muted">No access keys.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Instance</th>
                          <th>Status</th>
                          <th>Prefix</th>
                          <th>Last used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.access_grants.map((g) => (
                          <tr key={g.id} className={g.effective_status === "active" ? "" : "data-table-row--grant-muted"}>
                            <td className="table-cell-primary">{g.name}</td>
                            <td>{g.integration_instance_name}</td>
                            <td>
                              <span className="status-badge neutral">{g.effective_status}</span>
                            </td>
                            <td>
                              <code className="inline-code">{g.key_prefix}…</code>
                            </td>
                            <td>{formatDt(g.last_used_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {session.status === "authenticated" ? (
                <div className="user-admin-actions">
                  <p className="eyebrow">Actions</p>
                  <div className="user-admin-action-row">
                    {detail.account_status === "active" ? (
                      <>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmRevokeSessions(true)}>
                          End all sessions
                        </button>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmRevokeKeys(true)}>
                          Revoke all access keys
                        </button>
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setConfirmDeprovision(true)}>
                          Deactivate account
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
                          Reactivate account
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
                          onClick={() =>
                            void runAction(() => api.adminReactivateUser(session.csrfToken, detail.id), "Account restored")
                          }
                        >
                          Restore account
                        </button>
                        <button type="button" className="ghost-button danger-text" disabled={actionBusy} onClick={() => setConfirmHardDelete(true)}>
                          Delete permanently…
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
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
                  "Sessions ended, access keys revoked, and connections cleared.",
                )
              : undefined
          }
        >
          <ImpactSummary displayName={detail.display_name} email={detail.email} counts={detail.counts} verb="deactivate" />
          <p className="lede">The user will not be able to sign in until an administrator reactivates the account.</p>
        </ConfirmModal>
      ) : null}

      {confirmArchive && detail ? (
        <ConfirmModal
          title="Mark user as removed?"
          confirmLabel="Mark removed"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmArchive(false)}
          onConfirm={() =>
            session.status === "authenticated"
              ? void runAction(
                  () => api.adminSoftDeleteUser(session.csrfToken, detail.id),
                  "Account marked removed",
                  "Same cleanup as deactivation; the record stays for audit with removed status.",
                )
              : undefined
          }
        >
          <ImpactSummary displayName={detail.display_name} email={detail.email} counts={detail.counts} verb="mark as removed" />
          <p className="lede">The account is labeled removed and cannot sign in. You can still restore it later.</p>
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
                  `${detail.counts.active_sessions} session(s) revoked.`,
                )
              : undefined
          }
        >
          <p className="lede">
            End <strong>{detail.counts.active_sessions}</strong> active session{detail.counts.active_sessions === 1 ? "" : "s"} for{" "}
            <strong>{detail.display_name}</strong>.
          </p>
        </ConfirmModal>
      ) : null}

      {confirmRevokeKeys && detail ? (
        <ConfirmModal
          title="Revoke all access keys?"
          confirmLabel="Revoke keys"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmRevokeKeys(false)}
          onConfirm={() =>
            session.status === "authenticated"
              ? void runAction(
                  () => api.adminRevokeAllUserAccessKeys(session.csrfToken, detail.id),
                  "Access keys revoked",
                  `${detail.counts.access_keys_active} key(s) revoked.`,
                )
              : undefined
          }
        >
          <p className="lede">
            Revoke <strong>{detail.counts.access_keys_active}</strong> usable access key{detail.counts.access_keys_active === 1 ? "" : "s"} for{" "}
            <strong>{detail.display_name}</strong>. Integration connections are not removed.
          </p>
        </ConfirmModal>
      ) : null}

      {confirmHardDelete && detail ? (
        <ConfirmModal
          title="Delete user permanently?"
          confirmLabel="Delete permanently"
          confirmBusy={actionBusy}
          onCancel={() => !actionBusy && setConfirmHardDelete(false)}
          onConfirm={() => void handleHardDelete()}
        >
          <ImpactSummary displayName={detail.display_name} email={detail.email} counts={detail.counts} verb="permanently delete" />
          <p className="lede danger-text">This cannot be undone. All sessions, identities, connections, and access keys for this user are deleted.</p>
          <Field label={`Type the user email to confirm (${detail.email})`}>
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
