'use client';

/* ═══════════════════════════════════════════════════════════════
   Account Settings — new focused page
   Profile identity, sign-in info and account lifecycle.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import {
  Check,
  CreditCard,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Pencil,
  Trash2,
  User,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';
import Avatar from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

interface ProfileData {
  id: string;
  username: string;
  email?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export default function AccountSettingsPage() {
  const { token, logout } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailDirty, setEmailDirty] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    apiGet<ProfileData>('/api/profiles/me', token)
      .then((data) => {
        if (cancel) return;
        setProfile(data);
        setEmail(data?.email || '');
      })
      .catch(() => {
        if (!cancel) toast.error('Could not load your account');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast identity churns on each render; load-once behaviour is intentional
  }, [token]);

  const saveEmail = async () => {
    if (!token || !email.trim()) return;
    setSavingEmail(true);
    try {
      await apiPut('/api/settings/account', { email: email.trim() }, token);
      setEmailDirty(false);
      toast.success('Email address updated');
    } catch (err) {
      toast.error('Could not update email', (err as Error)?.message);
    } finally {
      setSavingEmail(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm('Log out of VANTA?')) logout();
  };

  const handleDelete = () => {
    const confirmed = window.confirm(
      'Delete your VANTA account? Your profile and account data will be permanently removed. This cannot be undone.'
    );
    if (!confirmed || !token) return;
    apiDelete('/api/settings/account', token)
      .then(() => logout())
      .catch((err: Error) => toast.error('Could not delete account', err?.message));
  };

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Account" back="/settings" />

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-64 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Profile summary ── */}
          <SettingsGroup>
            <div className="flex items-center gap-4 px-4 py-4">
              <Avatar
                src={profile?.avatarUrl || undefined}
                alt={profile?.username || 'User'}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-white">
                  {profile?.fullName || profile?.username || 'Your account'}
                </p>
                <p className="mt-0.5 truncate text-sm text-white/40">
                  @{profile?.username || 'username'}
                </p>
              </div>
            </div>
          </SettingsGroup>
{/* ── Identity ── */}
          <SettingsGroup icon={User} title="Profile">
            <SettingsLink
              href="/profile/editprofile"
              icon={Pencil}
              title="Edit profile"
              description="Name, bio, photo and cover"
            />
            <SettingsLink
              href="/profile/editprofile"
              icon={User}
              title="Username"
              description="How people find you"
              value={`@${profile?.username || ''}`}
            />
            <SettingsLink
              href="/settings/security"
              icon={KeyRound}
              title="Password & security"
              description="Update your password, sessions and login activity"
            />
          </SettingsGroup>

          {/* ── Email & phone ── */}
          <SettingsGroup
            icon={Mail}
            title="Email & Phone"
            description="Where VANTA reaches you"
          >
            <div className="px-4 pb-4 pt-3">
              <label htmlFor="account-email" className="text-xs text-white/40">
                Email address
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="account-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailDirty(e.target.value !== (profile?.email || ''));
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="settings-input min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={saveEmail}
                  disabled={savingEmail || !emailDirty || !email.trim()}
                  className={cn(
                    'btn-accent shrink-0 disabled:opacity-40'
                  )}
                >
                  {savingEmail ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} aria-hidden="true" />
                  )}
                  Save
                </button>
              </div>
              <p className="mt-2 text-[11px] text-white/25">
                We&apos;ll use this address for account notifications and recovery.
              </p>
            </div>
          </SettingsGroup>

          {/* ── Connected accounts ── */}
          <SettingsGroup
            icon={Link2}
            title="Connected Accounts"
            description="Sign in faster with your other accounts"
          >
            <div className="flex min-h-[62px] items-center gap-3.5 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                <Link2 size={17} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Google</p>
                <p className="mt-0.5 text-xs text-white/30">
                  Coming soon
                </p>
              </div>
            </div>
            <div className="flex min-h-[62px] items-center gap-3.5 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
                <Link2 size={17} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Apple</p>
                <p className="mt-0.5 text-xs text-white/30">
                  Coming soon
                </p>
              </div>
            </div>
          </SettingsGroup>

          {/* ── Payments ── */}
          <SettingsGroup icon={CreditCard} title="Payments">
            <SettingsLink
              href="/settings/payments"
              icon={CreditCard}
              title="Payments"
              description="Coins, subscriptions and balance"
            />
          </SettingsGroup>

          {/* ── Session controls ── */}
          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.09] text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <LogOut size={15} aria-hidden="true" />
              Log out
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] text-xs font-medium text-red-400/70 transition-colors hover:bg-red-500/[0.06] hover:text-red-300"
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}