"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, Check, CheckCheck, Heart, MessageCircle, Radio, Gift, UserPlus, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPatch } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import type { VantaNotification } from '@/context/NotificationContext';

// ============================================================================
// CREATOR NOTIFICATIONS — real /api/notifications feed with mark-read actions.
// ============================================================================

const iconByType: Record<string, any> = {
  like: { icon: Heart, cls: 'bg-rose-500/15 text-rose-300' },
  comment: { icon: MessageCircle, cls: 'bg-sky-500/15 text-sky-300' },
  follow: { icon: UserPlus, cls: 'bg-emerald-500/15 text-emerald-300' },
  live: { icon: Radio, cls: 'bg-red-500/15 text-red-300' },
  stream: { icon: Radio, cls: 'bg-red-500/15 text-red-300' },
  gift: { icon: Gift, cls: 'bg-[#c9a227]/15 text-[#d9a83f]' },
  wallet: { icon: Gift, cls: 'bg-[#c9a227]/15 text-[#d9a83f]' },
  message: { icon: MessageCircle, cls: 'bg-sky-500/15 text-sky-300' },
  system: { icon: Bell, cls: 'bg-white/[0.06] text-white/60' },
  milestone: { icon: Bell, cls: 'bg-white/[0.06] text-white/60' },
};

export default function CreatorNotificationsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<VantaNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: VantaNotification[] }>(`/api/notifications?limit=50${unreadOnly ? '&unread=true' : ''}`, token, { skipCache: true });
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [token, unreadOnly]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const markRead = async (id: string) => {
    if (!token) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try { await apiPatch(`/api/notifications/${encodeURIComponent(id)}/read`, {}, token); }
    catch { /* Non-fatal: list reverts on next reload */ }
  };

  const markAllRead = async () => {
    if (!token || items.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try { await apiPatch('/api/notifications/read-all', {}, token); }
    catch { /* Non-fatal */ }
  };

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="skeleton h-12 w-48 rounded-2xl" />
        {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load notifications</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const unreadCount = items.filter((n) => !n.read).length;
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] p-1">
          <button
            onClick={() => setUnreadOnly(false)}
            className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition-colors', !unreadOnly ? 'bg-[#c9a227] text-black' : 'text-white/40 hover:text-white')}
          >
            All
          </button>
          <button
            onClick={() => setUnreadOnly(true)}
            className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition-colors', unreadOnly ? 'bg-[#c9a227] text-black' : 'text-white/40 hover:text-white')}
          >
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/[0.04] hover:text-white">
            <CheckCheck size={13} /> Mark all read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Bell size={28} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">{unreadOnly ? 'No unread notifications' : 'No notifications yet'}</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-white/30">Likes, follows, gifts and live activity will show up here.</p>
        </section>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const iconMeta = iconByType[n.type?.trim().toLowerCase()] || { icon: Bell, cls: 'bg-white/[0.06] text-white/60' };
            const Icon = iconMeta.icon;
            return (
              <div
                key={n.id}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                  n.read ? 'border-white/[0.05] bg-white/[0.01]' : 'border-[var(--active-border)]/30 bg-white/[0.03]',
                )}
              >
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', iconMeta.cls)}><Icon size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white/85">{n.message || n.title || 'Notification'}</p>
                  <p className="mt-0.5 text-[10px] text-white/35">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                {!n.read && (
                  <button onClick={() => markRead(n.id)} aria-label="Mark as read" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white">
                    <Check size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}