'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { apiGet } from '@/lib/apiClient';
import { GO_LIVE_ROUTE } from '@/lib/goLiveEntry';
import type { CreatorStats, CreatorContentItem } from '@/lib/creatorStudio';
import MetricTile from '@/components/console/MetricTile';
import ConsolePanel from '@/components/console/Panel';
import { ConsoleErrorState, SkeletonRows } from '@/components/console/States';
import { fmtCompact, fmtCurrency, timeAgo } from '@/components/console/format';
import {
  Eye, Heart, Users, Radio, Gift, Coins,
  Video, FileText, ArrowUpRight, Plus,
  TrendingUp, Wallet, ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// CREATOR OVERVIEW — the studio home screen.
//
// Data comes exclusively from the real /api/creator/stats and
// /api/creator/content endpoints. There are no invented metrics: unavailable
// values render honestly (skeleton while loading, error state on failure,
// empty state when the creator has no content yet). Every figure is a lifetime
// aggregate produced by the backend — no client-side period maths and no
// fabricated percentage changes.
// ---------------------------------------------------------------------------

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const QUICK_ACTIONS = [
  { href: GO_LIVE_ROUTE, label: 'Go Live', desc: 'Start a live session', icon: Radio },
  { href: '/creator/content', label: 'Content Manager', desc: 'Review published content', icon: FileText },
  { href: '/creator/analytics', label: 'Analytics', desc: 'Explore your performance', icon: TrendingUp },
  { href: '/creator/earnings', label: 'Earnings', desc: 'Balance, gifts and transactions', icon: Wallet },
];

export default function CreatorStudioPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const { openPostModal } = useContentCreation();
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
        apiGet<{ content: CreatorContentItem[] }>('/api/creator/content?limit=5', token, { skipCache: true }).catch(() => ({ content: [] })),
      ]);
      setStats(statsRes?.stats ?? null);
      setContent(Array.isArray(contentRes?.content) ? contentRes.content : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your studio overview.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-8 pb-10" aria-busy="true">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-7 w-56 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3.5 w-72 animate-pulse rounded bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded bg-white/[0.04]" />)}
        </div>
        <div className="vc-panel">
          <div className="border-b border-console-border px-5 py-3">
            <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.05]" />
          </div>
          <SkeletonRows rows={3} />
        </div>
      </div>
    );
  }

  if (error) {
    return <ConsoleErrorState title="Couldn't load your overview" message={error} onRetry={() => void fetchData()} />;
  }

  const displayName = stats?.fullName || stats?.username || user?.username || 'Creator';
  const recent = content.slice(0, 4);

  return (
    <div className="space-y-8 pb-10">
      {/* Header: personalized greeting + the two actions creators actually need */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-console-text-3">{greeting()}</p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-console-text">
            <span className="truncate">{displayName}</span>
            {stats?.verified ? <VerificationBadge /> : null}
          </h2>
          <p className="mt-1 text-sm text-console-text-3">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openPostModal()}
            className="vc-focus inline-flex min-h-10 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-sm font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
          >
            <Plus size={16} aria-hidden /> Create
          </button>
          <button
            type="button"
            onClick={() => router.push(GO_LIVE_ROUTE)}
            className="vc-focus inline-flex min-h-10 items-center gap-2 rounded-[var(--vc-radius)] bg-console-gold px-5 text-sm font-semibold text-console-gold-fg transition-colors hover:bg-console-gold-hover"
          >
            <Radio size={16} aria-hidden /> Go Live
          </button>
        </div>
      </div>

      {/* Performance overview — an open metric band, not a grid of identical cards */}
      {stats ? (
        <section aria-label="Performance overview">
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <MetricTile label="Followers" value={fmtCompact(stats.totalFollowers)} icon={<Users size={13} />} hint={`${fmtCompact(stats.totalFollowing)} following`} />
            <MetricTile label="Total views" value={fmtCompact(stats.totalViews)} icon={<Eye size={13} />} hint={`${fmtCompact(stats.totalPosts)} posts · ${fmtCompact(stats.totalReels)} reels`} accent />
            <MetricTile label="Likes" value={fmtCompact(stats.totalLikes)} icon={<Heart size={13} />} hint={`${fmtCompact(stats.totalComments)} comments · ${fmtCompact(stats.totalShares)} shares`} />
            <MetricTile label="Gifts received" value={fmtCompact(stats.giftsReceived)} icon={<Gift size={13} />} hint={`${fmtCompact(stats.coins)} coins balance`} />
          </div>
          <p className="mt-3 text-[11px] text-console-text-3">
            Lifetime totals aggregated from your published content, live sessions and wallet.
          </p>
        </section>
      ) : null}

      {/* Main split: recent content + contextual side panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ConsolePanel
          className="lg:col-span-2"
          title="Recent content"
          description="Your latest published posts and reels"
          bodyClassName="p-0"
          actions={
            <Link href="/creator/content" className="vc-focus inline-flex items-center gap-1 rounded text-xs font-semibold text-console-gold hover:text-console-gold-hover">
              View all <ChevronRight size={13} aria-hidden />
            </Link>
          }
        >
          {recent.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <FileText size={22} className="mx-auto mb-3 text-console-text-3" aria-hidden />
              <p className="text-sm font-medium text-console-text-2">No content yet</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-console-text-3">
                Posts you publish will appear here with their real performance.
              </p>
              <button
                type="button"
                onClick={() => openPostModal()}
                className="vc-focus mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] bg-console-gold px-4 text-xs font-semibold text-console-gold-fg hover:bg-console-gold-hover"
              >
                <Plus size={13} aria-hidden /> Create your first post
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-console-border">
              {recent.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/post/${item.id}`}
                    className="vc-focus flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] sm:px-5"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 text-console-text-3">
                      {item.type === 'reel' ? <Video size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-console-text">{item.title}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[11px] text-console-text-3">
                        <span className="uppercase">{item.type}</span>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(item.createdAt)}</span>
                      </p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-4 text-right sm:flex">
                      <span className="text-xs text-console-text-3">
                        <span className="font-semibold text-console-text-2">{fmtCompact(item.views)}</span> views
                      </span>
                      <span className="text-xs text-console-text-3">
                        <span className="font-semibold text-console-text-2">{fmtCompact(item.likes)}</span> likes
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:hidden">
                      <Eye size={12} className="text-console-text-3" aria-hidden />
                      <span className="text-xs text-console-text-2">{fmtCompact(item.views)}</span>
                    </div>
                    <ArrowUpRight size={14} className="shrink-0 text-console-text-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ConsolePanel>


        <div className="space-y-6">
          <ConsolePanel title="Quick actions" bodyClassName="p-2">
            <nav aria-label="Quick actions">
              {QUICK_ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="vc-focus group flex min-h-[52px] items-center gap-3 rounded-[var(--vc-radius)] px-3 transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-console-border bg-console-bg2 text-console-text-3 transition-colors group-hover:text-console-gold">
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-console-text">{a.label}</span>
                      <span className="block truncate text-[11px] text-console-text-3">{a.desc}</span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-console-text-3" aria-hidden />
                  </Link>
                );
              })}
            </nav>
          </ConsolePanel>

          {stats ? (
            <ConsolePanel title="Live &amp; wallet snapshot" bodyClassName="px-5 py-4">
              <dl className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-xs text-console-text-3"><Radio size={13} aria-hidden /> Live sessions</dt>
                  <dd className="text-sm font-semibold tabular-nums text-console-text">{fmtCompact(stats.totalLiveSessions)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-xs text-console-text-3"><Coins size={13} aria-hidden /> Coin balance</dt>
                  <dd className="text-sm font-semibold tabular-nums text-console-text">{fmtCompact(stats.coins)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-xs text-console-text-3"><Wallet size={13} aria-hidden /> Earnings balance</dt>
                  <dd className="text-sm font-semibold tabular-nums text-console-gold">{fmtCurrency(stats.earningsBalance)}</dd>
                </div>
              </dl>
              <Link
                href="/creator/earnings"
                className="vc-focus mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border px-3.5 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
              >
                Monetization center <ArrowUpRight size={13} aria-hidden />
              </Link>
            </ConsolePanel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
