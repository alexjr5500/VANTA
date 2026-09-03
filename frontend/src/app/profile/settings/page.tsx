'use client';

/* ═══════════════════════════════════════════════════════════════
   Settings — hub
   Clean, premium category navigation. Every category opens its own
   focused page, and returning restores your scroll position.
   Blue is the single accent; every surface inherits VANTA's dark
   design system.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import {
  Bell,
  ChevronRight,
  Info,
  Lock,
  LogOut,
  MessageCircle,
  Palette,
  Play,
  Shield,
  User,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';
import Avatar from '@/components/ui/Avatar';

interface ProfileData {
  username: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

interface PrivacyData {
  theme?: string;
  privacyProfile?: string;
}

export default function SettingsPage() {
  const { token, logout } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyData>({});
  const [notif, setNotif] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    Promise.all([
      apiGet<ProfileData>('/api/profiles/me', token),
      apiGet<PrivacyData>('/api/settings/privacy', token),
      apiGet<Record<string, boolean>>('/api/settings/notifications', token),
    ])
      .then(([p, pri, notif]) => {
        if (cancel) return;
        setProfile(p);
        setPrivacy(pri || {});
        setNotif(notif || {});
      })
      .catch(() => {
        if (!cancel) toast.error('Could not load settings');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast identity churns on each render; load-once behaviour is intentional
  }, [token]);

  const privacyValue = privacy.privacyProfile === 'private' ? 'Private' : 'Public';

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Settings" back="/profile" />

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-56 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-56 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Account hero ── */}
          <SettingsGroup>
            <a
              href="/settings/account"
              className="group flex items-center gap-4 px-4 py-4"
            >
              <Avatar
                src={profile?.avatarUrl || undefined}
                alt={profile?.username || 'User'}
                size="lg"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-white">
                  {profile?.fullName || profile?.username || 'Your account'}
                </span>
                <span className="mt-0.5 block truncate text-sm text-white/40">
                  @{profile?.username || 'username'}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-[rgba(59,130,246,0.10)] px-3 py-1 text-[10px] font-semibold text-[#7cabff]">
                View profile
              </span>
              <ChevronRight
                className="shrink-0 text-white/20 group-hover:text-white/50"
                size={15}
                aria-hidden="true"
              />
            </a>
          </SettingsGroup>
{/* ── Account ── */}
          <SettingsGroup icon={User} title="Account">
            <SettingsLink
              href="/profile/editprofile"
              icon={User}
              title="Edit profile"
              description="Name, bio, photo and cover"
              value={profile?.username ? `@${profile.username}` : undefined}
            />
            <SettingsLink
              href="/settings/security"
              icon={Shield}
              title="Password & security"
              description="Change your password and turn on 2FA"
            />
            <SettingsLink
              href="/settings/payments"
              icon={Play}
              title="Payments"
              description="Coins, subscriptions and balance"
            />
          </SettingsGroup>

          {/* ── Privacy & safety ── */}
          <SettingsGroup icon={Lock} title="Privacy & Safety">
            <SettingsLink
              href="/settings/privacy"
              icon={Lock}
              title="Account privacy"
              description="Profile visibility and who can reach you"
              value={privacyValue}
            />
            <SettingsLink
              href="/settings/privacy"
              icon={MessageCircle}
              title="Messaging & follows"
              description="Who can message or follow you"
            />
            <SettingsLink
              href="/settings/privacy"
              icon={Shield}
              title="Blocked accounts"
              description="People you've blocked"
            />
          </SettingsGroup>

          {/* ── Notifications ── */}
          <SettingsGroup
            icon={Bell}
            title="Notifications"
            description="What you hear about"
          >
            <SettingsLink
              href="/settings/notifications"
              icon={Bell}
              title="Notifications"
              description="Push, messages, live and more"
              value={notif.pushAlerts ? 'On' : 'Off'}
            />
          </SettingsGroup>

          {/* ── Appearance ── */}
          <SettingsGroup icon={Palette} title="Appearance">
            <SettingsLink
              href="/settings/appearance"
              icon={Palette}
              title="Theme & appearance"
              description="Dark, light and accent color"
              value={privacy.theme === 'light' ? 'Light' : 'Dark'}
            />
          </SettingsGroup>

          {/* ── Content & media ── */}
          <SettingsGroup icon={Play} title="Content & Media">
            <SettingsLink
              href="/settings/content"
              icon={Play}
              title="Content & media"
              description="Autoplay, quality and data usage"
            />
            <SettingsLink
              href="/settings/device"
              icon={Info}
              title="Device & storage"
              description="Clear cache and manage downloads"
            />
          </SettingsGroup>

          {/* ── Chat ── */}
          <SettingsGroup icon={MessageCircle} title="Chat">
            <SettingsLink
              href="/settings/chat"
              icon={MessageCircle}
              title="Chat preferences"
              description="Previews, typing indicators and voice"
            />
          </SettingsGroup>

          {/* ── About ── */}
          <SettingsGroup icon={Info} title="About">
            <SettingsLink
              href="/settings/help"
              icon={Info}
              title="Help Center"
              description="Guides and support"
            />
            <SettingsLink
              href="/terms"
              icon={Play}
              title="Terms of Service"
              description="VANTA terms"
            />
            <SettingsLink
              href="/privacy"
              icon={Shield}
              title="Privacy Policy"
              description="Your data, your rules"
            />
            <SettingsLink
              href="/privacy-center"
              icon={Lock}
              title="Community Guidelines"
              description="What's allowed on VANTA"
            />
            <SettingsLink
              href="/settings/about"
              icon={Info}
              title="About VANTA"
              description="App version and more"
            />
          </SettingsGroup>

          {/* ── Sign out ── */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Log out of VANTA?')) logout();
              }}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.09] text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <LogOut size={15} aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}