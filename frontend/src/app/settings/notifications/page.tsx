'use client';

/* ═══════════════════════════════════════════════════════════════
   Notifications Settings — redesigned
   Logical groups, a single master control, short descriptions and
   quiet toggles. Changes save immediately with a subtle inline
   confirmation — no modals, no noise.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import {
  AtSign,
  BellRing,
  Heart,
  HeartHandshake,
  Info,
  Mail,
  MessageSquare,
  Radio,
  UserPlus,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import {
  SettingsGroup,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

/* Backend persisted channels (existing /api/settings/notifications contract) */
interface BackendPrefs {
  pushAlerts: boolean;
  emailAlerts: boolean;
  chatAlerts: boolean;
  liveAlerts: boolean;
}

const BACKEND_DEFAULTS: BackendPrefs = {
  pushAlerts: true,
  emailAlerts: true,
  chatAlerts: true,
  liveAlerts: true,
};

/* Granular categories — persisted locally (no backend column exists) */
const LOCAL_DEFAULTS = {
  likesAlerts: true,
  commentsAlerts: true,
  mentionsAlerts: true,
  followersAlerts: true,
  groupAlerts: true,
  channelAlerts: true,
  liveInteractionsAlerts: true,
  fundraiserAlerts: true,
};

type BackendKey = keyof BackendPrefs;
type LocalKey = keyof typeof LOCAL_DEFAULTS;

