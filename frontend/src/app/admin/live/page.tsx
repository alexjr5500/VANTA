'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Radio, Users, RefreshCw, XCircle, Ban, AlertTriangle, Loader2,
  Clock, MessageSquare, Gift,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getLiveStreams, endLiveStream, suspendLiveStream } from '@/lib/adminApi';
import { cn } from '@/lib/utils';

interface StreamRow {
  id: string;
  title: string;
  description?: string | null;
  viewerCount: number;
  active: boolean;
  allowGifts: boolean;
  allowPK: boolean;
  createdAt: string;
  host: { id: string; username: string; avatar?: string | null };
  category?: { name: string } | null;
  _count?: { chatMessages?: number; giftEvents?: number };
}

export default function LivePage() {
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
      if (!token) return;
      const result: any = await getLiveStreams(token, { limit: 50 });
      const body = Array.isArray(result) ? { streams: result, total: result.length } : result;
      setStreams(body.streams || []);
      setTotal(body.total || (body.streams || []).length);
    } catch (err: any) {
      setError(err?.message || 'Failed to load live streams.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const runAction = async (stream: StreamRow, action: 'end' | 'suspend') => {
    const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
    if (!token || busyId) return;
    const ok = window.confirm(action === 'end' ? `End the stream "${stream.title}"?` : `Suspend the stream "${stream.title}"? The host will be disconnected.`);
    if (!ok) return;
    setBusyId(stream.id);
    setNotice(null);
    try {
      if (action === 'end') await endLiveStream(token, stream.id);
      else await suspendLiveStream(token, stream.id, 'Suspended by admin');
      setNotice(`Stream ${action}ed.`);
      await fetchData();
    } catch (err: any) {
      setNotice(`Action failed: ${err?.message || 'please retry'}`);
    } finally {
      setBusyId(null);
    }
  };

  const liveCount = streams.filter((s) => s.active).length;
  const totalViewers = streams.reduce((sum, s) => sum + s.viewerCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Radio size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Live</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Live Streams</h1>
          <p className="text-sm text-gray-400 mt-1">Monitor and moderate active broadcasts.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-full">
            <Radio size={12} /> {liveCount} live · {totalViewers} viewers
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
        </div>
      </div>

      {notice && (
        <div className={cn('glass rounded-xl px-4 py-2.5 text-sm border', notice.startsWith('Action failed') ? 'border-red-500/20 text-red-300' : 'border-emerald-500/20 text-emerald-300')}>
          {notice}
        </div>
      )}
<GlassCard>
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
            <p className="text-sm text-gray-400">{error}</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
          </div>
        ) : streams.length === 0 ? (
          <div className="py-12 text-center">
            <Radio size={34} className="mx-auto mb-3 text-white/15" />
            <p className="text-sm text-white/50">No live streams found.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {streams.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-gray-300">
                  {s.active ? <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60"></span><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span></span> : <Radio size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{s.title}</p>
                    {s.category?.name && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{s.category.name}</span>}
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full', s.active ? 'bg-red-500/15 text-red-400' : 'bg-gray-500/15 text-gray-400')}>
                      {s.active ? 'LIVE' : 'Ended'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">@{s.host?.username || 'unknown'}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><Users size={10} />{s.viewerCount.toLocaleString()} viewers</span>
                    <span className="flex items-center gap-1"><MessageSquare size={10} />{s._count?.chatMessages ?? 0} messages</span>
                    <span className="flex items-center gap-1"><Gift size={10} />{s._count?.giftEvents ?? 0} gifts</span>
                    <span className="flex items-center gap-1"><Clock size={10} />{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {s.active && (
                    <>
                      <Button variant="ghost" size="sm" className="!px-2.5" icon={<Ban size={13} />} disabled={busyId === s.id} onClick={() => void runAction(s, 'suspend')}>Suspend</Button>
                      <Button variant="danger" size="sm" className="!px-2.5" icon={<XCircle size={13} />} disabled={busyId === s.id} onClick={() => void runAction(s, 'end')}>End</Button>
                    </>
                  )}
                  {busyId === s.id && <Loader2 size={14} className="animate-spin text-gray-500" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}