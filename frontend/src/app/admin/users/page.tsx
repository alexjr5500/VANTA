'use client';

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
  getUsers, suspendUser, banUser, restoreUser, verifyUser, deleteUser,
  type UserRecord, type UserPage,
} from '@/lib/adminApi';
import Button from '@/components/ui/Button';
import {
  Users, Search, Shield, Ban, RotateCcw, Loader2, AlertTriangle,
  ChevronLeft, ChevronRight, RefreshCw, Trash2, ShieldCheck,
  UserX, Filter, Clock,
} from 'lucide-react';

// ============================================================================
// Helpers
// ============================================================================

const fmt = (n: number) => n.toLocaleString('en-US');

const statusConfig: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-400' },
  SUSPENDED: { label: 'Suspended', cls: 'bg-yellow-500/15 text-yellow-400' },
  BANNED: { label: 'Banned', cls: 'bg-red-500/15 text-red-400' },
  DEACTIVATED: { label: 'Deactivated', cls: 'bg-gray-500/15 text-gray-400' },
  LOCKED: { label: 'Locked', cls: 'bg-orange-500/15 text-orange-400' },
};

const roleConfig: Record<string, string> = {
  SUPER_ADMIN: 'text-[#d9a83f]',
  ADMIN: 'text-[#dedede]',
  CEO: 'text-[#d9a83f]',
  ADMINISTRATOR: 'text-[#dedede]',
  MODERATOR: 'text-[#c8c8cc]',
  CREATOR: 'text-[#7eb4ff]',
  USER: 'text-gray-400',
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// ============================================================================
// Loading skeleton rows
// ============================================================================

function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-white/[0.04]">
          <td className="py-3 px-2"><div className="h-3 w-28 rounded bg-white/10 animate-pulse" /></td>
          <td className="py-3 px-2"><div className="h-3 w-36 rounded bg-white/10 animate-pulse" /></td>
          <td className="py-3 px-2"><div className="h-3 w-16 rounded bg-white/10 animate-pulse" /></td>
          <td className="py-3 px-2"><div className="h-3 w-14 rounded bg-white/10 animate-pulse" /></td>
          <td className="py-3 px-2"><div className="h-3 w-16 rounded bg-white/10 animate-pulse" /></td>
          <td className="py-3 px-2"><div className="h-8 w-24 rounded-lg bg-white/10 animate-pulse" /></td>
        </tr>
      ))}
    </tbody>
  );
}

// ============================================================================
// Confirm modal
// ============================================================================

