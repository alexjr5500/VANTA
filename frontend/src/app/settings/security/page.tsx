'use client';

/* Security Settings — real password change, session management and a full
   authenticator (TOTP) two-factor flow backed by /api/auth/2fa/*. The toggle
   reflects the real twoFactorEnabled flag on the account — it can only be ON
   after a successful authenticator verification. */

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
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';

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

interface TwoFactorSetup {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export default function SecuritySettingsPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  /* ── Real 2FA state (backend authoritative) ── */
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    Promise.all([
      apiGet<{ sessions: SessionItem[] }>('/api/settings/sessions', token),
      apiGet<{ logs: SecurityLog[] }>('/api/settings/security-logs', token).catch(() => ({ logs: [] })),
      apiGet<{ enabled: boolean }>('/api/auth/2fa/status', token).catch(() => ({ enabled: false })),
    ])
      .then(([s, l, tfa]) => {
        if (cancel) return;
        setSessions(s?.sessions || []);
        setLogs(l?.logs || []);
        setTwoFactorEnabled(Boolean(tfa?.enabled));
      })
      .catch(() => {
        if (!cancel) toast.error('Could not load security settings');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => { cancel = true; };
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
      await apiPut('/api/settings/account', { currentPassword, newPassword }, token);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      toast.success('Password updated');
    } catch (err) {
      toast.error('Could not update password', (err as Error)?.message);
    } finally {
      setBusy(null);
    }
  };

  /* ── 2FA setup: fetch a fresh secret + backup codes ── */
  const startTwoFactorSetup = async () => {
    if (!token) return;
    setBusy('2fa-setup');
    try {
      const data = await apiGet<TwoFactorSetup>('/api/auth/2fa/setup', token);
      setSetup(data);
      setVerifyCode('');
      setShowBackupCodes(true);
    } catch (err) {
      toast.error('Could not start 2FA setup', (err as Error)?.message);
    } finally {
      setBusy(null);
    }
  };

  /* ── 2FA enable: requires a valid authenticator code ── */
  const enableTwoFactor = async () => {
    if (!token || !setup) return;
    if (verifyCode.trim().length < 6) {
      toast.error('Enter the 6-digit code from your authenticator app');
      return;
    }
    setBusy('2fa-enable');
    try {
      await apiPost('/api/auth/2fa/enable', { token: verifyCode.trim() }, token);
      setTwoFactorEnabled(true);
      setSetup(null);
      setVerifyCode('');
      setShowBackupCodes(false);
      toast.success('Two-factor authentication enabled');
    } catch (err) {
      toast.error('Verification failed', (err as Error)?.message || 'Check the code and try again.');
    } finally {
      setBusy(null);
    }
  };

  /* ── 2FA disable: requires the account password ── */
  const disableTwoFactor = async () => {
    if (!token) return;
    if (!disablePassword) {
      toast.error('Enter your password to disable 2FA');
      return;
    }
    setBusy('2fa-disable');
    try {
      await apiPost('/api/auth/2fa/disable', { password: disablePassword }, token);
      setTwoFactorEnabled(false);
      setDisablePassword('');
      toast.success('Two-factor authentication disabled');
    } catch (err) {
      toast.error('Could not disable 2FA', (err as Error)?.message);
    } finally {
      setBusy(null);
    }
  };

  const revive = async (id: string) => {
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

  const reviveAll = async () => {
    if (!token) return;
    if (!window.confirm('Sign out of all other sessions?')) return;
    setBusy('all');
    try {
      await apiDelete('/api/settings/sessions', token);
      setSessions([]);
      toast.success('All sessions ended');
    } catch {
      toast.error('Could not end sessions', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso || '';
    }
  };

  return (
    <div className="space-y-8 pb-24">
      <PageHeader sticky bleed title="Security" back="/settings" />

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-52 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <>
          {/* ── Two-factor authentication ── */}
          <SettingsGroup
            icon={Fingerprint}
            title="Two-Factor Authentication"
            description="Extra security for your account"
          >
            <div className="flex items-center gap-3.5 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                <ShieldCheck size={17} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Authenticator app</p>
                <p className="mt-0.5 text-xs text-white/30">
                  {twoFactorEnabled
                    ? 'ON — a code is required at every sign-in.'
                    : 'OFF — set up with Google Authenticator, 1Password or similar.'}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium',
                  twoFactorEnabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.06] text-white/40'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', twoFactorEnabled ? 'bg-emerald-400' : 'bg-white/30')} />
                {twoFactorEnabled ? 'ON' : 'OFF'}
              </span>
            </div>

