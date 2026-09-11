'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell, Bookmark, ChevronRight, Eye, Gift, Heart, Image as ImageIcon, Loader2,
  MessageCircle, MoreHorizontal, Plus, Radio, RefreshCw, Search, Share2,
  Sparkles, Trash2, Users, WifiOff, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { createSocket } from '@/lib/socketClient';
import { useToast } from '@/components/ui/Toast';
import Avatar from '@/components/ui/Avatar';
import StoryCircle from '@/components/ui/StoryCircle';
import VerificationBadge from '@/components/ui/VerificationBadge';
import VantaLogo from '@/components/ui/VantaLogo';
import GlobalSearch from '@/components/search/GlobalSearch';
import CommentPanel from '@/components/social/CommentPanel';
import PostMedia from '@/components/social/PostMedia';
import GiftPicker, { GiftCatalogItem } from '@/components/social/GiftPicker';
import GiftPickerBoundary from '@/components/social/GiftPickerBoundary';
import { normalizeGiftCatalog } from '@/lib/giftCatalog';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { cleanId, isVideoItem, actionEndpointFor, detailPathFor } from '@/lib/feedIdentity';
import { useContentCreation } from '@/components/create/ContentCreationContext';

type Item = Record<string, any>;
type FeedTab = 'forYou' | 'following' | 'latest' | 'reels';

const formatCount = (value = 0) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);
const relativeTime = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};
const unwrap = (data: any): Item[] => Array.isArray(data) ? data : data?.items || data?.data || data?.streams || data?.stories || data?.gifts || [];
const getAuthor = (item: Item) => item.author || item.user || item.creator || item.host || {};
const mediaUrl = (item: Item) => resolveMediaUrl(item.media || item.mediaUrl || item.image || item.thumbnail || item.coverUrl || item.playbackUrl);

/** Compact gold unread badge for shell header icons. */
function HeaderBadge({ value }: { value: number }) {
  if (!value || value <= 0) return null;
  return <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#c9a227] px-1 text-[9px] font-bold leading-none text-black ring-2 ring-[#050505]">{value > 99 ? '99+' : value}</span>;
}

/**
 * Normalize the `/api/stories` response into per-user groups. A user must have
 * exactly one story tray entry no matter how many stories they posted, so we
 * key by USER/OWNER — never by story id. Also tolerates the legacy flat shape.
 */
function buildStoryGroups(raw: Item[]): Array<{ user: Item; stories: Item[]; hasUnviewed: boolean }> {
  const groups: Array<{ user: Item; stories: Item[]; hasUnviewed: boolean }> = [];
  const byUser = new Map<string, { user: Item; stories: Item[]; hasUnviewed: boolean }>();
  for (const entry of raw || []) {
    if (Array.isArray(entry?.stories)) {
      const user = entry.user || entry.author || {};
      const id = user.id || entry.userId || entry.ownerId;
      const key = String(id || JSON.stringify(user));
      let group = byUser.get(key);
      if (!group) { group = { user, stories: [], hasUnviewed: Boolean(entry.hasUnviewed) }; byUser.set(key, group); groups.push(group); }
      for (const story of entry.stories || []) {
        group.stories.push(story);
        if (story && !story.viewed) group.hasUnviewed = true;
      }
    } else if (entry?.id && entry?.mediaUrl) {
      const user = entry.user || entry.author || {};
      const id = user.id || entry.userId;
      const key = String(id || entry.id);
      let group = byUser.get(key);
      if (!group) { group = { user, stories: [], hasUnviewed: Boolean(!entry.viewed) }; byUser.set(key, group); groups.push(group); }
      group.stories.push(entry);
      if (entry && !entry.viewed) group.hasUnviewed = true;
    }
  }
  return groups;
}

