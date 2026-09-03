'use client';

/* ═══════════════════════════════════════════════════════════════
   Security Settings — redesigned
   Two-factor, password, active sessions and login activity in one
   calm, readable layout.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import {
  SettingsGroup,
  SettingsToggle,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

interface SessionItem {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

interface SecurityLog {
  id: string;
  action: string;
  createdAt: string;
}

const LOCAL_DEFAULTS = { twoFA: false };

export default function SecuritySettingsPage() {
  const { token, logout } = useAuth();
  const toast = useToast();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { prefs: local, set: setLocal } = useLocalPrefs(
    'vanta_security_extras',
    LOCAL_DEFAULTS
  );

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    Promise.all([
      apiGet<{ sessions: SessionItem[] }>('/api/settings/sessions', token),
      apiGet<{ logs: SecurityLog[] }>('/api/settings/security-logs', token).catch(
        () => ({ logs: [] })
      ),
    ])
      .then(([s, l]) => {
        if (cancel) return;
        setSessions(s?.sessions || []);
        setLogs(l?.logs || []);
      })
      .catch(() => {
        if (!cancel) toast.error('Could not load security settings');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast identity churns on each render; load-once behaviour is intentional
  }, [token]);

  const changePassword = async () => {
    if (!token) return;
    if (!currentPassword || !newPassword) {
      toast.error('Please fill in both password fields');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    setBusy('password');
    try {
      await apiPut(
        '/api/settings/account',
        { currentPassword, newPassword },
        token
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated');
    } catch (err) {
      toast.error('Could not update password', (err as Error)?.message);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    if (!token) return;
    setBusy(`session-${id}`);
    try {
      await apiDelete(`/api/settings/sessions/${id}`, token);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success('Session ended');
    } catch {
      toast.error('Could not end session', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const revokeAll = async () => {
    if (!token) return;
    const confirmed = window.confirm(
      'End all sessions on other devices? You will need to sign in again.'
    );
    if (!confirmed) return;
    setBusy('all');
    try {
      await apiDelete('/api/settings/sessions', token);
      logout();
    } catch {
      toast.error('Could not sign out other sessions');
      setBusy(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const twoFARow = (
    <div className="flex min-h-[62px] items-center gap-3.5 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-[#7cabff]">
        <Fingerprint size={17} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          Two-Factor Authentication
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-white/30">
          Add an extra layer of security to your account.
        </p>
      </div>
      <SettingsToggle
        checked={local.twoFA}
        onChange={(v) => setLocal('twoFA', v)}
        label="Two-Factor Authentication"
      />
    </div>
  );

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Security" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Protect your account, review your sessions and keep your
          devices safe.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-32 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-40 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Two-factor ── */}
          <SettingsGroup
            icon={ShieldCheck}
            title="Two-Factor Authentication"
            description="Extra protection"
          >
            {twoFARow}
          </SettingsGroup>
{/* ── Password ── */}
          <SettingsGroup
            icon={KeyRound}
            title="Password"
            description="Use a strong, unique password"
          >
            <div className="space-y-3 px-4 pb-4 pt-3">
              <div>
                <label htmlFor="security-current" className="text-xs text-white/40">
                  Current password
                </label>
                <input
                  id="security-current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                  className="settings-input mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="security-new" className="text-xs text-white/40">
                  New password
                </label>
                <input
                  id="security-new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="settings-input mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="security-confirm" className="text-xs text-white/40">
                  Confirm new password
                </label>
                <input
                  id="security-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat the new password"
                  autoComplete="new-password"
                  className="settings-input mt-1.5"
                />
              </div>
              <button
                type="button"
                onClick={changePassword}
                disabled={busy === 'password'}
                className="btn-accent w-full disabled:opacity-50"
              >
                {busy === 'password' ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Lock size={14} aria-hidden="true" />
                )}
                Update password
              </button>
            </div>
          </SettingsGroup>
{/* ── Active sessions ── */}
          <SettingsGroup
            icon={Laptop}
            title="Active Sessions"
            description="Devices where you're signed in"
            right={
              sessions.length > 1 ? (
                <button
                  type="button"
                  onClick={revokeAll}
                  disabled={busy === 'all'}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/35 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
                >
                  {busy === 'all' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <LogOut size={11} aria-hidden="true" />
                  )}
                  Sign out all
                </button>
              ) : undefined
            }
          >
            {sessions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/30">
                No active sessions.
              </p>
            ) : (
              sessions.map((session, index) => (
                <div
                  key={session.id}
                  className="flex items-center gap-3.5 px-4 py-3"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                    <Laptop size={17} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {session.userAgent || `Session ${index + 1}`}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-white/30">
                      {session.ipAddress || 'IP hidden'} ·{' '}
                      {formatDate(session.createdAt)}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Active
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(session.id)}
                    disabled={busy === `session-${session.id}`}
                    className="shrink-0 rounded-[10px] border border-white/[0.08] px-3 py-1.5 text-xs text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
                  >
                    {busy === `session-${session.id}` ? 'Ending…' : 'End'}
                  </button>
                </div>
              ))
            )}
          </SettingsGroup>

          {/* ── Login activity ── */}
          <SettingsGroup
            icon={Eye}
            title="Login Activity"
            description="Recent sign-ins to your account"
          >
            {logs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/30">
                No recent login activity.
              </p>
            ) : (
              logs.slice(0, 10).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3.5 px-4 py-3"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                    <EyeOff size={17} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white/80">{log.action}</p>
                  </div>
                  <span className="shrink-0 text-xs text-white/25">
                    {formatDate(log.createdAt)}
                  </span>
                </div>
              ))
            )}
          </SettingsGroup>
        </div>
      )}
    </div>
  );
}