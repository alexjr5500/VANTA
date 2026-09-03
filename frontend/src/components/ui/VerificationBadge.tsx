'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

export type VerificationBadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export interface VerificationBadgeProps {
  /** 'BLUE' and 'GOLD' each render the single canonical VANTA verified badge. */
  type?: 'BLUE' | 'GOLD' | 'NONE';
  /** Convenience shorthand: renders the canonical badge when truthy. */
  verified?: boolean;
  /** Controlled size variant of the same badge system. Defaults to 'sm'. */
  size?: VerificationBadgeSize;
  /** Show the badge label as a native tooltip. */
  showTooltip?: boolean;
  className?: string;
}

/* One canonical VANTA Verified Badge:
   - Icon: lucide Check — a single ✓ (no extra badge outline)
   - Shape: a faceted badge-seal silhouette with 8 prominent points
     alternating against 8 inner notches. It has visible edges/points so it
     reads as a premium verification seal — clearly NOT a plain circle and NOT
     a conventional 5-pointed star — while staying crisp at small sizes.
   - Color: approved VANTA gold gradient (design-system `--gradient-gold`).
   - Stroke: consistent per size; black check on gold.
   Only the seal/check scale with `size`; the identity never changes. */
const SIZES: Record<VerificationBadgeSize, { box: number; icon: number; stroke: number }> = {
  xs: { box: 14, icon: 9, stroke: 3 },
  sm: { box: 17, icon: 11, stroke: 3 },
  md: { box: 21, icon: 14, stroke: 2.75 },
  lg: { box: 27, icon: 18, stroke: 2.5 },
};

const LABEL = 'Verified account';

// Alternating outer points and inner notches around the seal body (16 total).
// Generated radially from center (12, 12.5), inner ring at 82% of the outer ring.
const BADGE_POLYGON =
  '12,1.8 12,3.73 8.6,4.2 9.21,5.69 4.6,5.4 5.93,6.68 2.6,8.6 4.29,9.3 2.2,11.5 3.96,11.68 3.6,15.6 5.11,15.04 5.6,18.4 6.75,17.34 8.6,19.6 9.21,18.32 12,22.2 12,20.45 15.4,19.6 14.79,18.32 18.4,18.4 17.25,17.34 20.4,15.6 18.89,15.04 21.8,11.5 20.04,11.68 21.4,8.6 19.71,9.3 19.4,5.4 18.07,6.68 15.4,4.2 14.79,5.69';

export default function VerificationBadge({
  type = 'BLUE',
  verified,
  size = 'sm',
  showTooltip = false,
  className,
}: VerificationBadgeProps) {
  const active = verified ? true : type !== 'NONE';
  const gradientId = useId();
  if (!active) return null;

  const s = SIZES[size];

  return (
    <span
      aria-label="Verified"
      role="img"
      title={showTooltip ? LABEL : undefined}
      className={cn('relative inline-flex shrink-0 select-none items-center justify-center', className)}
      style={{ width: s.box, height: s.box }}
    >
      {/* Edged badge-seal silhouette */}
      <svg
        viewBox="0 0 24 24"
        width={s.box}
        height={s.box}
        className="block"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#dfbd55" />
            <stop offset="0.55" stopColor="#c9a227" />
            <stop offset="1" stopColor="#a48220" />
          </linearGradient>
        </defs>
        {/* Body */}
        <polygon
          points={BADGE_POLYGON}
          fill={`url(#${gradientId})`}
          stroke="rgba(0, 0, 0, 0.65)"
          strokeWidth="0.55"
          strokeLinejoin="round"
        />
        {/* Subtle top sheen so the seal keeps its premium depth at any size */}
        <polygon
          points="12,1.8 12,3.73 8.6,4.2 9.21,5.69 4.6,5.4 5.93,6.68 6.9,8.2 10.4,4.6"
          fill="rgba(255, 255, 255, 0.28)"
        />
      </svg>
      <Check
        size={s.icon}
        strokeWidth={s.stroke}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shrink-0 text-[#050505]"
      />
    </span>
  );
}