function FeedSkeleton() {
  return <div className="divide-y divide-white/[.06]" aria-label="Loading feed">{[1, 2, 3].map(index => <div key={index} className="px-1 py-4"><div className="flex items-center gap-3"><div className="h-11 w-11 animate-pulse rounded-full bg-white/[.06]"/><div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-white/[.06]"/><div className="h-2.5 w-20 animate-pulse rounded bg-white/[.04]"/></div></div><div className="mt-4 aspect-[4/3] animate-pulse rounded-lg bg-white/[.035]"/></div>)}</div>;
}

function PostCard({ item, currentUserId, onLike, onSave, onComment, onShare, onGift, onFollow, onMore }: any) {
  const router = useRouter();
  const creator = getAuthor(item);
  const isOwn = creator.id === currentUserId;
  const source = mediaUrl(item);
  const profilePath = creator.username ? `/profile/${creator.username}` : '/profile';
  const actionClass = 'flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-xs text-[#8a8a8a] transition hover:bg-white/[.045] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

  return <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24 }} className="flex flex-col pt-3 pb-1">
    <header className="flex items-start gap-3 px-4 pb-3 pt-2">
      <button type="button" onClick={() => router.push(profilePath)} aria-label={`Open ${creator.username || 'creator'} profile`}><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="md"/></button>
      <div className="min-w-0 flex-1"><button type="button" onClick={() => router.push(profilePath)} className="flex max-w-full flex-wrap items-center gap-x-1.5 text-left"><span className="truncate text-sm font-semibold text-[#f5f5f5]">{creator.fullName || creator.username || 'VANTA creator'}</span>{creator.verified && <VerificationBadge type="BLUE" size="sm" />}<span className="truncate text-xs text-[#666]">@{creator.username}</span><span className="text-xs text-[#666]">· {relativeTime(item.createdAt)}</span></button>{item.location && <p className="mt-0.5 truncate text-[11px] text-[#666]">{item.location}</p>}</div>
      {!isOwn && <button type="button" onClick={() => onFollow(item)} className="min-h-9 rounded-lg border border-white/[.12] px-3 text-xs font-semibold text-[#d8d8d8] transition hover:bg-white hover:text-black">{item.following ? 'Following' : 'Follow'}</button>}
      <button type="button" onClick={() => onMore(item)} aria-label="More post options" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#666] transition hover:bg-white/[.05] hover:text-white"><MoreHorizontal size={19}/></button>
    </header>
    {(item.content || item.description) && <p className="mb-3 whitespace-pre-wrap px-4 text-[15px] leading-6 text-[#dedede]">{item.content || item.description}</p>}
    {item.hashtags && <p className="mb-3 px-4 text-xs text-[#c9a227]">{Array.isArray(item.hashtags) ? item.hashtags.map((tag: string) => `#${tag}`).join(' ') : item.hashtags}</p>}
    {source && <div className="border-y border-white/[.07] bg-[#080808]"><PostMedia src={source} isVideo={isVideoItem(item)} alt={item.content || `Post by ${creator.username || 'creator'}`} onDoubleClick={() => { if (!item.liked) onLike(item); }}/></div>}
    <footer className="flex items-center justify-between gap-1 px-2 py-1.5"><div className="flex min-w-0 items-center"><button type="button" onClick={() => onLike(item)} aria-label={item.liked ? 'Unlike post' : 'Like post'} aria-pressed={item.liked} className={cn(actionClass, item.liked && 'text-[#f2c75c]')}><Heart size={18} className={item.liked ? 'fill-current' : ''}/><span>{formatCount(item.likes)}</span></button><button type="button" onClick={() => onComment(item)} aria-label="Open comments" className={actionClass}><MessageCircle size={18}/><span>{formatCount(item.comments)}</span></button><button type="button" onClick={() => onShare(item)} aria-label="Share post" className={actionClass}><Share2 size={18}/><span>{formatCount(item.shares)}</span></button>{!isOwn && <button type="button" onClick={() => onGift(item)} aria-label="Send gift" className={cn(actionClass, 'hover:text-[#c9a227]')}><Gift size={18}/><span className="sr-only">Gift</span></button>}</div><button type="button" onClick={() => onSave(item)} aria-label={item.saved ? 'Remove saved post' : 'Save post'} aria-pressed={item.saved} className={cn(actionClass, item.saved && 'text-white')}><Bookmark size={18} className={item.saved ? 'fill-current' : ''}/><span className="sr-only">{item.saved ? 'Saved' : 'Save'}</span></button></footer>
  </motion.article>;
}

