'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
  getUsers, suspendUser, banUser, restoreUser, unbanUser, deleteUser,
  type UserRecord, type UserPage, type AdminVerificationPlan, type AdminVerificationState,
  type AppealRecord,
} from '@/lib/adminApi';
import {
  Users, Search, Shield, Ban, RotateCcw, Loader2,
  ChevronLeft, ChevronRight, RefreshCw, Trash2, ShieldCheck,
  UserX, Clock, BadgeCheck, History, X, ExternalLink,
} from 'lucide-react';
import ConsolePanel from '@/components/console/Panel';
import StatusBadge, { statusToneFor } from '@/components/console/StatusBadge';
import ConfirmDialog from '@/components/console/ConfirmDialog';
import {
  ConsoleErrorState, ConsoleEmptyState, SkeletonRows,
} from '@/components/console/States';
import { fmtNumber, fmtDate, timeAgo } from '@/components/console/format';

// ============================================================================
// ADMIN - USER MANAGEMENT
// ----------------------------------------------------------------------------
// Reads GET /api/admin/users/manage (server-side search, paginated, filterable) and performs the
// real, role-protected moderation actions the backend already exposes
// (suspend / ban / lift ban / restore / delete) plus selective
// confirmed first, and the result message reflects the confirmed backend
// response - nothing is optimistically reported as successful.
// ============================================================================

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'BANNED', label: 'Banned' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
  { value: 'LOCKED', label: 'Locked' },
];

