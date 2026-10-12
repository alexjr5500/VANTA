'use client';

import React, { type ReactNode } from 'react';
import { AlertCircle, Inbox, Lock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Honest data states for every console surface. These strictly differentiate:
 * loading, empty (nothing exists), no-results (filters), error (request
 * failed) and forbidden (no permission) — failures are never rendered as
 * empty data.
 */

export function ConsoleLoading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center gap-2 py-14 text-sm text-console-text-3', className)}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-console-border border-t-console-gold" aria-hidden />
      {label}
    </div>
  );
}

/** Skeleton rows that preserve the intended table/list layout while loading. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading records" className={cn('divide-y divide-console-border', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.05]" />
            <div className="h-2.5 w-1/4 animate-pulse rounded bg-white/[0.04]" />
          </div>
          <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

export function ConsoleErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-console-danger-soft text-console-danger">
        <AlertCircle size={20} aria-hidden />
      </span>
      <h3 className="text-sm font-semibold text-console-text">{title}</h3>
      {message ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-console-text-3">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="vc-focus mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border-strong px-3.5 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
        >
          <RefreshCw size={13} aria-hidden /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function ConsoleEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-console-border bg-white/[0.03] text-console-text-3">
        {icon || <Inbox size={19} aria-hidden />}
      </span>
      <h3 className="text-sm font-semibold text-console-text-2">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-console-text-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ConsoleForbiddenState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-console-warning-soft text-console-warning">
        <Lock size={19} aria-hidden />
      </span>
      <h3 className="text-sm font-semibold text-console-text">Access restricted</h3>
      <p className="mt-1 max-w-sm text-xs text-console-text-3">
        {message || 'You don’t have permission to view this data.'}
      </p>
    </div>
  );
}
