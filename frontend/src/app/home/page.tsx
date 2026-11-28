'use client';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readDefaultSection } from '@/lib/defaultSection';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark, ChevronRight, Eye, Gift, Heart, Image as ImageIcon, Loader2,
  MoreHorizontal, Plus, Radio, RefreshCw, Share2,
  Sparkles, Trash2, Users, WifiOff, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { startVisiblePolling } from '@/lib/visiblePolling';
import { createSocket } from '@/lib/socketClient';
import { useToast } from '@/components/ui/Toast';
import { canDownloadPostVideo, downloadPostVideo } from '@/lib/postVideoDownload';
import Avatar from '@/components/ui/Avatar';
import StoryTray from '@/components/story/StoryTray';
import LivePreviewImage from '@/components/live/LivePreviewImage';
import { openStatusFilePicker } from '@/components/story/StoryComposer';
import VerificationBadge from '@/components/ui/VerificationBadge';
import GlobalSearch from '@/components/search/GlobalSearch';
import PostMedia from '@/components/social/PostMedia';
import FeedPostCard from '@/components/social/FeedPostCard';
import CommentPanel from '@/components/social/CommentPanel';
import FeedPostMoreSheet from '@/components/social/FeedPostMoreSheet';
import FeedPostRepostSheet from '@/components/social/FeedPostRepostSheet';
import GiftPicker, { GiftCatalogItem } from '@/components/social/GiftPicker';
import GiftPickerBoundary from '@/components/social/GiftPickerBoundary';
import { normalizeGiftCatalog } from '@/lib/giftCatalog';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { cleanId, isVideoItem, actionEndpointFor, detailPathFor } from '@/lib/feedIdentity';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import PullToRefresh from '@/components/ui/PullToRefresh';

type Item = Record<string, any>;
type FeedTab = 'forYou' | 'following' | 'latest';

const formatCount = (value = 0) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);
const unwrap = (data: any): Item[] => Array.isArray(data) ? data : data?.items || data?.data || data?.streams || data?.stories || data?.gifts || [];
const getAuthor = (item: Item) => item.author || item.user || item.creator || item.host || {};
const mediaUrl = (item: Item) => resolveMediaUrl(item.media || item.mediaUrl || item.image || item.thumbnail || item.coverUrl || item.playbackUrl);

