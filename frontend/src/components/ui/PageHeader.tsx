'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocalizedUiText } from '@/lib/i18n/useLocalizedUiText';

export interface PageHeaderProps {
  /** Primary title. Long titles truncate instead of pushing actions off-screen. */
  title?: React.ReactNode;
  /** Optional small eyebrow label shown above the title. */
  eyebrow?: React.ReactNode;
  /**
   * Back affordance. Pass a route string to link, a callback to run it, or
   * `true` to call `router.back()`. Not rendered when `home` is set.
   */
  back?: boolean | string | (() => void);
  /** Render a compact leading spacer for the primary feed/home header (no wordmark). */
  home?: boolean;
  /** Render a menu/drawer toggle as the leading element. */
  onMenu?: () => void;
  /** Right-aligned controls (rendered `shrink-0` so titles never get crushed). */
  actions?: React.ReactNode;
  /** Fix the header to the top of the viewport with a blur / safe-area surface. */
  sticky?: boolean;
  /** Blend to the shell padding edge (`-mx-4`) when the page shell already adds `px-4`. */
  bleed?: boolean;
  className?: string;
}

/**
 * Canonical VANTA page header.
 *
 * Discover is the sizing reference: standard page headers are exactly 56px tall.
 * Titles and optional eyebrow labels stay on one line; no extra safe-area padding
 * or stacked text is allowed to make this shared header taller.
 */
export default function PageHeader({
  title,
  eyebrow,
  back,
  home,
  onMenu,
  actions,
  sticky,
  bleed,
  className,
}: PageHeaderProps) {
  const router = useRouter();
  const tr = useLocalizedUiText();

  const handleBack = () => {
    if (typeof back === 'function') back();
    else if (typeof back === 'string') router.push(back);
    else router.back();
  };

  const showBack = typeof back !== 'undefined' && back !== false;
  const showMenu = typeof onMenu === 'function';

  return (
    <header
      className={cn(
        'relative flex h-14 max-h-14 min-h-14 w-full shrink-0 items-center gap-2 overflow-hidden',
        bleed && '-mx-4 w-[calc(100%+2rem)]',
        sticky
          ? 'sticky top-0 z-30 border-b border-white/[0.08] bg-[var(--header-surface)] backdrop-blur-xl'
          : 'border-b border-white/[0.08]',
        className,
      )}
    >
      {(showBack || showMenu || home) && (
        <div className="flex shrink-0 items-center gap-1">
          {home ? (
            <span className="h-10 w-10 shrink-0" aria-hidden="true" />
          ) : (
            <>
              {showMenu ? (
                <button
                  type="button"
                  onClick={onMenu}
                  aria-label="Open menu"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white"
                >
                  <Menu size={19} />
                </button>
              ) : (
                showBack && (
                  <button
                    type="button"
                    onClick={handleBack}
                    aria-label="Go back"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white"
                  >
                    <ArrowLeft size={19} />
                  </button>
                )
              )}
            </>
          )}
        </div>
      )}
      {(title || eyebrow) && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {eyebrow && (
            <span className="shrink-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">
              {eyebrow}
            </span>
          )}
          {title && (
            <h1 className="min-w-0 truncate text-base font-semibold leading-none text-[#F5F5F5]">{typeof title === 'string' ? tr(title) : title}</h1>
          )}
        </div>
      )}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1 text-current">{actions}</div>}
    </header>
  );
}