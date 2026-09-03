'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import {
  AtSign,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Gift,
  Heart,
  Loader2,
  MessageCircle,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useAuth } from '@/context/AuthContext';
import { useNotifications, type VantaNotification } from '@/context/NotificationContext';
import { apiGet, apiPatch } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { cn } from '@/lib/utils';

type NotificationResponse = {
  items: VantaNotification[];
  nextCursor?: string;
  unreadCount: number;
};

type Filter = { id: string; label: string; types?: string[] };

const filters: Filter[] = [
  { id: 'all', label: 'All' },
  { id: 'likes', label: 'Likes', types: ['like'] },
  { id: 'comments', label: 'Comments', types: ['comment'] },
  { id: 'follows', label: 'Follows', types: ['follow'] },
  { id: 'mentions', label: 'Mentions', types: ['mention'] },
  { id: 'live', label: 'Live', types: ['live', 'stream'] },
  { id: 'gifts', label: 'Gifts', types: ['gift', 'wallet', 'wallet_deposit', 'wallet_transfer_received', 'wallet_transfer_sent'] },
  { id: 'chat', label: 'Chat', types: ['message'] },
  { id: 'system', label: 'System', types: ['system', 'milestone'] },
];

const iconByType: Record<string, typeof Bell> = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  mention: AtSign,
  live: Radio,
  stream: Radio,
  gift: Gift,
  wallet: Gift,
  message: MessageCircle,
  system: ShieldCheck,
  milestone: ShieldCheck,
  wallet_deposit: Gift,
  wallet_transfer_received: Gift,
  wallet_transfer_sent: Gift,
};

const normalizedTypeOf = (notification: VantaNotification) => notification.type.trim().toLowerCase();

const metadataOf = (notification: VantaNotification): Record<string, any> => {
  if (!notification.data) return {};
  if (typeof notification.data === 'object') return notification.data;
  try { return JSON.parse(notification.data); } catch { return {}; }
};

const destinationOf = (notification: VantaNotification) => {
  const data = metadataOf(notification);
  const type = normalizedTypeOf(notification);
  if (typeof data.destination === 'string' && data.destination.startsWith('/')) return data.destination;
  const streamId = data.streamId || (notification.entityType === 'live' ? notification.entityId : null);
  if (streamId) return `/live/${streamId}`;
  const conversationId = data.conversationId || (notification.entityType === 'conversation' ? notification.entityId : null);
  if (conversationId) return `/chat/${conversationId}`;
  if (data.groupId) return `/chat/${data.groupId}`;
  if (data.channelId) return `/chat/${data.channelId}`;
  const postId = data.postId || (notification.entityType === 'post' ? notification.entityId : null);
  if (postId) return `/home?post=${postId}${data.commentId ? `&comment=${data.commentId}` : ''}`;
  if (data.reelId || notification.entityType === 'reel') return `/reels?reel=${data.reelId || notification.entityId}`;
  if (data.transactionId || type === 'wallet' || type.startsWith('wallet_')) return '/balance/transactions';
  const actor = notification.actor?.username || notification.actorId || data.actorId || data.followerId;
  if (actor) return `/profile/${actor}`;
  return null;
};

const localTime = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 45) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (seconds < 7 * 86400) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
};

