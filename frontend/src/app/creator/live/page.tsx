"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Radio, Users, Gift, Clock, Eye, AlertCircle, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

// ============================================================================
// CREATOR LIVE STUDIO — real host stream stats from /api/live/stats and the
// existing Go Live flow. No fabricated stream data.
// ============================================================================

interface HostStats {
  totalStreams: number;
  totalViewers: number;
  totalGifts: number;
  totalDuration: number;
}

const fmtDuration = (seconds: number) => {
  const s = Number(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

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

export default function CreatorLivePage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<HostStats | null>(null);
  const [history, setHistory] = useState<any[]>([]);
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
      const [statsRes, historyRes] = await Promise.all([
        apiGet<HostStats>('/api/live/stats', token).catch(() => null),
        apiGet<any[]>('/api/live/history?limit=10', token).catch(() => []),
      ]);
      setStats(statsRes);
      setHistory(Array.isArray(historyRes) ? historyRes : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load live stats.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="skeleton h-40 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load live studio</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* Go live CTA */}
      <section className="relative overflow-hidden rounded-3xl border border-red-400/20 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/50 to-transparent" aria-hidden />
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-500/15 text-red-400"><Radio size={22} /></span>
            <div>
              <h2 className="text-lg font-bold text-white">Live Studio</h2>
              <p className="mt-0.5 text-sm text-white/45">Stream live to your audience with the full VANTA live experience.</p>
            </div>
          </div>
          <Link href="/live/go-live" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-red-400">
            <Radio size={16} /> Go Live <ArrowUpRight size={14} />
          </Link>
        </div>
      </section>

      {/* Host stats */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile icon={Radio} label="Total streams" value={Number(stats?.totalStreams || 0).toLocaleString()} accent="text-red-300" />
        <StatTile icon={Users} label="Total viewers" value={Number(stats?.totalViewers || 0).toLocaleString()} accent="text-sky-300" />
        <StatTile icon={Gift} label="Gifts received" value={Number(stats?.totalGifts || 0).toLocaleString()} accent="text-[#d9a83f]" />
        <StatTile icon={Clock} label="Stream time" value={fmtDuration(stats?.totalDuration ?? 0)} accent="text-emerald-300" />
      </section>

      {/* Recent streams */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-3 flex items-center gap-2">
          <Eye size={15} className="text-white/40" />
          <h3 className="text-sm font-bold text-white">Recent streams</h3>
        </div>
        {history.length > 0 ? (
          <div className="space-y-1.5">
            {history.slice(0, 8).map((stream: any) => (
              <Link
                key={stream.id}
                href={`/live/${stream.id}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-3.5 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/80">{stream.title || 'Untitled stream'}</p>
                  <p className="text-[10px] text-white/35">{new Date(stream.startedAt || stream.createdAt).toLocaleString()}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${stream.active ? 'bg-red-500/15 text-red-400' : 'bg-white/[0.06] text-white/40'}`}>
                  {stream.active ? 'Live' : stream.status || 'Ended'}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-white/40">You haven&apos;t hosted any streams yet.</p>
        )}
      </section>
    </motion.div>
  );
}