function ConfirmModal({
  title, message, confirmLabel, busy, onConfirm, onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#111114] p-5 shadow-elevated">
        <div className="flex items-center gap-3 mb-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-400"><AlertTriangle size={20} /></span>
          <h3 className="text-base font-bold text-white">{title}</h3>
        </div>
        <p className="text-sm text-gray-300 mt-1">{message}</p>
        <div className="flex items-center justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" size="sm" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
export default function AdminUsersPage() {
  const { token } = useAuth();
  const [data, setData] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [role, setRole] = useState('ALL');
  const [verified, setVerified] = useState('ALL');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ user: UserRecord; action: 'suspend' | 'ban' | 'delete' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
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

  // Reset to page 1 whenever filters change.
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
      setNotice(`${action} action completed for @${user.username}.`);
      await fetchData();
    } catch (err: any) {
      setNotice(`Action failed: ${err?.message || 'please retry'}`);
    } finally {
      setBusyId(null);
    }
  };

  const users = data?.users ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Management</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-400 mt-1">Search, inspect and moderate platform accounts.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-full">
            <Clock size={12} /> {data?.total ? `${fmt(data.total)} users` : '—'}
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
        </div>
      </div>

      {notice && (
        <div className={cn('glass rounded-xl px-4 py-2.5 text-sm border', notice.startsWith('Action failed') ? 'border-red-500/20 text-red-300' : 'border-emerald-500/20 text-emerald-300')}>
          {notice}
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/[0.06]">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username, email, name..."
            className="w-full bg-transparent border-none outline-none text-sm text-white placeholder-gray-500"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="glass rounded-xl px-3 py-2 text-sm text-white border border-white/[0.06] outline-none">
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="BANNED">Banned</option>
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="glass rounded-xl px-3 py-2 text-sm text-white border border-white/[0.06] outline-none">
          <option value="ALL">All roles</option>
          <option value="USER">User</option>
          <option value="CREATOR">Creator</option>
          <option value="MODERATOR">Moderator</option>
          <option value="ADMIN">Admin</option>
          <option value="SUPER_ADMIN">Super Admin</option>
        </select>
        <select value={verified} onChange={(e) => setVerified(e.target.value)} className="glass rounded-xl px-3 py-2 text-sm text-white border border-white/[0.06] outline-none">
          <option value="ALL">Verified & unverified</option>
          <option value="true">Verified only</option>
          <option value="false">Unverified only</option>
        </select>
        <Button variant="ghost" size="sm" className="h-10" icon={<Filter size={14} />} onClick={() => void fetchData()}>Apply</Button>
      </div>
{/* Table */}
      <div className="overflow-x-auto glass rounded-2xl border border-white/[0.06]">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
              <th className="text-left py-3 px-3 font-medium">User</th>
              <th className="text-left py-3 px-3 font-medium">Email</th>
              <th className="text-left py-3 px-3 font-medium">Role</th>
              <th className="text-left py-3 px-3 font-medium">Status</th>
              <th className="text-right py-3 px-3 font-medium">Coins</th>
              <th className="text-left py-3 px-3 font-medium">Joined</th>
              <th className="text-left py-3 px-3 font-medium">Last login</th>
              <th className="text-center py-3 px-3 font-medium">Actions</th>
            </tr>
          </thead>
          {loading ? (
            <TableSkeleton />
          ) : error ? (
            <tbody>
              <tr><td colSpan={8} className="py-10 text-center">
                <AlertTriangle size={30} className="mx-auto mb-2 text-red-400" />
                <p className="text-sm text-gray-400">{error}</p>
                <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
              </td></tr>
            </tbody>
          ) : users.length === 0 ? (
            <tbody>
              <tr><td colSpan={8} className="py-12 text-center">
                <Users size={34} className="mx-auto mb-3 text-white/15" />
                <p className="text-sm text-white/50">No users match these filters.</p>
              </td></tr>
            </tbody>
          ) : (
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white">
                        {(u.username || '?')[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">
                          @{u.username}
                          {u.verified && <ShieldCheck size={12} className="text-[#54a0ff] inline-block ml-1" />}
                        </p>
                        {u.fullName && <p className="text-[10px] text-gray-500 truncate">{u.fullName}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-gray-400">{u.email || '—'}</td>
                  <td className="py-3 px-3"><span className={cn('text-[11px] font-medium', roleConfig[u.role] || 'text-gray-400')}>{u.role}</span></td>
                  <td className="py-3 px-3">
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full', statusConfig[u.status]?.cls || 'bg-gray-500/15 text-gray-400')}>
                      {statusConfig[u.status]?.label || u.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums text-gray-300">{fmt(u.coins || 0)}</td>
                  <td className="py-3 px-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(u.createdAt)}</td>
                  <td className="py-3 px-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(u.lastLoginAt)}</td>
                  <td className="py-3 px-3 text-center">
                    <div className="flex items-center gap-1 justify-center">
                      {u.status === 'SUSPENDED' || u.status === 'BANNED' ? (
                        <button onClick={() => void run('restore', u)} disabled={busyId === u.id} className="p-2 rounded-lg hover:bg-emerald-500/15 text-emerald-400 transition-colors" title="Restore account">
                          <RotateCcw size={14} />
                        </button>
                      ) : (
                        <>
                          <button onClick={() => void run('verify', u)} disabled={busyId === u.id} className={cn('p-2 rounded-lg transition-colors', u.verified ? 'text-[#54a0ff] hover:bg-sky-500/15' : 'text-gray-400 hover:bg-sky-500/15 hover:text-[#54a0ff]')} title={u.verified ? 'Verified' : 'Verify user'}>
                            <Shield size={14} />
                          </button>
                          <button onClick={() => setModal({ user: u, action: 'suspend' })} disabled={busyId === u.id} className="p-2 rounded-lg hover:bg-yellow-500/15 text-yellow-400 transition-colors" title="Suspend">
                            <Ban size={14} />
                          </button>
                          <button onClick={() => setModal({ user: u, action: 'ban' })} disabled={busyId === u.id} className="p-2 rounded-lg hover:bg-red-500/15 text-red-400 transition-colors" title="Ban">
                            <UserX size={14} />
                          </button>
                          <button onClick={() => setModal({ user: u, action: 'delete' })} disabled={busyId === u.id} className="p-2 rounded-lg hover:bg-red-500/15 text-red-400 transition-colors" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      {busyId === u.id && <Loader2 size={12} className="animate-spin text-gray-500" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
{/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} icon={<ChevronLeft size={14} />} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="text-xs text-gray-400 px-2">{page} / {data.pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next<ChevronRight size={14} /></Button>
        </div>
      )}

      {/* Confirm modal for destructive actions */}
      {modal && (
        <ConfirmModal
          title={modal.action === 'delete' ? 'Delete user' : modal.action === 'ban' ? 'Ban user' : 'Suspend user'}
          message={
            modal.action === 'delete'
              ? `Permanently delete @${modal.user.username}? This removes their account, content and data. This cannot be undone.`
              : modal.action === 'ban'
                ? `Ban @${modal.user.username}? They will be blocked from logging in and using VANTA until unbanned.`
                : `Suspend @${modal.user.username}? They will be temporarily blocked from logging in until the suspension is lifted.`
          }
          confirmLabel={modal.action === 'delete' ? 'Delete' : modal.action === 'ban' ? 'Ban' : 'Suspend'}
          busy={busyId === modal.user.id}
          onConfirm={() => void run(modal.action, modal.user)}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}