'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Heart } from 'lucide-react';
import type { FundraiserListItem } from '@/types/fundraiser';
import { useFundraiserStats } from './useFundraiserStats';
import VantaVerifiedBadge from './VantaVerifiedBadge';
import { resolveMediaUrl } from '@/lib/mediaUrl';

/**
 * Compact "Active Fundraiser" card shown on a profile when the user has a live
 * campaign. Follows the existing profile card hierarchy without redesigning it.
 */
export default function ActiveFundraiserCard({ fundraiser }: { fundraiser: FundraiserListItem }) {
  const { percentFunded, raisedLabel, daysLeft, deadlineText } = useFundraiserStats(fundraiser);
  const cover = resolveMediaUrl(fundraiser.coverMediaUrl);

  return (
    <Link
      href={`/give/${fundraiser.slug}`}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--vanta-surface)] p-3 transition-all duration-300 hover:border-[var(--gold-border)] hover:bg-[var(--vanta-elevated)]"
    >
      {/* Cover thumb */}
      <div className="relative h-[72px] w-[96px] shrink-0 overflow-hidden rounded-xl bg-[#080808]">
        {cover ? (
          fundraiser.coverMediaType === 'VIDEO' ? (
            <video src={cover} poster={resolveMediaUrl(fundraiser.coverMediaThumbnailUrl) || undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <Image src={cover} alt={fundraiser.title} fill sizes="96px" className="object-cover" />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.05] to-transparent">
            <span className="text-2xl">{fundraiser.category?.emoji || '❤️'}</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">Active Fundraiser</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <p className="line-clamp-1 text-[13px] font-semibold text-white">{fundraiser.title}</p>
          {fundraiser.verified && <VantaVerifiedBadge size="xs" />}
        </div>

        <div className="mt-2 space-y-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(2, percentFunded))}%`, background: percentFunded >= 100 ? 'var(--gradient-gold)' : 'var(--gradient-primary)' }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-white/40">
            <span className="flex items-center gap-1 font-semibold text-white/75">
              <Heart size={10} className="text-[var(--vanta-gold-bright)]" fill="currentColor" />
              {raisedLabel}
            </span>
            <span className="flex items-center gap-1">
              <CalendarDays size={10} />
              {daysLeft > 0 ? `${daysLeft} days left` : deadlineText}
            </span>
          </div>
        </div>
      </div>

      <ArrowUpRight size={16} className="shrink-0 text-white/25 transition group-hover:text-[var(--vanta-gold-bright)]" />
    </Link>
  );
}