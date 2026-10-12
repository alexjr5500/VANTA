"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, Users, Gift, Clock, ArrowUpRight, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { GO_LIVE_ROUTE } from '@/lib/goLiveEntry';
import MetricTile from '@/components/console/MetricTile';
import ConsolePanel from '@/components/console/Panel';
import StatusBadge from '@/components/console/StatusBadge';
import { ConsoleErrorState, ConsoleEmptyState } from '@/components/console/States';
import { fmtCompact, fmtDateTime, fmtDuration } from '@/components/console/format';

// ============================================================================
// CREATOR LIVE STUDIO — real host stream stats from /api/live/stats and the
// existing Go Live flow (/live/go-live, resolved via lib/goLiveEntry.ts).
// No fabricated stream data; status labels reflect only what the backend
// reports (active flag / status field).
// ============================================================================

interface HostStats {
  totalStreams: number;
  totalViewers: number;
  totalGifts: number;
  totalDuration: number;
}

export default function CreatorLivePage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<HostStats | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) { setLoading(false); return; }
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
      <div className="space-y-6" aria-busy="true">
        <div className="vc-panel h-32 animate-pulse" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded bg-white/[0.04]" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return <ConsoleErrorState title="Couldn't load Live Studio" message={error} onRetry={() => void fetchData()} />;
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Go live CTA */}
      <section className="vc-panel flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--vc-radius)] bg-console-danger-soft text-console-danger">
            <Radio size={20} aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-console-text">Live Studio</h2>
            <p className="mt-0.5 text-sm text-console-text-3">
              Configure your camera and microphone, then stream live to your audience.
            </p>
          </div>
        </div>
        <Link
          href={GO_LIVE_ROUTE}
          className="vc-focus inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--vc-radius)] bg-console-gold px-5 text-sm font-semibold text-console-gold-fg transition-colors hover:bg-console-gold-hover"
        >
          <Radio size={15} aria-hidden /> Go Live <ArrowUpRight size={13} aria-hidden />
        </Link>
      </section>

      {/* Host stats */}
      <section aria-label="Host statistics">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          <MetricTile label="Total streams" value={fmtCompact(stats?.totalStreams ?? 0)} icon={<Radio size={13} />} accent />
          <MetricTile label="Total viewers" value={fmtCompact(stats?.totalViewers ?? 0)} icon={<Users size={13} />} />
          <MetricTile label="Gifts received" value={fmtCompact(stats?.totalGifts ?? 0)} icon={<Gift size={13} />} />
          <MetricTile label="Stream time" value={fmtDuration(stats?.totalDuration ?? 0)} icon={<Clock size={13} />} />
        </div>
        <p className="mt-3 text-[11px] text-console-text-3">
          Aggregated by the VANTA live service across your hosted sessions.
        </p>
      </section>


      {/* Recent streams */}
      <ConsolePanel title="Recent streams" description="Your latest live sessions" bodyClassName="p-0">
        {history.length === 0 ? (
          <ConsoleEmptyState
            icon={<Radio size={19} />}
            title="No streams yet"
            description="Sessions you host will appear here once they end, with their real status."
            action={
              <Link href={GO_LIVE_ROUTE} className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] bg-console-gold px-4 text-xs font-semibold text-console-gold-fg hover:bg-console-gold-hover">
                Start your first stream
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-console-border">
            {history.slice(0, 8).map((stream: any) => (
              <li key={stream.id}>
                <Link
                  href={`/live/${stream.id}`}
                  className="vc-focus flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-console-text">{stream.title || 'Untitled stream'}</p>
                    <p className="mt-0.5 text-[11px] text-console-text-3">{fmtDateTime(stream.startedAt || stream.createdAt)}</p>
                  </div>
                  {stream.active ? (
                    <StatusBadge tone="danger" label="Live" pulse />
                  ) : (
                    <StatusBadge tone="neutral" label={stream.status || 'Ended'} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-console-text-3">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        Stream status is reported live by the VANTA streaming service. Camera and microphone
        permissions are requested when you open the Go Live screen.
      </p>
    </div>
  );
}
