'use client';

import { cn } from '@/lib/utils';

interface UsdcIconProps {
  size?: number;
  className?: string;
}

export default function UsdcIcon({ size = 24, className }: UsdcIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-label="USDC"
    >
      <circle cx="12" cy="12" r="11" fill="#2775CA" />
      <circle cx="12" cy="12" r="8" fill="rgba(0,0,0,0.1)" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="white"
        fontSize="6"
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
      >
        USDC
      </text>
    </svg>
  );
}