            {!twoFactorEnabled && !setup && (
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={startTwoFactorSetup}
                  disabled={busy === '2fa-setup'}
                  className="btn-accent w-full disabled:opacity-50"
                >
                  {busy === '2fa-setup' ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={14} aria-hidden="true" />}
                  Set up two-factor authentication
                </button>
              </div>
            )}

            {setup && (
              <div className="space-y-3 border-t border-white/[0.06] px-4 py-4">
                <p className="text-sm text-white/70">
                  Scan the code with your authenticator app, or enter this secret manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 font-mono text-xs text-[var(--settings-accent-text)]">
                    {setup.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard?.writeText(setup.secret); toast.success('Secret copied'); }}
                    className="shrink-0 rounded-lg border border-white/[0.08] px-2.5 py-2 text-xs text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    Copy
                  </button>
                </div>
                <p className="break-all rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10px] leading-relaxed text-white/30">
                  {setup.qrCodeUrl}
                </p>
                {showBackupCodes && setup.backupCodes.length > 0 && (
                  <div className="rounded-xl border border-[var(--settings-accent-border)] bg-[var(--settings-accent-soft)] p-3">
                    <p className="mb-2 text-xs font-medium text-white/70">Save these backup codes — they are shown once.</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {setup.backupCodes.map((code) => (
                        <code key={code} className="rounded bg-black/30 px-2 py-1 text-center font-mono text-[11px] text-white/80">{code}</code>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    className="settings-input min-w-0 flex-1"
                    aria-label="Authenticator verification code"
                  />
                  <button
                    type="button"
                    onClick={enableTwoFactor}
                    disabled={busy === '2fa-enable'}
                    className="btn-accent shrink-0 disabled:opacity-50"
                  >
                    {busy === '2fa-enable' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} aria-hidden="true" />}
                    Verify & enable
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => { setSetup(null); setShowBackupCodes(false); }}
                  className="text-xs text-white/40 transition-colors hover:text-white/70"
                >
                  Cancel setup
                </button>
              </div>
            )}

            {twoFactorEnabled && (
              <div className="space-y-3 border-t border-white/[0.06] px-4 py-4">
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Enter your password to disable 2FA"
                  className="settings-input w-full"
                  aria-label="Password to disable 2FA"
                />
                <button
                  type="button"
                  onClick={disableTwoFactor}
                  disabled={busy === '2fa-disable'}
                  className="w-full rounded-[10px] border border-white/[0.09] px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
                >
                  {busy === '2fa-disable' ? <Loader2 size={14} className="animate-spin" /> : 'Disable two-factor authentication'}
                </button>
              </div>
            )}
          </SettingsGroup>

          {/* ── Password ── */}
          <SettingsGroup icon={KeyRound} title="Password" description="Keep your password strong">
            <div className="grid gap-3 px-4 py-4">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="settings-input w-full"
                aria-label="Current password"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 characters)"
                className="settings-input w-full"
                aria-label="New password"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="settings-input w-full"
                aria-label="Confirm new password"
              />
              <button
                type="button"
                onClick={changePassword}
                disabled={busy === 'password'}
                className="btn-accent w-full disabled:opacity-50"
              >
                {busy === 'password' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} aria-hidden="true" />}
                Change password
              </button>
            </div>
          </SettingsGroup>

          {/* ── Active sessions ── */}
          <SettingsGroup
            icon={Laptop}
            title="Active Sessions"
            description="Where you are signed in"
            right={
              sessions.length > 1 ? (
                <button
                  type="button"
                  onClick={reviveAll}
                  disabled={busy === 'all'}
                  className="shrink-0 rounded-[10px] border border-white/[0.08] px-3 py-1.5 text-xs text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
                >
                  {busy === 'all' ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} aria-hidden="true" />}
                  Sign out all
                </button>
              ) : undefined
            }
          >
            {sessions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/30">No active sessions.</p>
            ) : (
              sessions.map((session, index) => (
                <div key={session.id} className="flex items-center gap-3.5 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                    <Laptop size={17} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{session.userAgent || `Session ${index + 1}`}</p>
                    <p className="mt-0.5 truncate text-xs text-white/30">{session.ipAddress || 'IP hidden'} · {formatDate(session.createdAt)}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Active
                  </span>
                  <button
                    type="button"
                    onClick={() => revive(session.id)}
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
          <SettingsGroup icon={Eye} title="Login Activity" description="Recent sign-ins to your account">
            {logs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/30">No recent login activity.</p>
            ) : (
              logs.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center gap-3.5 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                    <EyeOff size={17} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white/80">{log.action}</p>
                  </div>
                  <span className="shrink-0 text-xs text-white/25">{formatDate(log.createdAt)}</span>
                </div>
              ))
            )}
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
