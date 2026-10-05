"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { FileText, Video, Eye, Heart, MessageCircle, Bookmark, Share2, AlertCircle, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

// ============================================================================
// CREATOR CONTENT — real published posts from /api/creator/content with their
// actual performance numbers. No mocked drafts or fake management controls.
// ============================================================================

interface CreatorContentItem {
  id: string;
  type: 'post' | 'reel';
  title: string;
  mediaUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  createdAt: string;
}

const fmtCompact = (n: number) =>
  Math.abs(Number(n || 0)) >= 1000
    ? Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0))
    : String(Number(n || 0));

export default function CreatorContentPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<CreatorContentItem[]>([]);
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
      const res = await apiGet<{ content: CreatorContentItem[] }>('/api/creator/content?limit=50', token, { skipCache: true });
      setItems(Array.isArray(res?.content) ? res.content : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your content.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="skeleton h-12 w-48 rounded-2xl" />
        {[1, 2, 3].map((i) => <div key={i} className="skeleton h-36 rounded-2xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load your content</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Content Manager</h2>
          <p className="mt-0.5 text-[11px] text-white/40">{items.length} published post{items.length === 1 ? '' : 's'} · performance from real engagement</p>
        </div>
      </div>

      {items.length === 0 ? (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <FileText size={28} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">No content yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-white/30">Posts you publish will appear here with their views, likes and comments.</p>
        </section>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/50">
                    {item.type === 'reel' ? <Video size={16} /> : <FileText size={16} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-[10px] text-white/35">{new Date(item.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                  </div>
                </div>
                <Link
                  href={`/post/${item.id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/[0.04] hover:text-white"
                >
                  View <ArrowUpRight size={11} />
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <p className="text-sm font-semibold text-white">{fmtCompact(item.views)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-white/35"><Eye size={9} /> Views</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <p className="text-sm font-semibold text-white">{fmtCompact(item.likes)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-white/35"><Heart size={9} /> Likes</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <p className="text-sm font-semibold text-white">{fmtCompact(item.comments)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-white/35"><MessageCircle size={9} /> Comments</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <p className="text-sm font-semibold text-white">{fmtCompact(item.shares)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-white/35"><Share2 size={9} /> Shares</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <p className="text-sm font-semibold text-white">{fmtCompact(item.saves)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-white/35"><Bookmark size={9} /> Saves</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}