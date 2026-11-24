'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  AtSign,
  Bell,
  Check,
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
import { previewExcerpt } from '@/lib/linkify';

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
  { id: 'live', label: 'Live', types: ['live', 'stream'] },
  { id: 'gifts', label: 'Gifts', types: ['gift', 'wallet', 'wallet_deposit', 'wallet_transfer_received', 'wallet_transfer_sent'] },
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
const CHAT_NOTIFICATION_TYPES = new Set(['message', 'group', 'channel', 'direct_message', 'chat_message']);
const isChatNotification = (notification: VantaNotification) => {
  const type = normalizedTypeOf(notification);
  const data = metadataOf(notification);
  return CHAT_NOTIFICATION_TYPES.has(type) || (type === 'mention' && Boolean(data.conversationId || data.groupId || data.channelId || notification.entityType === 'conversation'));
};

const metadataOf = (notification: VantaNotification): Record<string, any> => {
  if (!notification.data) return {};
  if (typeof notification.data === 'object') return notification.data;
  try { const value = JSON.parse(notification.data); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
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

const activityTabs = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'verified', label: 'Verified' },
] as const;

type ActivityTab = typeof activityTabs[number]['id'];

function activityMessage(notification: VantaNotification, actorName?: string | null) {
  const message = notification.message || notification.title || 'New notification';
  if (!actorName) return message;
  const data = metadataOf(notification);
  const names = [actorName, notification.actor?.username, data.followerUsername, data.likerUsername, data.commenterUsername, data.senderUsername]
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    .flatMap(name => [name, '@' + name]).sort((a, b) => b.length - a.length);
  const prefix = names.find(name => message.toLowerCase().startsWith(name.toLowerCase() + ' '));
  return prefix ? message.slice(prefix.length).trimStart() : message;
}

function activityColor(type: string) {
  if (type === 'like') return 'text-rose-500 fill-current';
  if (type === 'follow') return 'text-sky-400';
  if (type === 'comment' || type === 'mention') return 'text-[#d6a83f]';
  if (type === 'gift' || type.startsWith('wallet')) return 'text-[#d6a83f]';
  return 'text-white/55';
}

function RelatedPreview({ notification, token }: { notification: VantaNotification; token: string | null }) {
  const data = metadataOf(notification);
  const type = normalizedTypeOf(notification);
  const provided = [data.postContent, data.postText, data.replyContent, data.commentContent, data.contentPreview]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const postId = typeof data.postId === 'string' ? data.postId : notification.entityType === 'post' ? notification.entityId : null;
  const lookupId = !provided && type === 'like' ? postId : null;
  const [preview, setPreview] = useState<{ id: string; token: string; text: string } | null>(null);
  useEffect(() => {
    if (!lookupId || !token) return;
    let current = true;
    // Use the same authenticated, visibility-checked endpoint as Post Detail.
    void apiGet<{ content?: string | null }>(`/api/feed/${encodeURIComponent(lookupId)}`, token, { skipCache: true })
      .then(post => {
        if (current && typeof post.content === 'string') setPreview({ id: lookupId, token, text: post.content });
      }).catch(() => { /* Deleted or inaccessible content has no preview. */ });
    return () => { current = false; };
  }, [lookupId, token]);
  const text = provided || (lookupId && preview?.id === lookupId && preview.token === token ? preview.text : '');
  if (!text?.trim()) return null;
  return <p className="mt-1 line-clamp-3 break-words text-sm leading-5 text-white/50">{previewExcerpt(text)}</p>;
}

