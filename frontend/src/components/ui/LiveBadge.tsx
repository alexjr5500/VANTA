'use client';

import { cn } from '@/lib/utils';

interface LiveBadgeProps {
  viewers?: number;
  className?: string;
  size?: 'sm' | 'md';
}

export default function LiveBadge({ viewers, className, size = 'sm' }: LiveBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-bold text-white',
        size === 'sm' ? 'px-2 py-0.5 text-[9px]' : 'px-3 py-1 text-xs',
        'bg-gradient-to-r from-[#d6a83f] to-[#f2c75c] shadow-[0_0_12px_rgba(255,0,127,0.3)]',
        className
      )}
    >
      <span className={cn('rounded-full bg-white', size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', 'animate-pulse')} />
      {size === 'md' && <span>LIVE</span>}
      {viewers !== undefined && (
        <span className="opacity-90">
          {viewers >= 1000 ? `${(viewers / 1000).toFixed(1)}K` : viewers}
        </span>
      )}
    </div>
  );
}