'use client';

import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Accessible confirmation dialog for consequential actions.
 * - role="dialog" + aria-modal, labelled by title
 * - Escape closes; backdrop click closes (unless busy)
 * - focus moves to the cancel button on mount; tab order stays inside
 * - destructive tone is explicit in copy, not color alone
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vc-confirm-title"
        aria-describedby="vc-confirm-message"
        className="vc-panel w-full max-w-md overflow-hidden p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-start gap-3">
          <span className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
            tone === 'danger' ? 'bg-console-danger-soft text-console-danger' : 'bg-console-gold-soft text-console-gold',
          )}>
            <AlertTriangle size={19} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="vc-confirm-title" className="text-sm font-semibold text-console-text">{title}</h2>
            <p id="vc-confirm-message" className="mt-1 text-xs leading-relaxed text-console-text-2">{message}</p>
            {details ? <div className="mt-2 rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-2.5 text-xs text-console-text-3">{details}</div> : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={cn(
              'vc-focus inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] px-4 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-60',
              tone === 'danger' ? 'bg-console-danger text-white' : 'bg-console-gold text-console-gold-fg',
            )}
          >
            {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
