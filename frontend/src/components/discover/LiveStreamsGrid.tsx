'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Play, Eye, Radio, Monitor, Check, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';

interface LiveStream {
  id: string;
  title: string;
  thumbnail?: string;
  viewerCount: number;
  category: string;
  duration?: string;
  quality?: 'HD' | 'FHD' | '4K';
  creator: {
    name: string;
    username: string;
    avatar?: string;
    verified?: boolean;
  };
}

interface LiveStreamsGridProps {
  streams: LiveStream[];
  loading?: boolean;
}

const defaultStreams: LiveStream[] = [
  { id: '1', title: 'Summer Vibes DJ Set 🎵', viewerCount: 12450, category: 'Music', duration: '2:34:15', quality: 'FHD', creator: { name: 'DJ Electronica', username: '@djelectronica', verified: true } },
  { id: '2', title: 'Building with AI - Live Coding', viewerCount: 8700, category: 'Technology', duration: '1:15:30', quality: 'HD', creator: { name: 'TechHub Live', username: '@techhub', verified: true } },
  { id: '3', title: 'Gaming Tournament Finals', viewerCount: 32200, category: 'Gaming', duration: '3:45:00', quality: '4K', creator: { name: 'ProGamerX', username: '@progamerx' } },
  { id: '4', title: 'Art Stream: Digital Painting', viewerCount: 5600, category: 'Creative', duration: '0:45:22', quality: 'HD', creator: { name: 'ArtisticMaya', username: '@artisticmaya', verified: true } },
  { id: '5', title: 'Morning Yoga Session', viewerCount: 3400, category: 'Lifestyle', duration: '1:00:00', quality: 'HD', creator: { name: 'YogaWithSam', username: '@yogawithsam' } },
  { id: '6', title: 'Music Production Masterclass', viewerCount: 8900, category: 'Education', duration: '2:10:45', quality: 'FHD', creator: { name: 'BeatMaker Pro', username: '@beatmakerpro', verified: true } },
];

export default function LiveStreamsGrid({ streams = defaultStreams, loading }: LiveStreamsGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1   gap-4">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="rounded-2xl overflow-hidden">
            <div className="skeleton aspect-video" />
            <div className="p-3 space-y-2">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1   gap-4">
      {streams.map((stream, i) => (
        <motion.div
          key={stream.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="group relative rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.04] hover:border-[#d6a83f]/20 hover:bg-white/[0.04] transition-all duration-300 cursor-pointer"
        >
          {/* Thumbnail */}
          <div className="relative aspect-video bg-gradient-to-br from-[#1a1a28] to-[#0e0e16] overflow-hidden">
            {stream.thumbnail ? (
              <img src={resolveMediaUrl(stream.thumbnail)} alt={stream.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Radio size={32} className="text-[#d6a83f]/20" />
              </div>
            )}

            {/* Overlay Gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

            {/* Top Badges */}
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/90 text-[10px] font-bold text-white shadow-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE
              </div>
              {stream.quality && (
                <div className="px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm text-[9px] font-bold text-white/80">
                  {stream.quality}
                </div>
              )}
            </div>

            {/* Bottom Info Overlay */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm text-[10px] text-white/80">
                <Eye size={10} />
                {stream.viewerCount >= 1000 ? `${(stream.viewerCount / 1000).toFixed(1)}K` : stream.viewerCount}
              </div>
              {stream.duration && (
                <div className="px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm text-[10px] text-white/60">
                  {stream.duration}
                </div>
              )}
            </div>

            {/* Hover Play Button */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center shadow-2xl">
                <Play size={20} className="text-white ml-0.5" fill="white" />
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="p-3">
            <p className="text-sm font-semibold text-white truncate group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-[#d6a83f] group-hover:to-[#c8c8cc] transition-all">
              {stream.title}
            </p>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <Avatar src={stream.creator.avatar} alt={stream.creator.name} size="xs" />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-white/50 truncate max-w-[100px]">{stream.creator.name}</span>
                  {stream.creator.verified && <VerificationBadge verified size="xs" />}
                </div>
              </div>
              <span className="text-[10px] text-white/30 px-2 py-0.5 rounded-full bg-white/[0.04]">{stream.category}</span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}