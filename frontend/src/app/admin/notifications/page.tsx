'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Bell, RefreshCw, Clock, AlertTriangle, ChevronLeft, ChevronRight,
  MailOpen, Mail, Send,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getNotificationCenter } from '@/lib/adminApi';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const [stats, setStats] = useState<any>(null);
  const [byType, setByType] = useState<{ type: string; count: number }[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
      if (!token) return;
      const data = await getNotificationCenter(token, { page, limit: 40 });
      setStats(data.stats || {});
      setByType(data.byType || []);
      setNotifications(data.notifications || []);
      setTotalCount(data.totalCount || 0);
      setPages(Math.max(1, Math.ceil((data.totalCount || 0) / 40)));
    } catch (err: any) {
      setError(err?.message || 'Failed to load notification center.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Community</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Notification Center</h1>
          <p className="text-sm text-gray-400 mt-1">In-app notification volume and recent messages.</p>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Notifications" value={(stats?.total ?? 0).toLocaleString()} icon={<Bell size={16} />} cls="bg-[#d9a83f]/15 text-[#d9a83f]" />
        <StatCard label="Unread" value={(stats?.unread ?? 0).toLocaleString()} icon={<Mail size={16} />} cls="bg-sky-500/15 text-sky-400" />
        <StatCard label="Sent Today" value={(stats?.sentToday ?? 0).toLocaleString()} icon={<Send size={16} />} cls="bg-emerald-500/15 text-emerald-400" />
        <StatCard label="Delivered (tracked)" value={(stats?.delivered ?? 0).toLocaleString()} icon={<MailOpen size={16} />} cls="bg-violet-500/15 text-violet-400" />
      </div>
{/* By type */}
      {byType.length > 0 && (
        <GlassCard>
          <h3 className="text-sm font-bold text-white mb-3">By Type</h3>
          <div className="flex flex-wrap gap-2">
            {byType.map((t) => (
              <span key={t.type} className={cn('text-[11px] px-2.5 py-1 rounded-full bg-white/5 text-gray-300')}>
                {t.type.replace(/_/g, ' ')} · {t.count.toLocaleString()}
              </span>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Recent notifications */}
      <GlassCard>
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
            <p className="text-sm text-gray-400">{error}</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center">
            <Bell size={34} className="mx-auto mb-3 text-white/15" />
            <p className="text-sm text-white/50">No notifications yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', n.read ? 'bg-white/5 text-gray-500' : 'bg-[#d9a83f]/15 text-[#d9a83f]')}>
                  <Bell size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{n.title}</p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{n.type.replace(/_/g, ' ')}</span>
                    {!n.read && <span className="text-[9px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400">unread</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>
                  <p className="text-[10px] text-gray-600 mt-1 flex items-center gap-1"><Clock size={10} />@{n.username} · {new Date(n.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Pagination */}
      {pages > 1 && !loading && !error && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} icon={<ChevronLeft size={14} />} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="text-xs text-gray-400 px-2">{page} / {pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next<ChevronRight size={14} /></Button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, cls }: { label: string; value: string; icon: any; cls: string }) {
  return (
    <div className="glass rounded-2xl border border-white/[0.06] p-4">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2', cls)}>{icon}</div>
      <p className="text-xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}