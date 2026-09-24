'use client';

/* ═══════════════════════════════════════════════════════════════
   Language & Region Settings
   Selection drives the real i18n system (useI18n.setLocale → dynamic
   translation load + cookie/localStorage) and persists the account
   preference to the backend so it follows the user across devices.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { Check, Globe, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/lib/i18n/context';
import { locales, localeNames, type Locale } from '@/lib/i18n/config';
import { apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';

const LANGUAGES: { value: string; label: string }[] = locales.map((code) => ({
  value: code,
  label: localeNames[code as Locale] || code,
}));

export default function LanguageSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const { locale, setLocale } = useI18n();

  const [selected, setSelected] = useState<string>('en');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(locale);
  }, [locale]);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    apiGet<{ language?: string }>('/api/settings/privacy', token)
      .then((data) => {
        if (cancel || !data?.language) return;
        // If the account has a saved language different from the current one,
        // switch the app to it.
        if (data.language !== locale) void setLocale(data.language as Locale);
        setSelected(data.language);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on open
  }, [token]);

  const chooseLanguage = async (value: string) => {
    setSelected(value);
    try {
      await setLocale(value as Locale);
    } catch {
      /* i18n already falls back gracefully */
    }
    if (!token) return;
    setSaving(true);
    try {
      await apiPut('/api/settings/privacy', { language: value }, token);
    } catch {
      toast.error('Could not save language', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-24">
      <PageHeader
        sticky
        bleed
        title="Language & Region"
        back="/settings"
      />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Choose your display language. Supported translations are loaded from
          the VANTA translation set.
        </p>
      </div>

      <SettingsGroup
        icon={Globe}
        title="Display Language"
        description="Used across the app"
        right={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" /> : undefined}
      >
        <div className="divide-y divide-white/[0.06]">
          {LANGUAGES.map((lang) => {
            const active = selected === lang.value;
            return (
              <button
                key={lang.value}
                type="button"
                onClick={() => chooseLanguage(lang.value)}
                className={cn(
                  'flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]',
                  active && 'bg-white/[0.02]'
                )}
              >
                <span
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors',
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
          Changes apply immediately and are saved to your account.
        </p>
      </div>
    </div>
  );
}