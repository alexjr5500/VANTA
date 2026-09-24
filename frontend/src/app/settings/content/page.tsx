'use client';

/* ═══════════════════════════════════════════════════════════════
   Content & Media Settings
   Autoplay and data-usage preferences are device-local (per-device
   behavior) and are actually consumed by the app's video surfaces
   through useContentPrefs. Settings that VANTA does not implement
   (offline downloads) are intentionally not offered.
   ═══════════════════════════════════════════════════════════════ */

import { Play, Shield, Wifi, Video, SlidersHorizontal } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import {
  SavedChip,
  SelectRow,
  SettingsGroup,
  SettingsLink,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

const LOCAL_DEFAULTS = {
  autoplay: true,
  lowerData: false,
  quality: 'auto' as string,
  hideSensitive: true,
};

type LocalKey = keyof typeof LOCAL_DEFAULTS;

export default function ContentMediaSettingsPage() {
  const { prefs, set, savedVisible } = useLocalPrefs(
    'vanta_content_extras',
    LOCAL_DEFAULTS
  );

  const toggle = (key: LocalKey, value: boolean) => set(key, value);

  return (
    <div className="space-y-8 pb-24">
      <PageHeader
        sticky
        bleed
        title="Content & Media"
        back="/settings"
      />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Control how content plays and uses your data on this device.
        </p>
      </div>

      <SettingsGroup
        icon={Play}
        title="Playback"
        description="How videos behave as you scroll"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={Play}
          title="Autoplay"
          description="Play videos automatically in your feed."
          checked={prefs.autoplay}
          onChange={(v) => toggle('autoplay', v)}
        />
        <SelectRow
          icon={Video}
          title="Media quality"
          description="Preferred video sharpness"
          value={prefs.quality}
          onSelect={(v) => set('quality', v)}
          options={[
            { value: 'auto', label: 'Auto', description: 'Let VANTA pick the best quality.' },
            { value: 'hd', label: 'High definition (1080p)', description: 'Use more data for sharper video.' },
            { value: 'sd', label: 'Standard (480p)', description: 'Saves data with lighter video.' },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup
        icon={Wifi}
        title="Data Usage"
        description="Keep your data plan in check"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={Wifi}
          title="Lower data usage"
          description="Play lighter versions of media on mobile data."
          checked={prefs.lowerData}
          onChange={(v) => toggle('lowerData', v)}
        />
      </SettingsGroup>

      <SettingsGroup
        icon={SlidersHorizontal}
        title="Sensitive Content"
        description="What you&apos;re comfortable seeing"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={Shield}
          title="Hide sensitive content"
          description="Blur posts that may be sensitive before you open them."
          checked={prefs.hideSensitive}
          onChange={(v) => toggle('hideSensitive', v)}
        />
      </SettingsGroup>

      <SettingsGroup icon={SlidersHorizontal} title="Storage">
        <SettingsLink
          href="/settings/device"
          icon={SlidersHorizontal}
          title="Device & storage"
          description="Clear cache and manage stored data"
        />
      </SettingsGroup>
    </div>
  );
}