'use client';

import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import LiveBadge from './LiveBadge';
import UserAvatar from './UserAvatar';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { cn, formatNumber } from '@/lib/utils';

interface StreamCardProps {
  stream: {
    id: string;
    title: string;
    streamer: string;
    avatar: string;
    thumbnail: string;
    viewers: number;
    category: string;
    tags?: string[];
    isFeatured?: boolean;
  };
  variant?: 'default' | 'featured' | 'compact';
  className?: string;
  onClick?: () => void;
}

export default function StreamCard({ stream, variant = 'default', className, onClick }: StreamCardProps) {
  if (variant === 'featured') {
    return (
      <motion.div className={cn('relative overflow-hidden rounded-3xl cursor-pointer group', className)} onClick={onClick} whileHover={{ scale: 1.01 }} transition={{ duration: 0.3 }}>
        <div className="relative h-[280px]  ">
          <img src={resolveMediaUrl(stream.thumbnail)} alt={stream.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <LiveBadge viewers={stream.viewers} size="md" />
            <span className="rounded-full bg-white/10 backdrop-blur-md px-3 py-1 text-xs text-white">{stream.category}</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="flex items-center gap-4">
              <UserAvatar src={stream.avatar} alt={stream.streamer} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-bold text-white truncate">{stream.title}</h3>
                <p className="text-sm text-gray-300 mt-1">{stream.streamer}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Users size={14} className="text-gray-400" />
                  <span className="text-xs text-gray-400">{formatNumber(stream.viewers)} watching</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (variant === 'compact') {
    return (
      <motion.div className={cn('flex items-center gap-3 rounded-2xl p-3 cursor-pointer hover:bg-white/[0.03] transition-colors', className)} onClick={onClick} whileHover={{ x: 4 }}>
        <div className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden">
          <img src={resolveMediaUrl(stream.thumbnail)} alt={stream.title} className="h-full w-full object-cover" />
          <div className="absolute bottom-1 left-1">
            <span className="text-[8px] font-bold text-white bg-gradient-to-r from-[#d6a83f] to-[#f2c75c] px-1 py-0.5 rounded">{formatNumber(stream.viewers)}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{stream.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{stream.streamer}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{stream.category}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className={cn('group rounded-2xl overflow-hidden border border-white/[0.06] bg-black/40 backdrop-blur-xl cursor-pointer', className)} onClick={onClick} whileHover={{ y: -4 }} transition={{ duration: 0.3 }}>
      <div className="relative aspect-video overflow-hidden">
        <img src={resolveMediaUrl(stream.thumbnail)} alt={stream.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <LiveBadge viewers={stream.viewers} />
          <span className="rounded-full bg-white/10 backdrop-blur-md px-2 py-0.5 text-[10px] text-white">{stream.category}</span>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <UserAvatar src={stream.avatar} alt={stream.streamer} size="sm" status="online" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-white truncate">{stream.title}</h4>
            <p className="text-xs text-gray-400 mt-0.5">{stream.streamer}</p>
          </div>
        </div>
        {stream.tags && stream.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {stream.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-400">#{tag}</span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}