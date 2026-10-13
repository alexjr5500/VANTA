'use client';

import React, { useCallback, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PullToRefreshProps {
  /** Async refresh operation. Returned promise resolves when fresh data is in. */
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  /** Extra classes for the scroll container. */
  className?: string;
  /** Disable the gesture (e.g. on desktop or while a modal is open). */
  disabled?: boolean;
}

const THRESHOLD = 72; // px of downward drag needed to trigger a refresh
const MAX_PULL = 110; // cap the visual pull distance
const RESISTANCE = 0.5; // drag -> translate damping

/**
 * Reusable pull-to-refresh for scrollable, list-based pages.
 *
 * Behaviour (touch only; desktop keeps its own explicit refresh control):
 *  - Only arms when the scroll container is already at the very top.
 *  - Ignores horizontal gestures, multi-touch, and text selection/inputs.
 *  - Shows a subtle gold spinner that grows as you pull; triggers onRefresh
 *    once the threshold is crossed on release.
 *  - Prevents duplicate concurrent refreshes and respects reduced-motion.
 *  - Never locks scrolling (uses transform on an inner wrapper only).
 */
export default function PullToRefresh({ onRefresh, children, className, disabled = false }: PullToRefreshProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const armed = useRef(false);

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    armed.current = true;
  }, [disabled, refreshing]);

  const onTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!armed.current || startY.current == null || refreshing) return;
    const dy = event.touches[0].clientY - startY.current;
    if (dy <= 0) {
      setPull(0);
      return;
    }
    // If the user scrolls the list up past the top, hand control back to the
    // browser so normal scrolling is never interfered with.
    const el = scrollRef.current;
    if (el && el.scrollTop > 0) { armed.current = false; setPull(0); return; }
    const distance = Math.min(MAX_PULL, dy * RESISTANCE);
    setPull(distance);
    // Once we're clearly pulling down, prevent the native overscroll bounce.
    if (distance > 4 && event.cancelable) event.preventDefault();
  }, [refreshing]);

  const finish = useCallback(async () => {
    if (!armed.current) { setPull(0); return; }
    armed.current = false;
    startY.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(THRESHOLD * 0.6);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }, [pull, refreshing, onRefresh]);

  const onScroll = (_event: UIEvent<HTMLDivElement>) => {
    // If the user scrolls away from the top mid-gesture, cancel the pull.
    if (armed.current && scrollRef.current && scrollRef.current.scrollTop > 2) {
      armed.current = false;
      setPull(0);
    }
  };

  const active = pull > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {/* Loading indicator — a subtle gold spinner that fades/slides in. */}
      <div
        aria-hidden={!active}
        className={cn(
          'pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center justify-center',
          'transition-opacity duration-200'
        )}
        style={{
          top: `calc(env(safe-area-inset-top) + ${Math.max(4, pull - 6)}px)`,
          opacity: active ? 1 : 0,
          transform: `translate(-50%, ${refreshing ? 0 : -6}px) scale(${reduceMotion ? 1 : 0.85 + progress * 0.15})`,
          transition: reduceMotion ? 'none' : undefined,
        }}
      >
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
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={finish}
        onTouchCancel={finish}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide [-webkit-overflow-scrolling:touch]',
          className
        )}
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
