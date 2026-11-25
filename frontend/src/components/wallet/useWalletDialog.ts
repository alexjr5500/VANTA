'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

const focusable = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard focus inside a wallet dialog and restore it to its opener. */
export function useWalletDialog<T extends HTMLElement>(open: boolean, onClose: () => void, locked = false) {
  const ref = useRef<T>(null);
  const latest = useRef({ onClose, locked });
  useLayoutEffect(() => { latest.current = { onClose, locked }; }, [onClose, locked]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    const getControls = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter(el => el.getClientRects().length && !el.closest('[inert]'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!latest.current.locked) latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = getControls();
      if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (!controls.includes(document.activeElement as HTMLElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) dialog.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
