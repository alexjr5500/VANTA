'use client';

import { cn } from '@/lib/utils';

interface GiftIconProps {
  size?: number;
  className?: string;
  variant?: 'default' | 'rose' | 'diamond' | 'crown' | 'rocket' | 'yacht' | 'teddy' | 'heart' | 'luxury';
}

const GIFT_SVGS: Record<string, string> = {
  default: 'M12 4l-2 4h4l-2-4zM6 10h12v2H6zM8 12v6h8v-6',
  rose: 'M12 2C8 2 4 6 4 10c0 4 8 10 8 10s8-6 8-10c0-4-4-8-8-8z',
  diamond: 'M12 2L2 12l10 10 10-10L12 2zM12 6l4 4-4 4-4-4 4-4z',
  crown: 'M2 19l3-10 5 4 2-8 2 8 5-4 3 10H2z',
  rocket: 'M12 2C8 2 4 6 4 10c0 4 2 6 4 8v4h8v-4c2-2 4-4 4-8 0-4-4-8-8-8zM12 12a2 2 0 100-4 2 2 0 000 4z',
  yacht: 'M2 20h20l-2-4H4l-2 4zM12 4v12M8 8l4-4 4 4',
  teddy: 'M12 2a6 6 0 00-6 6c0 2 1 4 2 5l-2 3h12l-2-3c1-1 2-3 2-5a6 6 0 00-6-6zM9 8h6M10 11h4',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  luxury: 'M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7l2-7z',
};

export default function GiftIcon({ size = 24, className, variant = 'default' }: GiftIconProps) {
  const pathData = GIFT_SVGS[variant] || GIFT_SVGS.default;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-label={variant === 'default' ? 'Gift' : variant.charAt(0).toUpperCase() + variant.slice(1)}
    >
      <defs>
        <linearGradient id={`gift-grad-${variant}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF007F" />
          <stop offset="100%" stopColor="#7A00CC" />
        </linearGradient>
      </defs>
      <path
        d={pathData}
        fill={variant === 'default' ? 'currentColor' : 'url(#gift-grad-' + variant + ')'}
        stroke={variant === 'default' ? 'none' : 'rgba(255,255,255,0.2)'}
        strokeWidth="0.5"
      />
    </svg>
  );
}