'use client';

import type { CSSProperties } from 'react';
import { createFrameCoalescer, viewportChanged } from './viewportScheduling';

/**
 * VANTA global visual-viewport / mobile-keyboard helper.
 * Only treat viewport reduction as keyboard space while an editable control is
 * focused. Android WebViews may report system-bar/edge-to-edge differences
 * when the keyboard is closed; those must not move fixed app chrome.
 */

export type VisualViewportState = {
  height: number;
  offsetTop: number;
  keyboard: number;
  open: boolean;
};

const DEFAULTS: VisualViewportState = { height: 0, offsetTop: 0, keyboard: 0, open: false };
let current: VisualViewportState = { ...DEFAULTS };
let mounted = false;

function hasEditableFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active) return false;
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) return false;
  if (active instanceof HTMLInputElement && ['button', 'checkbox', 'radio', 'submit', 'reset', 'file'].includes(active.type)) return false;
  return true;
}

function readState(): VisualViewportState {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const height = Math.round(vv?.height ?? layoutHeight);
  const offsetTop = Math.round(vv?.offsetTop ?? 0);
  const viewportReduction = Math.max(0, Math.round(layoutHeight - (vv?.height ?? layoutHeight)));
  // Require editable focus and a meaningful reduction; viewport/system-bar
  // differences alone are not evidence that the keyboard is open.
  const keyboard = hasEditableFocus() && viewportReduction >= 120 ? viewportReduction : 0;
  return { height, offsetTop, keyboard, open: keyboard > 0 };
}

function applyToRoot(state: VisualViewportState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--vanta-vh', `${state.height}px`);
  root.style.setProperty('--vanta-vh-offset', `${state.offsetTop}px`);
  root.style.setProperty('--vanta-kb', `${state.keyboard}px`);
  root.style.setProperty('--vanta-safe-bottom', `calc(env(safe-area-inset-bottom, 0px) + ${state.keyboard}px)`);
}

function sync(force = false): void {
  const next = readState();
  if (!force && !viewportChanged(current, next)) return;
  current = next;
  applyToRoot(current);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<VisualViewportState>('vanta:viewport', { detail: current }));
  }
}

export function mountVisualViewport(): () => void {
  if (typeof window === 'undefined' || mounted) return () => undefined;
  mounted = true;
  const vv = window.visualViewport;
  const scheduler = createFrameCoalescer(
    callback => window.requestAnimationFrame(callback),
    handle => window.cancelAnimationFrame(handle),
    () => sync(),
  );
  const onChange = scheduler.schedule;
  // Initial variables must exist before keyboard-dependent layout is rendered.
  sync(true);
  vv?.addEventListener('resize', onChange);
  vv?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  document.addEventListener('focusin', onChange);
  document.addEventListener('focusout', onChange);
  return () => {
    vv?.removeEventListener('resize', onChange);
    vv?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
    document.removeEventListener('focusin', onChange);
    document.removeEventListener('focusout', onChange);
    scheduler.dispose();
    mounted = false;
  };
}

export function getVisualViewportState(): VisualViewportState {
  return { ...current };
}

export function keyboardStyle(state: VisualViewportState): CSSProperties {
  return { bottom: `calc(env(safe-area-inset-bottom, 0px) + ${state.keyboard}px)` };
}
