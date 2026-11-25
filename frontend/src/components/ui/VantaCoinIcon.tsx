'use client';

import { cn } from '@/lib/utils';

interface VantaCoinIconProps {
  size?: number;
  className?: string;
  decorative?: boolean;
}

/** The shared VANTA currency mark uses the original packaged brand artwork.
 * The gold rim identifies platform coins; the logo itself is not redrawn or recolored.
 */
export default function VantaCoinIcon({ size = 24, className, decorative = false }: VantaCoinIconProps) {
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'VANTA Coins'}
      aria-hidden={decorative || undefined}
      style={{ width: size, height: size, padding: size * 0.09 }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full align-middle bg-gradient-to-br from-[#fff0ae] via-[#d4af37] to-[#94651a]', className)}
    >
      <img
        src="/branding/pwa-192.png"
        alt=""
        draggable={false}
        width={size}
        height={size}
        className="block h-full w-full rounded-full bg-[#15171d] object-contain"
      />
    </span>
  );
}
