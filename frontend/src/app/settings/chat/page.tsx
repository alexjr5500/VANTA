'use client';

/* ═══════════════════════════════════════════════════════════════
   Chat Settings — new focused page
   Message previews, typing indicators and voice messages.
   ═══════════════════════════════════════════════════════════════ */

import { Eye, MessageSquare, Mic, Type } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import {
  SavedChip,
  SelectRow,
  SettingsGroup,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

const LOCAL_DEFAULTS = {
  chatNotifications: true,
  messagePreviews: true,
  typingIndicators: true,
  voicePref: 'auto' as string,
};

type LocalKey = keyof typeof LOCAL_DEFAULTS;

export default function ChatSettingsPage() {
  const { prefs, set, savedVisible } = useLocalPrefs(
    'vanta_chat_extras',
    LOCAL_DEFAULTS
  );

  const toggle = (key: LocalKey, value: boolean) => set(key, value);

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Chat" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Tune how chats behave — previews, typing and voice.
        </p>
      </div>

      <SettingsGroup
        icon={MessageSquare}
        title="Conversations"
        description="Message basics"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={MessageSquare}
          title="Chat notifications"
          description="Notify me about new messages and replies."
          checked={prefs.chatNotifications}
          onChange={(v) => toggle('chatNotifications', v)}
        />
        <ToggleRow
          icon={Eye}
          title="Message previews"
          description="Show message text on notifications."
          checked={prefs.messagePreviews}
          onChange={(v) => toggle('messagePreviews', v)}
        />
        <ToggleRow
          icon={Type}
          title="Typing indicators"
          description="Show when someone is typing a reply."
          checked={prefs.typingIndicators}
          onChange={(v) => toggle('typingIndicators', v)}
        />
      </SettingsGroup>

      <SettingsGroup
        icon={Mic}
        title="Voice Messages"
        description="How voice messages play"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <SelectRow
          icon={Mic}
          title="Voice message playback"
          value={prefs.voicePref}
          onSelect={(v) => set('voicePref', v)}
          options={[
            { value: 'auto', label: 'Auto-play', description: 'Voice messages start playing automatically.' },
            { value: 'tap', label: 'Tap to play', description: 'Voice messages only play when you tap them.' },
            { value: 'subtitles', label: 'Subtitles only', description: 'Show transcripts instead of playing audio.' },
          ]}
        />
      </SettingsGroup>
    </div>
  );
}