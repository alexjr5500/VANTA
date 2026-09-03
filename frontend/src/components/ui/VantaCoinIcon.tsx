'use client';

import { cn } from '@/lib/utils';

interface VantaCoinIconProps {
  size?: number;
  className?: string;
}

/**
 * VANTA currency icon.
 *
 * A minimal, premium, monochrome mark that communicates digital value and the
 * VANTA creator economy. Uses the BLACK / GRAPHITE / SILVER / WHITE identity —
 * no gold, no emoji, no legacy coin treatment.
 */
export default function VantaCoinIcon({ size = 24, className }: VantaCoinIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-label="VANTA"
      role="img"
    >
      {/* Outer ring — silver */}
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
      {/* Inner ring — graphite */}
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
      {/* Central V mark — premium digital currency */}
      <path
        d="M7.5 8.5L12 16.5L16.5 8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Accent tick — value / premium */}
      <path
        d="M12 16.5V19"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}