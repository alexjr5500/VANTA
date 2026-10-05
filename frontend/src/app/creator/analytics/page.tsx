"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { TrendingUp, Eye, Heart, MessageCircle, Share2, Bookmark, Users, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

// ============================================================================
// CREATOR ANALYTICS — real aggregated metrics from /api/creator/stats
// ============================================================================

interface CreatorStats {
  username: string;
  fullName: string | null;
  avatar: string | null;
  verified: boolean;
  role: string;
  totalFollowers: number;
  totalFollowing: number;
  totalPosts: number;
  totalReels: number;
  totalLiveSessions: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  giftsReceived: number;
  coins: number;
  earnings: number;
  earningsBalance: number;
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1000) return String(value);
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
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

export default function AnalyticsPage() {
  const { token } = useAuth();
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
      setError(err?.message || 'Failed to load analytics.');
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
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load analytics</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const s = stats || ({} as CreatorStats);
  const totalContent = (s.totalPosts || 0) + (s.totalReels || 0);
  const engagement = s.totalFollowers > 0 ? Math.round(((s.totalViews + s.totalLikes + s.totalComments) / s.totalFollowers) * 100) / 100 : 0;
  const hasAnyData = (s.totalViews || 0) > 0 || (s.totalLikes || 0) > 0 || (s.totalFollowers || 0) > 0 || totalContent > 0;
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* Performance overview */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp size={15} className="text-[var(--active)]" />
          <h2 className="text-sm font-bold text-white">Performance overview</h2>
          <span className="ml-auto rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/40">All time</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[11px] text-white/40">Total views</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-white">{formatCompact(s.totalViews || 0)}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400"><Eye size={12} /> from your published content</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[11px] text-white/40">Audience</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-white">{formatCompact(s.totalFollowers || 0)}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/35"><Users size={12} /> followers</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[11px] text-white/40">Engagement rate</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-white">{hasAnyData ? `${engagement}×` : '—'}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/35"><Heart size={12} /> views + likes vs followers</p>
          </div>
        </div>
      </section>

      {/* Engagement metrics */}
      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">Engagement</h3>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <StatTile icon={Eye} label="Views" value={formatCompact(s.totalViews ?? 0)} accent="text-white/60" />
          <StatTile icon={Heart} label="Likes" value={formatCompact(s.totalLikes ?? 0)} accent="text-rose-300" />
          <StatTile icon={MessageCircle} label="Comments" value={formatCompact(s.totalComments ?? 0)} accent="text-sky-300" />
          <StatTile icon={Share2} label="Shares" value={formatCompact(s.totalShares ?? 0)} accent="text-emerald-300" />
          <StatTile icon={Bookmark} label="Saves" value={formatCompact(s.totalSaves ?? 0)} accent="text-amber-300" />
          <StatTile icon={Users} label="Following" value={formatCompact(s.totalFollowing ?? 0)} />
        </div>
      </section>

      {/* Content metrics */}
      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">Content</h3>
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile icon={TrendingUp} label="Posts" value={formatCompact(s.totalPosts ?? 0)} accent="text-white/60" />
          <StatTile icon={Bookmark} label="Reels" value={formatCompact(s.totalReels ?? 0)} accent="text-violet-300" />
          <StatTile icon={Share2} label="Live sessions" value={formatCompact(s.totalLiveSessions ?? 0)} accent="text-red-300" />
        </div>
      </section>

      {!hasAnyData && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <TrendingUp size={30} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">No analytics yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-white/30">Publish content and go live to start building your performance data. Metrics update as your posts earn views and engagement.</p>
          <Link href="/creator/content" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--active)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90">
            View content <span aria-hidden>→</span>
          </Link>
        </section>
      )}
    </motion.div>
  );
}