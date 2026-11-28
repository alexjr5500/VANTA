'use client';

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Notifications Settings â€” redesigned
   Logical groups, a single master control, short descriptions and
   quiet toggles. Changes save immediately with a subtle inline
   confirmation â€” no modals, no noise.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

import { useEffect, useRef, useState } from 'react';
import {
  AtSign,
  BellRing,
  Heart,
  Info,
  Mail,
  MessageSquare,
  Radio,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { usePush } from '@/context/PushContext';
import { useToast } from '@/components/ui/Toast';
import {
  SettingsGroup,
  SettingsLink,
  ToggleRow,
} from '@/components/settings/SettingsUI';

/* Backend persisted channels (existing /api/settings/notifications contract).
   Every category below is a real column on NotificationPreferences and is
   enforced by notificationService.shouldDeliver when events are created. */
interface BackendPrefs {
  pushAlerts: boolean;
  emailAlerts: boolean;
  chatAlerts: boolean;
  liveAlerts: boolean;
  likesAlerts: boolean;
  commentsAlerts: boolean;
  mentionsAlerts: boolean;
  followersAlerts: boolean;
  groupAlerts: boolean;
  channelAlerts: boolean;
  liveInteractionsAlerts: boolean;
  followingOnlySocialAlerts: boolean;
  chatRequestAlerts: boolean;
  muteSocialAlerts: boolean;
}

const BACKEND_DEFAULTS: BackendPrefs = {
  pushAlerts: true,
  emailAlerts: true,
  chatAlerts: true,
  liveAlerts: true,
  likesAlerts: true,
  commentsAlerts: true,
  mentionsAlerts: true,
  followersAlerts: true,
  groupAlerts: true,
  channelAlerts: true,
  liveInteractionsAlerts: true,
  followingOnlySocialAlerts: false,
  chatRequestAlerts: true,
  muteSocialAlerts: false,
};

type BackendKey = keyof BackendPrefs;

export default function NotificationSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [backend, setBackend] = useState<BackendPrefs>(BACKEND_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const pendingKeys = useRef(new Set<BackendKey>());
  const [saving, setSaving] = useState<BackendKey[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setLoading(true); setLoadError(false); setBackend(BACKEND_DEFAULTS);
    if (!token) return;
    let cancel = false;
    apiGet<BackendPrefs>('/api/settings/notifications', token, { skipCache: true })
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
  const toggleBackend = async (key: BackendKey, value: boolean) => {
    if (!token || loadError || pendingKeys.current.has(key)) return;
    pendingKeys.current.add(key);
    setSaving((prev) => [...prev, key]);
    try {
      await apiPut('/api/settings/notifications', { [key]: value }, token);
      setBackend((prev) => ({ ...prev, [key]: value }));
      flagSaved(key);
    } catch {
      toast.error('Could not save', 'Please try again.');
    } finally {
      pendingKeys.current.delete(key);
      setSaving((prev) => prev.filter((item) => item !== key));
    }
  };

  const paused = !backend.pushAlerts;
// OS-level push for THIS device (Web Push subscription registration).
  const push = usePush();
  const pushOnThisDevice = push.status === 'enabled' || push.status === 'granted';
  const pushDescription =
    push.status === 'unsupported' || !push.supported
      ? (typeof navigator !== 'undefined' && /VANTAAndroid/i.test(navigator.userAgent)
          ? "Native notification registration is not available in this session. Check Android notification permission and reopen the app."
          : "OS notifications aren't available in this browser context. Try a supported browser or the VANTA Android app.")
      : push.status === 'unconfigured'
        ? "Push notifications aren't set up on the VANTA server yet. Your browser and app are working — this just needs the server's push keys configured once."
        : push.status === 'network-error'
          ? "We couldn't reach the VANTA server to check notifications. Check your connection and try again."
          : push.status === 'permission-denied'
            ? 'Notifications are blocked in your browser settings. Enable them (site settings → Notifications), then tap to retry.'
            : push.status === 'permission-pending'
              ? 'Tap to allow notifications even when VANTA is fully closed — this is what makes incoming calls and messages reach you.'
              : push.status === 'enabled'
                ? 'This device receives notifications even when VANTA is closed or locked.'
                : 'Push status unknown — tap to re-check.';
  const enableDevicePush = () => {
    void push.enablePush().then((result) => {
      if (result.ok) {
        toast.success('Push enabled', 'This device will notify you when the app is closed.');
      } else if (push.permission === 'denied') {
        toast.error('Notifications blocked', 'Allow notifications for VANTA in your browser settings, then try again.');
      } else if (result.reason === 'network-error') {
        toast.error('Connection issue', "We couldn't reach the server. Check your connection and try again.");
      }
    });
  };
  const retryDevicePush = () => {
    void push.refresh().then((result) => {
      if (result.ok) toast.success('Push enabled', 'This device will notify you when the app is closed.');
    });
  };
  const showPushRetry = push.status === 'network-error' || push.status === 'permission-denied';

  return (
    <div className="space-y-8 pb-24">
      <PageHeader
        sticky
        bleed
        title="Notifications"
        back="/settings"
      />

      {/* Intro */}
      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Choose what you want to be notified about. Changes save
          automatically.
        </p>
      </div>
{loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-52 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-44 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* â”€â”€ Push Notifications â€” master control â”€â”€ */}
          <SettingsGroup
            icon={BellRing}
            title="Push Notifications"
            description="Delivery channels"
          >
            <ToggleRow
              icon={BellRing}
              title="Social and general alerts"
              description="Controls device push delivery and new social/general activity notifications. Chat and live in-app preferences are separate."
              checked={backend.pushAlerts}
              onChange={(v) => toggleBackend('pushAlerts', v)}
              disabled={loadError || saving.includes('pushAlerts')}
              saved={savedKey === 'pushAlerts'}
            />
            {paused && (
              <div className="flex items-center gap-2.5 bg-[var(--settings-accent-softer)] px-4 py-3">
                <Info size={13} className="shrink-0 text-[var(--settings-accent-text)]" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-white/40">
                  Device push is paused for this account, including chat and live push. Their in-app categories have separate controls.
                </p>
              </div>
            )}
            <ToggleRow
              icon={BellRing}
              title="This device"
              description={pushDescription}
              checked={pushOnThisDevice}
              disabled={push.status === 'unconfigured' || push.status === 'unsupported'}
              onChange={(enabled) => {
                if (enabled) enableDevicePush();
                else void push.disablePush();
              }}
            />
            {showPushRetry && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={retryDevicePush}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.12] px-3 text-xs font-medium text-white transition hover:bg-white/[0.05]"
                >
                  <RefreshCw size={13} aria-hidden="true" /> Try again
                </button>
              </div>
            )}
            <ToggleRow
              icon={Mail}
              title="Email Notifications"
              description="Save your email notification preference. Security and transactional emails are separate."
              checked={backend.emailAlerts}
              onChange={(v) => toggleBackend('emailAlerts', v)}
              disabled={loadError || saving.includes('emailAlerts')}
              saved={savedKey === 'emailAlerts'}
            />
          </SettingsGroup>

          {/* â”€â”€ Social Activity â”€â”€ */}
          <SettingsGroup title="Filters" description="Control new social notifications">
            <ToggleRow icon={UserPlus} title="Only accounts you follow" description="Only receive new likes, comments, mentions and follower notifications from accounts you follow. Does not affect chats, payments or security alerts."
              checked={backend.followingOnlySocialAlerts}
              onChange={(value) => toggleBackend('followingOnlySocialAlerts', value)}
              disabled={loadError || saving.includes('followingOnlySocialAlerts')}
              saved={savedKey === 'followingOnlySocialAlerts'} />
            <ToggleRow icon={UserPlus} title="Mute social alerts from muted accounts" description="Suppress new likes, follows, comments and mentions from muted accounts. Chats and financial alerts are unaffected." checked={backend.muteSocialAlerts} disabled={loadError || saving.includes('muteSocialAlerts')} onChange={value => void toggleBackend('muteSocialAlerts',value)} />
            <SettingsLink href="/settings/privacy" title="Mute and block accounts" description="Manage accounts you have muted or blocked" />
          </SettingsGroup>
          <SettingsGroup
            icon={Heart}
            title="Social Activity"
            description="Be part of the conversation"
          >
            <ToggleRow
              icon={Heart}
              title="Likes & Reactions"
              description="When someone likes or reacts to your content."
              checked={backend.likesAlerts}
              onChange={(v) => toggleBackend('likesAlerts', v)}
              disabled={paused || loadError || saving.includes('likesAlerts')}
              saved={savedKey === 'likesAlerts'}
            />
            <ToggleRow
              icon={MessageSquare}
              title="Comments"
              description="When someone comments on your posts."
              checked={backend.commentsAlerts}
              onChange={(v) => toggleBackend('commentsAlerts', v)}
              disabled={paused || loadError || saving.includes('commentsAlerts')}
              saved={savedKey === 'commentsAlerts'}
            />
            <ToggleRow
              icon={AtSign}
              title="Mentions"
              description="When someone mentions you."
              checked={backend.mentionsAlerts}
              onChange={(v) => toggleBackend('mentionsAlerts', v)}
              disabled={paused || loadError || saving.includes('mentionsAlerts')}
              saved={savedKey === 'mentionsAlerts'}
            />
            <ToggleRow
              icon={UserPlus}
              title="New Followers"
              description="When someone follows you."
              checked={backend.followersAlerts}
              onChange={(v) => toggleBackend('followersAlerts', v)}
              disabled={paused || loadError || saving.includes('followersAlerts')}
              saved={savedKey === 'followersAlerts'}
            />
          </SettingsGroup>
{/* â”€â”€ Messages â”€â”€ */}
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
              disabled={loadError || saving.includes('chatAlerts')}
              saved={savedKey === 'chatAlerts'}
            />
            <ToggleRow icon={MessageSquare} title="Message request alerts" description="Notify me about new contact requests and acceptances." checked={backend.chatRequestAlerts} disabled={!backend.chatAlerts || loadError || saving.includes('chatRequestAlerts')} onChange={value => void toggleBackend('chatRequestAlerts',value)} />
            <ToggleRow
              icon={UserPlus}
              title="Group Messages"
              description="Notifications from groups you're a member of."
              checked={backend.groupAlerts}
              onChange={(v) => toggleBackend('groupAlerts', v)}
              disabled={!backend.chatAlerts || loadError || saving.includes('groupAlerts')}
              saved={savedKey === 'groupAlerts'}
            />
            <ToggleRow
              icon={Radio}
              title="Channel Updates"
              description="Notifications from channels you follow."
              checked={backend.channelAlerts}
              onChange={(v) => toggleBackend('channelAlerts', v)}
              disabled={!backend.chatAlerts || loadError || saving.includes('channelAlerts')}
              saved={savedKey === 'channelAlerts'}
            />
          </SettingsGroup>

          {/* â”€â”€ Live â”€â”€ */}
          <SettingsGroup icon={Radio} title="Live" description="Streaming moments">
            <ToggleRow
              icon={Radio}
              title="Live Notifications"
              description="When creators you follow go live."
              checked={backend.liveAlerts}
              onChange={(v) => toggleBackend('liveAlerts', v)}
              disabled={loadError || saving.includes('liveAlerts')}
              saved={savedKey === 'liveAlerts'}
            />
            <ToggleRow
              icon={BellRing}
              title="Live Interactions"
              description="Important interactions involving your live streams."
              checked={backend.liveInteractionsAlerts}
              onChange={(v) => toggleBackend('liveInteractionsAlerts', v)}
              disabled={!backend.liveAlerts || loadError || saving.includes('liveInteractionsAlerts')}
              saved={savedKey === 'liveInteractionsAlerts'}
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



