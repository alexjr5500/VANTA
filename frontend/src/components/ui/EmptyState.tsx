'use client';

import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
        {icon || <Inbox size={24} className="text-white/30" />}
      </div>
      <h3 className="text-white/50 font-medium text-lg mb-1">{title}</h3>
      {description && (
        <p className="text-white/30 text-sm max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function EmptyStateSimple({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-white/40">{title}</p>
      {description && <p className="text-xs text-white/20 mt-1">{description}</p>}
    </div>
  );
}