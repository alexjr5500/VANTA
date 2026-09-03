'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Crown, Flame, Sparkles, Star, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DiscoverSidebarProps {
  trendingTopics?: { tag: string; posts: number; trend: 'up' | 'hot' | 'featured' }[];
  suggestedCreators?: { name: string; username: string; avatar?: string; followers: number; isLive?: boolean }[];
}

export default function DiscoverSidebar({
  trendingTopics,
  suggestedCreators,
}: DiscoverSidebarProps) {
  const hasAnyData = (trendingTopics && trendingTopics.length > 0) || 
                     (suggestedCreators && suggestedCreators.length > 0);

  if (!hasAnyData) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
          <Sparkles size={24} className="text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/30">Discover insights will appear here</p>
          <p className="text-xs text-white/20 mt-1">Trending topics and creator suggestions coming soon</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Trending Topics */}
      {trendingTopics && trendingTopics.length > 0 && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-emerald-400" />
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Trending</h3>
          </div>
          <div className="space-y-2">
            {trendingTopics.map((topic, i) => (
              <motion.button
                key={topic.tag}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-white/[0.03] transition-all group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    'text-xs font-semibold',
                    topic.trend === 'hot' && 'text-red-400',
                    topic.trend === 'up' && 'text-emerald-400',
                    topic.trend === 'featured' && 'text-amber-400',
                  )}>
                    {topic.trend === 'hot' && '<Flame size={16} className="inline-block" />'}
                    {topic.trend === 'up' && '↑'}
                    {topic.trend === 'featured' && '<Star size={16} className="inline-block" />'}
                  </span>
                  <span className="text-sm text-white/70 group-hover:text-white truncate">{topic.tag}</span>
                </div>
                <span className="text-[10px] text-gray-500 shrink-0 ml-2">{topic.posts.toLocaleString()}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Creators */}
      {suggestedCreators && suggestedCreators.length > 0 && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-[#d6a83f]" />
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Suggested Creators</h3>
          </div>
          <div className="space-y-2">
            {suggestedCreators.map((creator, i) => (
              <motion.div
                key={creator.username}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-all cursor-pointer group"
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#d6a83f]/20 to-[#c8c8cc]/20 flex items-center justify-center text-xs font-bold text-white/60">
                    {creator.name.charAt(0)}
                  </div>
                  {creator.isLive && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[#0a0a0f]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{creator.name}</p>
                  <p className="text-[10px] text-gray-500">{creator.followers >= 1000000 ? `${(creator.followers / 1000000).toFixed(1)}M` : `${(creator.followers / 1000).toFixed(1)}K`} followers</p>
                </div>
                <button className="shrink-0 px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  Follow
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}