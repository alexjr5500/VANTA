'use client';

/* ═══════════════════════════════════════════════════════════════
   VANTA Settings UI kit
   A small, consistent set of surfaces for the Settings experience.
   Blue is the single accent. Surfaces, radii, spacing and type all
   inherit the existing VANTA design system.
   ═══════════════════════════════════════════════════════════════ */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { storage } from '@/lib/platformStorage';

/* Blue accent — single source of truth for the Settings experience */
export const ACCENT = {
  bg: 'bg-[#3b82f6]',
  solid: '#3b82f6',
  strong: '#2563eb',
  text: 'text-[#7cabff]',
  soft: 'bg-[rgba(59,130,246,0.10)]',
  softer: 'bg-[rgba(59,130,246,0.06)]',
  border: 'border-[rgba(59,130,246,0.30)]',
};

type IconComponent = React.ComponentType<{
  size?: number | string;
  className?: string;
  strokeWidth?: number | string;
}>;

/* ────────────────────────────────────────────────────────────────
   Scroll restoration — returning from a sub-page keeps your place.
   ──────────────────────────────────────────────────────────────── */

const SCROLL_KEY = 'vanta_settings_scroll';

export function useScrollRestore() {
  const save = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(SCROLL_KEY, String(Math.max(0, window.scrollY)));
    } catch {
      /* private mode — ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let target = 0;
    try {
      target = Number(sessionStorage.getItem(SCROLL_KEY));
    } catch {
      /* ignore */
    }
    if (target > 0) {
      const t = window.setTimeout(() => window.scrollTo(0, target), 0);
      try {
        sessionStorage.removeItem(SCROLL_KEY);
      } catch {
        /* ignore */
      }
      return () => window.clearTimeout(t);
    }
  }, []);

  return save;
}

/* ────────────────────────────────────────────────────────────────
   Local preferences — immediate local persistence with a subtle
   "saved" confirmation. Used for preferences without a backend
   column so the experience still feels instant and durable.
   ──────────────────────────────────────────────────────────────── */

export function useLocalPrefs<T extends Record<string, boolean | string>>(
  key: string,
  defaults: T
) {
  type K = keyof T;
  const [prefs, setPrefs] = useState<T>(defaults);
  const [hydrated, setHydrated] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const raw = await storage.getItem(key);
      if (!cancel && raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<T>;
          setPrefs((prev) => ({ ...prev, ...parsed }));
        } catch {
          /* corrupted — fall back to defaults */
        }
      }
      if (!cancel) setHydrated(true);
    })();
    return () => {
      cancel = true;
    };
  }, [key]);

  const set = useCallback(
    (k: K, value: T[K]) => {
      setPrefs((prev) => {
        const next = { ...prev, [k]: value } as T;
        void storage.setItem(key, JSON.stringify(next));
        return next;
      });
      setSavedVisible(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedVisible(false), 1400);
    },
    [key]
  );

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  return { prefs, set, hydrated, savedVisible };
}

/* ────────────────────────────────────────────────────────────────
   SavedChip — quiet inline confirmation
   ──────────────────────────────────────────────────────────────── */

