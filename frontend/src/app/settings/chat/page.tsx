'use client';

/* Chat Settings — message notifications, previews and typing indicators are
   account-level preferences persisted to /api/settings/privacy and enforced
   by the backend (notifications, chat read state, socket typing relay).
   Voice-message playback stays device-local (a per-device convenience). */

import { useEffect, useRef, useState } from 'react';
import { Eye, MessageSquare, Mic, Type } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import {
  SelectRow,
  SettingsGroup,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

const VOICE_DEFAULTS = { voicePref: 'auto' as string };

type ChatPrefKey = 'chatNotifications' | 'messagePreviews' | 'typingIndicators';

interface ChatPrefs {
  chatNotifications: boolean;
  messagePreviews: boolean;
  typingIndicators: boolean;
}

const CHAT_DEFAULTS: ChatPrefs = {
  chatNotifications: true,
  messagePreviews: true,
  typingIndicators: true,
};

export default function ChatSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState<ChatPrefs>(CHAT_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsRef = useRef(prefs);

  const { prefs: voice, set: setVoice } = useLocalPrefs('vanta_voice_pref', VOICE_DEFAULTS);

  const flagSaved = (key: string) => {
    setSavedKey(key);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSavedKey(null), 1400);
  };

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    apiGet<Partial<ChatPrefs>>('/api/settings/privacy', token)
      .then((data) => {
        if (cancel || !data) return;
        setPrefs({
          chatNotifications: data.chatNotifications ?? true,
          messagePreviews: data.messagePreviews ?? true,
          typingIndicators: data.typingIndicators ?? true,
        });
      })
      .catch(() => {
        if (!cancel) toast.error('Could not load chat settings');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast identity churns; load-once is intentional
  }, [token]);

  const toggle = (key: ChatPrefKey, value: boolean) => {
    if (!token) return;
    setPrefs((prev) => ({ ...prev, [key]: value }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiPut('/api/settings/privacy', { [key]: value }, token);
        flagSaved(key);
      } catch {
        // Revert the UI to the actual saved value on failure.
        setPrefs(prefsRef.current);
        toast.error('Could not save', 'Please try again.');
      }
    }, 320);
  };

  return (
    <div className="space-y-8 pb-24">
      <PageHeader sticky bleed title="Chat" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Tune how chats behave — messages, previews, typing and voice.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full rounded-[var(--radius-md)]" />
          <div className="skeleton h-52 w-full rounded-[var(--radius-md)]" />
        </div>
      ) : (
        <>
          <SettingsGroup
            icon={MessageSquare}
            title="Conversations"
            description="Message basics"
          >
            <ToggleRow
              icon={MessageSquare}
              title="Chat notifications"
              description="Notify me about new messages and replies."
              checked={prefs.chatNotifications}
              onChange={(v) => toggle('chatNotifications', v)}
              saved={savedKey === 'chatNotifications'}
            />
            <ToggleRow
              icon={Eye}
              title="Message previews"
              description="Show message text on notifications."
              checked={prefs.messagePreviews}
              onChange={(v) => toggle('messagePreviews', v)}
              saved={savedKey === 'messagePreviews'}
            />
            <ToggleRow
              icon={Type}
              title="Typing indicators"
              description="Let others see when you are typing a reply."
              checked={prefs.typingIndicators}
              onChange={(v) => toggle('typingIndicators', v)}
              saved={savedKey === 'typingIndicators'}
            />
          </SettingsGroup>

          <SettingsGroup
            icon={Mic}
            title="Voice Messages"
            description="How voice messages play on this device"
          >
            <SelectRow
              icon={Mic}
              title="Voice message playback"
              value={voice.voicePref}
              onSelect={(v) => setVoice('voicePref', v)}
              options={[
                { value: 'auto', label: 'Auto-play', description: 'Voice messages start playing automatically.' },
                { value: 'tap', label: 'Tap to play', description: 'Voice messages only play when you tap them.' },
                { value: 'subtitles', label: 'Subtitles only', description: 'Show transcripts instead of playing audio.' },
              ]}
            />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
