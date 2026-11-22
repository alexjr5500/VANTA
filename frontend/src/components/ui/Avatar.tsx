'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { resolveMediaUrl, DEFAULT_AVATAR } from '@/lib/mediaUrl';
import { mediaUrlsMatch, PROFILE_MEDIA_EVENT, ProfileMediaUpdate } from '@/lib/profileMedia';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';

export interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  status?: 'online' | 'offline' | 'away' | 'busy' | 'none';
  className?: string;
  /** Applied to the OUTER positioning wrapper so the whole avatar can be made
   *  to fill a fixed-size parent (rings, story circles, bezels). Without this
   *  the image can only ever be as large as the built-in size variant. */
  wrapperClassName?: string;
  onClick?: () => void;
  fallback?: string;
  /** Active verification entitlement to display on the avatar circle. */
  verified?: boolean;
  verificationType?: VerificationType | null;
}

const sizeStyles = {
  xs: 'w-6 h-6 text-[8px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-16 h-16 text-base',
  '2xl': 'w-20 h-20 text-lg',
};

const statusStyles = {
  online: 'bg-emerald-500',
  offline: 'bg-gray-500',
  away: 'bg-amber-500',
  busy: 'bg-red-500',
  none: 'hidden',
};

const statusSizes = {
  xs: 'w-1.5 h-1.5 ring-1',
  sm: 'w-2 h-2 ring-1',
  md: 'w-2.5 h-2.5 ring-2',
  lg: 'w-3 h-3 ring-2',
  xl: 'w-3.5 h-3.5 ring-2',
  '2xl': 'w-4 h-4 ring-2',
};

export default function Avatar({
  src,
  alt = 'User',
  size = 'md',
  status = 'none',
  className,
  wrapperClassName,
  onClick,
  fallback,
  verified = false,
  verificationType,
}: AvatarProps) {
  const [error, setError] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    setResolvedSrc(src ? resolveMediaUrl(src) : src || null);
    setError(false);
  }, [src]);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<ProfileMediaUpdate>).detail;
      if (detail && mediaUrlsMatch(resolvedSrc, detail.previousAvatar)) {
        setResolvedSrc(detail.avatar ? resolveMediaUrl(detail.avatar) : null);
        setError(false);
      }
    };
    window.addEventListener(PROFILE_MEDIA_EVENT, handleUpdate);
    return () => window.removeEventListener(PROFILE_MEDIA_EVENT, handleUpdate);
  }, [resolvedSrc]);

  const hasImage = resolvedSrc && !error;

  return (
    <div
      className={cn('relative inline-flex shrink-0 overflow-visible', sizeStyles[size], wrapperClassName, onClick && 'cursor-pointer')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={alt}
    >
      <div
        className={cn(
          'aspect-square rounded-full flex items-center justify-center overflow-hidden',
          'bg-[#161616] border border-white/[0.08]',
          sizeStyles[size],
          className
        )}
      >
        {hasImage ? (
          <img
            src={resolvedSrc}
            alt={alt}
            className="w-full h-full object-cover"
            onError={() => setError(true)}
          />
        ) : fallback ? (
          <span className="font-semibold text-white/40">
            {fallback.charAt(0).toUpperCase()}
          </span>
        ) : (
          // One consistent default avatar for users without a profile picture.
          <img src={DEFAULT_AVATAR} alt={alt} className="w-full h-full object-cover" />
        )}
      </div>

      {verified && verificationType && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 rounded-full bg-[#050505] p-[1px] leading-none" aria-label={verificationType === 'BLUE' ? 'Blue verified' : 'Gold verified'}>
          <VerificationBadge type={verificationType} size={size === 'xs' || size === 'sm' ? 'xs' : 'sm'} />
        </span>
      )}

      {status !== 'none' && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-[#07070d]',
            statusStyles[status],
            statusSizes[size]
          )}
          aria-label={status}
        />
      )}
    </div>
  );
}