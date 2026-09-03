'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Play, Eye, Heart, Gift, Share2, Check, Radio } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { formatNumber } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';

interface LiveFeaturedStreamProps {
  stream?: {
    id: string;
    title: string;
    description?: string | null;
    thumbnailUrl?: string | null;
    viewerCount: number;
    likes?: number;
    gifts?: number;
    categoryName?: string | null;
    category?: { name: string } | null;
    host: {
      id: string;
      username: string;
      fullName?: string | null;
      avatar?: string | null;
      verified?: boolean;
    };
  } | null;
}

export default function LiveFeaturedStream({ stream }: LiveFeaturedStreamProps) {
  const router = useRouter();

  // Don't render if no real stream data
  if (!stream) return null;

  const host = stream.host;
  const category = stream.category?.name || stream.categoryName;

  return (
    <div
      className="relative overflow-hidden rounded-3xl group cursor-pointer"
      onClick={() => router.push(`/live/${stream.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') router.push(`/live/${stream.id}`); }}
      aria-label={`Watch ${stream.title} live`}
    >
      <div className="relative aspect-[21/9] min-h-[350px]   bg-[#0a0a0a]">
        {/* Thumbnail */}
        {stream.thumbnailUrl ? (
          <img
            src={resolveMediaUrl(stream.thumbnailUrl)}
            alt={stream.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#161616] to-[#0a0a0a]">
            <Radio size={48} className="text-white/10" />
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

        {/* Content */}
        <div className="absolute inset-0 flex flex-col justify-between p-6  ">
          {/* Top Bar */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/90 text-[10px] font-bold text-white shadow-lg shadow-red-500/30">
                <motion.span
                  className="w-2 h-2 rounded-full bg-white"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                LIVE
              </div>
              {category && (
                <div className="px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] text-white/60 border border-white/[0.08]">
                  {category}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); }}
                className="p-2.5 rounded-xl bg-black/40 backdrop-blur-sm border border-white/[0.08] text-white/60 hover:text-white transition-all"
                aria-label="Share"
              >
                <Share2 size={15} />
              </button>
            </div>
          </div>

          {/* Bottom Content */}
          <div className="space-y-4">
            {/* Creator Info */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
              <div className="relative">
                <Avatar src={host.avatar} alt={host.fullName || host.username || 'Creator'} size="lg" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-white">{host.fullName || host.username || 'Creator'}</span>
                  {host.verified && <VerificationBadge verified size="sm" />}
                </div>
                <p className="text-sm text-white/50">@{host.username}</p>
              </div>
            </motion.div>

            {/* Title */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <h2 className="text-2xl   font-bold text-white max-w-2xl leading-tight tracking-tight">
                {stream.title}
              </h2>
              {stream.description && (
                <p className="text-sm text-white/50 mt-2 max-w-xl line-clamp-2">{stream.description}</p>
              )}
            </motion.div>

            {/* Stats */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="flex flex-wrap items-center gap-4 "
            >
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/[0.06]">
                <Eye size={14} className="text-red-400" />
                <span className="text-sm font-bold text-white tabular-nums">
                  {formatNumber(stream.viewerCount)}
                </span>
                <span className="text-[10px] text-white/40">watching</span>
              </div>
              {stream.likes !== undefined && stream.likes > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-white/50">
                  <Heart size={16} />
                  <span>{formatNumber(stream.likes)}</span>
                </div>
              )}
              {stream.gifts !== undefined && stream.gifts > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-white/50">
                  <Gift size={16} />
                  <span>{formatNumber(stream.gifts)}</span>
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); router.push(`/live/${stream.id}`); }}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#f5f5f5] text-black text-sm font-bold shadow-[0_4px_20px_rgba(255,255,255,0.1)] hover:bg-white transition-all"
              >
                <Play size={16} fill="currentColor" />
                Join Live
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}