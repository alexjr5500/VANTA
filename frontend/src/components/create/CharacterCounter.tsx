'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CharacterCounterProps {
  current: number;
  max: number;
  className?: string;
}

export default function CharacterCounter({ current, max, className }: CharacterCounterProps) {
  const percentage = (current / max) * 100;
  const isNearLimit = current >= max * 0.85;
  const isAtLimit = current >= max;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative w-8 h-8">
        <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="2.5"
          />
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke={isAtLimit ? '#f2c75c' : isNearLimit ? '#f59e0b' : '#d6a83f'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 13}`}
            strokeDashoffset={`${2 * Math.PI * 13 * (1 - Math.min(percentage, 100) / 100)}`}
            className="transition-all duration-300"
          />
        </svg>
        {isAtLimit && (
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-[#f2c75c]">
            {max - current}
          </span>
        )}
      </div>
      <span
        className={cn(
          'text-xs font-medium transition-colors',
          isAtLimit && 'text-[#f2c75c]',
          isNearLimit && !isAtLimit && 'text-amber-400',
          !isNearLimit && 'text-gray-500'
        )}
      >
        {current}/{max}
      </span>
    </div>
  );
}