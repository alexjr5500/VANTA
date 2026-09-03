'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, Camera, Crown, Eye, Flame, Gamepad2, Globe, Hash, Heart, Monitor, Music, Palette, Play, Radio, Search, Sparkles, Star, TrendingUp, Trophy, Users, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { openAppMenu } from '@/lib/openAppMenu';

const categories = [
  { name: 'Gaming', icon: '🎮', color: 'from-[#151517]0/20 to-[#8a8a8a]/20', count: 0, viewers: '', trending: true },
  { name: 'Music', icon: '🎵', color: 'from-[#d6a83f]/20 to-[#d6a83f]/20', count: 0, viewers: '', trending: true },
  { name: 'Education', icon: '📚', color: 'from-[#151517]0/20 to-[#151517]0/20', count: 0, viewers: '' },
  { name: 'Entertainment', icon: '🎬', color: 'from-amber-500/20 to-orange-500/20', count: 0, viewers: '', trending: true },
  { name: 'Sports', icon: '⚽', color: 'from-emerald-500/20 to-teal-500/20', count: 38, viewers: '4.1K' },
  { name: 'Technology', icon: '💻', color: 'from-[#8a8a8a]/20 to-[#151517]0/20', count: 0, viewers: '', trending: true },
  { name: 'Art & Creative', icon: '🎨', color: 'from-orange-500/20 to-yellow-500/20', count: 0, viewers: '' },
  { name: 'Lifestyle', icon: '🌟', color: 'from-[#d6a83f]/20 to-[#151517]0/20', count: 0, viewers: '' },
  { name: 'News & Politics', icon: '📰', color: 'from-red-500/20 to-[#d6a83f]/20', count: 0, viewers: '' },
  { name: 'Science', icon: '🔬', color: 'from-[#151517]0/20 to-[#151517]0/20', count: 0, viewers: '' },
  { name: 'Travel', icon: '✈️', color: 'from-emerald-500/20 to-green-500/20', count: 0, viewers: '' },
  { name: 'Food & Drink', icon: '🍳', color: 'from-orange-500/20 to-amber-500/20', count: 0, viewers: '' },
];

const trending = [
  { tag: '#SummerVibes', posts: '', trend: '🔥' },
  { tag: '#MusicFestival', posts: '', trend: '↑' },
  { tag: '#Gaming', posts: '', trend: '🔥' },
  { tag: '#AIArt', posts: '', trend: '⭐' },
  { tag: '#LiveMusic', posts: '', trend: '↑' },
  { tag: '#TechTalk', posts: '', trend: '🔥' },
];