const ROLE_OPTIONS = ['ALL', 'USER', 'CREATOR', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

const VERIFIED_OPTIONS = [
  { value: 'ALL', label: 'Verified & unverified' },
  { value: 'true', label: 'Verified only' },
  { value: 'false', label: 'Unverified only' },
];

const roleClass: Record<string, string> = {
  SUPER_ADMIN: 'text-console-gold',
  CEO: 'text-console-gold',
  FINANCE_MANAGER: 'text-console-gold',
  ADMIN: 'text-console-text',
  ADMINISTRATOR: 'text-console-text',
  MODERATOR: 'text-console-info',
  SUPPORT_AGENT: 'text-console-info',
  CONTENT_REVIEWER: 'text-console-info',
  CREATOR: 'text-console-info',
  USER: 'text-console-text-2',
};

const toneRing: Record<string, string> = {
  neutral: 'text-console-text-3 hover:bg-white/[0.06] hover:text-console-text',
  success: 'text-console-success hover:bg-console-success-soft',
  warning: 'text-console-warning hover:bg-console-warning-soft',
  danger: 'text-console-danger hover:bg-console-danger-soft',
  gold: 'text-console-gold hover:bg-console-gold-soft',
};

const ACTION_COPY: Record<'suspend' | 'ban' | 'delete', { title: string; message: string; confirm: string }> = {
  suspend: {
    title: 'Suspend account',
    message: 'The user will be temporarily blocked from signing in and using VANTA until the suspension is lifted. You can restore the account afterwards.',
    confirm: 'Suspend account',
  },
  ban: {
    title: 'Ban account',
    message: 'The user will be blocked from signing in and using VANTA until the ban is lifted. This is a stronger enforcement action than a suspension.',
    confirm: 'Ban account',
  },
  delete: {
    title: 'Delete account',
    message: 'This permanently removes the account and its associated data. This cannot be undone.',
    confirm: 'Delete permanently',
  },
};

export default function AdminUsersPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [data, setData] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState('ALL');
  const [role, setRole] = useState('ALL');
  const [verified, setVerified] = useState('ALL');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ user: UserRecord; action: 'suspend' | 'ban' | 'delete' } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await getUsers(token, {
        search: search || undefined,
        status: status === 'ALL' ? undefined : status,
        role: role === 'ALL' ? undefined : role,
        verified: verified === 'ALL' ? undefined : verified,
        page,
        limit: 25,
      });
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [token, search, status, role, verified, page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Return to the first page whenever a filter changes.
  useEffect(() => { setPage(1); }, [search, status, role, verified]);

  const run = async (action: 'suspend' | 'ban' | 'restore' | 'verify' | 'delete', user: UserRecord) => {
    if (!token || busyId) return;
    setBusyId(user.id);
    setNotice(null);
    try {
      if (action === 'suspend') await suspendUser(token, user.id);
      if (action === 'ban') await banUser(token, user.id);
      if (action === 'restore') await restoreUser(token, user.id);
      if (action === 'verify') await verifyUser(token, user.id);
      if (action === 'delete') await deleteUser(token, user.id);
      setModal(null);
      setNotice({ tone: 'success', text: `${action} completed for @${user.username}.` });
      await fetchData();
    } catch (err: any) {
      setNotice({ tone: 'danger', text: `Action failed: ${err?.message || 'please retry'}` });
    } finally {
      setBusyId(null);
    }
  };

  const users = data?.users ?? [];
  const filtersActive = Boolean(search) || status !== 'ALL' || role !== 'ALL' || verified !== 'ALL';

  return (
    <div className="space-y-5 pb-10">
      {/* Confirmed outcomes are announced to assistive technology */}
      <div aria-live="polite">
        {notice ? (
          <p
            role="status"
            className={cn(
              'rounded-[var(--vc-radius)] border px-3.5 py-2.5 text-xs',
              notice.tone === 'danger'
                ? 'border-console-danger/30 bg-console-danger-soft text-console-danger'
                : 'border-console-success/30 bg-console-success-soft text-console-success',
            )}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      {/* ------------------------------- Filters ------------------------------ */}
      <ConsolePanel title="Filters" bodyClassName="px-4 py-3.5 sm:px-5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-console-text-3" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users"
              placeholder="Username, email or name"
              className="vc-input w-full pl-9"
            />
          </div>

          <label className="sr-only" htmlFor="filter-status">Account status</label>
          <select id="filter-status" value={status} onChange={(e) => setStatus(e.target.value)} className="vc-select w-full">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <label className="sr-only" htmlFor="filter-role">Role</label>
          <select id="filter-role" value={role} onChange={(e) => setRole(e.target.value)} className="vc-select w-full">
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r === 'ALL' ? 'All roles' : r.replace(/_/g, ' ')}</option>)}
          </select>

          <label className="sr-only" htmlFor="filter-verified">Verification</label>
          <select id="filter-verified" value={verified} onChange={(e) => setVerified(e.target.value)} className="vc-select w-full">
            {VERIFIED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div className="flex items-center gap-2">
            <span className="flex min-h-[38px] flex-1 items-center gap-1.5 overflow-hidden rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 px-3 text-[11px] text-console-text-3">
              <Clock size={12} className="shrink-0" aria-hidden />
              <span className="truncate">{loading ? 'Loading' : `${fmtNumber(data?.total ?? 0)} users`}</span>
            </span>
            <button
              type="button"
              onClick={() => void fetchData()}
              aria-label="Reload user list"
              className="vc-focus grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[var(--vc-radius)] border border-console-border text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
            >
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        </div>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => { setSearch(''); setStatus('ALL'); setRole('ALL'); setVerified('ALL'); }}
            className="vc-focus mt-2.5 inline-flex min-h-8 items-center rounded-[var(--vc-radius)] px-2 text-[11px] font-semibold text-console-gold hover:text-console-gold-hover"
          >
            Clear all filters
          </button>
        ) : null}
      </ConsolePanel>

      {/* ------------------- Loading / error / empty / results ---------------- */}
      {loading ? (
        <div className="vc-panel"><SkeletonRows rows={8} /></div>
      ) : error ? (
        <ConsolePanel><ConsoleErrorState title="Couldn''t load users" message={error} onRetry={() => void fetchData()} /></ConsolePanel>
      ) : users.length === 0 ? (
        <ConsolePanel>
          <ConsoleEmptyState
            icon={<Users size={19} />}
            title={filtersActive ? 'No users match these filters' : 'No users found'}
            description={
              filtersActive
                ? 'Try a different search term, status, role or verification filter.'
                : 'The user management endpoint returned an empty result set.'
            }
            action={filtersActive ? (
              <button
                type="button"
                onClick={() => { setSearch(''); setStatus('ALL'); setRole('ALL'); setVerified('ALL'); }}
                className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-xs font-semibold text-console-text-2 hover:bg-white/[0.04]"
              >
                Clear filters
              </button>
            ) : undefined}
          />
        </ConsolePanel>
      ) : (
        <>
          {/* Desktop: dense table for efficient scanning */}
          <div className="vc-panel hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
              <table className="vc-table">
                <caption className="sr-only">Platform accounts with role, status and available moderation actions</caption>
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">Coins</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Last active</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const restricted = u.status === 'SUSPENDED' || u.status === 'BANNED';
                    const busy = busyId === u.id;
                    return (
                      <tr key={u.id}>
                        <td>
                          <span className="flex items-center gap-2.5">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-console-border bg-console-bg2 text-[10px] font-semibold text-console-text-2">
                              {(u.username || '?').charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-console-text">@{u.username}</span>
                              <span className="block truncate text-[11px] text-console-text-3">{u.fullName || '-'}</span>
                            </span>
                          </span>
                        </td>
                        <td className="max-w-[200px] truncate">{u.email || '-'}</td>
                        <td><span className={cn('text-[11px] font-semibold', roleClass[u.role] || 'text-console-text-2')}>{u.role}</span></td>
                        <td><StatusBadge tone={statusToneFor(u.status)} label={String(u.status || 'ACTIVE')} /></td>
                        <td className="text-right tabular-nums">{fmtNumber(u.coins)}</td>
                        <td className="whitespace-nowrap text-console-text-3">{fmtDate(u.createdAt)}</td>
                        <td className="whitespace-nowrap text-console-text-3">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : '-'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {busy ? (
                              <Loader2 size={13} className="animate-spin text-console-text-3" aria-label="Applying action" />
                            ) : restricted ? (
                              <IconAction label={`Restore @${u.username}`} onClick={() => void run('restore', u)} tone="success">
                                <RotateCcw size={14} />
                              </IconAction>
                            ) : (
                              <>
                                <IconAction
                                  label={u.verified ? `@${u.username} is already verified` : `Verify @${u.username}`}
                                  onClick={() => void run('verify', u)}
                                  tone={u.verified ? 'gold' : 'neutral'}
                                >
                                  <Shield size={14} />
                                </IconAction>
                                <IconAction label={`Suspend @${u.username}`} onClick={() => setModal({ user: u, action: 'suspend' })} tone="warning">
                                  <Ban size={14} />
                                </IconAction>
                                <IconAction label={`Ban @${u.username}`} onClick={() => setModal({ user: u, action: 'ban' })} tone="danger">
                                  <UserX size={14} />
                                </IconAction>
                                <IconAction label={`Delete @${u.username}`} onClick={() => setModal({ user: u, action: 'delete' })} tone="danger">
                                  <Trash2 size={14} />
                                </IconAction>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: compact record list - prioritised fields, all actions kept */}
          <ul className="vc-panel divide-y divide-console-border lg:hidden">
            {users.map((u) => {
              const restricted = u.status === 'SUSPENDED' || u.status === 'BANNED';
              const busy = busyId === u.id;
              return (
                <li key={u.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-console-border bg-console-bg2 text-[11px] font-semibold text-console-text-2">
                      {(u.username || '?').charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[13px] font-medium text-console-text">@{u.username}</span>
                        <span className={cn('text-[10px] font-semibold uppercase', roleClass[u.role] || 'text-console-text-2')}>{u.role}</span>
                        {u.verified ? <ShieldCheck size={12} className="shrink-0 text-console-info" aria-label="Verified" /> : null}
                      </p>
                      <p className="mt-0.5 break-all text-[11px] text-console-text-3">{u.email || 'No email on record'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-console-text-3">
                        <StatusBadge tone={statusToneFor(u.status)} label={String(u.status || 'ACTIVE')} />
                        <span className="tabular-nums">{fmtNumber(u.coins)} coins</span>
                        <span>Joined {fmtDate(u.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 border-t border-console-border pt-3">
                    {busy ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-console-text-3">
                        <Loader2 size={13} className="animate-spin" aria-hidden /> Applying action...
                      </span>
                    ) : restricted ? (
                      <ActionButton label={`Restore @${u.username}`} onClick={() => void run('restore', u)} icon={<RotateCcw size={13} />}>Restore</ActionButton>
                    ) : (
                      <>
                        <ActionButton label={`Verify @${u.username}`} onClick={() => void run('verify', u)} icon={<Shield size={13} />}>Verify</ActionButton>
                        <ActionButton label={`Suspend @${u.username}`} onClick={() => setModal({ user: u, action: 'suspend' })} icon={<Ban size={13} />}>Suspend</ActionButton>
                        <ActionButton label={`Ban @${u.username}`} onClick={() => setModal({ user: u, action: 'ban' })} tone="danger" icon={<UserX size={13} />}>Ban</ActionButton>
                        <ActionButton label={`Delete @${u.username}`} onClick={() => setModal({ user: u, action: 'delete' })} tone="danger" icon={<Trash2 size={13} />}>Delete</ActionButton>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ------------------------------ Pagination ---------------------------- */}
      {data && data.pages > 1 ? (
        <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="vc-focus inline-flex min-h-9 items-center gap-1 rounded-[var(--vc-radius)] border border-console-border px-3 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
          >
            <ChevronLeft size={14} aria-hidden /> Previous
          </button>
          <span className="px-2 text-xs tabular-nums text-console-text-3">Page {page} of {data.pages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page >= data.pages}
            className="vc-focus inline-flex min-h-9 items-center gap-1 rounded-[var(--vc-radius)] border border-console-border px-3 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
          >
            Next <ChevronRight size={14} aria-hidden />
          </button>
        </nav>
      ) : null}

      {/* --------------------- Confirmation for consequences ------------------- */}
      {modal ? (
        <ConfirmDialog
          open
          tone="danger"
          title={ACTION_COPY[modal.action].title}
          message={ACTION_COPY[modal.action].message}
          confirmLabel={ACTION_COPY[modal.action].confirm}
          busy={busyId === modal.user.id}
          details={
            <>
              Target account: <strong className="text-console-text-2">@{modal.user.username}</strong> - role {modal.user.role}
            </>
          }
          onConfirm={() => void run(modal.action, modal.user)}
          onCancel={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Local action controls. Both are real <button> elements carrying an
   accessible name, never clickable generic containers.
   --------------------------------------------------------------------------- */

function IconAction({ label, onClick, tone = 'neutral', children }: { label: string; onClick: () => void; tone?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('vc-focus grid h-8 w-8 place-items-center rounded-[var(--vc-radius)] transition-colors', toneRing[tone])}
    >
      {children}
    </button>
  );
}

function ActionButton({ label, onClick, tone = 'neutral', icon, children }: { label: string; onClick: () => void; tone?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'vc-focus inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border px-2 text-[11px] font-semibold transition-colors',
        tone === 'danger' ? 'text-console-danger hover:bg-console-danger-soft' : 'text-console-text-2 hover:bg-white/[0.04] hover:text-console-text',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

