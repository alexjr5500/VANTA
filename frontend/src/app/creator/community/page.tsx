"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Users, UserCheck, Heart, Eye, MessageCircle, Hash, AlertCircle, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

// ============================================================================
// CREATOR AUDIENCE — real follower/engagement data from /api/creator/stats.
// ============================================================================

interface CreatorStats {
  username: string;
  totalFollowers: number;
  totalFollowing: number;
  totalPosts: number;
  totalReels: number;
  totalLiveSessions: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  giftsReceived: number;
}

function StatTile({ icon: Icon, label, value, accent = 'text-white/60' }: { icon: any; label: string; value: string; accent?: string }) {
  return (
    <div className="card-premium min-w-0 p-4">
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.05]">
        <Icon size={15} className={accent} />
      </div>
      <p className="truncate text-xl font-bold text-white">{value}</p>
      <p className="mt-1 truncate text-[11px] text-white/40">{label}</p>
    </div>
  );
}

export default function CommunityPage() {
  const { token, user } = useAuth();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ stats: CreatorStats }>('/api/creator/stats', token);
      setStats(res?.stats ?? null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load audience data.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load audience</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const s = stats || ({} as CreatorStats);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* Audience overview */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-[var(--active)]" />
            <h2 className="text-sm font-bold text-white">Audience</h2>
          </div>
          <Link href={`/profile/${s.username || user?.username || ''}`} className="inline-flex items-center gap-1 text-[11px] text-[var(--active-bright)]">
            View profile <ArrowUpRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={UserCheck} label="Followers" value={Number(s.totalFollowers || 0).toLocaleString()} accent="text-emerald-300" />
          <StatTile icon={Users} label="Following" value={Number(s.totalFollowing || 0).toLocaleString()} accent="text-white/60" />
          <StatTile icon={Eye} label="Total views" value={Number(s.totalViews || 0).toLocaleString()} accent="text-white/60" />
          <StatTile icon={Heart} label="Likes" value={Number(s.totalLikes || 0).toLocaleString()} accent="text-rose-300" />
        </div>
      </section>

      {/* Engagement */}
      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">Engagement</h3>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile icon={MessageCircle} label="Comments" value={Number(s.totalComments || 0).toLocaleString()} accent="text-sky-300" />
          <StatTile icon={UserCheck} label="Posts" value={Number(s.totalPosts || 0).toLocaleString()} accent="text-white/60" />
          <StatTile icon={Hash} label="Live sessions" value={Number(s.totalLiveSessions || 0).toLocaleString()} accent="text-red-300" />
          <StatTile icon={ArrowUpRight} label="Gifts received" value={Number(s.giftsReceived || 0).toLocaleString()} accent="text-[#d9a83f]" />
        </div>
      </section>

      {/* Communities */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-1 flex items-center gap-2">
          <Hash size={15} className="text-white/40" />
          <h3 className="text-sm font-bold text-white">Communities</h3>
        </div>
        <p className="mb-4 text-[11px] text-white/40">Join and participate in VANTA communities from the Communities area.</p>
        <Link href="/communities" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--active)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90">
          Open Communities <ArrowUpRight size={13} />
        </Link>
      </section>
    </motion.div>
  );
}