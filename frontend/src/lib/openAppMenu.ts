'use client';

/**
 * Open the global VANTA mobile menu (the bottom sheet owned by AppLayout).
 *
 * Pages render their own PageHeader; this lets any page wire its header's
 * existing `onMenu` slot to the single app-level drawer without prop drilling
 * or a duplicate menu/header implementation.
 */
export function openAppMenu(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('vanta:open-menu'));
}
