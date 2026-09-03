'use client';

/* ═══════════════════════════════════════════════════════════════
   Appearance Settings — redesigned
   Theme, accent color and reading comfort in one calm layout.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiPut } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/context/ThemeContext';
import { useAccessibility } from '@/context/AccessibilityContext';
import {
  SettingsGroup,
  ToggleRow,
  useLocalPrefs,
  useScrollRestore,
  SavedChip,
} from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';

const LOCAL_DEFAULTS = {
  density: 'comfortable' as string,
  accent: 'blue' as string,
};

const THEME_OPTIONS = [
  { id: 'dark', icon: Moon, label: 'Dark' },
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'system', icon: Monitor, label: 'System' },
];

export default function AppearanceSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const saveScroll = useScrollRestore();

  const { setTheme } = useTheme();
  const { reducedMotion, toggleReducedMotion } = useAccessibility();

  const [selected, setSelected] = useState<'dark' | 'light' | 'system'>('dark');
  const [savingTheme, setSavingTheme] = useState(false);

  const { prefs: local, set: setLocal, savedVisible } = useLocalPrefs(
    'vanta_appearance_extras',
    LOCAL_DEFAULTS
  );

  /* Resolve the saved preference into a concrete theme choice */
  useEffect(() => {
    const stored = localStorage.getItem('vanta_theme');
    setSelected(stored === 'light' || stored === 'system' ? stored : 'dark');
  }, []);

  const chooseTheme = async (id: 'dark' | 'light' | 'system') => {
    setSelected(id);
    setSavingTheme(true);

    let concrete: 'dark' | 'light' = 'dark';
    if (id === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      concrete = prefersDark ? 'dark' : 'light';
      // Remember the explicit preference; the ThemeContext reads vanta_theme.
      localStorage.setItem('vanta_theme', prefersDark ? 'dark' : 'light');
    } else {
      concrete = id;
    }

    setTheme(concrete); // ThemeContext persists vanta_theme too

    if (token) {
      try {
        await apiPut('/api/settings/privacy', { theme: concrete }, token);
      } catch {
        toast.error('Could not save theme', 'Please try again.');
      }
    }
    setSavingTheme(false);
  };

  const densityOptions = [
    { value: 'comfortable', label: 'Comfortable', description: 'More spacing, easier reading.' },
    { value: 'compact', label: 'Compact', description: 'More content in every screen.' },
  ];

  const accentOptions = [
    { value: 'blue', label: 'Blue', description: 'VANTA blue — recommended.', swatch: 'bg-[#3b82f6]' },
    { value: 'default', label: 'Monochrome', description: 'The original VANTA look.', swatch: 'bg-[#b8b8b8]' },
  ];

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Appearance" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Make VANTA feel like yours — theme, color and reading comfort.
        </p>
      </div>

      {/* ── Theme ── */}
      <SettingsGroup icon={Monitor} title="Theme" description="Match your mood or your OS">
        <div className="grid grid-cols-3 gap-2 p-4">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = selected === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseTheme(option.id as 'dark' | 'light' | 'system')}
                aria-pressed={active}
                className={cn(
                  'flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-[12px] border transition-all',
                  active
                    ? 'border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.08)]'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                )}
              >
                <span
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-full transition-colors',
                    active ? 'bg-[#3b82f6] text-white' : 'bg-white/[0.06] text-white/40'
                  )}
                >
                  <Icon size={16} strokeWidth={2} />
                </span>
                <span className={cn('text-xs font-medium', active ? 'text-white' : 'text-white/40')}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
        {savingTheme && (
          <p className="flex items-center gap-1.5 px-4 pb-3 text-[11px] text-white/30">
            <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/60" />
            Saving theme…
          </p>
        )}
      </SettingsGroup>
{/* ── Accent color ── */}
      <SettingsGroup
        icon={Palette}
        title="Accent Color"
        description="Blue is VANTA's signature accent"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        {accentOptions.map((option) => {
          const active = local.accent === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setLocal('accent', option.value)}
              className="flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border',
                  option.swatch,
                  active ? 'border-[rgba(59,130,246,0.5)]' : 'border-white/[0.08]'
                )}
              >
                {active && <Check size={16} className="text-white" strokeWidth={2.5} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-white/30">
                  {option.description}
                </span>
              </span>
              {active && <Check size={16} className="shrink-0 text-[#7cabff]" strokeWidth={2.5} />}
            </button>
          );
        })}
      </SettingsGroup>

      {/* ── Reading & display ── */}
      <SettingsGroup
        icon={SlidersHorizontal}
        title="Reading & Display"
        description="How content is laid out for you"
      >
        {densityOptions.map((option) => {
          const active = local.density === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setLocal('density', option.value)}
              className="flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors',
                  active
                    ? 'border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.08)] text-[#7cabff]'
                    : 'border-white/[0.06] bg-white/[0.03] text-white/40'
                )}
              >
                <SlidersHorizontal size={16} strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-white/30">
                  {option.description}
                </span>
              </span>
              {active && <Check size={16} className="shrink-0 text-[#7cabff]" strokeWidth={2.5} />}
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

      {/* ── Language & region ── */}
      <SettingsGroup icon={SlidersHorizontal} title="Localization" description="Language and regional settings">
        <Link
          href="/settings/language"
          onClick={saveScroll}
          className="flex w-full min-h-[62px] items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
            <SlidersHorizontal size={17} strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">
              Language & Region
            </span>
            <span className="mt-0.5 block text-xs text-white/30">
              Display language and regional preferences
            </span>
          </span>
          <span className="shrink-0 text-xs text-white/25">English</span>
          <SettingsChevron />
        </Link>
      </SettingsGroup>
    </div>
  );
}

function SettingsChevron() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-white/20"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}