function Skeletons() {
  return <div aria-label="Loading notifications">{[0, 1, 2, 3, 4].map(item => <div key={item} className="flex gap-3 border-b border-white/[0.07] px-4 py-4"><div className="mt-2 h-6 w-6 animate-pulse rounded bg-white/[0.07]" /><div className="min-w-0 flex-1 space-y-2"><div className="h-9 w-9 animate-pulse rounded-full bg-white/[0.07]" /><div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.07]" /><div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" /></div></div>)}</div>;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { latestNotification, notificationRevision, setAuthoritativeUnreadCount, decrementUnreadCount, clearUnreadCount } = useNotifications();
  const [items, setItems] = useState<VantaNotification[]>([]);
  const [filterId, setFilterId] = useState('all');
  const [activityTab, setActivityTab] = useState<ActivityTab>('all');
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
    if (activityTab === 'mentions') params.set('types', 'mention');
    else if (activeFilter.types) params.set('types', activeFilter.types.join(','));
    return `/api/notifications?${params}`;
  }, [activeFilter, activityTab, unreadOnly]);

  const load = useCallback(async (cursor?: string, quiet = false) => {
    if (!token) return;
    cursor ? setLoadingMore(true) : !quiet && setLoading(true);
    setError(false);
    try {
      const response = await apiGet<NotificationResponse>(requestPath(cursor), token, { skipCache: true });
      // Direct and group chat messages belong in Chats, not the activity feed.
      const received = Array.isArray(response.items) ? response.items.filter(item => !isChatNotification(item)) : [];
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

  const visibleItems = activityTab === 'verified' ? items.filter(item => item.actor?.verified && item.actor.verificationType) : items;
  const visibleUnread = items.some(item => !item.read);

  return (
    <main className="-mx-4 flex min-h-[100dvh] w-[calc(100%+2rem)] flex-col bg-[var(--background)] pb-[env(safe-area-inset-bottom)] text-[var(--vanta-white)]">
      <header className="sticky top-0 z-30 shrink-0 bg-[var(--header-surface)]">
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-3">
          <div className="flex min-w-0 items-center gap-1">
            <button type="button" onClick={() => router.back()} aria-label="Go back" className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/50"><ArrowLeft size={19} /></button>
            <button type="button" onClick={() => router.push('/profile')} aria-label="Your profile" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-white/50"><Avatar src={user?.avatar ?? user?.avatarUrl} alt="" size="sm" /></button>
          </div>
          <h1 className="text-base font-bold text-white">Notifications</h1>
          <button onClick={() => router.push('/settings/notifications')} className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-white/80 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/50" aria-label="Notification settings"><Settings size={23} /></button>
        </div>
        <div className="grid grid-cols-3 border-b border-white/[0.08]" role="tablist" aria-label="Notification activity">
          {activityTabs.map(tab => <button key={tab.id} role="tab" aria-selected={activityTab === tab.id} onClick={() => { setActivityTab(tab.id); setFilterId('all'); }} className={cn('relative flex min-h-12 items-center justify-center gap-1.5 px-1 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50', activityTab === tab.id ? 'text-[#d6a83f] after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#d6a83f]' : 'text-white/50 hover:text-white')}>
            {tab.id === 'all' && <Bell size={17} aria-hidden="true" />}{tab.label}
          </button>)}
        </div>
        <div className="flex min-h-11 items-center gap-2 border-b border-white/[0.07] px-4">
          {activityTab !== 'mentions' && <select aria-label="Notification category" value={filterId} onChange={event => setFilterId(event.target.value)} className="min-w-0 max-w-[42%] rounded-md bg-[var(--surface)] px-2 py-1.5 text-xs text-white/80 focus-visible:ring-2 focus-visible:ring-[#d6a83f]">{filters.map(filter => <option key={filter.id} value={filter.id}>{filter.id === 'all' ? 'All activity' : filter.label}</option>)}</select>}
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(value => !value)} className={cn('shrink-0 rounded-md px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-[#d6a83f]', unreadOnly ? 'bg-[var(--surface)] text-[#d6a83f]' : 'text-white/55')}>Unread only</button>
          {visibleUnread && <button type="button" onClick={() => void markAllRead()} disabled={markingAll} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-2 text-xs text-white/65 focus-visible:ring-2 focus-visible:ring-[#d6a83f] disabled:opacity-50" aria-label="Mark all notifications as read">{markingAll ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}<span>Mark all read</span></button>}
        </div>
      </header>

      <section className="bg-[var(--background)]" aria-live="polite">
        {loading ? <Skeletons /> : error ? <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><CircleAlert size={28} className="text-white/65" /><h2 className="mt-4 text-base font-semibold text-white">Couldn&apos;t load your notifications.</h2><button onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-md border border-white/[0.12] bg-[var(--surface)] px-4 py-2.5 text-sm text-white focus-visible:ring-2 focus-visible:ring-white/50"><RefreshCw size={15} />Try Again</button></div> : <>
          {visibleItems.length === 0 && <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center"><Bell size={26} className="text-white/45" /><h2 className="mt-3 text-base font-semibold text-white">{nextCursor ? 'No matching activity on this page' : 'You\u2019re all caught up'}</h2><p className="mt-1 text-sm text-white/50">{nextCursor ? 'Load more to check older notifications.' : 'No matching notifications right now.'}</p></div>}
          {visibleItems.map((notification, index) => {
            const normalizedType = normalizedTypeOf(notification);
            const Icon = iconByType[normalizedType] ?? Bell;
            const data = metadataOf(notification);
            const actorName = notification.actor?.fullName || notification.actor?.username;
            const destination = destinationOf(notification);
            const thumbnail = [data.thumbnailUrl, data.imageUrl].find(value => typeof value === 'string' && value.trim());
            const message = activityMessage(notification, actorName);
            return <motion.article key={notification.id} initial={index === 0 && latestNotification?.id === notification.id ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} className={cn('relative border-b border-white/[0.08] transition-colors hover:bg-[var(--surface)]', !notification.read && 'bg-white/[0.025]')}>
              <button type="button" onClick={() => void openNotification(notification)} className="flex w-full items-start gap-3 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d6a83f]" aria-label={`${notification.read ? 'Read' : 'Unread'} notification: ${actorName ? actorName + ' ' : ''}${message}${destination ? '. Open related content' : ''}`}>
                <span className={cn('mt-1 flex w-7 shrink-0 justify-center', activityColor(normalizedType))}><Icon size={26} strokeWidth={2.2} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  {notification.actor && <div className="mb-1.5"><Avatar src={notification.actor.avatar} alt={actorName || 'User'} size="md" /></div>}
                  <p className="break-words text-sm leading-5 text-white/85">
                    {actorName && <><strong className="font-bold text-white">{actorName}</strong>{notification.actor?.verified && notification.actor.verificationType && <span className="ml-1 inline-flex align-middle"><VerificationBadge verified type={notification.actor.verificationType} size="sm" /></span>}{' '}</>}
                    {message}{' '}<span className="whitespace-nowrap text-white/45">· <time dateTime={notification.createdAt}>{localTime(notification.createdAt)}</time></span>
                  </p>
                  <RelatedPreview notification={notification} token={token} />
                  {thumbnail && <img src={resolveMediaUrl(thumbnail)} alt="Related content" className="mt-2 max-h-20 max-w-32 rounded object-cover" /* eslint-disable-line @next/next/no-img-element */ />}
                </div>
                {!notification.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#d6a83f]" aria-hidden="true" />}
              </button>
            </motion.article>;
          })}
          {nextCursor && <div className="flex justify-center p-4"><button onClick={() => void load(nextCursor)} disabled={loadingMore} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/[0.1] bg-[var(--surface)] px-4 text-xs font-medium text-white/70 focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50">{loadingMore && <Loader2 size={14} className="animate-spin" />}Load more</button></div>}
        </>}
      </section>
    </main>
  );
}
