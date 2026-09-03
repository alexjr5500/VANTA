'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Users, Calendar, Gift, Radio, ChevronRight, Eye } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface LiveSidebarProps {
  streams?: any[];
  creators?: any[];
}

export default function LiveSidebar({ streams, creators }: LiveSidebarProps) {
  const router = useRouter();
  const hasData = (streams && streams.length > 0) || (creators && creators.length > 0);

  if (!hasData) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
          <Radio size={24} className="text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/30">No live statistics available</p>
          <p className="text-xs text-white/20 mt-1">Data will appear when streams go live</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Suggested Creators */}
      {creators && creators.length > 0 && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-white/50" />
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Suggested Creators</h3>
          </div>
          <div className="space-y-2">
            {creators.slice(0, 4).map((creator: any, i: number) => (
              <motion.div
                key={creator.id || i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-all cursor-pointer group"
              >
                <div className="relative">
                <Avatar src={creator.avatar} alt={creator.fullName || creator.username || 'U'} size="sm" />
                  {creator.isLive && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[#0e0e16]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{creator.fullName || creator.username}</p>
                  <p className="text-[10px] text-gray-500">{creator.followersCount || 0} followers</p>
                </div>
                <button className="shrink-0 px-2.5 py-1 rounded-lg bg-[#f5f5f5] text-black text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  Follow
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Trending Streams */}
      {streams && streams.length > 0 && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-white/50" />
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Active Streams</h3>
          </div>
          <div className="space-y-2">
            {streams.slice(0, 4).map((stream: any, i: number) => (
              <div key={stream.id || i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-all cursor-pointer">
                <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] border border-white/[0.06] flex items-center justify-center">
                  <Radio size={14} className="text-red-400/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{stream.title || 'Untitled Stream'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-500">{stream.category || 'General'}</span>
                    <span className="text-[10px] text-gray-500">·</span>
                    <span className="text-[10px] text-gray-500">{(stream.viewerCount || 0).toLocaleString()} watching</span>
                  </div>
                </div>
                <Eye size={12} className="text-gray-600 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Stats - only from real data */}
      {streams && streams.length > 0 && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Radio size={14} className="text-white/50" />
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Live Statistics</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Live Streams', value: streams.length.toString(), color: 'text-white' },
              { label: 'Total Viewers', value: streams.reduce((a: number, s: any) => a + (s.viewerCount || 0), 0).toLocaleString(), color: 'text-white/80' },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl bg-white/[0.03] p-3">
                <p className="text-[10px] text-gray-500">{stat.label}</p>
                <p className={cn('text-lg font-bold mt-0.5', stat.color)}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}