export default function NotificationSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [backend, setBackend] = useState<BackendPrefs>(BACKEND_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { prefs: local, set: setLocal, hydrated } = useLocalPrefs(
    'vanta_notif_categories',
    LOCAL_DEFAULTS
  );

  const flagSaved = (key: string) => {
    setSavedKey(key);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSavedKey(null), 1400);
  };

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    apiGet<any>('/api/settings/notifications', token)
      .then((data) => {
        if (cancel) return;
        setBackend({ ...BACKEND_DEFAULTS, ...(data || {}) });
      })
      .catch(() => {
        if (!cancel) setLoadError(true);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [token]);

  /* Toggle a backend-persisted channel (immediate update + debounced PUT) */
  const toggleBackend = (key: BackendKey, value: boolean) => {
    if (!token) return;
    const next = { ...backend, [key]: value };
    setBackend(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiPut('/api/settings/notifications', next, token);
        flagSaved(key);
      } catch {
        setBackend((prev) => ({ ...prev, [key]: !value }));
        toast.error('Could not save', 'Please try again.');
      }
    }, 320);
  };

  /* Toggle a locally-persisted category (instant) */
  const toggleLocal = (key: LocalKey, value: boolean) => {
    setLocal(key, value);
    flagSaved(key);
  };

  const paused = !backend.pushAlerts;

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Notifications" back="/settings" />

      {/* Intro */}
      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Choose what you want to be notified about. Changes save
          automatically.
        </p>
      </div>
{loading && !hydrated ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-52 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-44 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Push Notifications — master control ── */}
          <SettingsGroup
            icon={BellRing}
            title="Push Notifications"
            description="Delivery channels"
          >
            <ToggleRow
              icon={BellRing}
              title="Allow Notifications"
              description="Receive push notifications for your activity."
              checked={backend.pushAlerts}
              onChange={(v) => toggleBackend('pushAlerts', v)}
              saved={savedKey === 'pushAlerts'}
            />
            {paused && (
              <div className="flex items-center gap-2.5 bg-[rgba(59,130,246,0.06)] px-4 py-3">
                <Info size={13} className="shrink-0 text-[#7cabff]" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-white/40">
                  Notifications are paused. Turn on Allow Notifications to
                  manage the categories below.
                </p>
              </div>
            )}
            <ToggleRow
              icon={Mail}
              title="Email Notifications"
              description="Get email updates for messages and activity you miss."
              checked={backend.emailAlerts}
              onChange={(v) => toggleBackend('emailAlerts', v)}
              saved={savedKey === 'emailAlerts'}
            />
          </SettingsGroup>

          {/* ── Social Activity ── */}
          <SettingsGroup
            icon={Heart}
            title="Social Activity"
            description="Be part of the conversation"
          >
            <ToggleRow
              icon={Heart}
              title="Likes & Reactions"
              description="When someone likes or reacts to your content."
              checked={local.likesAlerts}
              onChange={(v) => toggleLocal('likesAlerts', v)}
              disabled={paused}
              saved={savedKey === 'likesAlerts'}
            />
            <ToggleRow
              icon={MessageSquare}
              title="Comments"
              description="When someone comments on your posts."
              checked={local.commentsAlerts}
              onChange={(v) => toggleLocal('commentsAlerts', v)}
              disabled={paused}
              saved={savedKey === 'commentsAlerts'}
            />
            <ToggleRow
              icon={AtSign}
              title="Mentions"
              description="When someone mentions you."
              checked={local.mentionsAlerts}
              onChange={(v) => toggleLocal('mentionsAlerts', v)}
              disabled={paused}
              saved={savedKey === 'mentionsAlerts'}
            />
            <ToggleRow
              icon={UserPlus}
              title="New Followers"
              description="When someone follows you."
              checked={local.followersAlerts}
              onChange={(v) => toggleLocal('followersAlerts', v)}
              disabled={paused}
              saved={savedKey === 'followersAlerts'}
            />
          </SettingsGroup>
{/* ── Messages ── */}
          <SettingsGroup
            icon={MessageSquare}
            title="Messages"
            description="Direct chats and group spaces"
          >
            <ToggleRow
              icon={MessageSquare}
              title="New Messages"
              description="When someone sends you a message."
              checked={backend.chatAlerts}
              onChange={(v) => toggleBackend('chatAlerts', v)}
              disabled={paused}
              saved={savedKey === 'chatAlerts'}
            />
            <ToggleRow
              icon={UserPlus}
              title="Group Messages"
              description="Notifications from groups you're a member of."
              checked={local.groupAlerts}
              onChange={(v) => toggleLocal('groupAlerts', v)}
              disabled={paused}
              saved={savedKey === 'groupAlerts'}
            />
            <ToggleRow
              icon={Radio}
              title="Channel Updates"
              description="Notifications from channels you follow."
              checked={local.channelAlerts}
              onChange={(v) => toggleLocal('channelAlerts', v)}
              disabled={paused}
              saved={savedKey === 'channelAlerts'}
            />
          </SettingsGroup>

          {/* ── Live ── */}
          <SettingsGroup icon={Radio} title="Live" description="Streaming moments">
            <ToggleRow
              icon={Radio}
              title="Live Notifications"
              description="When creators you follow go live."
              checked={backend.liveAlerts}
              onChange={(v) => toggleBackend('liveAlerts', v)}
              disabled={paused}
              saved={savedKey === 'liveAlerts'}
            />
            <ToggleRow
              icon={BellRing}
              title="Live Interactions"
              description="Important interactions involving your live streams."
              checked={local.liveInteractionsAlerts}
              onChange={(v) => toggleLocal('liveInteractionsAlerts', v)}
              disabled={paused}
              saved={savedKey === 'liveInteractionsAlerts'}
            />
          </SettingsGroup>

          {/* ── Fundraising ── */}
          <SettingsGroup
            icon={HeartHandshake}
            title="Fundraising"
            description="VANTA Give updates"
          >
            <ToggleRow
              icon={HeartHandshake}
              title="Fundraising Updates"
              description="Important updates about fundraisers you support or create."
              checked={local.fundraiserAlerts}
              onChange={(v) => toggleLocal('fundraiserAlerts', v)}
              disabled={paused}
              saved={savedKey === 'fundraiserAlerts'}
            />
          </SettingsGroup>
        </div>
      )}

      {loadError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Could not load your notification settings. Please try again.
        </div>
      )}
    </div>
  );
}