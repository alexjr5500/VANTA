'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'card';
  width?: string | number;
  height?: string | number;
}

export default function Skeleton({
  className,
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  const baseClass = 'bg-white/[0.04] animate-pulse';

  const variants = {
    text: 'h-4 w-full rounded-lg',
    circular: 'rounded-full',
    rectangular: 'rounded-xl',
    card: 'h-48 rounded-[var(--radius-2xl)]',
  };

  return (
    <div
      className={cn(baseClass, variants[variant], className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton className="w-32" />
          <Skeleton className="w-20" />
        </div>
      </div>
      <Skeleton variant="text" />
      <Skeleton variant="text" className="w-3/4" />
      <Skeleton variant="rectangular" height={200} />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton variant="circular" width={36} height={36} />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="w-40" />
            <Skeleton className="w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}