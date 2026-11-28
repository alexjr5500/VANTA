'use client';

/* ═══════════════════════════════════════════════════════════════
   Language & Region Settings
   Selection drives the real i18n system (useI18n.setLocale → dynamic
   translation load + cookie/localStorage) and persists the account
   preference to the backend so it follows the user across devices.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import { Check, Globe, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/lib/i18n/context';
import { locales, localeNames, type Locale } from '@/lib/i18n/config';
import { apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';
import { useLocalizedUiText } from '@/lib/i18n/useLocalizedUiText';

const LANGUAGES: { value: string; label: string }[] = locales.map((code) => ({
  value: code,
  label: localeNames[code as Locale] || code,
}));

export default function LanguageSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const { locale, setLocale } = useI18n();
  const tr = useLocalizedUiText();
  const chosenLocally = useRef(false);

  const [selected, setSelected] = useState<string>('en');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    setSelected(locale);
  }, [locale]);

  useEffect(() => {
    setReady(false); chosenLocally.current=false;
    if (!token) return;
    let cancel = false;
    apiGet<{ language?: string }>('/api/settings/privacy', token, { skipCache: true })
      .then((data) => {
        if (cancel || chosenLocally.current || !data?.language) return;
        // If the account has a saved language different from the current one,
        // switch the app to it.
        const canonical = locales.find(code => code.toLowerCase() === data.language?.toLowerCase());
        if (!canonical) return;
        if (canonical !== locale) void setLocale(canonical);
        setSelected(canonical);
      })
      .catch(() => { if (!cancel) toast.error('Could not load saved language'); })
      .finally(() => { if (!cancel) setReady(true); });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on open
  }, [token]);

  const chooseLanguage = async (value: string) => {
    const canonical = locales.find(code => code === value);
    if (!canonical || !token || pending.current) return;
    pending.current = true;
    chosenLocally.current = true;
    setSaving(true);
    try {
      await apiPut('/api/settings/privacy', { language: canonical }, token);
      await setLocale(canonical);
      setSelected(canonical);
    } catch { toast.error('Could not save language', 'Please try again.'); }
    finally { pending.current = false; setSaving(false); }
  };

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        sticky
        bleed
        title="Language & Region"
        back="/settings"
      />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          {tr('Choose your display language. Supported translations are loaded from the VANTA translation set.')}
        </p>
      </div>

      <input type="search" aria-label="Search languages" placeholder="Search languages" value={query} onChange={event => setQuery(event.target.value)} className="settings-input w-full" />
      <SettingsGroup
        icon={Globe}
        title="Display Language"
        description="Used across the app"
        right={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" /> : undefined}
      >
        <div className="divide-y divide-white/[0.06]">
          {LANGUAGES.filter(lang => (lang.label + ' ' + lang.value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((lang) => {
            const active = selected === lang.value;
            return (
              <button
                key={lang.value}
                type="button"
                disabled={!ready || saving}
                aria-pressed={active}
                onClick={() => chooseLanguage(lang.value)}
                className={cn(
                  'flex w-full min-h-14 items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]',
                  active && 'bg-white/[0.02]'
                )}
              >
                <span
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors',
                    active
                      ? 'border-[var(--settings-accent-border)] bg-[var(--settings-accent-soft)] text-[var(--settings-accent-text)]'
                      : 'border-white/[0.06] bg-white/[0.03] text-white/40'
                  )}
                >
                  <Globe size={16} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-white">{lang.label}</span>
                  <span className="mt-0.5 block text-xs uppercase text-white/25">{lang.value}</span>
                </span>
                {active && <Check size={16} className="shrink-0 text-[var(--settings-accent-text)]" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <div className="flex items-center gap-2 px-1">
        <Check size={13} className="shrink-0 text-[var(--settings-accent-text)]" aria-hidden="true" />
        <p className="text-xs text-white/30">
          {tr('Your language selection updates supported screens immediately. Some screens remain in English until translations are completed.')}
        </p>
      </div>
    </div>
  );
}