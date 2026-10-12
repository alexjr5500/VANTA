"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  TrendingUp, Eye, Heart, MessageCircle, Share2, Bookmark, Users,
  Radio, Video, FileText, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import type { CreatorStats, CreatorContentItem } from '@/lib/creatorStudio';
import MetricTile from '@/components/console/MetricTile';
import ConsolePanel from '@/components/console/Panel';
import { ConsoleErrorState, ConsoleEmptyState } from '@/components/console/States';
import { fmtCompact } from '@/components/console/format';

// ============================================================================
// CREATOR ANALYTICS — real aggregated metrics from /api/creator/stats plus
// content-level performance from /api/creator/content. The backend exposes
// only cumulative (lifetime) totals for creators — no per-day time series —
// so this workspace presents totals and content comparisons and NEVER draws
// invented trend lines or fabricated date ranges.
// ============================================================================

export default function AnalyticsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [content, setContent] = useState<CreatorContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [statsRes, contentRes] = await Promise.all([
        apiGet<{ stats: CreatorStats }>('/api/creator/stats', token),
        apiGet<{ content: CreatorContentItem[] }>('/api/creator/content?limit=50', token, { skipCache: true }).catch(() => ({ content: [] })),
      ]);
      setStats(statsRes?.stats ?? null);
      setContent(Array.isArray(contentRes?.content) ? contentRes.content : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6 pb-8" aria-busy="true">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded bg-white/[0.04]" />)}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-white/[0.04]" />)}
        </div>
        <div className="vc-panel h-64 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return <ConsoleErrorState title="Couldn't load analytics" message={error} onRetry={() => void fetchData()} />;
  }

  if (!stats) {
    return (
      <ConsoleEmptyState
        title="Analytics unavailable"
        description="We couldn't retrieve your creator statistics. Try again in a moment."
        action={
          <button type="button" onClick={() => void fetchData()} className="vc-focus min-h-9 rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-xs font-semibold text-console-text-2 hover:bg-white/[0.04]">
            Try again
          </button>
        }
      />
    );
  }

  const hasAnyData = stats.totalViews > 0 || stats.totalLikes > 0 || stats.totalFollowers > 0;

  // Content performance: top items by views (real per-item metrics).
  const topContent = [...content].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  const maxViews = Math.max(1, ...topContent.map((c) => c.views || 0));

  return (
    <div className="space-y-8 pb-10">
      {/* Primary performance band */}
      <section aria-label="Primary performance">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          <MetricTile label="Followers" value={fmtCompact(stats.totalFollowers)} icon={<Users size={13} />} hint={`${fmtCompact(stats.totalFollowing)} following`} accent />
          <MetricTile label="Total views" value={fmtCompact(stats.totalViews)} icon={<Eye size={13} />} hint="All published content" />
          <MetricTile label="Content published" value={fmtCompact(stats.totalPosts + stats.totalReels)} icon={<FileText size={13} />} hint={`${fmtCompact(stats.totalPosts)} posts · ${fmtCompact(stats.totalReels)} reels`} />
          <MetricTile label="Live sessions" value={fmtCompact(stats.totalLiveSessions)} icon={<Radio size={13} />} hint={`${fmtCompact(stats.giftsReceived)} gifts received`} />
        </div>
        <p className="mt-3 text-[11px] text-console-text-3">
          Cumulative lifetime totals from the VANTA creator stats service. Time-range filters are not
          available yet — the backend does not expose per-period creator series.
        </p>
      </section>

      {/* Supporting engagement metrics */}
      <section aria-label="Engagement metrics">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-console-text-3">Engagement</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          <MetricTile label="Likes" value={fmtCompact(stats.totalLikes)} icon={<Heart size={13} />} />
          <MetricTile label="Comments" value={fmtCompact(stats.totalComments)} icon={<MessageCircle size={13} />} />
          <MetricTile label="Shares" value={fmtCompact(stats.totalShares)} icon={<Share2 size={13} />} />
          <MetricTile label="Saves" value={fmtCompact(stats.totalSaves)} icon={<Bookmark size={13} />} />
          <MetricTile label="Following" value={fmtCompact(stats.totalFollowing)} icon={<Users size={13} />} />
          <MetricTile label="Reels" value={fmtCompact(stats.totalReels)} icon={<Video size={13} />} />
        </div>
      </section>

      {/* Content comparison — real per-item performance */}
      <ConsolePanel
        title="Content performance"
        description="Your top published content by views"
        actions={
          <Link href="/creator/content" className="vc-focus inline-flex items-center gap-1 rounded text-xs font-semibold text-console-gold hover:text-console-gold-hover">
            Manage content <ChevronRight size={13} aria-hidden />
          </Link>
        }
        bodyClassName="p-0"
      >
        {topContent.length === 0 ? (
          <ConsoleEmptyState
            icon={<TrendingUp size={19} />}
            title="No content performance yet"
            description="Publish posts and reels to start comparing how your content performs."
          />
        ) : (
          <ul className="divide-y divide-console-border">
            {topContent.map((item, idx) => {
              const pct = maxViews > 0 ? Math.max(2, Math.round(((item.views || 0) / maxViews) * 100)) : 0;
              return (
                <li key={item.id}>
                  <Link href={`/post/${item.id}`} className="vc-focus block px-4 py-3 transition-colors hover:bg-white/[0.02] sm:px-5">
                    <div className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-console-text-3">{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-console-text">{item.title}</p>
                        <p className="mt-0.5 text-[11px] text-console-text-3">
                          {item.type === 'reel' ? 'Reel' : 'Post'} · {fmtCompact(item.likes)} likes · {fmtCompact(item.comments)} comments
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-console-text">{fmtCompact(item.views)}</span>
                      <span className="hidden shrink-0 text-[11px] text-console-text-3 sm:inline">views</span>
                    </div>
                    <div className="mt-2 ml-8 h-1 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden>
                      <div className="h-full rounded-full bg-console-gold/70" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ConsolePanel>

      {!hasAnyData && (
        <ConsoleEmptyState
          icon={<TrendingUp size={19} />}
          title="No analytics yet"
          description="Publish content and go live to start building your performance data. Metrics update as your posts earn views and engagement."
          action={
            <Link href="/creator/content" className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] bg-console-gold px-4 text-xs font-semibold text-console-gold-fg hover:bg-console-gold-hover">
              View content
            </Link>
          }
        />
      )}
    </div>
  );
}

