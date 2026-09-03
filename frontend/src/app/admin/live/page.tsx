"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Radio, Users, Eye, AlertTriangle, DollarSign, MessageCircle,
  Clock, Activity, Shield, XCircle, Ban, AlertCircle, Star,
  Search, TrendingUp, ArrowUp, ArrowDown, MoreHorizontal, Video
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getLiveStreams } from '@/lib/adminApi';
import type { LiveStreamMonitor } from '@/types/admin';

const healthConfig: Record<string, { color: string; label: string }> = {
  good: { color: 'bg-green-500/15 text-green-400', label: 'Good' },
  fair: { color: 'bg-yellow-500/15 text-yellow-400', label: 'Fair' },
  poor: { color: 'bg-red-500/15 text-red-400', label: 'Poor' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  live: { color: 'bg-red-500/20 text-red-300', label: 'LIVE' },
  ended: { color: 'bg-gray-500/20 text-gray-400', label: 'Ended' },
  suspended: { color: 'bg-yellow-500/20 text-yellow-300', label: 'Suspended' },
};

export default function LivePage() {
  const [search, setSearch] = useState('');
  const [selectedStream, setSelectedStream] = useState<LiveStreamMonitor | null>(null);
  const [streams, setStreams] = useState<LiveStreamMonitor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getLiveStreams(token);
        setStreams(data);
      } catch (err) {
        console.error('Failed to fetch live streams:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    return streams.filter(s =>
      !search || s.title.toLowerCase().includes(search.toLowerCase()) || s.creatorName.toLowerCase().includes(search.toLowerCase())
    );
  }, [search, streams]);

  const totalViewers = streams.reduce((s, st) => s + st.currentViewers, 0);
  const totalGifts = streams.reduce((s, st) => s + st.gifts, 0);
  const totalGiftRevenue = streams.reduce((s, st) => s + st.giftRevenue, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Radio size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Live</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Live Stream Management</h1>
          <p className="text-sm text-gray-400 mt-1">Monitor and manage all active live streams.</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2  gap-3">
        {[
          { label: 'Active Streams', value: String(streams.filter(s => s.status === 'live').length), icon: Radio, color: 'from-red-500 to-[#b78929]' },
          { label: 'Total Viewers', value: totalViewers.toLocaleString(), icon: Eye, color: 'from-[#151517]0 to-[#68686c]' },
          { label: 'Gifts Received', value: String(totalGifts), icon: DollarSign, color: 'from-yellow-500 to-amber-600' },
          { label: 'Gift Revenue', value: `$${totalGiftRevenue.toFixed(2)}`, icon: TrendingUp, color: 'from-green-500 to-emerald-600' },
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
      <GlassCard>
        <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06]">
          <Search size={14} className="text-gray-500" />
          <input type="text" placeholder="Search streams..." value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
        </div>
      </GlassCard>

      {/* Streams */}
      <div className="space-y-3">
        {filtered.map((stream, i) => (
          <motion.div key={stream.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-[20px] p-5 border border-white/[0.06] hover:border-white/[0.12] transition-all">
            <div className="flex flex-col   gap-4">
              {/* Stream Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusConfig[stream.status]?.color || ''}`}>
                    {statusConfig[stream.status]?.label || stream.status}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${healthConfig[stream.health]?.color || ''}`}>
                    {healthConfig[stream.health]?.label || stream.health}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white truncate">{stream.title}</h3>
                <p className="text-xs text-gray-400 mt-0.5">by {stream.creatorName} • {stream.category}</p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3  gap-3 text-center">
                <div>
                  <div className="flex items-center gap-1 justify-center text-green-400"><Eye size={12} /><span className="text-sm font-bold">{stream.currentViewers.toLocaleString()}</span></div>
                  <p className="text-[10px] text-gray-500">Viewers</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 justify-center text-[#c8c8cc]"><Users size={12} /><span className="text-sm font-bold">{stream.peakViewers.toLocaleString()}</span></div>
                  <p className="text-[10px] text-gray-500">Peak</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 justify-center text-yellow-400"><MessageCircle size={12} /><span className="text-sm font-bold">{stream.chatActivity.toLocaleString()}</span></div>
                  <p className="text-[10px] text-gray-500">Chat</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 justify-center text-[#d6a83f]"><DollarSign size={12} /><span className="text-sm font-bold">${stream.giftRevenue.toFixed(0)}</span></div>
                  <p className="text-[10px] text-gray-500">Gifts</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 justify-center text-gray-400"><Clock size={12} /><span className="text-sm font-bold">{stream.duration}</span></div>
                  <p className="text-[10px] text-gray-500">Duration</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button className="p-2 rounded-xl hover:bg-red-500/10 text-red-400 transition-colors" title="End Stream"><XCircle size={14} /></button>
                <button className="p-2 rounded-xl hover:bg-yellow-500/10 text-yellow-400 transition-colors" title="Suspend Stream"><Ban size={14} /></button>
                <button className="p-2 rounded-xl hover:bg-orange-500/10 text-orange-400 transition-colors" title="Warn Creator"><AlertCircle size={14} /></button>
                <button className="p-2 rounded-xl hover:bg-[#c8c8cc]/10 text-[#c8c8cc] transition-colors" title="Highlight Stream"><Star size={14} /></button>
                <button onClick={() => setSelectedStream(selectedStream?.id === stream.id ? null : stream)}
                  className="p-2 rounded-xl hover:bg-white/10 text-gray-400 transition-colors">
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>

            {/* Expanded Details */}
            {selectedStream?.id === stream.id && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 pt-4 border-t border-white/[0.06]">
                <div className="grid grid-cols-2  gap-4 text-sm">
                  <div><p className="text-[10px] text-gray-500 uppercase">Quality</p><p className="text-white mt-1">{stream.streamQuality} • {stream.bitrate}kbps • {stream.fps}fps</p></div>
                  <div><p className="text-[10px] text-gray-500 uppercase">Started</p><p className="text-white mt-1">{new Date(stream.startedAt).toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-gray-500 uppercase">Reports</p><p className="text-red-400 mt-1">{stream.reports}</p></div>
                  <div><p className="text-[10px] text-gray-500 uppercase">Moderators</p><p className="text-white mt-1">{stream.moderators.length}</p></div>
                </div>
                {stream.tags.length > 0 && (
                  <div className="flex gap-1 mt-3">
                    {stream.tags.map(tag => <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300">#{tag}</span>)}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}