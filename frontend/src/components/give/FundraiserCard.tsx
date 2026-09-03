'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays, Heart, MapPin } from 'lucide-react';
import type { FundraiserListItem } from '@/types/fundraiser';
import { cn } from '@/lib/utils';
import VantaVerifiedBadge from './VantaVerifiedBadge';
import { useFundraiserStats } from './useFundraiserStats';
import { resolveMediaUrl } from '@/lib/mediaUrl';

interface FundraiserCardProps {
  fundraiser: FundraiserListItem;
  className?: string;
  /** Compact mode for profile embeds — smaller cover and tighter metrics. */
  compact?: boolean;
}

export default function FundraiserCard({ fundraiser, className, compact = false }: FundraiserCardProps) {
  const { percentFunded, raisedLabel, targetLabel, daysLeft, deadlineText } = useFundraiserStats(fundraiser);
  const cover = resolveMediaUrl(fundraiser.coverMediaUrl);
  const isVideo = fundraiser.coverMediaType === 'VIDEO';

  return (
    <Link
      href={`/give/${fundraiser.slug}`}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] transition-all duration-300',
        'hover:border-white/[0.14] hover:bg-[var(--vanta-elevated)] hover:shadow-[0_16px_48px_rgba(0,0,0,0.4)]',
        className
      )}
    >
      {/* Cover */}
      <div className={cn('relative w-full overflow-hidden bg-[#080808]', compact ? 'aspect-[16/9]' : 'aspect-[4/3]')}>
        {cover ? (
          isVideo ? (
            <video
              src={cover}
              poster={resolveMediaUrl(fundraiser.coverMediaThumbnailUrl) || undefined}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <Image
              src={cover}
              alt={fundraiser.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.04] to-transparent">
            <span className="text-4xl">{fundraiser.category?.emoji || '❤️'}</span>
          </div>
        )}
        {/* Category chip */}
        {fundraiser.category && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/[0.1] bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-md">
            {fundraiser.category.emoji && <span className="text-[11px]">{fundraiser.category.emoji}</span>}
            {fundraiser.category.name}
          </span>
        )}
        {fundraiser.isFeatured && !compact && (
          <span className="absolute right-3 top-3 inline-flex items-center rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--vanta-gold-bright)]">
            Featured
          </span>
        )}
      </div>

      {/* Body */}
      <div className={cn('flex flex-1 flex-col gap-3', compact ? 'p-3.5' : 'p-4')}>
        <div className="flex items-start justify-between gap-2">
          <h3 className={cn('line-clamp-2 font-semibold leading-snug text-white', compact ? 'text-[13px]' : 'text-[15px]')}>
            {fundraiser.title}
          </h3>
        </div>

        {!compact && fundraiser.summary && (
          <p className="line-clamp-2 text-xs leading-relaxed text-white/45">{fundraiser.summary}</p>
        )}

        {/* Progress */}
        <div className="mt-auto space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(2, percentFunded))}%`,
                background: percentFunded >= 100 ? 'var(--gradient-gold)' : 'var(--gradient-primary)',
              }}
            />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className={cn('font-bold tabular-nums text-white', compact ? 'text-sm' : 'text-base')}>{raisedLabel}</p>
              <p className="text-[10px] text-white/40">raised of {targetLabel}</p>
            </div>
            <div className="text-right">
              <p className={cn('font-semibold tabular-nums text-[var(--vanta-gold-bright)]', compact ? 'text-xs' : 'text-sm')}>
                {Math.round(percentFunded)}%
              </p>
              <p className="text-[10px] text-white/40">funded</p>
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.05] pt-2.5">
          {fundraiser.verified ? (
            <VantaVerifiedBadge variant="pill" size="xs" />
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-white/35">
              <Heart size={11} className="text-white/25" />
              {fundraiser.supporterCount} {fundraiser.supporterCount === 1 ? 'supporter' : 'supporters'}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] text-white/35">
            <CalendarDays size={11} />
            {daysLeft > 0 ? `${daysLeft} days left` : deadlineText}
          </span>
          {fundraiser.location && (
            <span className="inline-flex items-center gap-1 text-[10px] text-white/35">
              <MapPin size={11} />
              {fundraiser.location}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}