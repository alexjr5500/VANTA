'use client';

import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Console metric tile — a focused metric grouping, not a decorative card.
 * Used sparingly for primary KPIs; every value is real backend data.
 */
export default function MetricTile({
  label,
  value,
  hint,
  icon,
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 border-t-2 border-console-border pt-3 pr-4',
        accent && 'border-t-console-gold',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon ? <span className={cn('shrink-0', accent ? 'text-console-gold' : 'text-console-text-3')}>{icon}</span> : null}
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-console-text-3">{label}</p>
      </div>
      <p className={cn('mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight', accent ? 'text-console-gold' : 'text-console-text')}>
        {value}
      </p>
      {hint ? <p className="mt-1 truncate text-xs text-console-text-3">{hint}</p> : null}
    </div>
  );
}
