'use client';

import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Console section panel — an open content section with an optional header
 * row (title + description + right-aligned actions). Used instead of
 * repeating generic card grids across Studio and Admin pages.
 */
export default function ConsolePanel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag className={cn('vc-panel overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-console-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="truncate text-sm font-semibold text-console-text">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-console-text-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </Tag>
  );
}
