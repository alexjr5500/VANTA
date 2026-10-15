'use client';

import React, { useCallback, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PullToRefreshProps {
  /** Async refresh operation. Returned promise resolves when fresh data is in. */
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  /** Extra classes for the scroll container (the component root). */
  className?: string;
  /**
   * Exposes the actual scroll element to the page so existing page-level
   * refs (e.g. Discover's scroll-to-top) keep working.
   */
  scrollRef?: { current: HTMLElement | null };
  /** Accessible label for the scroll region (e.g. feed landmarks). */
  ariaLabel?: string;
  /** Disable the gesture (e.g. on desktop or while a modal is open). */
  disabled?: boolean;
}

const THRESHOLD = 72; // px of downward drag needed to trigger a refresh
const MAX_PULL = 110; // cap the visual pull distance
const RESISTANCE = 0.5; // drag -> translate damping

/**
 * Reusable pull-to-refresh for scrollable, list-based pages.
 *
 * The component root IS the scroll container. The previous version wrapped
 * the scroller in an extra `overflow-hidden` block that was not a flex
 * container, so the inner `flex-1` scroller collapsed to content height,
 * `overflow-y-auto` never produced a scrollbar, and the feed was clipped and
 * unscrollable (the Homepage scrolling bug).
 *
 * Behaviour:
 *  - Only arms when the scroll container is already at the very top.
 *  - Ignores horizontal gestures, multi-touch, and text selection/inputs.
 *  - Shows a subtle gold spinner that grows as you pull; triggers onRefresh
 *    once the threshold is crossed on release.
 *  - Prevents duplicate concurrent refreshes, surfaces failures with a retry
 *    hint, and respects reduced-motion.
 *  - Never locks scrolling: only the inner wrapper is translated, and only
 *    while an armed downward pull is in progress.
 */
export default function PullToRefresh({
  onRefresh,
  children,
  className,
  scrollRef: scrollRefProp,
  ariaLabel,
  disabled = false,
}: PullToRefreshProps) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const armed = useRef(false);

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Safety net: if a refresh promise hangs, release the loading indicator.
  const watchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armWatchdog = useCallback(() => {
    if (watchRef.current) clearTimeout(watchRef.current);
    watchRef.current = setTimeout(() => {
      setRefreshing(false);
      setPull(0);
    }, 15000);
  }, []);

  // Expose the scroll element both internally and to the page (if requested).
  const attachRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (scrollRefProp) scrollRefProp.current = node;
    },
    [scrollRefProp]
  );

  const onTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || refreshing) return;
    // Single-finger, vertical intent only. Skip if the touch began on an input,
    // textarea, select, or a selected-text region so we never hijack typing or
    // text selection.
    if (event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-pull]')) return;
    if (window.getSelection && String(window.getSelection()).length > 0) return;

    const el = scrollRef.current;
    if (!el || el.scrollTop > 2) return; // only arm at the very top
    startY.current = event.touches[0].clientY;
    startX.current = event.touches[0].clientX;
    armed.current = true;
    setFailed(false);
  }, [disabled, refreshing]);

  const onTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!armed.current || startY.current == null || refreshing) return;
    const dy = event.touches[0].clientY - startY.current;
    const dx = event.touches[0].clientX - (startX.current ?? 0);
    if (dy <= 0) {
      // Normal scrolling toward (and past) the top: never block it.
      setPull(0);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontally dominant: leave the gesture to the page's own swipe logic.
      return;
    }
    // If the container leaves the top mid-gesture, hand control back to the
    // browser so normal scrolling is never interfered with.
    const el = scrollRef.current;
    if (el && el.scrollTop > 2) { armed.current = false; setPull(0); return; }
    const distance = Math.min(MAX_PULL, dy * RESISTANCE);
    setPull(distance);
    // Only while clearly pulling down at the very top, prevent the native
    // overscroll bounce. Scrolling through content never reaches this branch.
    if (distance > 4 && event.cancelable) event.preventDefault();
  }, [refreshing]);

  const finish = useCallback(async () => {
    if (!armed.current) { setPull(0); return; }
    armed.current = false;
    startY.current = null;
    startX.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(THRESHOLD * 0.6);
      setFailed(false);
      armWatchdog();
      try {
        await onRefresh();
      } catch {
        // Keep existing data on screen and offer a retry instead of resetting.
        setFailed(true);
        window.setTimeout(() => setFailed(false), 5000);
      } finally {
        setRefreshing(false);
        setPull(0);
        if (watchRef.current) { clearTimeout(watchRef.current); watchRef.current = null; }
      }
    } else {
      setPull(0);
    }
  }, [pull, refreshing, onRefresh, armWatchdog]);

  const onScroll = (_event: UIEvent<HTMLDivElement>) => {
    // If the user scrolls away from the top mid-gesture, cancel the pull.
    if (armed.current && scrollRef.current && scrollRef.current.scrollTop > 2) {
      armed.current = false;
      setPull(0);
    }
  };

  // While a failed hint is showing, keep the indicator visible without
  // moving the content (the wrapper only translates during an armed pull).
  const shown = failed && !pull && !refreshing ? 28 : pull;
  const active = shown > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div
      ref={attachRef}
      onScroll={onScroll}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={finish}
      onTouchCancel={finish}
      aria-label={ariaLabel}
      className={cn(
        'relative min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide [-webkit-overflow-scrolling:touch]',
        className
      )}
    >
      {/* Loading indicator — a subtle gold spinner that fades/slides in. */}
      <div
        aria-hidden={!active}
        className={cn(
          'pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center justify-center',
          'transition-opacity duration-200'
        )}
        style={{
          top: `calc(env(safe-area-inset-top) + ${Math.max(4, shown - 6)}px)`,
          opacity: active ? 1 : 0,
          transform: `translate(-50%, ${refreshing ? 0 : -6}px) scale(${reduceMotion ? 1 : 0.85 + progress * 0.15})`,
          transition: reduceMotion ? 'none' : undefined,
        }}
      >
        {failed ? (
          <div
            className="flex items-center gap-1.5 rounded-full border border-[#d6a83f]/30 bg-[#161616]/95 px-3 py-1.5 text-[11px] font-medium text-[#d6a83f] shadow-lg backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <AlertCircle size={12} />
            Couldn&apos;t refresh &mdash; pull to retry
          </div>
        ) : (
          <div
            className={cn(
              'grid h-9 w-9 place-items-center rounded-full border border-[#d6a83f]/30 bg-[#161616]/90 shadow-lg backdrop-blur',
              refreshing && 'animate-none'
            )}
          >
            <Loader2
              size={17}
              className={cn('text-[#d6a83f]', refreshing ? 'animate-spin' : '')}
              style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
            />
          </div>
        )}
      </div>

      {/* Inner wrapper owns the pull translate; the scrollport itself is untouched. */}
      <div
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: armed.current ? 'none' : 'transform 220ms cubic-bezier(.16,1,.3,1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
