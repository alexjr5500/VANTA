'use client';

import { cn } from '@/lib/utils';
import VerificationBadge from '@/components/ui/VerificationBadge';

export type VantaVerifiedBadgeSize = 'xs' | 'sm' | 'md';

interface VantaVerifiedBadgeProps {
  /** Show the full pill with "VANTA Verified" text. Defaults to compact check disc. */
  variant?: 'pill' | 'disc';
  size?: VantaVerifiedBadgeSize;
  className?: string;
}

const pillText: Record<VantaVerifiedBadgeSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-[11px]',
  md: 'text-xs',
};

const pillPadding: Record<VantaVerifiedBadgeSize, string> = {
  xs: 'px-2 py-0.5',
  sm: 'px-2.5 py-1',
  md: 'px-3 py-1.5',
};

const discSize: Record<VantaVerifiedBadgeSize, 'xs' | 'sm' | 'md'> = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
};

/*
 * The ONE canonical "VANTA Verified" badge for fundraisers.
 *
 * "VANTA Verified" means VANTA reviewed the fundraiser's information and
 * evidence through its verification process. It is NOT a guarantee of the
 * outcome or every statement made by the organizer.
 *
 * The check-mark disc reuses the exact same visual language as the platform's
 * canonical VerificationBadge (approved VANTA gold gradient, black check) so
 * there is never a second badge identity. The pill variant adds the label.
 */
export default function VantaVerifiedBadge({ variant = 'disc', size = 'sm', className }: VantaVerifiedBadgeProps) {
  if (variant === 'pill') {
    return (
      <span
        role="img"
        aria-label="VANTA Verified"
        title="VANTA Verified — reviewed by VANTA"
        className={cn(
          'inline-flex shrink-0 select-none items-center gap-1.5 rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)] text-[var(--vanta-gold-bright)]',
          pillText[size],
          pillPadding[size],
          className
        )}
      >
        <VerificationBadge type="GOLD" size="xs" />
        <span className="font-semibold tracking-wide">VANTA Verified</span>
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label="VANTA Verified"
      title="VANTA Verified — reviewed by VANTA"
      className={cn('inline-flex shrink-0 select-none items-center', className)}
    >
      <VerificationBadge type="GOLD" size={discSize[size]} />
    </span>
  );
}