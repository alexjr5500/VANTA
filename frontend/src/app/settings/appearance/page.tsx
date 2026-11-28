'use client';

/* Appearance Settings — accent color and display density.
   Each control is applied live to the whole app via ThemeContext and
   persisted to the account through /api/settings/privacy. */

import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Palette, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { useTheme, type Accent, type Density } from '@/context/ThemeContext';
import { useAccessibility } from '@/context/AccessibilityContext';
import { SettingsGroup, ToggleRow, useScrollRestore } from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';

export default function AppearanceSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const saveScroll = useScrollRestore();

  const { accent, setAccent, density, setDensity } = useTheme();
  const { reducedMotion, toggleReducedMotion } = useAccessibility();
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    setReady(false);
    if (!token) return;
    let cancel = false;
    apiGet<{ accent?: string; density?: string }>('/api/settings/privacy', token, { skipCache: true })
      .then((data) => {
        if (cancel || !data) return;
        if (data.accent === 'gold' || data.accent === 'monochrome') setAccent(data.accent);
        if (data.density === 'compact' || data.density === 'comfortable') setDensity(data.density);
      })
      .catch(() => { if (!cancel) toast.error('Could not load saved appearance'); })
      .finally(() => { if (!cancel) setReady(true); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on open
  }, [token]);

  const persistAppearance = async (patch: Record<string, string>) => {
    if (!token || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await apiPut('/api/settings/privacy', patch, token);
      if (patch.accent) setAccent(patch.accent as Accent);
      if (patch.density) setDensity(patch.density as Density);
    } catch {
      toast.error('Could not save appearance', 'Please try again.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const chooseAccent = (value: Accent) => {
    void persistAppearance({ accent: value });
  };

  const chooseDensity = (value: Density) => {
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
    <div className="space-y-6 pb-24">
      <PageHeader sticky bleed title="Appearance" back="/settings" />

      <p className="text-sm opacity-70">VANTA uses its slate dark theme. Accent and density changes are saved to your account before being applied.</p>
      <SettingsGroup icon={Palette} title="Accent Color" description="Choose accent colors for supported controls">
        {accentOptions.map((option) => {
          const active = accent === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={!ready || saving}
              aria-pressed={active}
              onClick={() => chooseAccent(option.value as Accent)}
              className="flex w-full min-h-[58px] items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface)]"
            >
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors',
                active ? 'border-[var(--active-border)] bg-[var(--active-soft)]' : 'border-[var(--border)] bg-[var(--surface)]')}>
                <span className={cn('h-3.5 w-3.5 rounded-full', option.swatch)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{option.description}</span>
              </span>
              {active && <Check size={16} className="shrink-0 text-[var(--active-bright)]" strokeWidth={2.5} />}
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
              disabled={!ready || saving}
              aria-pressed={active}
              onClick={() => chooseDensity(option.value as Density)}
              className="flex w-full min-h-[58px] items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface)]"
            >
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors',
                active ? 'border-[var(--active-border)] bg-[var(--active-soft)] text-[var(--active-bright)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]')}>
                <SlidersHorizontal size={16} strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{option.description}</span>
              </span>
              {active && <Check size={16} className="shrink-0 text-[var(--active-bright)]" strokeWidth={2.5} />}
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
        <Link href="/settings/language" onClick={saveScroll} className="flex w-full min-h-[58px] items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface)]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-white/40">
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
