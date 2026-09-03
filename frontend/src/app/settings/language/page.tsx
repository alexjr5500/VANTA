'use client';

/* ═══════════════════════════════════════════════════════════════
   Language & Region Settings — redesigned
   Display language picker in the new Settings style with an
   immediate save confirmation.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import {
  SavedChip,
  SelectRow,
  SettingsGroup,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ar', label: 'العربية' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
];

const LOCAL_DEFAULTS = { language: 'en' as string };

export default function LanguageSettingsPage() {
  const { prefs, set, savedVisible } = useLocalPrefs(
    'vanta_language',
    LOCAL_DEFAULTS
  );

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // The local prefs hook hydrates asynchronously; gate rendering so the
    // select shows the stored value instead of a flicker to English.
    const t = setTimeout(() => setHydrated(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Language & Region" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Choose your display language. VANTA supports many regions.
        </p>
      </div>

      <SettingsGroup
        icon={Globe}
        title="Display Language"
        description="Used across the app"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <SelectRow
          icon={Globe}
          title="Language"
          value={prefs.language}
          onSelect={(v) => set('language', v)}
          options={LANGUAGES}
        />
      </SettingsGroup>

      {hydrated && (
        <div className="flex items-center gap-2 px-1">
          <Check size={13} className="text-[#7cabff]" aria-hidden="true" />
          <p className="text-xs text-white/30">
            Saved automatically. Full translations are rolling out per region.
          </p>
        </div>
      )}
    </div>
  );
}