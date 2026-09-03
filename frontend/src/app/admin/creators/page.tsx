"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Search, Shield, XCircle, DollarSign,
  TrendingUp, Star, Crown, Clock, Eye, MessageCircle, Activity,
  MoreHorizontal, Music, Gamepad2, Palette, Monitor, Camera
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getCreators } from '@/lib/adminApi';
import type { CreatorRecord } from '@/types/admin';
import VerificationBadge from '@/components/ui/VerificationBadge';

export default function CreatorsPage() {
  const [search, setSearch] = useState('');
  const [creators, setCreators] = useState<CreatorRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getCreators(token);
        setCreators(data);
      } catch (err) {
        console.error('Failed to fetch creators:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = creators.filter(c =>
    !search || c.username.toLowerCase().includes(search.toLowerCase()) || c.displayName?.toLowerCase().includes(search.toLowerCase())
  );

  const fmt = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Creators</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Creator Management</h1>
          <p className="text-sm text-gray-400 mt-1">Manage creators, verify accounts, and review monetization requests.</p>
        </div>
      </div>

      {/* Search */}
      <GlassCard>
        <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06] flex-1 min-w-[200px]">
          <Search size={14} className="text-gray-500" />
          <input type="text" placeholder="Search creators..." value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
        </div>
      </GlassCard>

      {/* Creators List */}
      <div className="space-y-2">
        {filtered.map((creator, i) => (
          <motion.div key={creator.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            className="glass rounded-[20px] p-4 border border-white/[0.06] hover:border-white/[0.12] transition-all">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#151517]0 to-[#151517]0 flex items-center justify-center text-white font-bold shrink-0">
                {creator.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{creator.displayName || creator.username}</span>
                  {creator.isVerified && <VerificationBadge verified size="xs" className="inline-block" />}
                  {creator.isMonetized && <DollarSign size={12} className="text-green-400" />}
                </div>
                <p className="text-xs text-gray-500">@{creator.username} • {creator.category}</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center text-xs">
                <div><p className="font-bold text-white">{fmt(creator.followers)}</p><p className="text-gray-500">Followers</p></div>
                <div><p className="font-bold text-white">{fmt(creator.totalViews)}</p><p className="text-gray-500">Views</p></div>
                <div><p className="font-bold text-green-400">${fmt(creator.totalEarnings)}</p><p className="text-gray-500">Earnings</p></div>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-2 rounded-xl hover:bg-[#c8c8cc]/10 text-[#c8c8cc] transition-colors" title="Verify Creator"><Shield size={14} /></button>
                <button className="p-2 rounded-xl hover:bg-white/10 text-gray-400 transition-colors"><MoreHorizontal size={14} /></button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}