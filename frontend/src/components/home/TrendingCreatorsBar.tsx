'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Sparkles, ChevronRight, Plus } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';

interface Creator {
  id: string;
  username: string;
  fullName: string;
  avatar?: string;
  followersCount?: number;
  category?: string;
}

interface TrendingCreatorsBarProps {
  creators: Creator[];
  loading?: boolean;
}

export default function TrendingCreatorsBar({ creators, loading }: TrendingCreatorsBarProps) {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex flex-col items-center gap-2 shrink-0">
            <div className="skeleton w-14 h-14 rounded-full" />
            <div className="skeleton h-3 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (creators.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#d6a83f]" />
          <h3 className="text-xs font-bold text-white/80">Trending Creators</h3>
        </div>
        <button className="text-[10px] text-white/30 hover:text-white/60 transition flex items-center gap-0.5">
          View all <ChevronRight size={10} />
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
        {creators.slice(0, 8).map((creator, i) => (
          <motion.div
            key={creator.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group"
          >
            <div className="relative">
              <Avatar
                src={creator.avatar}
                alt={creator.username}
                size="md"
                status="online"
              />
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Plus size={6} className="text-white" />
              </div>
            </div>
            <span className="text-[10px] text-white/60 truncate max-w-[60px] group-hover:text-white transition-colors">
              {creator.username}
            </span>
            {creator.followersCount && (
              <span className="text-[8px] text-white/30">
                {(creator.followersCount >= 1000 ? `${(creator.followersCount / 1000).toFixed(1)}K` : creator.followersCount)} followers
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