export default function ExplorePage() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto min-w-0 w-full space-y-8 overflow-x-hidden pb-24 "
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <PageHeader title="Explore" onMenu={openAppMenu} />
      </motion.div>

        {/* Premium Search */}
        <div className="relative group">
          <div className="relative flex items-center rounded-3xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl transition-all duration-300 focus-within:border-[#d6a83f]/30 focus-within:bg-white/[0.06] focus-within:shadow-lg focus-within:shadow-[#d6a83f]/10">
            <Search size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors duration-300 group-focus-within:text-[#d6a83f]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search creators, streams, communities, hashtags..."
              className="w-full bg-transparent pl-12 pr-4 py-4 text-sm text-white placeholder-gray-600 outline-none rounded-3xl"
              aria-label="Search explore"
            />
          </div>
        </div>

      {/* Trending Now */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-emerald-400" />
          <h2 className="text-lg font-bold text-white">Trending Now</h2>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide gap-3 pb-2">
          {trending.map((item, i) => (
            <motion.button
              key={item.tag}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all"
            >
              <span className="text-sm">{item.trend}</span>
              <div className="text-left">
                <p className="text-sm font-semibold text-white">{item.tag}</p>
                <p className="text-[10px] text-gray-500">{item.posts} posts</p>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.section>

      {/* Featured Creators */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Star size={16} className="text-amber-400" />
            <h2 className="text-lg font-bold text-white">Featured Creators</h2>
          </div>
          <button className="text-xs text-white/30 hover:text-white transition-colors">View All</button>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide gap-4 pb-2">
          {[
            { name: 'DJ Electronica', handle: '@djelectronica', category: 'Music', viewers: '', live: true, banner: 'from-[#d6a83f]/20 via-[#c8c8cc]/20 to-[#c8c8cc]/10' },
            { name: 'TechHub Live', handle: '@techhub', category: 'Tech', viewers: '', live: true, banner: 'from-[#c8c8cc]/20 via-[#c8c8cc]/20 to-[#c8c8cc]/10' },
            { name: 'ProGamerX', handle: '@progamerx', category: 'Gaming', viewers: '', live: true, banner: 'from-[#c8c8cc]/20 via-[#d6a83f]/20 to-[#f2c75c]/10' },
            { name: 'ArtisticMaya', handle: '@artisticmaya', category: 'Art', viewers: '', banner: 'from-emerald-500/20 via-[#c8c8cc]/20 to-[#c8c8cc]/10' },
          ].map((creator, i) => (
            <motion.div
              key={creator.handle}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="shrink-0 w-52 rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden hover:bg-white/[0.04] hover:border-[#d6a83f]/20 transition-all duration-300 group cursor-pointer"
            >
              <div className={cn('h-16 bg-gradient-to-br', creator.banner)} />
              <div className="relative px-4 -mt-8">
                <div className="w-14 h-14 rounded-full border-2 border-[#0a0a0f] overflow-hidden bg-gradient-to-br from-[#d6a83f]/20 to-[#c8c8cc]/20 flex items-center justify-center">
                  <span className="text-lg font-bold text-white/60">{creator.name.charAt(0)}</span>
                </div>
                {creator.live && (
                  <span className="absolute top-0 right-4 w-3 h-3 rounded-full bg-red-500 border-2 border-[#0a0a0f] animate-pulse" />
                )}
              </div>
              <div className="p-4 pt-2">
                <p className="text-sm font-semibold text-white truncate">{creator.name}</p>
                <p className="text-[10px] text-gray-500">{creator.handle}</p>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <Eye size={10} />
                    {creator.viewers} watching
                  </div>
                  <span className="text-[10px] text-white/30 px-2 py-0.5 rounded-full bg-white/[0.04]">{creator.category}</span>
                </div>
                <button className="w-full mt-3 py-2 rounded-xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  Follow
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Browse Categories */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Hash size={16} className="text-[#c8c8cc]" />
            <h2 className="text-lg font-bold text-white">Browse Categories</h2>
          </div>
          <span className="text-xs text-white/20">{categories.reduce((a, c) => a + c.count, 0)} total streams</span>
        </div>
        <div className="grid grid-cols-2    gap-3">
          {categories.map((cat, i) => (
            <motion.div
              key={cat.name}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.02 }}
            >
              <Link
                href={`/explore/${cat.name.toLowerCase().replace(/\s+/g, '-')}`}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl bg-gradient-to-br border border-white/[0.06] p-4 hover:border-white/[0.12] transition-all duration-200 group',
                  cat.color
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{cat.icon}</span>
                  {cat.trending && (
                    <motion.span
                      className="text-[10px]"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Flame size={16} className="inline-block" />
                    </motion.span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{cat.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-white/40">{cat.count} live</span>
                    {cat.viewers && (
                      <>
                        <span className="text-[10px] text-white/20">·</span>
                        <span className="text-[10px] text-white/40">{cat.viewers} watching</span>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Popular Communities */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[#c8c8cc]" />
            <h2 className="text-lg font-bold text-white">Popular Communities</h2>
          </div>
          <button className="text-xs text-white/30 hover:text-white transition-colors">View All</button>
        </div>
        <div className="grid grid-cols-1   gap-3">
          {[
            { name: 'Music Lovers', members: '', online: '', icon: '🎵', gradient: 'from-[#d6a83f]/10 to-[#d6a83f]/10' },
            { name: 'Tech Innovators', members: '', online: '', icon: '💻', gradient: 'from-[#151517]0/10 to-[#151517]0/10' },
            { name: 'Gaming Hub', members: '', online: '', icon: '🎮', gradient: 'from-[#151517]0/10 to-[#8a8a8a]/10' },
          ].map((community, i) => (
            <motion.div
              key={community.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                'flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br border border-white/[0.06] cursor-pointer hover:border-white/[0.12] transition-all group',
                community.gradient
              )}
            >
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center text-2xl">
                {community.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{community.name}</p>
                <p className="text-[10px] text-white/40">{community.members} members · {community.online} online</p>
              </div>
              <ArrowRight size={14} className="text-white/20 group-hover:text-white/60 transition-colors shrink-0" />
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Platform Stats */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-3xl bg-gradient-to-br from-[#d6a83f]/5 via-[#c8c8cc]/5 to-[#c8c8cc]/5 border border-[#d6a83f]/10 p-6"
      >
        <div className="grid grid-cols-2  gap-6 text-center">
          {[
            { icon: Radio, label: 'Live Streams', value: '', color: 'text-red-400' },
            { icon: Users, label: 'Active Creators', value: '', color: 'text-[#d6a83f]' },
            { icon: Eye, label: 'Total Views', value: '', color: 'text-[#c8c8cc]' },
            { icon: Zap, label: 'Avg. Watch Time', value: '', color: 'text-[#c8c8cc]' },
          ].map((stat, i) => (
            <div key={stat.label}>
              <stat.icon size={20} className={cn('mx-auto mb-2', stat.color)} />
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-[10px] text-white/40">{stat.label}</p>
            </div>
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
}