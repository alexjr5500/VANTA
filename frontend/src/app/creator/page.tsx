'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { apiGet } from '@/lib/apiClient';
import { GO_LIVE_ROUTE } from '@/lib/goLiveEntry';
import type { CreatorStats, CreatorContentItem } from '@/lib/creatorStudio';
import { ConsoleErrorState } from '@/components/console/States';
import { fmtCompact, fmtCurrency, timeAgo } from '@/components/console/format';
import { Eye, MessageCircle, Bookmark, Share2, Heart, Users, Radio, Gift, Coins, Video, FileText, ArrowUpRight, Plus, TrendingUp, Wallet, ChevronRight } from 'lucide-react';

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};
const QUICK_ACTIONS = [
  { href: GO_LIVE_ROUTE, label: 'Go live', desc: 'Start a live session', icon: Radio },
  { href: '/creator/content', label: 'Your content', desc: 'Manage posts and reels', icon: FileText },
  { href: '/creator/analytics', label: 'Analytics', desc: 'Understand your reach', icon: TrendingUp },
  { href: '/creator/earnings', label: 'Earnings', desc: 'Wallet and transactions', icon: Wallet },
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
    setLoading(true); setError(null);
    try {
      const [statsRes, contentRes] = await Promise.all([
        apiGet<{ stats: CreatorStats }>('/api/creator/stats', token),
        apiGet<{ content: CreatorContentItem[] }>('/api/creator/content?limit=24', token, { skipCache: true }).catch(() => ({ content: [] as CreatorContentItem[] })),
      ]);
      setStats(statsRes?.stats ?? null);
      setContent(Array.isArray(contentRes?.content) ? contentRes.content : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your studio overview.');
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void fetchData(); }, [fetchData]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const ordered = useMemo(() => {
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...content].sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
  }, [content, order]);
  if (loading) return <div className="w-full space-y-8 pb-10" aria-busy="true">
    <div className="space-y-3"><div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" /><div className="h-8 w-56 animate-pulse rounded bg-white/[0.06]" /><div className="h-4 w-64 animate-pulse rounded bg-white/[0.04]" /></div>
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-20 animate-pulse rounded bg-white/[0.04]" />)}</div>
    <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
  </div>;
  if (error) return <ConsoleErrorState title="Couldn't load your overview" message={error} onRetry={() => void fetchData()} />;

  const displayName = stats?.fullName || stats?.username || user?.username || 'Creator';
  const columns = [
    { key: 'post' as const, label: 'Posts', icon: FileText, accent: 'text-console-gold' },
    { key: 'reel' as const, label: 'Reels', icon: Video, accent: 'text-cyan-300' },
  ].map(col => ({ ...col, items: ordered.filter(item => item.type === col.key) }));
  const chart = content.slice(0, 12).reverse();
  const maxViews = Math.max(1, ...chart.map(item => item.views || 0));
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map(item => item.id).filter(id => id !== dragId);
    const at = ids.indexOf(targetId);
    ids.splice(at, 0, dragId);
    setOrder(ids); setDragId(null);
  };
  const card = 'rounded-2xl border border-white/[0.08] bg-[#0f1013] p-4 shadow-[0_0_0_1px_rgba(0,0,0,.4),0_18px_40px_-24px_rgba(34,211,238,.25)]';

  return <div className="w-full min-w-0 space-y-6 pb-10">
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/80">{greeting()}</p>
        <h2 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-console-text sm:text-3xl"><span className="truncate">{displayName}</span>{stats?.verified ? <VerificationBadge /> : null}</h2>
        <p className="mt-1 text-sm text-console-text-3">Your studio dashboard, live from your VANTA account.</p></div>
      <div className="flex w-full shrink-0 gap-2 sm:w-auto">
        <button type="button" onClick={() => openPostModal()} className="vc-focus inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-console-text-2 hover:bg-white/[0.04] sm:flex-none"><Plus size={16} aria-hidden /> Create</button>
        <button type="button" onClick={() => router.push(GO_LIVE_ROUTE)} className="vc-focus inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-console-gold px-5 text-sm font-semibold text-console-gold-fg hover:bg-console-gold-hover sm:flex-none"><Radio size={16} aria-hidden /> Go live</button>
      </div>
    </section>

    {stats ? <section aria-label="Your performance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric icon={<Users size={15}/>} label="Followers" value={fmtCompact(stats.totalFollowers)} hint={`${fmtCompact(stats.totalFollowing)} following`} tone="gold" />
      <Metric icon={<Eye size={15}/>} label="Views" value={fmtCompact(stats.totalViews)} hint={`${fmtCompact(stats.totalPosts)} posts · ${fmtCompact(stats.totalReels)} reels`} tone="cyan" />
      <Metric icon={<Heart size={15}/>} label="Likes" value={fmtCompact(stats.totalLikes)} hint={`${fmtCompact(stats.totalComments)} comments · ${fmtCompact(stats.totalShares)} shares`} tone="gold" />
      <Metric icon={<Wallet size={15}/>} label="Earnings balance" value={fmtCurrency(stats.earningsBalance)} hint={`${fmtCompact(stats.giftsReceived)} gifts · ${fmtCompact(stats.coins)} coins`} tone="cyan" />
    </section> : null}

    <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
      <div className={card}>
        <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-console-text">Views by recent content</h3><p className="mt-0.5 text-xs text-console-text-3">Your latest {chart.length || 0} posts and reels, oldest to newest</p></div><Link href="/creator/analytics" className="vc-focus inline-flex items-center gap-1 text-xs font-medium text-console-gold hover:text-console-gold-hover">Analytics <ArrowUpRight size={13} aria-hidden /></Link></div>
        {chart.length === 0 ? <p className="py-10 text-center text-xs text-console-text-3">Publish a post or reel and its views will chart here.</p> :
          <div className="flex h-44 items-end gap-2" role="img" aria-label="Views per recent content item">{chart.map(item => <div key={item.id} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${item.title}: ${item.views} views`}>
            <span className="text-[10px] tabular-nums text-console-text-3">{fmtCompact(item.views)}</span>
            <div className={`w-full rounded-t-md ${item.type === 'reel' ? 'bg-gradient-to-t from-cyan-500/30 to-cyan-300' : 'bg-gradient-to-t from-[#8a6a1c] to-[#f2c75c]'}`} style={{ height: `${Math.max(4, ((item.views || 0) / maxViews) * 100)}%` }} />
          </div>)}</div>}
        <div className="mt-3 flex gap-4 text-[11px] text-console-text-3"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#f2c75c]" />Posts</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-300" />Reels</span></div>
      </div>
      <div className={`${card} space-y-4`}>
        <h3 className="text-sm font-semibold text-console-text">Engagement totals</h3>
        {stats ? <dl className="space-y-3">
          <Balance icon={<MessageCircle size={14}/>} label="Comments" value={fmtCompact(stats.totalComments)} />
          <Balance icon={<Share2 size={14}/>} label="Shares" value={fmtCompact(stats.totalShares)} />
          <Balance icon={<Bookmark size={14}/>} label="Saves" value={fmtCompact(stats.totalSaves)} />
          <Balance icon={<Radio size={14}/>} label="Live sessions" value={fmtCompact(stats.totalLiveSessions)} />
          <Balance icon={<Coins size={14}/>} label="Coin balance" value={fmtCompact(stats.coins)} />
        </dl> : <p className="text-xs text-console-text-3">No stats yet.</p>}
        <nav aria-label="Creator shortcuts" className="grid grid-cols-2 gap-2 pt-1">{QUICK_ACTIONS.map(action => { const Icon = action.icon; return <Link key={action.href} href={action.href} className="vc-focus flex min-h-11 items-center gap-2 rounded-xl border border-white/[0.08] px-3 text-xs font-medium text-console-text-2 hover:border-cyan-300/40 hover:text-console-text"><Icon size={14} className="text-cyan-300" />{action.label}</Link>; })}</nav>
      </div>
    </section>

    <section aria-label="Content board" className={card}>
      <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-console-text">Content board</h3><p className="mt-0.5 text-xs text-console-text-3">Drag cards to rearrange your view. Ordering is local to this page and doesn't change your content.</p></div><Link href="/creator/content" className="vc-focus inline-flex shrink-0 items-center gap-1 text-xs font-medium text-console-gold hover:text-console-gold-hover">Manage <ChevronRight size={14} aria-hidden /></Link></div>
      {content.length === 0 ? <div className="flex min-h-32 flex-col items-center justify-center text-center"><FileText size={20} className="mb-2 text-console-text-3" aria-hidden /><p className="text-sm font-medium text-console-text">Your content starts here</p><button type="button" onClick={() => openPostModal()} className="vc-focus mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-console-gold px-4 text-xs font-semibold text-console-gold-fg"><Plus size={14} aria-hidden /> Create a post</button></div> :
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{columns.map(col => { const Icon = col.icon; return <div key={col.key} className="min-w-0 rounded-xl bg-white/[0.025] p-3" onDragOver={e => e.preventDefault()}>
        <div className="mb-2 flex items-center justify-between"><span className={`inline-flex items-center gap-2 text-xs font-semibold ${col.accent}`}><Icon size={14} />{col.label}</span><span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] tabular-nums text-console-text-3">{col.items.length}</span></div>
        <ul className="space-y-2">{col.items.length === 0 ? <li className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-console-text-3">Nothing here yet</li> : col.items.map(item => <li key={item.id} draggable onDragStart={() => setDragId(item.id)} onDragEnd={() => setDragId(null)} onDragOver={e => e.preventDefault()} onDrop={() => dropOn(item.id)} className={`cursor-grab rounded-lg border border-white/[0.08] bg-[#14151a] p-3 active:cursor-grabbing ${dragId === item.id ? 'opacity-40' : ''}`}>
          <Link href={`/post/${item.id}`} draggable={false} className="vc-focus block truncate text-sm font-medium text-console-text hover:text-console-gold">{item.title}</Link>
          <p className="mt-1 text-[11px] text-console-text-3">{timeAgo(item.createdAt)}</p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-console-text-2"><span className="inline-flex items-center gap-1"><Eye size={12} className="text-cyan-300"/>{fmtCompact(item.views)}</span><span className="inline-flex items-center gap-1"><Heart size={12} className="text-[#f2c75c]"/>{fmtCompact(item.likes)}</span><span className="inline-flex items-center gap-1"><MessageCircle size={12}/>{fmtCompact(item.comments)}</span></div>
        </li>)}</ul></div>; })}</div>}
    </section>
  </div>;
}

function Metric({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint: string; tone: 'gold' | 'cyan' }) {
  return <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0f1013] p-4"><div className={`mb-2 flex items-center gap-2 ${tone === 'gold' ? 'text-[#f2c75c]' : 'text-cyan-300'}`}>{icon}<span className="text-xs text-console-text-3">{label}</span></div><p className="text-2xl font-semibold tracking-tight tabular-nums text-console-text">{value}</p><p className="mt-1 truncate text-[11px] text-console-text-3">{hint}</p></div>;
}
function Balance({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-xs text-console-text-3">{icon}{label}</dt><dd className="text-sm font-semibold tabular-nums text-console-text">{value}</dd></div>;
}