/**
 * Normalize the `/api/stories` response into per-user groups. A user must have
 * exactly one story tray entry no matter how many stories they posted, so we
 * key by USER/OWNER â€” never by story id. Also tolerates the legacy flat shape.
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
  return <div className="divide-y divide-white/[.06]" aria-label="Loading feed">{[1, 2, 3].map(index => <div key={index} className="px-1 py-4"><div className="flex items-center gap-3"><div className="h-11 w-11 animate-pulse rounded-full bg-white/[.06]"/><div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-white/[.06]"/><div className="h-2.5 w-20 animate-pulse rounded bg-white/[.04]"/></div></div><div className="mt-4 aspect-[3/2] animate-pulse rounded-lg bg-white/[.035]"/></div>)}</div>;
}

export default function HomePage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadPost = async (target: Item) => { if (downloadingId) return; setDownloadingId(target.id); await downloadPostVideo(target, toast, p => { if (p === null) { setDownloadingId(null); setMoreFor(undefined); } }); };
  const { openPostModal, openStoryModal, openQuotePost } = useContentCreation();
  const [tab, setTab] = useState<FeedTab>('forYou');
  const [sectionReady, setSectionReady] = useState(false);
  useEffect(() => { setTab(readDefaultSection('timeline')); setSectionReady(true); }, []);
  const [items, setItems] = useState<Item[]>([]);
  const [live, setLive] = useState<Item[]>([]);
  const [storyRefreshKey, setStoryRefreshKey] = useState(0);
  // Per-session feed seed. A stable seed keeps pagination consistent within a
  // visit; a refresh generates a NEW seed so the discovery content reorders.
  const feedSeedRef = useRef(Math.random().toString(36).slice(2, 10));
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [giftFor, setGiftFor] = useState<Item>();
  const [reelCommentsFor, setReelCommentsFor] = useState<Item>();
  const [repostFor, setRepostFor] = useState<Item>();
  const [moreFor, setMoreFor] = useState<Item>();
  const [deletePostFor, setDeletePostFor] = useState<Item>();
  const [deletePostSending, setDeletePostSending] = useState(false);
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftError, setGiftError] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const pendingActionsRef = useRef(new Set<string>());
  const feedRequest = useRef(0);
  const feedBusy = useRef(false);

  const fetchFeed = useCallback(async (reset = true, requestedCursor?: string, nextSeed?: string) => {
    if (!token || !sectionReady || (!reset && feedBusy.current)) return;
    const request = ++feedRequest.current;
    feedBusy.current = true;
    reset ? setLoading(true) : setLoadingMore(true);
    if (reset) { setError(''); setLoadMoreError(false); }
    else setLoadMoreError(false);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (requestedCursor) query.set('cursor', requestedCursor);
      // Only the mixed home feed is seed-rotated; the Following tab is chronological.
      const seedToUse = nextSeed ?? feedSeedRef.current;
      if (tab !== 'following') query.set('seed', seedToUse);
      const endpoint = tab === 'following' ? '/api/feed' : '/api/feed/home';
      const data = await apiGet<any>(`${endpoint}?${query}`, token, { skipCache: reset });
      if (request !== feedRequest.current) return;
      const next: Item[] = unwrap(data).map((item): Item => ({ ...item, liked: typeof item.liked === 'boolean' ? item.liked : typeof item.isLiked === 'boolean' ? item.isLiked : false, likes: item.likes ?? item.likesCount ?? item._count?.likes ?? 0 }));
      setItems(previous => {
        if (reset) return next;
        const ids = new Set(previous.map(item => item.id));
        return [...previous, ...next.filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true; })];
      });
      setCursor(data?.nextCursor);
      setHasMore(Boolean(data?.nextCursor));
    } catch { if (request === feedRequest.current) { if (reset) setError("Couldn't load your feed."); else setLoadMoreError(true); } }
    finally { if (request === feedRequest.current) { feedBusy.current = false; setLoading(false); setLoadingMore(false); } }
  }, [token, tab, sectionReady]);

  // Explicit refresh: start a NEW feed session (new seed) so the discovery
  // content reorders, and refresh the story tray too.
  const refreshFeed = useCallback(async () => {
    const nextSeed = Math.random().toString(36).slice(2, 10);
    feedSeedRef.current = nextSeed;
    setCursor(undefined);
    setHasMore(true);
    setStoryRefreshKey(key => key + 1);
    await fetchFeed(true, undefined, nextSeed);
  }, [fetchFeed]);

  useEffect(() => {
    setItems([]); setCursor(undefined); setHasMore(true); void fetchFeed(true);
    return () => { feedRequest.current += 1; feedBusy.current = false; };
  }, [fetchFeed]);
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); setOnline(navigator.onLine); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }, []);
  useEffect(() => {
    if (!token) return;
    const socket = createSocket(token, 'home-social');
    const update = (data: any) => setItems(previous => previous.map(item => item.id === data.postId ? {
      ...item,
      likes: data.likes ?? item.likes,
      shares: data.shares ?? item.shares,
      comments: data.commentCount ?? item.comments,
      // The server broadcasts the actor and their resulting like state. Keep
      // the heart state in sync for this viewer as well as the aggregate count.
      ...(data.likedBy === user?.id && typeof data.liked === 'boolean' ? { liked: data.liked } : {}),
    } : item));
    socket.on('social:post-updated', update); socket.on('social:comment-created', update); socket.connect();
    return () => { socket.off('social:post-updated', update); socket.off('social:comment-created', update); socket.disconnect(); };
  }, [token, user?.id]);
  useEffect(() => {
    if (!token) { setLive([]); return; }
    // Clear previous account's discovery data, then refresh only while visible/online.
    setLive([]);
    return startVisiblePolling({
      intervalMs: 15_000,
      isAvailable: () => document.visibilityState === 'visible' && navigator.onLine,
      subscribe: notify => {
        document.addEventListener('visibilitychange', notify);
        window.addEventListener('online', notify);
        return () => {
          document.removeEventListener('visibilitychange', notify);
          window.removeEventListener('online', notify);
        };
      },
      load: () => apiGet<any>('/api/live/discover?limit=6&sort=viewerCount', token, { skipCache: true }),
      onValue: result => setLive(unwrap(result)),
    });
  }, [token]);
  useEffect(() => { const element = sentinel.current; if (!element) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && hasMore && !loading && !loadingMore && !loadMoreError) void fetchFeed(false, cursor); }, { rootMargin: '500px' }); observer.observe(element); return () => observer.disconnect(); }, [cursor, fetchFeed, hasMore, loading, loadingMore, loadMoreError]);

  // Delete a post/reel from the â€¢â€¢â€¢ menu (own content only). Removes the item
  // from the local feed immediately after the server confirms.
  const confirmDeletePost = async () => {
    if (!token || !deletePostFor || deletePostSending) return;
    const item = deletePostFor;
    const endpoint = isVideoItem(item) ? `/api/reels/${cleanId(item)}` : `/api/feed/${cleanId(item)}`;
    setDeletePostSending(true);
    try {
      await apiDelete(endpoint, token);
      setItems(previous => previous.filter(entry => entry.id !== item.id));
      setStoryRefreshKey(key => key + 1);
      setLive(previous => previous.filter(stream => stream.id !== item.id));
      setDeletePostFor(undefined);
      toast.success(isVideoItem(item) ? 'Reel deleted' : 'Post deleted');
    } catch (reason: any) {
      toast.error('Content not deleted', reason?.message || 'Please try again.');
    } finally {
      setDeletePostSending(false);
    }
  };

  const openPostMore = (item: Item) => setMoreFor(item);
  const requestDelete = (item: Item) => { setMoreFor(undefined); setDeletePostFor(item); };

  const optimistic = async (item: Item, mode: 'like' | 'save') => {
    if (!token || item.type === 'live') return;
    const id = cleanId(item);
    const actionKey = `${mode}:${id}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    pendingActionsRef.current.add(actionKey);
    const key = mode === 'like' ? 'liked' : 'saved';
    const was = Boolean(item[key]);
    const previousLikes = Number(item.likes || 0);
    const apply = (value: boolean, count?: number) => setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, [key]: value, ...(mode === 'like' ? { likes: Number.isFinite(count) ? Math.max(0, Number(count)) : Math.max(0, Number(entry.likes || 0) + (value ? 1 : -1)) } : {}) } : entry));
    apply(!was);
    const base = actionEndpointFor(item);
    try {
      if (mode === 'like') {
        const result = await apiPost<any>(`${base}/${id}/like`, {}, token);
        setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, liked: typeof result?.liked === 'boolean' ? result.liked : !was, likes: Number.isFinite(Number(result?.likeCount ?? result?.likes)) ? Number(result?.likeCount ?? result?.likes) : Math.max(0, previousLikes + (was ? -1 : 1)) } : entry));
      } else if (isVideoItem(item)) {
        await apiPost(`${base}/${id}/save`, {}, token);
      } else if (was) {
        await apiDelete(`${base}/${id}/save`, token);
      } else {
        await apiPost(`${base}/${id}/save`, {}, token);
      }
    } catch (reason: any) {
      apply(was, previousLikes);
      toast.error('Could not update post', reason?.message);
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  };
  const follow = async (item: Item) => {
    if (!token) return;
    const creator = getAuthor(item);
    if (!creator.id || !creator.username) {
      toast.error('Follow unavailable', 'This creator does not have a valid profile.');
      return;
    }
    const actionKey = `follow:${creator.id}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    pendingActionsRef.current.add(actionKey);
    const was = Boolean(item.following || item.isFollowing);
    const updateFollowing = (value: boolean) => setItems(previous => previous.map(entry =>
      getAuthor(entry).id === creator.id ? { ...entry, following: value, isFollowing: value } : entry
    ));
    updateFollowing(!was);
    try {
      if (was) await apiDelete(`/api/profiles/${encodeURIComponent(creator.username)}/follow`, token);
      else await apiPost(`/api/profiles/${encodeURIComponent(creator.username)}/follow`, {}, token);
    } catch (reason: any) {
      updateFollowing(was);
      toast.error('Follow failed', reason?.message);
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  };
  const followSuggested = async (profile: Item) => {
    if (!token || !profile.id || !profile.username) return;
    const actionKey = `follow:${profile.id}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    pendingActionsRef.current.add(actionKey);
    const was = Boolean(profile.following || profile.isFollowing);
    const updateFollowing = (value: boolean) => {
      setItems(previous => previous.map(entry => getAuthor(entry).id === profile.id ? { ...entry, following: value, isFollowing: value } : entry));
    };
    updateFollowing(!was);
    try {
      if (was) await apiDelete(`/api/profiles/${encodeURIComponent(profile.username)}/follow`, token);
      else await apiPost(`/api/profiles/${encodeURIComponent(profile.username)}/follow`, {}, token);
    } catch (reason: any) {
      updateFollowing(was);
      toast.error('Follow failed', reason?.message);
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  };
  const loadGiftData = async () => {
    if (!token) return; setGiftLoading(true); setGiftError('');
    try { const [catalog, wallet] = await Promise.all([apiGet<any>('/api/monetization/gifts', token, { skipCache: true }), apiGet<any>('/api/monetization/wallet', token, { skipCache: true })]); setGifts(normalizeGiftCatalog(unwrap(catalog))); const coinBalance = Number(wallet?.coinBalance); if (!Number.isSafeInteger(coinBalance) || coinBalance < 0) throw new Error('Wallet returned an invalid VANTA balance.'); setBalance(coinBalance); }
    catch (reason: any) { setGifts([]); setGiftError(reason?.message || 'The gift service is unavailable.'); }
    finally { setGiftLoading(false); }
  };
  const openGift = (item: Item) => { if (!token) return; setGiftFor(item); setGifts([]); setGiftError(''); void loadGiftData(); };
  const share = async (destination: string, target?: Item) => {
    if (!target || !token) return;
    const id = cleanId(target);
    const isReel = isVideoItem(target);
    // Reels have their own detail route and (like the Reels page) no backend
    // share endpoint, so we just share the /reels/:id link. Posts use the feed
    // share endpoint.
    const url = `${location.origin}${detailPathFor(target)}`;
    try {
      if (destination === 'NATIVE' && !navigator.share) {
        toast.error('Device sharing is unavailable', 'Use Copy link instead.');
        return;
      }
      if (destination === 'NATIVE') {
        // The device share sheet can be cancelled; do not report success first.
        await navigator.share({ title: 'VANTA', text: target.content, url });
      } else if (destination === 'COPY_LINK') {
        await navigator.clipboard.writeText(url);
      } else if (destination === 'MESSAGE') {
        router.push(`/chat?share=${encodeURIComponent(url)}`);
      }
      if (!isReel) await apiPost(`/api/feed/${id}/share`, { destination }, token);
      if (destination === 'COPY_LINK') toast.success('Link copied');
      else if (destination === 'NATIVE') toast.success('Shared successfully');
      setMoreFor(undefined);
    }
    catch (reason: any) { toast.error('Share failed', reason?.message); }
  };
  const repost = async (target: Item) => {
    if (!token) return;
    try {
      let patch: any;
      if (isVideoItem(target)) { const result: any = await apiPost(`/api/reels/${cleanId(target)}/repost`, {}, token); patch = { isReposted: Boolean(result?.reposted), reposts: Number(result?.reposts ?? 0) }; }
      else { const result: any = await apiPost(`/api/feed/${cleanId(target)}/repost`, {}, token); patch = { isReposted: Boolean(result?.reposted), reposts: Number(result?.reposts ?? 0) }; }
      setItems(previous => previous.map(entry => entry.id === target.id ? { ...entry, ...patch } : entry));
      setRepostFor(undefined);
    } catch (reason: any) { toast.error('Repost failed', reason?.message); }
  };
  const quote = (target: Item) => { setRepostFor(undefined); openQuotePost({ kind: isVideoItem(target) ? 'reel' : 'post', id: cleanId(target), url: `${location.origin}${detailPathFor(target)}`, path: detailPathFor(target) }); };
  const visible = useMemo(() => { const base = items.filter(item => item.type !== 'suggested_creator'); if (tab === 'latest') return [...base].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()); return base; }, [items, tab]);


  return <div data-vanta-page="home" className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--background)] text-white">
    <PullToRefresh scrollRef={pageScrollRef} onRefresh={refreshFeed}>
    <div className="w-full min-w-0 px-0 pb-28 pt-1">
      <main className="mx-auto w-full max-w-[670px] min-w-0 px-3 sm:px-2 lg:px-0">
        <div className="mb-5 hidden items-center justify-between "><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#666]">Home</p><h1 className="mt-1 text-xl font-semibold text-[#f5f5f5]">What&apos;s happening on VANTA</h1></div><button type="button" onClick={() => void refreshFeed()} aria-label="Refresh feed" className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[.08] text-[#8a8a8a] transition hover:bg-white/[.05] hover:text-white"><RefreshCw size={16}/></button></div>
        <StoryTray scrollRef={pageScrollRef} onCreate={() => {
          if (navigator.userAgent.includes('VANTAAndroid')) openStatusFilePicker(openStoryModal);
          else openStoryModal();
        }} refreshKey={storyRefreshKey} compact className="mb-2" />
        <LiveStrip streams={live} openStream={stream => router.push(`/live/${cleanId(stream)}`)} openAll={() => router.push('/live')}/>
        <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg border border-white/[.06] bg-[var(--surface)] p-0.5" role="tablist" aria-label="Feed filters">{([['forYou', 'For you'], ['following', 'Following'], ['latest', 'Latest']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('min-h-9 min-w-0 rounded-md px-1 text-xs font-medium transition sm:text-sm', tab === id ? 'bg-[#c9a227] text-black shadow-sm' : 'text-[#858585] hover:bg-white/[.04] hover:text-white')}>{label}</button>)}</div>
        <button type="button" onClick={openPostModal} className="mb-4 hidden w-full items-center gap-3 rounded-lg border border-white/[.08] bg-[#0d0d0f] px-4 py-3 text-left text-sm text-[#666] transition hover:border-white/[.14] hover:bg-[#151517] hover:text-[#b8b8b8] "><Avatar src={user?.avatar || user?.avatarUrl || (user?.profile as any)?.avatar || (user?.profile as any)?.avatarUrl} alt={user?.username || 'You'} size="md"/><span className="flex-1">Share something with VANTA...</span><span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.08] text-[#b8b8b8]"><ImageIcon size={17}/></span></button>
        {!online && <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/[.08] bg-[var(--surface)] px-3 py-2.5 text-xs text-[#b8b8b8]"><WifiOff size={14}/>You are offline. Some actions are unavailable.</div>}
        {loading && !items.length ? <FeedSkeleton/> : error && !items.length ? <ErrorState retry={() => fetchFeed(true)}/> : !visible.length ? <EmptyFeed discover={() => router.push('/discover')}/> : <div className="space-y-2">{visible.map(item => <div key={item.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_400px]"><FeedPostCard item={item} currentUserId={user?.id} onLike={() => optimistic(item, 'like')} onSave={() => optimistic(item, 'save')} onComment={item => { if (isVideoItem(item)) { if (token) setReelCommentsFor(item); else router.push('/login'); } else router.push(`/post/${encodeURIComponent(cleanId(item))}/reply`); }} onShare={setRepostFor} onGift={openGift} onFollow={follow} onMore={setMoreFor} compactCaption feedCompactMedia hideFollowButton/></div>)}<div ref={sentinel} className="flex justify-center py-6">{loadingMore && <Loader2 className="animate-spin text-[#666]"/>}{loadMoreError && <button type="button" onClick={() => void fetchFeed(false, cursor)} className="rounded-lg px-4 py-2 text-xs text-[#c9a227] hover:bg-white/[.05]">Couldn't load more posts. Retry</button>}{!hasMore && <span className="text-xs text-[#666]">You&apos;re all caught up.</span>}</div></div>}
      </main>
      </div>
    </PullToRefresh>
    {reelCommentsFor && token && typeof document !== 'undefined' && createPortal(<CommentPanel key={cleanId(reelCommentsFor)} kind="reel" postId={cleanId(reelCommentsFor)} postAuthor={getAuthor(reelCommentsFor).id ? { ...getAuthor(reelCommentsFor), id: getAuthor(reelCommentsFor).id, username: getAuthor(reelCommentsFor).username || '' } : undefined} initialCount={Number(reelCommentsFor.comments || 0)} token={token} currentUser={user} onClose={() => setReelCommentsFor(undefined)} onCountChange={count => setItems(previous => previous.map(item => item.id === reelCommentsFor.id ? { ...item, comments: count, commentsCount: count } : item))} />, document.body)}
    <AnimatePresence>{giftFor && token && <GiftPickerBoundary onClose={() => setGiftFor(undefined)}><GiftPicker gifts={gifts} balance={balance} recipient={getAuthor(giftFor)} token={token} videoId={isVideoItem(giftFor) ? cleanId(giftFor) : undefined} streamId={giftFor.type === 'live' ? cleanId(giftFor) : undefined} loading={giftLoading} loadError={giftError} onRetry={() => void loadGiftData()} onClose={() => setGiftFor(undefined)} onSent={(remaining, _amount, gift, quantity = 1) => { setBalance(remaining); const sentTo = giftFor; setItems(previous => previous.map(entry => entry.id === sentTo.id ? { ...entry, isGifted: true, tips: Number(entry.tips ?? entry.tipCount ?? entry.giftsReceived ?? entry.gifts ?? 0) + quantity, gifts: Number(entry.gifts ?? 0) + quantity } : entry)); toast.success('Gift sent', `You sent ${gift.name} to ${getAuthor(giftFor).fullName || getAuthor(giftFor).username}`); }}/></GiftPickerBoundary>} {repostFor && <FeedPostRepostSheet close={() => setRepostFor(undefined)} repost={() => void repost(repostFor)} quote={() => quote(repostFor)}/>} {moreFor && <FeedPostMoreSheet item={moreFor} download={canDownloadPostVideo(moreFor) ? () => void downloadPost(moreFor) : undefined} downloading={downloadingId === moreFor.id} share={destination => void share(destination, moreFor)} isOwn={getAuthor(moreFor).id === user?.id} close={() => setMoreFor(undefined)} openProfile={() => { const creator = getAuthor(moreFor); setMoreFor(undefined); router.push(creator.username ? `/profile/${creator.username}` : '/profile'); }} save={() => { void optimistic(moreFor, 'save'); setMoreFor(undefined); }} remove={() => requestDelete(moreFor)} />}{deletePostFor && <DeleteConfirmDialog title={`Delete this ${isVideoItem(deletePostFor) ? 'Reel' : 'Post'}?`} description={`This cannot be undone. The ${isVideoItem(deletePostFor) ? 'Reel' : 'post'} will be removed from VANTA immediately.`} confirmLabel={`Delete ${isVideoItem(deletePostFor) ? 'Reel' : 'post'}`} busy={deletePostSending} onCancel={() => { if (!deletePostSending) setDeletePostFor(undefined); }} onConfirm={() => void confirmDeletePost()} />}</AnimatePresence>
  </div>;
}

function LiveStrip({ streams, openStream, openAll }: { streams: Item[]; openStream: (stream: Item) => void; openAll: () => void }) {
  if (!streams.length) return null;
  return <section className="mb-2" aria-labelledby="live-now-heading"><div className="mb-1 flex items-center justify-between"><h2 id="live-now-heading" className="flex items-center gap-2 text-xs font-semibold tracking-[.16em] text-[#b8b8b8]"><span className="h-2 w-2 rounded-full bg-[#b4232f]"/>LIVE NOW</h2><button type="button" onClick={openAll} className="flex items-center gap-1 text-xs text-[#666] hover:text-white">View all<ChevronRight size={14}/></button></div><div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">{streams.slice(0, 5).map(stream => { const creator = getAuthor(stream); const preview = stream.thumbnailUrl || stream.thumbnail || stream.coverUrl || stream.previewUrl; return <button key={stream.id} type="button" onClick={() => openStream(stream)} className="group w-44 shrink-0 text-left"><span className="relative block aspect-video overflow-hidden rounded-lg border border-white/[.08] bg-[#101010]"><LivePreviewImage thumbnail={preview} avatar={creator.avatar} name={creator.username || "Creator"}/><span className="absolute left-2 top-2 rounded bg-[#9f1d2a] px-2 py-1 text-[9px] font-bold tracking-[.12em] text-white">LIVE</span><span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[9px] text-white"><Eye size={10}/>{formatCount(stream.viewerCount || stream.viewers)}</span></span><span className="mt-2 flex items-center gap-2"><span className="relative grid h-9 w-9 shrink-0 place-items-center"><span aria-hidden="true" className="absolute inset-[-3px] rounded-full border-2 border-[#e43d4b] animate-pulse"/><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="sm" className="relative z-10 ring-2 ring-[#e43d4b]"/></span><span className="min-w-0"><b className="block truncate text-xs font-semibold text-[#e8e8e8]">{stream.title || 'Live on VANTA'}</b><small className="flex items-center gap-1.5 truncate text-[10px]"><span className="font-bold tracking-[.1em] text-[#ef5660]">LIVE</span><span className="truncate text-[#666]">{creator.fullName || creator.username}</span></small></span></span></button>; })}</div></section>;
}

function Panel({ title, action, onAction, children }: any) { return <section className="border-b border-white/[.08] pb-4"><div className="mb-2 flex items-center justify-between"><h2 className="text-[11px] font-semibold tracking-[.16em] text-[#8a8a8a]">{title}</h2>{action && <button type="button" onClick={onAction} className="text-[11px] text-[#666] hover:text-white">{action}</button>}</div>{children}</section>; }
function LiveRow({ stream, open }: { stream: Item; open: () => void }) { const creator = getAuthor(stream); return <button type="button" onClick={open} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-white/[.035]"><span className="relative"><span aria-hidden="true" className="absolute -inset-1 rounded-full border-2 border-[#e43d4b] animate-pulse"/><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="md" verified={Boolean(creator.verified && creator.verificationType)} verificationType={creator.verificationType} className="relative z-10 ring-2 ring-[#e43d4b]"/><i className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#b4232f] ring-2 ring-[#050505] animate-pulse"/></span><span className="min-w-0"><b className="block truncate text-sm font-medium text-[#d8d8d8]">{creator.fullName || creator.username}</b><small className="flex items-center gap-1 text-[#666]"><span className="font-bold tracking-[.1em] text-[#ef5660]">LIVE</span><span>·</span><Eye size={11}/>{formatCount(stream.viewerCount || stream.viewers)} watching</small></span></button>; }
function SuggestedRow({ profile, follow, open }: { profile: Item; follow: () => void; open: () => void }) { const active = Boolean(profile.following || profile.isFollowing); return <div className="flex items-center gap-3 px-1 py-2.5"><button type="button" onClick={open}><Avatar src={profile.avatar} alt={profile.username || 'Creator'} size="md" verified={Boolean(profile.verified && profile.verificationType)} verificationType={profile.verificationType} /></button><button type="button" onClick={open} className="min-w-0 flex-1 text-left"><b className="flex items-center gap-1 truncate text-sm font-medium text-[#d8d8d8]">{profile.fullName || profile.username}{profile.verified && profile.verificationType && <VerificationBadge verified type={profile.verificationType} size="xs" />}</b><small className="block truncate text-[#666]">@{profile.username}</small></button><button type="button" onClick={follow} className={cn('min-h-9 rounded-lg px-3 text-xs font-semibold transition', active ? 'border border-white/[.1] text-[#8a8a8a]' : 'bg-[#f5f5f5] text-black hover:bg-white')}>{active ? 'Following' : 'Follow'}</button></div>; }
function SmallEmpty({ text }: { text: string }) { return <p className="px-1 py-4 text-xs leading-5 text-[#666]">{text}</p>; }
function ErrorState({ retry }: { retry: () => void }) { return <div className="border-y border-white/[.08] px-4 py-16 text-center"><RefreshCw className="mx-auto text-[#666]"/><h2 className="mt-4 text-base font-semibold">Couldn&apos;t load your feed.</h2><p className="mt-2 text-sm text-[#666]">VANTA could not reach the feed service.</p><button type="button" onClick={retry} className="mt-5 rounded-lg bg-[#f5f5f5] px-4 py-2.5 text-sm font-semibold text-black">Try again</button></div>; }
function EmptyFeed({ discover }: { discover: () => void }) { return <div className="border-y border-white/[.08] px-4 py-16 text-center"><Sparkles className="mx-auto text-[#8a8a8a]"/><h2 className="mt-4 text-lg font-semibold">Nothing here yet.</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#666]">Discover creators and communities to start building your VANTA feed.</p><button type="button" onClick={discover} className="mt-5 rounded-lg bg-[#f5f5f5] px-4 py-2.5 text-sm font-semibold text-black">Discover</button></div>; }
