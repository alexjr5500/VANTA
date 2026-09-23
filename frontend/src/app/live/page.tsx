'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Radio, RefreshCw, Users, Video, WifiOff, Heart, TrendingUp, Sparkles, Menu } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { openAppMenu } from '@/lib/openAppMenu';
import LiveFeaturedStream from '@/components/live/LiveFeaturedStream';
import LiveStreamCard from '@/components/live/LiveStreamCard';
import { cn } from '@/lib/utils';

type LiveTab = 'forYou' | 'following' | 'popular';

interface StreamHost {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

interface LiveStream {
  id: string;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  viewerCount: number;
  status: string;
  active: boolean;
  categoryName?: string | null;
  startedAt?: string | null;
  allowGifts?: boolean;
  host: StreamHost;
  category?: { name: string } | null;
  _count?: { viewers?: number; giftEvents?: number };
}

const TABS: { id: LiveTab; label: string; icon: typeof Sparkles }[] = [
  { id: 'forYou', label: 'For You', icon: Sparkles },
  { id: 'following', label: 'Following', icon: Heart },
  { id: 'popular', label: 'Popular', icon: TrendingUp },
];

export default function LivePage() {
  const { token } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<LiveTab>('forYou');
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (active: LiveTab) => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const endpoint =
        active === 'following'
          ? '/api/live/following?limit=24'
          : `/api/live/discover?limit=24&sort=${active === 'popular' ? 'popular' : 'trending'}`;
      const data = await apiGet<any>(endpoint, token, { skipCache: true });
      const items: LiveStream[] = Array.isArray(data)
        ? data
        : data?.items || data?.streams || data?.data || [];
      setStreams(items);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  const featured = tab === 'forYou' ? streams[0] : undefined;
  const grid = tab === 'forYou' ? streams.slice(1) : streams;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto min-w-0 w-full space-y-6 overflow-x-hidden pb-24"
    >
      {/* Header — Balance-style full-bleed sticky bar that stays fixed while
          the stream grid scrolls beneath it. Live is a primary nav destination,
          so the leading slot is the VANTA menu toggle (same 40×40 icon button
          language as Balance's back button). */}
      <header className="sticky top-0 z-30 relative -mx-4 flex h-14 w-[calc(100%+2rem)] shrink-0 items-center gap-2.5 border-b border-white/[.08] bg-[#080808]/90 px-4 backdrop-blur-xl">
        <button type="button" onClick={openAppMenu} aria-label="Open menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Menu size={20} /></button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-[#f5f5f5]">Live</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => router.push('/live/go-live')}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#D6A83F] to-[#F2C75C] px-4 text-xs font-extrabold text-black shadow-[0_4px_18px_rgba(214,168,63,0.35)] transition hover:brightness-105 active:scale-95"
          >
            <Radio size={13} />
            Go Live
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide" role="tablist" aria-label="Live feed">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-bold transition active:scale-95',
                active
                  ? 'border-[#D6A83F]/60 bg-[#D6A83F]/12 text-[#F2C75C]'
                  : 'border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white/85',
              )}
            >
              <Icon size={13} className={active ? 'text-[#F2C75C]' : 'text-white/35'} />
              {label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="space-y-6" aria-label="Loading live streams">
          {tab === 'forYou' && <div className="aspect-[21/9] min-h-[300px] animate-pulse rounded-3xl bg-white/[.045]" />}
          <div>
            <div className="mb-4 h-3 w-24 animate-pulse rounded bg-white/[.06]" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="aspect-video animate-pulse rounded-2xl bg-white/[.04]" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-white/[.05]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && loadError && (
        <div className="rounded-3xl border border-white/[.08] bg-[#101010] px-6 py-16 text-center">
          <WifiOff className="mx-auto text-[#8a8a8a]" />
          <h2 className="mt-4 text-lg font-semibold">Couldn&apos;t load Live.</h2>
          <p className="mt-2 text-sm text-[#666]">VANTA could not reach the live services.</p>
          <button
            type="button"
            onClick={() => void load(tab)}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#f5f5f5] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white"
          >
            <RefreshCw size={15} />
            Try Again
          </button>
        </div>
      )}

      {!loading && !loadError && streams.length === 0 && (
        <div className="rounded-3xl border border-white/[.08] bg-[#101010] px-6 py-16 text-center">
          {tab === 'following' ? <Heart className="mx-auto text-[#8a8a8a]" /> : <Users className="mx-auto text-[#8a8a8a]" />}
          <h2 className="mt-4 text-lg font-semibold">
            {tab === 'following'
              ? 'No live streams from people you follow'
              : tab === 'popular'
                ? 'Nothing trending right now'
                : 'No one is live right now'}
          </h2>
          <p className="mt-2 text-sm text-[#666]">
            {tab === 'following'
              ? 'Streams from creators you follow will appear here the moment they go live.'
              : 'Be the first to go live and share with the VANTA community.'}
          </p>
          <button
            type="button"
            onClick={() => router.push('/live/go-live')}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#D6A83F] to-[#F2C75C] px-5 py-2.5 text-sm font-extrabold text-black shadow-[0_4px_18px_rgba(214,168,63,0.3)] transition hover:brightness-105"
          >
            <Radio size={15} />
            Go Live
          </button>
        </div>
      )}

      {!loading && !loadError && streams.length > 0 && (
        <div className="space-y-8">
          {featured && (
            <section aria-label="Featured stream">
              <LiveFeaturedStream stream={featured} />
            </section>
          )}

          {grid.length > 0 && (
            <section aria-label="Live streams">
              <div className="mb-4 flex items-center gap-2">
                <Video size={15} className="text-[#8a8a8a]" />
                <h2 className="text-base font-bold text-white">
                  {tab === 'following' ? 'From your network' : tab === 'popular' ? 'Trending now' : 'Live Now'}
                </h2>
                <span className="rounded-full bg-white/[.05] px-2 py-0.5 text-[10px] text-white/40">
                  {streams.length} live
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {grid.map((stream, index) => (
                  <LiveStreamCard key={stream.id} stream={stream} index={index} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </motion.div>
  );
}