export default function HomePage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { unreadCount: notificationUnread } = useNotifications();
  const { chatUnreadCount: chatUnread } = useChatUnread();
  const { openPostModal, openStoryModal } = useContentCreation();
  const [tab, setTab] = useState<FeedTab>('forYou');
  const [items, setItems] = useState<Item[]>([]);
  const [live, setLive] = useState<Item[]>([]);
  const [stories, setStories] = useState<Item[]>([]);
  const [trending, setTrending] = useState<Item[]>([]);
  const [suggested, setSuggested] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [commentsFor, setCommentsFor] = useState<Item>();
  const [giftFor, setGiftFor] = useState<Item>();
  const [shareFor, setShareFor] = useState<Item>();
  const [moreFor, setMoreFor] = useState<Item>();
  const [deletePostFor, setDeletePostFor] = useState<Item>();
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftError, setGiftError] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async (reset = true, requestedCursor?: string) => {
    if (!token) return;
    reset ? setLoading(true) : setLoadingMore(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (requestedCursor) query.set('cursor', requestedCursor);
      const endpoint = tab === 'following' ? '/api/feed/following' : '/api/feed/home';
      const data = await apiGet<any>(`${endpoint}?${query}`, token, { skipCache: reset });
      const next = unwrap(data);
      setItems(previous => reset ? next : [...previous, ...next.filter(item => !previous.some(existing => existing.id === item.id))]);
      setCursor(data?.nextCursor);
      setHasMore(Boolean(data?.nextCursor));
    } catch { setError("Couldn't load your feed."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [token, tab]);

  useEffect(() => { setCursor(undefined); setHasMore(true); void fetchFeed(true); }, [fetchFeed]);
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); setOnline(navigator.onLine); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }, []);
  useEffect(() => {
    if (!token) return;
    Promise.allSettled([apiGet<any>('/api/live/discover?limit=6&sort=viewerCount', token), apiGet<any>('/api/stories', token), apiGet<any>('/api/feed/trending?limit=5', token), apiGet<any>('/api/profiles/discover?limit=5', token)]).then(([liveResult, storyResult, trendResult, suggestedResult]) => {
      if (liveResult.status === 'fulfilled') setLive(unwrap(liveResult.value));
      if (storyResult.status === 'fulfilled') setStories(unwrap(storyResult.value));
      if (trendResult.status === 'fulfilled') setTrending(unwrap(trendResult.value));
      if (suggestedResult.status === 'fulfilled') setSuggested(unwrap(suggestedResult.value));
    });
    const socket = createSocket(token, 'home-social');
    const update = (data: any) => setItems(previous => previous.map(item => item.id === data.postId ? { ...item, likes: data.likes ?? item.likes, shares: data.shares ?? item.shares, comments: data.commentCount ?? item.comments } : item));
    socket.on('social:post-updated', update); socket.on('social:comment-created', update); socket.connect();
    return () => { socket.off('social:post-updated', update); socket.off('social:comment-created', update); socket.disconnect(); };
  }, [token]);
  useEffect(() => { const element = sentinel.current; if (!element) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && hasMore && !loadingMore) void fetchFeed(false, cursor); }, { rootMargin: '500px' }); observer.observe(element); return () => observer.disconnect(); }, [cursor, fetchFeed, hasMore, loadingMore]);

  // Delete a post/reel from the ••• menu (own content only). Removes the item
  // from the local feed immediately after the server confirms.
  const confirmDeletePost = async () => {
    if (!token || !deletePostFor) return;
    const item = deletePostFor;
    setDeletePostFor(undefined);
    const endpoint = isVideoItem(item) ? `/api/reels/${cleanId(item)}` : `/api/feed/${cleanId(item)}`;
    try {
      await apiDelete(endpoint, token);
      setItems(previous => previous.filter(entry => entry.id !== item.id));
      setStories(previous => previous.filter(story => story.id !== item.id));
      setLive(previous => previous.filter(stream => stream.id !== item.id));
      setTrending(previous => previous.filter(entry => entry.id !== item.id));
      toast.success(isVideoItem(item) ? 'Reel deleted' : 'Post deleted');
    } catch (reason: any) {
      toast.error('Content not deleted', reason?.message);
    }
  };

  const openShare = (item: Item) => setShareFor(item);
  const openPostMore = (item: Item) => setMoreFor(item);
  const requestDelete = (item: Item) => setDeletePostFor(item);

  const optimistic = async (item: Item, mode: 'like' | 'save') => {
    if (!token || item.type === 'live') return;
    const key = mode === 'like' ? 'liked' : 'saved'; const was = Boolean(item[key]);
    const apply = (value: boolean) => setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, [key]: value, ...(mode === 'like' ? { likes: Math.max(0, (entry.likes || 0) + (value ? 1 : -1)) } : {}) } : entry));
    apply(!was);
    const base = actionEndpointFor(item);
    const id = cleanId(item);
    try {
      if (isVideoItem(item)) {
        // Reels are stored in the prisma.video table and must be addressed via
        // /api/reels/:videoId. The reel save endpoint toggles save/un-save with a
        // single POST. Keep this in lockstep with the Reels page so a Reel behaves
        // identically no matter where it was opened.
        if (mode === 'like') await apiPost(`${base}/${id}/like`, {}, token);
        else await apiPost(`${base}/${id}/save`, {}, token);
      } else if (mode === 'like') {
        await apiPost(`${base}/${id}/like`, {}, token);
      } else if (was) {
        await apiDelete(`${base}/${id}/save`, token);
      } else {
        await apiPost(`${base}/${id}/save`, {}, token);
      }
    }
    catch (reason: any) { apply(was); toast.error('Could not update post', reason?.message); }
  };
  const follow = async (item: Item) => {
    if (!token) return; const creator = getAuthor(item); const was = Boolean(item.following);
    setItems(previous => previous.map(entry => getAuthor(entry).id === creator.id ? { ...entry, following: !was } : entry));
    try { was ? await apiDelete(`/api/profiles/${creator.username}/follow`, token) : await apiPost(`/api/profiles/${creator.username}/follow`, {}, token); }
    catch (reason: any) { setItems(previous => previous.map(entry => getAuthor(entry).id === creator.id ? { ...entry, following: was } : entry)); toast.error('Follow failed', reason?.message); }
  };
  const followSuggested = async (profile: Item) => {
    if (!token || !profile.username) return; const was = Boolean(profile.following || profile.isFollowing);
    setSuggested(previous => previous.map(entry => entry.id === profile.id ? { ...entry, following: !was, isFollowing: !was } : entry));
    try { was ? await apiDelete(`/api/profiles/${profile.username}/follow`, token) : await apiPost(`/api/profiles/${profile.username}/follow`, {}, token); }
    catch (reason: any) { setSuggested(previous => previous.map(entry => entry.id === profile.id ? { ...entry, following: was, isFollowing: was } : entry)); toast.error('Follow failed', reason?.message); }
  };
  const loadGiftData = async () => {
    if (!token) return; setGiftLoading(true); setGiftError('');
    try { const [catalog, wallet] = await Promise.all([apiGet<any>('/api/monetization/gifts', token, { skipCache: true }), apiGet<any>('/api/monetization/wallet', token, { skipCache: true })]); setGifts(normalizeGiftCatalog(unwrap(catalog))); const coinBalance = Number(wallet?.coinBalance); if (!Number.isSafeInteger(coinBalance) || coinBalance < 0) throw new Error('Wallet returned an invalid VANTA balance.'); setBalance(coinBalance); }
    catch (reason: any) { setGifts([]); setGiftError(reason?.message || 'The gift service is unavailable.'); }
    finally { setGiftLoading(false); }
  };
  const openGift = (item: Item) => { if (!token) return; setGiftFor(item); setGifts([]); setGiftError(''); void loadGiftData(); };
  const share = async (destination: string) => {
    if (!shareFor || !token) return;
    const id = cleanId(shareFor);
    const isReel = isVideoItem(shareFor);
    // Reels have their own detail route and (like the Reels page) no backend
    // share endpoint, so we just share the /reels/:id link. Posts use the feed
    // share endpoint.
    const url = `${location.origin}${detailPathFor(shareFor)}`;
    try { if (!isReel) await apiPost(`/api/feed/${id}/share`, { destination }, token); if (destination === 'COPY_LINK') await navigator.clipboard.writeText(url); else if (destination === 'NATIVE' && navigator.share) await navigator.share({ title: 'VANTA', text: shareFor.content, url }); else if (destination === 'MESSAGE') router.push(`/chat?share=${encodeURIComponent(url)}`); toast.success('Shared successfully'); setShareFor(undefined); }
    catch (reason: any) { toast.error('Share failed', reason?.message); }
  };
  const visible = useMemo(() => { const base = items.filter(item => item.type !== 'suggested_creator'); if (tab === 'reels') return base.filter(isVideoItem); if (tab === 'latest') return [...base].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()); return base; }, [items, tab]);

  return <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#050505] text-white">
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[.08] bg-[#080808]/90 px-4 backdrop-blur-xl"><VantaLogo size={34} variant="monochrome" /><span className="text-base font-bold tracking-[.14em] text-white">VANTA</span><div className="ml-auto flex min-w-0 items-center gap-1"><button type="button" onClick={() => router.push('/discover')} aria-label="Search VANTA" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Search size={18}/></button><button type="button" onClick={() => router.push('/notifications')} aria-label="Open notifications" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Bell size={18}/>{notificationUnread > 0 && <HeaderBadge value={notificationUnread}/>}</button><button type="button" onClick={() => router.push('/chat')} aria-label="Open chat" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><MessageCircle size={18}/>{chatUnread > 0 && <HeaderBadge value={chatUnread}/>}</button><button type="button" onClick={() => router.push('/profile')} aria-label="Open your profile" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"><Avatar src={user?.avatar} alt="Your profile" size="sm" /></button></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide [-webkit-overflow-scrolling:touch]">
    <div className="w-full px-3 pb-24 pt-4">
      <main className="min-w-0">
        <div className="mb-5 hidden items-center justify-between "><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#666]">Home</p><h1 className="mt-1 text-xl font-semibold text-[#f5f5f5]">What&apos;s happening on VANTA</h1></div><button type="button" onClick={() => void fetchFeed(true)} aria-label="Refresh feed" className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[.08] text-[#8a8a8a] transition hover:bg-white/[.05] hover:text-white"><RefreshCw size={16}/></button></div>
        <section aria-label="Stories" className="mb-5 py-4"><div className="flex gap-4 overflow-x-auto scrollbar-hide">{(() => { const storyGroups = buildStoryGroups(stories); const myGroup = storyGroups.find(g => String(g.user?.id) === String(user?.id)); const mySegments = (myGroup?.stories || []).map(s => ({ id: s.id, viewed: Boolean(s.viewed) })); const myHasStories = mySegments.length > 0; return (<><button type="button" onClick={openStoryModal} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-[11px] text-[#8a8a8a]"><span className="relative block"><StoryCircle src={user?.avatar} alt="Your story" active segments={myHasStories ? mySegments : undefined} /><i className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#0d0d0f] bg-[#c9a227] text-black"><Plus size={14} strokeWidth={2.5}/></i></span><span>Your Story</span></button>{storyGroups.filter(g => String(g.user?.id) !== String(user?.id)).map(group => { const user0 = group.user || {}; const opener = group.hasUnviewed ? (group.stories.find(item => !item.viewed) || group.stories[0]) : group.stories[0]; if (!user0.id || !opener) return null; return <button key={user0.id} type="button" onClick={() => router.push(`/stories/${user0.id}?start=${opener.id}`)} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-[11px] text-[#8a8a8a]"><StoryCircle src={user0.avatar} alt={user0.username || 'Story'} active={group.hasUnviewed} segments={(group.stories || []).map(s => ({ id: s.id, viewed: Boolean(s.viewed) }))} /><span className="max-w-16 truncate">{user0.username}</span></button>; })}</>) ; })()}</div></section>
        <LiveStrip streams={live} openStream={stream => router.push(`/live/${cleanId(stream)}`)} openAll={() => router.push('/live')}/>
        <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-white/[.08] scrollbar-hide" role="tablist" aria-label="Feed filters">{([['forYou', 'For you'], ['following', 'Following'], ['latest', 'Latest'], ['reels', 'Reels']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('relative min-h-12 shrink-0 px-4 text-sm font-medium text-[#666] transition hover:text-[#b8b8b8]', tab === id && 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[#c9a227]')}>{label}</button>)}</div>
        <button type="button" onClick={openPostModal} className="mb-4 hidden w-full items-center gap-3 rounded-lg border border-white/[.08] bg-[#0d0d0f] px-4 py-3 text-left text-sm text-[#666] transition hover:border-white/[.14] hover:bg-[#151517] hover:text-[#b8b8b8] "><Avatar src={user?.avatar} alt={user?.username || 'You'} size="md"/><span className="flex-1">Share something with VANTA...</span><span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.08] text-[#b8b8b8]"><ImageIcon size={17}/></span></button>
        {!online && <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/[.08] bg-[#161616] px-3 py-2.5 text-xs text-[#b8b8b8]"><WifiOff size={14}/>You are offline. Some actions are unavailable.</div>}
        {loading && !items.length ? <FeedSkeleton/> : error && !items.length ? <ErrorState retry={() => fetchFeed(true)}/> : !visible.length ? <EmptyFeed discover={() => router.push('/discover')}/> : <div className="divide-y divide-white/[.06]">{visible.map(item => <PostCard key={item.id} item={item} currentUserId={user?.id} onLike={() => optimistic(item, 'like')} onSave={() => optimistic(item, 'save')} onComment={setCommentsFor} onShare={setShareFor} onGift={openGift} onFollow={follow} onMore={setMoreFor}/>)}<div ref={sentinel} className="flex justify-center py-6">{loadingMore && <Loader2 className="animate-spin text-[#666]"/>}{!hasMore && <span className="text-xs text-[#666]">You&apos;re all caught up.</span>}</div></div>}
      </main>
      </div>
    </div>
    <AnimatePresence>{commentsFor && token && <CommentPanel kind={isVideoItem(commentsFor) ? 'reel' : 'post'} postId={cleanId(commentsFor)} postAuthor={getAuthor(commentsFor)} initialCount={commentsFor.comments || 0} token={token} currentUser={user} onClose={() => setCommentsFor(undefined)} onCountChange={count => setItems(previous => previous.map(item => item.id === commentsFor.id ? { ...item, comments: count } : item))}/>} {giftFor && token && <GiftPickerBoundary onClose={() => setGiftFor(undefined)}><GiftPicker gifts={gifts} balance={balance} recipient={getAuthor(giftFor)} token={token} streamId={giftFor.type === 'live' ? cleanId(giftFor) : undefined} loading={giftLoading} loadError={giftError} onRetry={() => void loadGiftData()} onClose={() => setGiftFor(undefined)} onSent={(remaining, _amount, gift) => { setBalance(remaining); toast.success('Gift sent', `You sent ${gift.name} to ${getAuthor(giftFor).fullName || getAuthor(giftFor).username}`); }}/></GiftPickerBoundary>} {shareFor && <ShareSheet close={() => setShareFor(undefined)} share={share}/>} {moreFor && <MoreSheet item={moreFor} isOwn={getAuthor(moreFor).id === user?.id} close={() => setMoreFor(undefined)} openProfile={() => { const creator = getAuthor(moreFor); setMoreFor(undefined); router.push(creator.username ? `/profile/${creator.username}` : '/profile'); }} save={() => { void optimistic(moreFor, 'save'); setMoreFor(undefined); }} remove={() => requestDelete(moreFor)} />}{deletePostFor && <DeleteConfirmation item={deletePostFor} onCancel={() => setDeletePostFor(undefined)} onConfirm={() => void confirmDeletePost()} />}</AnimatePresence>
  </div>;
}

function LiveStrip({ streams, openStream, openAll }: { streams: Item[]; openStream: (stream: Item) => void; openAll: () => void }) {
  if (!streams.length) return null;
  return <section className="mb-5" aria-labelledby="live-now-heading"><div className="mb-3 flex items-center justify-between"><h2 id="live-now-heading" className="flex items-center gap-2 text-xs font-semibold tracking-[.16em] text-[#b8b8b8]"><span className="h-2 w-2 rounded-full bg-[#b4232f]"/>LIVE NOW</h2><button type="button" onClick={openAll} className="flex items-center gap-1 text-xs text-[#666] hover:text-white">View all<ChevronRight size={14}/></button></div><div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">{streams.slice(0, 5).map(stream => { const creator = getAuthor(stream); const preview = resolveMediaUrl(stream.thumbnail || stream.coverUrl || stream.previewUrl); return <button key={stream.id} type="button" onClick={() => openStream(stream)} className="group w-52 shrink-0 text-left"><span className="relative block aspect-video overflow-hidden rounded-lg border border-white/[.08] bg-[#101010]">{preview ? <img src={preview} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"/> : <span className="flex h-full items-center justify-center text-[#666]"><Radio size={22}/></span>}<span className="absolute left-2 top-2 rounded bg-[#9f1d2a] px-2 py-1 text-[9px] font-bold tracking-[.12em] text-white">LIVE</span><span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[9px] text-white"><Eye size={10}/>{formatCount(stream.viewerCount || stream.viewers)}</span></span><span className="mt-2 flex items-center gap-2"><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="sm"/><span className="min-w-0"><b className="block truncate text-xs font-semibold text-[#e8e8e8]">{stream.title || 'Live on VANTA'}</b><small className="block truncate text-[10px] text-[#666]">{creator.fullName || creator.username}</small></span></span></button>; })}</div></section>;
}

function Panel({ title, action, onAction, children }: any) { return <section className="border-b border-white/[.08] pb-4"><div className="mb-2 flex items-center justify-between"><h2 className="text-[11px] font-semibold tracking-[.16em] text-[#8a8a8a]">{title}</h2>{action && <button type="button" onClick={onAction} className="text-[11px] text-[#666] hover:text-white">{action}</button>}</div>{children}</section>; }
function LiveRow({ stream, open }: { stream: Item; open: () => void }) { const creator = getAuthor(stream); return <button type="button" onClick={open} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-white/[.035]"><span className="relative"><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="md"/><i className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#b4232f] ring-2 ring-[#050505]"/></span><span className="min-w-0"><b className="block truncate text-sm font-medium text-[#d8d8d8]">{creator.fullName || creator.username}</b><small className="flex items-center gap-1 text-[#666]"><Eye size={11}/>{formatCount(stream.viewerCount || stream.viewers)} watching</small></span></button>; }
function SuggestedRow({ profile, follow, open }: { profile: Item; follow: () => void; open: () => void }) { const active = Boolean(profile.following || profile.isFollowing); return <div className="flex items-center gap-3 px-1 py-2.5"><button type="button" onClick={open}><Avatar src={profile.avatar} alt={profile.username || 'Creator'} size="md"/></button><button type="button" onClick={open} className="min-w-0 flex-1 text-left"><b className="flex items-center gap-1 truncate text-sm font-medium text-[#d8d8d8]">{profile.fullName || profile.username}{profile.verified && <VerificationBadge verified size="xs" />}</b><small className="block truncate text-[#666]">@{profile.username}</small></button><button type="button" onClick={follow} className={cn('min-h-9 rounded-lg px-3 text-xs font-semibold transition', active ? 'border border-white/[.1] text-[#8a8a8a]' : 'bg-[#f5f5f5] text-black hover:bg-white')}>{active ? 'Following' : 'Follow'}</button></div>; }
function SmallEmpty({ text }: { text: string }) { return <p className="px-1 py-4 text-xs leading-5 text-[#666]">{text}</p>; }
function ErrorState({ retry }: { retry: () => void }) { return <div className="border-y border-white/[.08] px-4 py-16 text-center"><RefreshCw className="mx-auto text-[#666]"/><h2 className="mt-4 text-base font-semibold">Couldn&apos;t load your feed.</h2><p className="mt-2 text-sm text-[#666]">VANTA could not reach the feed service.</p><button type="button" onClick={retry} className="mt-5 rounded-lg bg-[#f5f5f5] px-4 py-2.5 text-sm font-semibold text-black">Try again</button></div>; }
function EmptyFeed({ discover }: { discover: () => void }) { return <div className="border-y border-white/[.08] px-4 py-16 text-center"><Sparkles className="mx-auto text-[#8a8a8a]"/><h2 className="mt-4 text-lg font-semibold">Nothing here yet.</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#666]">Discover creators and communities to start building your VANTA feed.</p><button type="button" onClick={discover} className="mt-5 rounded-lg bg-[#f5f5f5] px-4 py-2.5 text-sm font-semibold text-black">Discover</button></div>; }
function ShareSheet({ close, share }: any) { return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close share options" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"/><motion.section role="dialog" aria-modal="true" aria-label="Share post" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg rounded-t-xl border border-white/[.1] bg-[#161616] p-5 shadow-2xl    "><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Share post</h2><button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><X size={18}/></button></div><div className="grid grid-cols-3 gap-2">{[['COPY_LINK', 'Copy link'], ['NATIVE', 'Share'], ['MESSAGE', 'Message']].map(([id, label]) => <button key={id} type="button" onClick={() => share(id)} className="rounded-lg border border-white/[.08] p-4 text-xs text-[#b8b8b8] hover:bg-white/[.05]"><Share2 size={19} className="mx-auto mb-2 text-white"/>{label}</button>)}</div></motion.section></>; }
function MoreSheet({ item, isOwn, close, openProfile, save, remove }: any) { return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close post options" className="fixed inset-0 z-50 bg-black/70"/><motion.section role="dialog" aria-modal="true" aria-label="Post options" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-xl border border-white/[.1] bg-[#161616] p-3    "><button type="button" onClick={save} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Bookmark size={18}/>{item.saved ? 'Remove from saved' : 'Save post'}</button><button type="button" onClick={openProfile} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Users size={18}/>{isOwn ? 'Open your profile' : 'View creator profile'}</button>{isOwn && <button type="button" onClick={remove} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-rose-300 hover:bg-white/[.05]"><Trash2 size={18}/>Delete</button>}<button type="button" onClick={close} className="mt-2 min-h-12 w-full rounded-lg border border-white/[.08] text-sm text-[#8a8a8a] hover:bg-white/[.05]">Cancel</button></motion.section></>; }
function DeleteConfirmation({ item, onCancel, onConfirm }: any) {
  const kind = isVideoItem(item) ? 'Reel' : 'Post';
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} aria-label="Cancel delete" className="fixed inset-0 z-[60] bg-black/70"/><motion.section role="alertdialog" aria-modal="true" aria-label={`Delete ${kind}`} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .97 }} className="fixed left-1/2 top-1/2 z-[65] w-[min(400px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.1] bg-[#161616] p-5 shadow-2xl"><header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Delete this {kind.toLowerCase()}?</h2><button type="button" onClick={onCancel} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-[#8a8a8a] hover:bg-white/[.05]"><X size={18}/></button></header><p className="mb-5 text-sm leading-6 text-[#c8c8cc]/60">This cannot be undone. The {kind.toLowerCase()} will be removed from VANTA immediately.</p><div className="flex items-center justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-white/[.08] px-4 text-sm text-[#d8d8d8] hover:bg-white/[.05]">Cancel</button><button type="button" onClick={onConfirm} className="min-h-11 rounded-lg bg-[#b4232f] px-4 text-sm font-semibold text-white transition hover:bg-[#9f1d2a]">Delete {kind.toLowerCase()}</button></div></motion.section></>;
}