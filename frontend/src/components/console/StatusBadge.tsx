'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold';

const toneMap: Record<StatusTone, { dot: string; text: string; bg: string }> = {
  success: { dot: 'bg-console-success', text: 'text-console-success', bg: 'bg-console-success-soft' },
  warning: { dot: 'bg-console-warning', text: 'text-console-warning', bg: 'bg-console-warning-soft' },
  danger: { dot: 'bg-console-danger', text: 'text-console-danger', bg: 'bg-console-danger-soft' },
  info: { dot: 'bg-console-info', text: 'text-console-info', bg: 'bg-console-info-soft' },
  gold: { dot: 'bg-console-gold', text: 'text-console-gold', bg: 'bg-console-gold-soft' },
  neutral: { dot: 'bg-console-text-3', text: 'text-console-text-2', bg: 'bg-white/[0.04]' },
};

/**
 * Console status badge — a colored dot PLUS a text label, so status is never
 * communicated through color alone (WCAG 1.4.1).
 */
export default function StatusBadge({
  tone = 'neutral',
  label,
  className,
  pulse,
}: {
  tone?: StatusTone;
  label: string;
  className?: string;
  pulse?: boolean;
}) {
  const t = toneMap[tone] || toneMap.neutral;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        t.bg, t.text, className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.dot, pulse && 'animate-pulse')} aria-hidden />
      {label}
    </span>
  );
}

/** Map common backend status strings to tones without inventing new values. */
export function statusToneFor(status: string | null | undefined): StatusTone {
  const s = String(status || '').toUpperCase();
  if (['ACTIVE', 'COMPLETED', 'APPROVED', 'RESOLVED', 'PAID', 'HEALTHY', 'VERIFIED', 'ONLINE', 'LIVE'].includes(s)) return 'success';
  if (['PENDING', 'REVIEW', 'UNDER_REVIEW', 'PROCESSING', 'DEGRADED', 'SUSPENDED', 'FLAGGED', 'AWAITING'].includes(s)) return 'warning';
  if (['BANNED', 'FAILED', 'REJECTED', 'DOWN', 'REMOVED', 'REVERSED', 'ERROR', 'BANN'].includes(s)) return 'danger';
  if (['REFUNDED', 'RESTORED', 'INFO'].includes(s)) return 'info';
  return 'neutral';
}
