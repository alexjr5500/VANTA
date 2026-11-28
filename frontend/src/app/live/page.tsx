'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { readDefaultSection } from '@/lib/defaultSection';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Radio, RefreshCw, Users, WifiOff, Heart, TrendingUp, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
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
  { id: 'forYou', label: 'For you', icon: Sparkles },
  { id: 'following', label: 'Following', icon: Heart },
  { id: 'popular', label: 'Popular', icon: TrendingUp },
];

export default function LivePage() {
  const { token } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<LiveTab>('forYou');
  const [sectionReady, setSectionReady] = useState(false);
  const requestId = useRef(0);
  useEffect(() => { setTab(readDefaultSection('live')); setSectionReady(true); }, []);
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (active: LiveTab, silent = false) => {
    if (!sectionReady) return;
    const request = ++requestId.current;
    if (!token) {
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      const endpoint = active === 'following'
        ? '/api/live/following?limit=24'
        : `/api/live/discover?limit=24&sort=${active === 'popular' ? 'popular' : 'trending'}`;
      const data = await apiGet<any>(endpoint, token, { skipCache: true });
      const items: LiveStream[] = Array.isArray(data)
        ? data
        : data?.items || data?.streams || data?.data || [];
      if (request !== requestId.current) return;
      setStreams(items);
      setLoadError(false);
    } catch {
      if (!silent && request === requestId.current) setLoadError(true);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [token, sectionReady]);

  useEffect(() => { void load(tab); }, [load, tab]);

  useEffect(() => {
    const id = window.setInterval(() => { void load(tab, true); }, 30_000);
    return () => window.clearInterval(id);
  }, [load, tab]);

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      data-vanta-page="live" className="mx-auto min-w-0 w-full space-y-4 pb-24"
    >
      <header className="sticky top-0 z-30 -mx-4 flex h-14 w-[calc(100%+2rem)] items-center gap-0 border-b border-white/[.07] bg-[var(--header-surface)] px-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight text-white">Live</h1>
        </div>
        <button
          type="button"
          onClick={() => router.push('/live/go-live')}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[#D6A83F] px-4 text-xs font-bold text-black transition hover:bg-[#E7B94F] active:scale-[.98]"
        >
          <Radio size={14} /> Go live
        </button>
      </header>

      <div className="flex items-center rounded-lg border border-white/[.07] bg-[var(--surface)] p-1" role="tablist" aria-label="Live streams">
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
                'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-semibold transition',
                active ? 'bg-[var(--surface-active)] text-white' : 'text-white/45 hover:text-white/80',
              )}
            >
              <Icon size={13} className={active ? 'text-[#F2C75C]' : 'text-current'} />
              {label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-video rounded-xl bg-[var(--surface-active)]" />
              <div className="mt-3 h-3 w-2/3 rounded bg-white/[.06]" />
              <div className="mt-2 h-3 w-1/3 rounded bg-white/[.04]" />
            </div>
          ))}
        </div>
      )}

      {!loading && loadError && (
        <section className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-white/[.08] bg-[var(--surface)] px-5 text-center">
          <WifiOff size={22} className="text-white/35" />
          <h2 className="mt-4 text-base font-semibold text-white">Live isn’t available right now</h2>
          <p className="mt-1.5 max-w-xs text-sm text-white/45">Check your connection and try again.</p>
          <button type="button" onClick={() => void load(tab)} className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-xs font-bold text-black transition hover:bg-white/90">
            <RefreshCw size={13} /> Try again
          </button>
        </section>
      )}

      {!loading && !loadError && streams.length === 0 && (
        <section className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-white/[.08] bg-[var(--surface)] px-5 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/[.05] text-white/50">
            {tab === 'following' ? <Heart size={20} /> : <Users size={20} />}
          </span>
          <h2 className="mt-4 text-base font-semibold text-white">
            {tab === 'following' ? 'No one you follow is live' : tab === 'popular' ? 'Nothing popular right now' : 'No one is live right now'}
          </h2>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-white/45">
            {tab === 'following' ? 'When creators you follow start streaming, you’ll find them here.' : 'Start a stream and be the first to show up here.'}
          </p>
          <button type="button" onClick={() => router.push('/live/go-live')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#D6A83F] px-5 text-xs font-bold text-black transition hover:bg-[#E7B94F]">
            <Radio size={14} /> Go live
          </button>
        </section>
      )}

      {!loading && !loadError && streams.length > 0 && (
        <section aria-label="Live now">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Live now</h2>
            <span className="text-[11px] tabular-nums text-white/40">{streams.length} {streams.length === 1 ? 'stream' : 'streams'}</span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
            {streams.map((stream, index) => (
              <LiveStreamCard key={stream.id} stream={stream} index={index} />
            ))}
          </div>
        </section>
      )}
    </motion.main>
  );
}
