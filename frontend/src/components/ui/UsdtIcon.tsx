'use client';

import { cn } from '@/lib/utils';

interface UsdtIconProps {
  size?: number;
  className?: string;
}

export default function UsdtIcon({ size = 24, className }: UsdtIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-label="USDT"
    >
      <circle cx="12" cy="12" r="11" fill="#26A17B" />
      <circle cx="12" cy="12" r="8" fill="rgba(0,0,0,0.1)" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="white"
        fontSize="7"
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
      >
        USDT
      </text>
    </svg>
  );
}