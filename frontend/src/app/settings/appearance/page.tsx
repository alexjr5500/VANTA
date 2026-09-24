'use client';

/* Appearance Settings — theme, accent color and display density.
   Each control is applied live to the whole app via ThemeContext and
   persisted to the account through /api/settings/privacy. */

import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { useTheme, type Accent, type Density, type ThemeMode } from '@/context/ThemeContext';
import { useAccessibility } from '@/context/AccessibilityContext';
import { SettingsGroup, ToggleRow, useScrollRestore } from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';

const THEME_OPTIONS: { id: ThemeMode; icon: typeof Moon; label: string }[] = [
  { id: 'dark', icon: Moon, label: 'Dark' },
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'system', icon: Monitor, label: 'System' },
];

export default function AppearanceSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const saveScroll = useScrollRestore();

  const { themeMode, setThemeMode, accent, setAccent, density, setDensity } = useTheme();
  const { reducedMotion, toggleReducedMotion } = useAccessibility();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    apiGet<{ themeMode?: string; accent?: string; density?: string }>('/api/settings/privacy', token)
      .then((data) => {
        if (cancel || !data) return;
        if (data.themeMode === 'light' || data.themeMode === 'system') setThemeMode(data.themeMode);
        if (data.accent === 'gold' || data.accent === 'monochrome') setAccent(data.accent);
        if (data.density === 'compact' || data.density === 'comfortable') setDensity(data.density);
      })
      .catch(() => {});
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on open
  }, [token]);

  const persistAppearance = async (patch: Record<string, string>) => {
    if (!token) return;
    setSaving(true);
    try {
      await apiPut('/api/settings/privacy', patch, token);
    } catch {
      toast.error('Could not save appearance', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const chooseTheme = (id: ThemeMode) => {
    setThemeMode(id);
    const concrete = id === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : id;
    void persistAppearance({ theme: concrete, themeMode: id });
  };

  const chooseAccent = (value: Accent) => {
    setAccent(value);
    void persistAppearance({ accent: value });
  };

  const chooseDensity = (value: Density) => {
    setDensity(value);
    void persistAppearance({ density: value });
  };

  const densityOptions = [
    { value: 'comfortable', label: 'Comfortable', description: 'More spacing, easier reading.' },
    { value: 'compact', label: 'Compact', description: 'More content in every screen.' },
  ];

  const accentOptions = [
    { value: 'gold', label: 'Gold', description: 'VANTA gold -- the premium accent.', swatch: 'bg-[#c9a227]' },
    { value: 'monochrome', label: 'Monochrome', description: 'The original VANTA silvery look.', swatch: 'bg-[#b8b8b8]' },
  ];

  return (
    <div className="space-y-8 pb-24">
      <PageHeader sticky bleed title="Appearance" back="/settings" />

      <SettingsGroup
        icon={Palette}
        title="Theme"
        description="Match your mood or your OS"
        right={saving ? <span className="text-[10px] text-white/30">saving…</span> : undefined}
      >
        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = themeMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseTheme(option.id)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-[12px] border py-4 text-center transition-colors',
                  active ? 'border-[var(--settings-accent-border)] bg-[var(--settings-accent-soft)]' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                )}
              >
                <Icon size={18} className={active ? 'text-[var(--settings-accent-text)]' : 'text-white/50'} />
                <span className="text-xs font-medium text-white">{option.label}</span>
                {active && <Check size={14} className="text-[var(--settings-accent-text)]" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-[10px] text-white/25">
          System follows your device&apos;s light/dark preference automatically.
        </p>
      </SettingsGroup>

      <SettingsGroup icon={Palette} title="Accent Color" description="Applies across buttons, links and active states">
        {accentOptions.map((option) => {
          const active = accent === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => chooseAccent(option.value as Accent)}
              className="flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors',
                active ? 'border-[var(--settings-accent-border)] bg-[var(--settings-accent-soft)]' : 'border-white/[0.06] bg-white/[0.03]')}>
                <span className={cn('h-3.5 w-3.5 rounded-full', option.swatch)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">{option.label}</span>
                <span className="mt-0.5 block text-xs text-white/30">{option.description}</span>
              </span>
              {active && <Check size={16} className="shrink-0 text-[var(--settings-accent-text)]" strokeWidth={2.5} />}
            </button>
          );
        })}
      </SettingsGroup>

      <SettingsGroup icon={SlidersHorizontal} title="Reading & Display" description="How content is laid out for you">
        {densityOptions.map((option) => {
          const active = density === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => chooseDensity(option.value as Density)}
              className="flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors',
                active ? 'border-[var(--settings-accent-border)] bg-[var(--settings-accent-soft)] text-[var(--settings-accent-text)]' : 'border-white/[0.06] bg-white/[0.03] text-white/40')}>
                <SlidersHorizontal size={16} strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">{option.label}</span>
                <span className="mt-0.5 block text-xs text-white/30">{option.description}</span>
              </span>
              {active && <Check size={16} className="shrink-0 text-[var(--settings-accent-text)]" strokeWidth={2.5} />}
            </button>
          );
        })}
        <ToggleRow
          icon={Monitor}
          title="Reduce motion"
          description="Minimize animations across the app."
          checked={reducedMotion}
          onChange={toggleReducedMotion}
        />
      </SettingsGroup>

      <SettingsGroup icon={SlidersHorizontal} title="Localization" description="Language and regional settings">
        <Link href="/settings/language" onClick={saveScroll} className="flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
            <SlidersHorizontal size={17} strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">Language & Region</span>
            <span className="mt-0.5 block text-xs text-white/30">Display language and regional preferences</span>
          </span>
          <SettingsChevron />
        </Link>
      </SettingsGroup>
    </div>
  );
}

function SettingsChevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/20" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
