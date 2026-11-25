'use client';

import { createElement } from 'react';
import { cn } from '@/lib/utils';

interface VantaCoinIconProps {
  size?: number;
  className?: string;
  decorative?: boolean;
}

/** Shared currency mark using original VANTA artwork, without recoloring it. */
export default function VantaCoinIcon({ size = 24, className, decorative = false }: VantaCoinIconProps) {
  return createElement('span', {
    role: decorative ? undefined : 'img',
    'aria-label': decorative ? undefined : 'VANTA Coins',
    'aria-hidden': decorative || undefined,
    style: { width: size, height: size, padding: Math.max(1, size * 0.09) },
    className: cn('inline-flex shrink-0 items-center justify-center rounded-full align-middle bg-gradient-to-br from-[#fff0ae] via-[#d4af37] to-[#94651a]', className),
  }, createElement('img', {
    src: '/branding/pwa-192.png',
    alt: '',
    draggable: false,
    width: size,
    height: size,
    className: 'block h-full w-full rounded-full bg-[#15171d] object-contain',
  }));
}
