"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Building2, Search, Users, MessageSquare, Archive, Trash2,
  RotateCcw, Shield, Star, Crown, Globe, Lock, Sparkles,
  MoreHorizontal, Eye, EyeOff
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { getCommunities } from '@/lib/adminApi';
import type { CommunityRecord } from '@/types/admin';

export default function CommunitiesPage() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [communities, setCommunities] = useState<CommunityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getCommunities(token);
        setCommunities(data);
      } catch (err) {
        console.error('Failed to fetch communities:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return communities;
    return communities.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.description?.toLowerCase().includes(search.toLowerCase()));
  }, [search, communities]);

  const totalMembers = communities.reduce((s, c) => s + c.memberCount, 0);
  const totalPosts = communities.reduce((s, c) => s + c.postCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Communities</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Community Management</h1>
          <p className="text-sm text-gray-400 mt-1">Manage, moderate, and feature communities.</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2  gap-3">
        {[
          { label: 'Total Communities', value: String(communities.length), icon: Building2, color: 'from-[#d6a83f] to-[#b78929]' },
          { label: 'Total Members', value: totalMembers.toLocaleString(), icon: Users, color: 'from-[#151517]0 to-[#68686c]' },
          { label: 'Total Posts', value: totalPosts.toLocaleString(), icon: MessageSquare, color: 'from-green-500 to-emerald-600' },
          { label: 'Featured', value: String(communities.filter(c => c.isFeatured).length), icon: Star, color: 'from-yellow-500 to-amber-600' },
        ].map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-[20px] p-4 border border-white/[0.06]">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br ${card.color} mb-2`}>
              <card.icon size={16} className="text-white" />
            </div>
            <p className="text-xl font-bold text-white">{card.value}</p>
            <p className="text-xs text-gray-400">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Search */}
      <div className="glass rounded-[var(--radius-2xl)] p-5">
        <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06]">
          <Search size={14} className="text-gray-500" />
          <input type="text" placeholder="Search communities..." value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
        </div>
      </div>

      {/* Communities List */}
      <div className="grid grid-cols-1   gap-3">
        {filtered.map((comm, i) => (
          <motion.div key={comm.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            className="glass rounded-[20px] p-5 border border-white/[0.06] hover:border-white/[0.12] transition-all group">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#151517]0 to-[#151517]0 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {comm.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-white truncate">{comm.name}</h3>
                  {comm.isFeatured && <Star size={10} className="text-yellow-400 fill-yellow-400" />}
                </div>
                <p className="text-xs text-gray-400 truncate mt-0.5">{comm.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
              <span className="flex items-center gap-1"><Users size={12} />{comm.memberCount.toLocaleString()}</span>
              <span className="flex items-center gap-1"><MessageSquare size={12} />{comm.postCount.toLocaleString()}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${comm.type === 'public' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{comm.type}</span>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="flex-1 p-2 rounded-xl text-xs bg-white/5 text-gray-400 hover:bg-white/10 transition-colors">View</button>
              <button className="p-2 rounded-xl text-xs bg-white/5 text-yellow-400 hover:bg-yellow-500/10 transition-colors" title="Feature"><Star size={12} /></button>
              <button className="p-2 rounded-xl text-xs bg-white/5 text-red-400 hover:bg-red-500/10 transition-colors" title="Archive"><Archive size={12} /></button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}