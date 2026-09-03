'use client';

import Image from 'next/image';
import { CalendarDays, Heart, Share2, Users } from 'lucide-react';
import type { Fundraiser } from '@/types/fundraiser';
import { useFundraiserStats } from './useFundraiserStats';
import VantaVerifiedBadge from './VantaVerifiedBadge';
import Button from '@/components/ui/Button';
import { resolveMediaUrl } from '@/lib/mediaUrl';

interface FundraiserHeroProps {
  fundraiser: Fundraiser;
  onDonate: () => void;
  onShare: () => void;
  /** If true the Donate CTA is hidden (deadline passed / own campaign). */
  disabled?: boolean;
  disabledLabel?: string;
}

export default function FundraiserHero({ fundraiser, onDonate, onShare, disabled, disabledLabel }: FundraiserHeroProps) {
  const { percentFunded, raisedLabel, targetLabel, daysLeft, supportersLabel, deadlineText } = useFundraiserStats(fundraiser);
  const cover = resolveMediaUrl(fundraiser.coverMediaUrl);
  const isVideo = fundraiser.coverMediaType === 'VIDEO';

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
      {/* Media */}
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080808] lg:aspect-[16/11]">
        {cover ? (
          isVideo ? (
            <video
              src={cover}
              poster={resolveMediaUrl(fundraiser.coverMediaThumbnailUrl) || undefined}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <Image src={cover} alt={fundraiser.title} fill priority sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.05] to-transparent">
            <span className="text-6xl">{fundraiser.category?.emoji || '❤️'}</span>
          </div>
        )}
        {fundraiser.isFeatured && (
          <span className="absolute left-4 top-4 inline-flex items-center rounded-full border border-[var(--gold-border)] bg-black/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--vanta-gold-bright)] backdrop-blur-md">
            Featured
          </span>
        )}
      </div>

      {/* Campaign stats */}
      <div className="flex flex-col justify-center gap-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/55">
            {fundraiser.category?.emoji && <span className="mr-1">{fundraiser.category.emoji}</span>}
            {fundraiser.category?.name || 'Fundraiser'}
          </span>
          {fundraiser.verified && <VantaVerifiedBadge variant="pill" size="sm" />}
        </div>

        <h1 className="text-h1 text-white">{fundraiser.title}</h1>
        {fundraiser.summary && <p className="text-secondary text-white/55">{fundraiser.summary}</p>}

        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-stat text-white">{raisedLabel}</span>
            <span className="text-secondary text-white/40">raised of {targetLabel}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, Math.max(2, percentFunded))}%`,
                background: percentFunded >= 100 ? 'var(--gradient-gold)' : 'var(--gradient-primary)',
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold tabular-nums text-[var(--vanta-gold-bright)]">{Math.round(percentFunded)}% funded</span>
            <div className="flex items-center gap-4 text-xs text-white/45">
              <span className="inline-flex items-center gap-1.5">
                <Users size={13} />
                {supportersLabel} {fundraiser.supporterCount === 1 ? 'supporter' : 'supporters'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={13} />
                {daysLeft > 0 ? `${daysLeft} days remaining` : deadlineText}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button variant="gold" size="lg" fullWidth={false} onClick={onDonate} disabled={disabled} className="flex-1 sm:flex-none">
            <Heart size={16} fill="currentColor" />
            Donate
          </Button>
          <Button variant="secondary" size="lg" onClick={onShare}>
            <Share2 size={16} />
            Share
          </Button>
        </div>
        {disabled && disabledLabel && <p className="text-xs text-white/40">{disabledLabel}</p>}
      </div>
    </section>
  );
}