export function SavedChip({ visible = true }: { visible?: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(59,130,246,0.10)] px-2 py-0.5 text-[10px] font-semibold text-[#7cabff]"
        >
          <Check size={9} strokeWidth={3} aria-hidden="true" />
          saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────────────────────────────────────────────
   SettingsToggle — smooth, accessible iOS-style switch
   ──────────────────────────────────────────────────────────────── */

export function SettingsToggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (_next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors duration-200',
        'focus-visible:ring-2 focus-visible:ring-[rgba(59,130,246,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0f]',
        disabled && 'cursor-not-allowed',
        checked ? 'bg-[#3b82f6]' : 'bg-white/[0.14]'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[20px]' : 'translate-x-0'
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      />
    </button>
  );
}
/* ────────────────────────────────────────────────────────────────
   SettingsGroup — one logical section header + one quiet card
   ──────────────────────────────────────────────────────────────── */

export function SettingsGroup({
  icon: Icon,
  title,
  description,
  children,
  right,
}: {
  icon?: IconComponent;
  title?: string;
  description?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      {(title || description) && (
        <div className="flex items-center gap-2 px-1">
          {Icon && (
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[rgba(59,130,246,0.10)] text-[#7cabff]"
              aria-hidden="true"
            >
              <Icon size={12} strokeWidth={2.5} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs leading-relaxed text-white/30">
                {description}
              </p>
            )}
          </div>
          {right && <span className="shrink-0">{right}</span>}
        </div>
      )}
      <div className="settings-card">{children}</div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────
   SettingsLink — navigation row (opens its own focused page)
   ──────────────────────────────────────────────────────────────── */

export function SettingsLink({
  href,
  icon: Icon,
  title,
  description,
  value,
  trailing,
}: {
  href: string;
  icon?: IconComponent;
  title: string;
  description?: string;
  value?: string;
  trailing?: ReactNode;
}) {
  const saveScroll = useScrollRestore();
  return (
    <Link
      href={href}
      onClick={saveScroll}
      className="group flex min-h-[62px] items-center gap-3.5 px-4 py-3 transition-colors hover:bg-white/[0.03] active:bg-white/[0.06]"
    >
      {Icon && (
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40 transition-colors group-hover:text-white/70"
          aria-hidden="true"
        >
          <Icon size={17} strokeWidth={1.9} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-white/30">
            {description}
          </span>
        )}
      </span>
      {trailing}
      {value && (
        <span className="max-w-[140px] shrink-0 truncate text-xs text-white/30">
          {value}
        </span>
      )}
      <ChevronRight
        size={15}
        className="shrink-0 text-white/20 transition-colors group-hover:text-white/50"
        aria-hidden="true"
      />
    </Link>
  );
}
/* ────────────────────────────────────────────────────────────────
   ToggleRow — setting + short description + toggle (no noise)
   ──────────────────────────────────────────────────────────────── */

export function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  saved,
}: {
  icon?: IconComponent;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (_next: boolean) => void;
  disabled?: boolean;
  saved?: boolean;
}) {
  return (
    <div className="flex min-h-[62px] items-center gap-3.5 px-4 py-3">
      {Icon && (
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] transition-colors',
            checked ? 'text-[#7cabff]' : 'text-white/40'
          )}
          aria-hidden="true"
        >
          <Icon size={17} strokeWidth={1.9} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-sm font-medium text-white',
              disabled && 'text-white/40'
            )}
          >
            {title}
          </span>
          {saved && <SavedChip />}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-white/30">
            {description}
          </span>
        )}
      </div>
      <div className={cn('shrink-0', disabled && 'opacity-35')}>
        <SettingsToggle
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          label={title}
        />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   SelectRow — inline, expandable option picker (iOS-style)
   ──────────────────────────────────────────────────────────────── */

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export function SelectRow({
  icon: Icon,
  title,
  description,
  value,
  options,
  onSelect,
  disabled,
  right,
  saved,
}: {
  icon?: IconComponent;
  title: string;
  description?: string;
  value: string;
  options: SelectOption[];
  onSelect: (_value: string) => void;
  disabled?: boolean;
  right?: ReactNode;
  saved?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <div className={cn(disabled && 'pointer-events-none')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          'flex min-h-[62px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.06]',
          disabled && 'opacity-40'
        )}
      >
        {Icon && (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40"
            aria-hidden="true"
          >
            <Icon size={17} strokeWidth={1.9} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {title}
          </span>
          {description && (
            <span className="mt-0.5 block text-xs text-white/30">
              {description}
            </span>
          )}
        </span>
        {right}
        {saved && <SavedChip />}
        {current && (
          <span className="max-w-[140px] shrink-0 truncate text-xs text-white/30">
            {current.label}
          </span>
        )}
        <ChevronDown
          size={15}
          className={cn(
            'shrink-0 text-white/25 transition-transform duration-200',
            open && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 px-4 pb-3">
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onSelect(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors',
                      selected
                        ? 'border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.08)]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className="mt-0.5 block text-xs text-white/30">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <Check
                        size={16}
                        strokeWidth={2.5}
                        className="shrink-0 text-[#7cabff]"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}