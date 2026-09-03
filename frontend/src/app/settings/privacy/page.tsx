'use client';

/* ═══════════════════════════════════════════════════════════════
   Privacy Settings — redesigned
   Account privacy + messaging/follow rules, presence toggles and
   account management (blocked / muted). Changes save immediately.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import {
  Ban,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  MessageSquare,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import {
  SelectRow,
  SettingsGroup,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

interface PrivacySettings {
  privacyProfile: string;
  privacyMessages: string;
  privacyFollows: string;
}

const PRIVACY_DEFAULTS: PrivacySettings = {
  privacyProfile: 'public',
  privacyMessages: 'everyone',
  privacyFollows: 'everyone',
};

interface UserReference {
  id: string;
  username: string;
}

const LOCAL_DEFAULTS = {
  activityStatus: true,
  readReceipts: true,
};

type LocalKey = keyof typeof LOCAL_DEFAULTS;

export default function PrivacySettingsPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [privacy, setPrivacy] = useState<PrivacySettings>(PRIVACY_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const [blocked, setBlocked] = useState<UserReference[]>([]);
  const [muted, setMuted] = useState<UserReference[]>([]);
  const [blockTarget, setBlockTarget] = useState('');
  const [muteTarget, setMuteTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const privacyRef = useRef(privacy);
  useEffect(() => {
    privacyRef.current = privacy;
  }, [privacy]);

  const { prefs: local, set: setLocal } = useLocalPrefs(
    'vanta_privacy_extras',
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
    Promise.all([
      apiGet<PrivacySettings>('/api/settings/privacy', token),
      apiGet<{ blocked: UserReference[] }>('/api/settings/blocked', token),
      apiGet<{ muted: UserReference[] }>('/api/settings/muted', token),
    ])
      .then(([p, b, m]) => {
        if (cancel) return;
        setPrivacy({ ...PRIVACY_DEFAULTS, ...p });
        setBlocked(b?.blocked || []);
        setMuted(m?.muted || []);
      })
      .catch(() => {
        if (!cancel) toast.error('Could not load privacy settings');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast identity churns on each render; load-once behaviour is intentional
  }, [token]);

  const updatePrivacy = (key: keyof PrivacySettings, value: string) => {
    if (!token) return;
    const next = { ...privacyRef.current, [key]: value };
    setPrivacy(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiPut('/api/settings/privacy', next, token);
        flagSaved(key);
      } catch {
        toast.error('Could not save', 'Please try again.');
      }
    }, 320);
  };

  const toggleLocal = (key: LocalKey, value: boolean) => {
    setLocal(key, value);
    flagSaved(key);
  };

  const addBlocked = async () => {
    const username = blockTarget.trim();
    if (!username || !token) return;
    setBusy('block');
    try {
      await apiPost('/api/settings/blocked', { targetUsername: username }, token);
      setBlockTarget('');
      const res = await apiGet<{ blocked: UserReference[] }>(
        '/api/settings/blocked',
        token
      );
      setBlocked(res?.blocked || []);
      toast.success('Account blocked');
    } catch (err) {
      toast.error('Could not block', (err as Error)?.message);
    } finally {
      setBusy(null);
    }
  };

  const unblock = async (id: string) => {
    if (!token) return;
    setBusy(`unblock-${id}`);
    try {
      await apiDelete(`/api/settings/blocked/${id}`, token);
      setBlocked((prev) => prev.filter((u) => u.id !== id));
      toast.success('Account unblocked');
    } catch {
      toast.error('Could not unblock', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const addMuted = async () => {
    const username = muteTarget.trim();
    if (!username || !token) return;
    setBusy('mute');
    try {
      await apiPost('/api/settings/muted', { targetUsername: username }, token);
      setMuteTarget('');
      const res = await apiGet<{ muted: UserReference[] }>(
        '/api/settings/muted',
        token
      );
      setMuted(res?.muted || []);
      toast.success('Account muted');
    } catch (err) {
      toast.error('Could not mute', (err as Error)?.message);
    } finally {
      setBusy(null);
    }
  };

  const unmute = async (id: string) => {
    if (!token) return;
    setBusy(`unmute-${id}`);
    try {
      await apiDelete(`/api/settings/muted/${id}`, token);
      setMuted((prev) => prev.filter((u) => u.id !== id));
      toast.success('Account unmuted');
    } catch {
      toast.error('Could not unmute', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };
return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Privacy" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Control who can see your profile, reach you and interact with
          your content.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-40 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-40 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Account privacy ── */}
          <SettingsGroup icon={Lock} title="Account Privacy" description="Profile and audience">
            <SelectRow
              icon={Lock}
              title="Account privacy"
              value={privacy.privacyProfile}
              saved={savedKey === 'privacyProfile'}
              onSelect={(v) => updatePrivacy('privacyProfile', v)}
              options={[
                { value: 'public', label: 'Public', description: 'Anyone can see your profile and content.' },
                { value: 'private', label: 'Private', description: 'Only your followers can see your profile.' },
              ]}
            />
            <SelectRow
              icon={MessageSquare}
              title="Who can message me"
              value={privacy.privacyMessages}
              saved={savedKey === 'privacyMessages'}
              onSelect={(v) => updatePrivacy('privacyMessages', v)}
              options={[
                { value: 'everyone', label: 'Everyone', description: 'Anyone on VANTA can send you a message.' },
                { value: 'following', label: 'People I follow', description: 'Only accounts you follow can message you.' },
                { value: 'noone', label: 'No one', description: 'Nobody can send you direct messages.' },
              ]}
            />
            <SelectRow
              icon={UserCheck}
              title="Who can follow me"
              value={privacy.privacyFollows}
              saved={savedKey === 'privacyFollows'}
              onSelect={(v) => updatePrivacy('privacyFollows', v)}
              options={[
                { value: 'everyone', label: 'Everyone', description: 'Any account can follow you.' },
                { value: 'followers', label: 'People I follow', description: 'Only accounts you follow can follow you.' },
                { value: 'noone', label: 'No one', description: 'Followers are disabled for your account.' },
              ]}
            />
          </SettingsGroup>

          {/* ── Presence ── */}
          <SettingsGroup icon={Users} title="Presence" description="How you appear to others">
            <ToggleRow
              icon={Eye}
              title="Activity status"
              description="Show when you're active to people who follow you."
              checked={local.activityStatus}
              onChange={(v) => toggleLocal('activityStatus', v)}
              saved={savedKey === 'activityStatus'}
            />
            <ToggleRow
              icon={EyeOff}
              title="Read receipts"
              description="Let people see when you've read their messages."
              checked={local.readReceipts}
              onChange={(v) => toggleLocal('readReceipts', v)}
              saved={savedKey === 'readReceipts'}
            />
          </SettingsGroup>
{/* ── Blocked accounts ── */}
          <SettingsGroup
            icon={Ban}
            title="Blocked Accounts"
            description="People you've blocked can't see or contact you"
          >
            <div className="px-4 pt-3">
              <div className="flex gap-2">
                <input
                  value={blockTarget}
                  onChange={(e) => setBlockTarget(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBlocked()}
                  placeholder="Enter username to block"
                  className="settings-input min-w-0 flex-1"
                  aria-label="Username to block"
                />
                <button
                  type="button"
                  onClick={addBlocked}
                  disabled={busy === 'block' || !blockTarget.trim()}
                  className="btn-accent-ghost shrink-0 disabled:opacity-40"
                >
                  {busy === 'block' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Ban size={14} aria-hidden="true" />
                  )}
                  Block
                </button>
              </div>
            </div>
            <div className="px-4 pb-3 pt-2">
              {blocked.length === 0 ? (
                <p className="px-1 py-2 text-xs text-white/30">
                  No blocked accounts.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {blocked.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
                    >
                      <span className="truncate text-sm text-white/80">
                        @{user.username}
                      </span>
                      <button
                        type="button"
                        onClick={() => unblock(user.id)}
                        disabled={busy === `unblock-${user.id}`}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                      >
                        {busy === `unblock-${user.id}` ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <X size={12} aria-hidden="true" />
                        )}
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsGroup>

          {/* ── Muted accounts ── */}
          <SettingsGroup
            icon={UserPlus}
            title="Muted Accounts"
            description="You'll stop seeing content from these accounts"
          >
            <div className="px-4 pt-3">
              <div className="flex gap-2">
                <input
                  value={muteTarget}
                  onChange={(e) => setMuteTarget(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addMuted()}
                  placeholder="Enter username to mute"
                  className="settings-input min-w-0 flex-1"
                  aria-label="Username to mute"
                />
                <button
                  type="button"
                  onClick={addMuted}
                  disabled={busy === 'mute' || !muteTarget.trim()}
                  className="btn-accent-ghost shrink-0 disabled:opacity-40"
                >
                  {busy === 'mute' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <UserPlus size={14} aria-hidden="true" />
                  )}
                  Mute
                </button>
              </div>
            </div>
            <div className="px-4 pb-3 pt-2">
              {muted.length === 0 ? (
                <p className="px-1 py-2 text-xs text-white/30">
                  No muted accounts.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {muted.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
                    >
                      <span className="truncate text-sm text-white/80">
                        @{user.username}
                      </span>
                      <button
                        type="button"
                        onClick={() => unmute(user.id)}
                        disabled={busy === `unmute-${user.id}`}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                      >
                        {busy === `unmute-${user.id}` ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <X size={12} aria-hidden="true" />
                        )}
                        Unmute
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsGroup>
        </div>
      )}
    </div>
  );
}