'use client';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';

/* ═══════════════════════════════════════════════════════════════
   Account Settings — new focused page
   Profile identity, sign-in info and account lifecycle.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  CreditCard,
  Download,
  UserMinus,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';
import Avatar from '@/components/ui/Avatar';

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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);


  useEffect(() => {
    if (!token) return;
    let cancel = false;
    apiGet<ProfileData>('/api/profiles/me', token)
      .then((data) => {
        if (cancel) return;
        setProfile(data);
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

  const handleLogout = () => {
    if (window.confirm('Log out of VANTA?')) logout();
  };

  const handleDelete = () => {
    if (token) setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!token || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiDelete('/api/settings/account', token);
      setDeleteConfirmOpen(false);
      logout();
    } catch (err) {
      toast.error('Could not delete account', (err as Error)?.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
    <div className="space-y-5 pb-24">
      <PageHeader
        sticky
        bleed
        title="Your account"
        back="/settings"
      />

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-64 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Profile summary ── */}
          <SettingsGroup>
            <div className="flex items-center gap-3 px-4 py-3">
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
              title="Change your password"
              description="Update your password, sessions and login activity"
            />
          </SettingsGroup>

          {/* ── Email & phone ── */}
          <SettingsGroup icon={Mail} title="Email & Phone" description="Where VANTA reaches you">
            <SettingsLink
              href="/settings/security"
              icon={Mail}
              title="Change email address"
              description={profile?.email || 'Add and verify your email address'}
            />
          </SettingsGroup>

          <SettingsGroup icon={User} title="Your data and account">
            <SettingsLink href="/settings/account/archive" icon={Download} title="Download an archive of your data" description="Request and download a copy of your VANTA data" />
            <SettingsLink href="/settings/account/deactivate" icon={UserMinus} title="Deactivate your account" description="Temporarily disable your account" />
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

          {/* ── Verification ── */}
          <SettingsGroup icon={ShieldCheck} title="Verification">
            <SettingsLink
              href="/verification/badge"
              icon={BadgeCheck}
              title="Verified Badge"
              description="Get Blue or Gold verified"
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
      {deleteConfirmOpen && <DeleteConfirmDialog title="Delete your VANTA account?" description="Your profile and account data will be permanently removed. This action cannot be undone." confirmLabel="Delete account" busy={deleteBusy} onCancel={() => { if (!deleteBusy) setDeleteConfirmOpen(false); }} onConfirm={() => void confirmDelete()} />}
    </>
  );
}