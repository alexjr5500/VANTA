'use client';

import type { CSSProperties } from 'react';

/**
 * VANTA global visual-viewport / mobile-keyboard helper.
 *
 * Mobile browsers (Android Chrome / installed PWAs) shrink the visible area
 * when the on-screen keyboard opens; `window.innerHeight` is unreliable and
 * keyboard height varies by device/browser/orientation. The reliable source is
 * `window.visualViewport`.
 *
 * This module subscribes to `visualViewport.resize` / `visualViewport.scroll`
 * (plus `window.resize` fallback), derives the visible height, keyboard offset
 * and visual-viewport vertical offset, and writes them as CSS variables on
 * `:root` so ANY component can position itself above the keyboard without
 * hard-coded pixel values:
 *
 *   --vanta-vh          visible viewport height (px)
 *   --vanta-vh-offset   visualViewport.offsetTop (px, 0 on desktop)
 *   --vanta-kb          on-screen keyboard height (px, 0 when closed)
 *   --vanta-safe-bottom combined safe-area inset + keyboard offset (px)
 *
 * It is a singleton mounted once from the app shell (AppLayout).
 */

export type VisualViewportState = {
  /** Visible viewport height (px) — the height above the keyboard. */
  height: number;
  /** Vertical offset of the visual viewport in the layout viewport (px). */
  offsetTop: number;
  /** On-screen keyboard height (px). 0 when closed / on desktop. */
  keyboard: number;
  /** True while an on-screen keyboard reduces the visible viewport. */
  open: boolean;
};

const DEFAULTS: VisualViewportState = { height: 0, offsetTop: 0, keyboard: 0, open: false };
let current: VisualViewportState = { ...DEFAULTS };
let mounted = false;

function readState(): VisualViewportState {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const height = Math.round(vv?.height ?? layoutHeight);
  const offsetTop = Math.round(vv?.offsetTop ?? 0);
  // Android does not resize the layout viewport when the keyboard opens, so the
  // keyboard height is exactly the difference between layout and visual height.
  const keyboard = Math.max(0, Math.round(layoutHeight - (vv?.height ?? layoutHeight)));
  return { height, offsetTop, keyboard, open: keyboard > 0 };
}

function applyToRoot(state: VisualViewportState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--vanta-vh', `${state.height}px`);
  root.style.setProperty('--vanta-vh-offset', `${state.offsetTop}px`);
  root.style.setProperty('--vanta-kb', `${state.keyboard}px`);
  // Combined safe-area + keyboard offset so fixed UI never double-stacks them.
  root.style.setProperty('--vanta-safe-bottom', `calc(env(safe-area-inset-bottom, 0px) + ${state.keyboard}px)`);
}

function sync(): void {
  current = readState();
  applyToRoot(current);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<VisualViewportState>('vanta:viewport', { detail: current }));
  }
}

/** Mount the global listener once. Returns an unmount function (no-op if already mounted). */
export function mountVisualViewport(): () => void {
  if (typeof window === 'undefined' || mounted) return () => undefined;
  mounted = true;
  const vv = window.visualViewport;
  const onChange = () => sync();
  sync();
  vv?.addEventListener('resize', onChange);
  vv?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    vv?.removeEventListener('resize', onChange);
    vv?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
    mounted = false;
  };
}

/** Read the current visual-viewport / keyboard state synchronously. */
export function getVisualViewportState(): VisualViewportState {
  return { ...current };
}

/** CSS vars already cover most needs; this convenience inlines the keyboard bottom inset. */
export function keyboardStyle(state: VisualViewportState): CSSProperties {
  return { bottom: `calc(env(safe-area-inset-bottom, 0px) + ${state.keyboard}px)` };
}