function Skeletons() {
  return <div aria-label="Loading notifications" className="divide-y divide-white/[0.06]">{[0, 1, 2, 3, 4].map(item => <div key={item} className="flex min-h-20 items-center gap-3 px-4 py-3"><div className="h-11 w-11 animate-pulse rounded-full bg-white/[0.07]" /><div className="flex-1 space-y-2"><div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.07]" /><div className="h-3 w-24 animate-pulse rounded bg-white/[0.04]" /></div></div>)}</div>;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { token } = useAuth();
  const { latestNotification, notificationRevision, setAuthoritativeUnreadCount, decrementUnreadCount, clearUnreadCount } = useNotifications();
  const [items, setItems] = useState<VantaNotification[]>([]);
  const [filterId, setFilterId] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState(false);

  const activeFilter = useMemo(() => filters.find(item => item.id === filterId) ?? filters[0], [filterId]);

  const requestPath = useCallback((cursor?: string) => {
    const params = new URLSearchParams({ limit: '25' });
    if (cursor) params.set('cursor', cursor);
    if (unreadOnly) params.set('unread', 'true');
    if (activeFilter.types) params.set('types', activeFilter.types.join(','));
    return `/api/notifications?${params}`;
  }, [activeFilter, unreadOnly]);

  const load = useCallback(async (cursor?: string, quiet = false) => {
    if (!token) return;
    cursor ? setLoadingMore(true) : !quiet && setLoading(true);
    setError(false);
    try {
      const response = await apiGet<NotificationResponse>(requestPath(cursor), token, { skipCache: true });
      const received = Array.isArray(response.items) ? response.items : [];
      setItems(current => cursor ? [...current, ...received.filter(item => !current.some(existing => existing.id === item.id))] : received);
      setNextCursor(response.nextCursor);
      setAuthoritativeUnreadCount(response.unreadCount);
    } catch {
      if (!quiet) setError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [requestPath, setAuthoritativeUnreadCount, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (latestNotification) void load(undefined, true); }, [latestNotification, load]);
  useEffect(() => { if (notificationRevision) void load(undefined, true); }, [notificationRevision, load]);

  const markRead = async (notification: VantaNotification) => {
    if (!token || notification.read) return;
    setItems(current => current.map(item => item.id === notification.id ? { ...item, read: true, readAt: new Date().toISOString() } : item));
    decrementUnreadCount();
    try {
      const response = await apiPatch<{ unreadCount: number }>(`/api/notifications/${notification.id}/read`, {}, token);
      setAuthoritativeUnreadCount(response.unreadCount);
      if (unreadOnly) setItems(current => current.filter(item => item.id !== notification.id));
    } catch {
      setItems(current => current.map(item => item.id === notification.id ? notification : item));
      void load(undefined, true);
    }
  };

  const openNotification = async (notification: VantaNotification) => {
    await markRead(notification);
    const destination = destinationOf(notification);
    if (destination) router.push(destination);
  };

  const markAllRead = async () => {
    if (!token || markingAll) return;
    const snapshot = items;
    setMarkingAll(true);
    setItems(current => unreadOnly ? [] : current.map(item => ({ ...item, read: true, readAt: new Date().toISOString() })));
    clearUnreadCount();
    try {
      const response = await apiPatch<{ unreadCount: number }>('/api/notifications/read-all', {}, token);
      setAuthoritativeUnreadCount(response.unreadCount);
    } catch {
      setItems(snapshot);
      void load(undefined, true);
    } finally { setMarkingAll(false); }
  };

  const visibleUnread = items.some(item => !item.read);

  return (
    <main className="mx-auto w-full max-w-[480px] pb-24 text-[var(--vanta-white)]">
      <PageHeader
        title="Notifications"
        back
        sticky
        actions={
          <>
            {visibleUnread && <button onClick={markAllRead} disabled={markingAll} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#C8C8CC] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50" aria-label="Mark all notifications as read">{markingAll ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}</button>}
            <button onClick={() => router.push('/settings/notifications')} className="flex h-10 w-10 items-center justify-center rounded-lg text-[#C8C8CC] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label="Notification settings"><Settings size={19} /></button>
          </>
        }
      />
      <div className="mt-2 flex items-end justify-between gap-4 border-b border-white/[0.06]">
          <div className="flex min-w-0 gap-5 overflow-x-auto" role="tablist" aria-label="Notification categories">{filters.map(filter => <button key={filter.id} role="tab" aria-selected={filterId === filter.id} onClick={() => setFilterId(filter.id)} className={cn('relative shrink-0 pb-3 text-xs font-medium transition focus-visible:outline-none focus-visible:text-white', filterId === filter.id ? 'text-white after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#b8b8b8]' : 'text-[#666] hover:text-[#b8b8b8]')}>{filter.label}</button>)}</div>
          <div className="mb-2 flex shrink-0 rounded-md border border-white/[0.08] bg-[#101010] p-0.5" aria-label="Read status filter">{[false, true].map(value => <button key={String(value)} onClick={() => setUnreadOnly(value)} className={cn('rounded px-2.5 py-1.5 text-[11px] transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50', unreadOnly === value ? 'bg-[#1c1c1c] text-white' : 'text-[#666] hover:text-[#b8b8b8]')}>{value ? 'Unread' : 'All'}</button>)}</div>
        </div>

      <section className="overflow-hidden border-x border-b border-white/[0.06] bg-[#080808] " aria-live="polite">
        {loading ? <Skeletons /> : error ? <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><CircleAlert size={28} className="text-[#b8b8b8]" /><h2 className="mt-4 text-base font-semibold text-white">Couldn&apos;t load your notifications.</h2><button onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-md border border-white/[0.12] bg-[#161616] px-4 py-2.5 text-sm text-white hover:bg-[#1c1c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"><RefreshCw size={15} />Try Again</button></div> : items.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.1] bg-[#101010]"><Bell size={23} className="text-[#b8b8b8]" /></div><h2 className="mt-4 text-base font-semibold text-white">You&apos;re all caught up</h2><p className="mt-1 text-sm text-[#666]">No new activity right now.</p></div> : <div className="divide-y divide-white/[0.06]">{items.map((notification, index) => {
          const normalizedType = normalizedTypeOf(notification);
          const Icon = iconByType[normalizedType] ?? Bell;
          const data = metadataOf(notification);
          const actorName = notification.actor?.fullName || notification.actor?.username;
          const destination = destinationOf(notification);
          const thumbnail = data.thumbnailUrl || data.imageUrl;
          return <motion.article key={notification.id} initial={index === 0 && latestNotification?.id === notification.id ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} className={cn('group relative flex min-h-20 items-center gap-3 px-4 py-3 transition', notification.read ? 'bg-[#080808] hover:bg-[#101010]' : 'bg-[#161616] hover:bg-[#1c1c1c]')}>
            <button onClick={() => void openNotification(notification)} className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50" aria-label={`${notification.read ? 'Read' : 'Unread'} notification: ${notification.message || notification.title || 'New notification'}${destination ? '. Open related content' : ''}`} />
            <div className="relative z-10 shrink-0 pointer-events-none"><Avatar src={notification.actor?.avatar || undefined} alt={actorName || 'VANTA'} size="md" /><span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#101010] bg-[#f5f5f5] text-black"><Icon size={10} strokeWidth={2.3} /></span></div>
            <div className="pointer-events-none relative z-10 min-w-0 flex-1"><p className="text-[13px] leading-5 text-[#b8b8b8]">{actorName && <strong className="font-semibold text-white">{actorName}{notification.actor?.verified && <VerificationBadge verified size="sm" className="ml-1 inline align-[-2px]" />} </strong>}{notification.message || notification.title || 'New notification'}</p><div className="mt-1 flex items-center gap-2"><time dateTime={notification.createdAt} className="text-[11px] text-[#666]">{localTime(notification.createdAt)}</time><span className="text-[10px] uppercase text-[#666]">{normalizedType.replaceAll('_', ' ')}</span></div></div>
            {/* Notification media may come from user-configured remote hosts. */}
            {thumbnail && <img src={resolveMediaUrl(thumbnail)} alt="Related content" className="pointer-events-none relative z-10 h-12 w-12 shrink-0 rounded object-cover" /* eslint-disable-line @next/next/no-img-element */ />}
            {!notification.read && <span className="pointer-events-none relative z-10 h-2 w-2 shrink-0 rounded-full bg-[var(--vanta-gold)]" aria-hidden="true" />}
            {destination && <ChevronRight size={15} className="pointer-events-none relative z-10 shrink-0 text-[#666]" aria-hidden="true" />}
          </motion.article>;
        })}{nextCursor && <div className="flex justify-center p-4"><button onClick={() => void load(nextCursor)} disabled={loadingMore} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/[0.1] bg-[#101010] px-4 text-xs font-medium text-[#b8b8b8] hover:bg-[#161616] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50">{loadingMore && <Loader2 size={14} className="animate-spin" />}Load more</button></div>}</div>}
      </section>
    </main>
  );
}