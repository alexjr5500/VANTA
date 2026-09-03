'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Play, Eye, Gift, Clock, Radio, Check } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';

interface LiveStreamCardProps {
  stream: {
    id: string;
    title: string;
    thumbnailUrl?: string | null;
    viewerCount: number;
    likes?: number;
    gifts?: number;
    categoryName?: string | null;
    category?: { name?: string } | null;
    status?: string;
    active?: boolean;
    startedAt?: string | null;
    endedAt?: string | null;
    duration?: number;
    host: {
      id: string;
      username: string;
      fullName?: string | null;
      avatar?: string | null;
      verified?: boolean;
    };
    _count?: {
      viewers?: number;
      giftEvents?: number;
    };
  };
  ended?: boolean;
  index?: number;
}

export default function LiveStreamCard({ stream, ended = false, index = 0 }: LiveStreamCardProps) {
  const router = useRouter();
  const host = stream.host;
  const category = stream.category?.name || stream.categoryName || 'General';
  const viewerCount = stream.viewerCount ?? stream._count?.viewers ?? 0;
  const giftCount = stream.gifts ?? stream._count?.giftEvents ?? 0;

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const handleClick = () => {
    if (ended) {
      router.push(`/profile/${host.username}`);
    } else {
      router.push(`/live/${stream.id}`);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      onClick={handleClick}
      className="group relative cursor-pointer"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      aria-label={ended ? `View ${host.username}'s profile` : `Watch ${stream.title} live`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0D0D0F] shadow-[0_8px_28px_rgba(0,0,0,.4)] transition group-hover:border-white/[0.16]">
        {stream.thumbnailUrl ? (
          <img
            src={resolveMediaUrl(stream.thumbnailUrl)}
            alt={stream.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0D0D0F]">
            <Radio size={30} className="text-white/10" />
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        {/* Top Badges */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          {!ended && (
            <div className="flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-[9px] font-bold tracking-[.12em] text-white shadow-lg">
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-white"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              LIVE
            </div>
          )}
          {ended && (
            <div className="rounded-md bg-black/75 px-2 py-1 text-[9px] font-semibold tracking-[.1em] text-white/70 backdrop-blur-sm">
              ENDED
            </div>
          )}
          {category && !ended && (
            <div className="rounded-md bg-black/60 px-2 py-1 text-[8px] font-medium text-white/70 backdrop-blur-sm">
              {category}
            </div>
          )}
        </div>


        {/* Bottom Overlay */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          <div className="flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[9px] text-white/85 backdrop-blur-sm">
            <Eye size={10} />
            <span className="tabular-nums">{formatNumber(viewerCount)}</span>
          </div>
          {!ended && stream.startedAt && (
            <div className="flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[9px] text-white/60 backdrop-blur-sm">
              <Clock size={10} />
              {formatDuration(stream.duration)}
            </div>
          )}
          {ended && stream.duration && stream.duration > 0 && (
            <div className="flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[9px] text-white/60 backdrop-blur-sm">
              <Clock size={10} />
              {formatDuration(stream.duration)}
            </div>
          )}
        </div>

        {/* Hover Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <motion.div
            initial={{ scale: 0.8 }}
            whileHover={{ scale: 1.1 }}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/45 shadow-2xl backdrop-blur-md"
          >
            <Play size={16} className="text-white ml-0.5" fill="white" />
          </motion.div>
        </div>
      </div>

      {/* Info */}
      <div className="pt-2.5">
        <p className="truncate text-[13px] font-semibold leading-tight text-[#F5F5F5]">{stream.title}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar src={host.avatar} alt={host.username} size="xs" />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="max-w-[92px] truncate text-[11px] font-medium text-[#C8C8CC]">{host.fullName || host.username}</span>
                {host.verified && <VerificationBadge verified size="xs" />}
              </div>
              <span className="block max-w-[110px] truncate text-[10px] text-[#666]">@{host.username}</span>
            </div>
          </div>
          {giftCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[9px] text-[#666]">
              <Gift size={9} />
              {formatNumber(giftCount)}
            </span>
          )}
        </div>
      </div>

    </motion.article>
  );
}