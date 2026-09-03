'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Radio, RefreshCw, Users, Video, WifiOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { openAppMenu } from '@/lib/openAppMenu';
import PageHeader from '@/components/ui/PageHeader';
import LiveFeaturedStream from '@/components/live/LiveFeaturedStream';
import LiveStreamCard from '@/components/live/LiveStreamCard';

/**
 * VANTA Live
 * ----------
 * Browse page for everything broadcasting right now. Pulls active streams from
 * `/api/live/discover` and renders the top stream as a featured hero plus the
 * rest as a grid. Creator identity (name, handle, avatar, verified badge) is
 * rendered by LiveFeaturedStream / LiveStreamCard from the server-controlled
 * `host.verified` flag — verification is never inferred from a hardcoded name.
 */

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

export default function LivePage() {
  const { token } = useAuth();
  const router = useRouter();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const data = await apiGet<any>('/api/live/discover?limit=24&sort=trending', token, { skipCache: true });
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
    void load();
  }, [load]);

  const featured = streams[0];
  const grid = streams.slice(1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto min-w-0 w-full space-y-8 overflow-x-hidden pb-24"
    >
      <PageHeader
        title="Live"
        eyebrow="VANTA"
        onMenu={openAppMenu}
        actions={
          <button
            type="button"
            onClick={() => router.push('/live/studio')}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#f5f5f5] px-4 text-xs font-semibold text-black transition hover:bg-white"
          >
            <Radio size={13} />
            Go Live
          </button>
        }
      />

      {loading && (
        <div className="space-y-6" aria-label="Loading live streams">
          <div className="aspect-[21/9] min-h-[300px] animate-pulse rounded-3xl bg-white/[.045]" />
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
            onClick={() => void load()}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#f5f5f5] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white"
          >
            <RefreshCw size={15} />
            Try Again
          </button>
        </div>
      )}

      {!loading && !loadError && streams.length === 0 && (
        <div className="rounded-3xl border border-white/[.08] bg-[#101010] px-6 py-16 text-center">
          <Users className="mx-auto text-[#8a8a8a]" />
          <h2 className="mt-4 text-lg font-semibold">No one is live right now</h2>
          <p className="mt-2 text-sm text-[#666]">Be the first to go live and share with the VANTA community.</p>
          <button
            type="button"
            onClick={() => router.push('/live/studio')}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#f5f5f5] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white"
          >
            <Radio size={15} />
            Go Live
          </button>
        </div>
      )}

      {!loading && !loadError && streams.length > 0 && (
        <div className="space-y-8">
          <section aria-label="Featured stream">
            <LiveFeaturedStream stream={featured} />
          </section>

          {grid.length > 0 && (
            <section aria-label="All live streams">
              <div className="mb-4 flex items-center gap-2">
                <Video size={15} className="text-[#8a8a8a]" />
                <h2 className="text-base font-bold text-white">Live Now</h2>
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

