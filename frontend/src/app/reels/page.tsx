'use client';

import BookmarkIcon from '@/components/ui/BookmarkIcon';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { MentionSuggestions, useMentionSuggestions } from '@/components/social/MentionSuggestions';
import { MentionTextarea } from '@/components/social/MentionTextarea';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Clapperboard,
  Flag,
  Gift,
  Heart,
  Eye,
  Loader2,
  Maximize,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useContentPrefs } from '@/lib/useContentPrefs';
import PullToRefresh from '@/components/ui/PullToRefresh';
import { useToast } from '@/components/ui/Toast';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';
import ReelShareSheet from '@/components/social/ReelShareSheet';
import GiftPicker, { GiftCatalogItem } from '@/components/social/GiftPicker';
import GiftPickerBoundary from '@/components/social/GiftPickerBoundary';
import { normalizeGiftCatalog } from '@/lib/giftCatalog';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { chooseReelPlaybackSource } from '@/lib/reelPlaybackSource';
import { shouldMountReelVideo } from '@/lib/reelMediaPolicy';
import { renderTextWithLinks } from '@/lib/linkify';
import { REEL_TAP_WINDOW_MS, isReelTap, isReelDoubleTap, reelPreload, reelIndexAtScroll, nextReelLike, type ReelTap } from '@/lib/reelPlayback';
import { feedFromSwipe, settleFeedSwipe, startFeedSwipe, trackFeedSwipe } from '@/lib/feedSwipe';

declare global {
  interface Window {
    VantaNative?: { shareText: (text: string, nonce: string, requestId: string) => void };
    __VANTA_NATIVE_SHARE_NONCE?: string;
  }
}

type Feed = 'for-you' | 'following' | 'trending';
type Author = {
  id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  verified?: boolean;
  verificationType?: VerificationType | null;
  following?: boolean;
  isFollowing?: boolean;
};
type Reel = {
  id: string;
  title?: string;
  description?: string;
  videoUrl: string;
  hlsUrl?: string | null;
  thumbnailUrl?: string;
  duration?: number;
  views: number;
  likes: number;
  comments: number;
  saves?: number;
  shares?: number;
  gifts?: number;
  reposts?: number;
  isReposted?: boolean;
  isGifted?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
  isFollowing?: boolean;
  author: Author;
};
type ReelComment = {
  id: string;
  userId?: string;
  content: string;
  createdAt?: string;
  liked?: boolean;
  _count?: { likes: number; replies?: number };
  user?: { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean; verificationType?: VerificationType | null };
};

const formatCount = (value = 0) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value);
const feedLabel = (feed: Feed) => feed === 'for-you' ? 'For You' : feed[0].toUpperCase() + feed.slice(1);

const timeAgo = (iso?: string) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
};

export default function ReelsPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { openReelUploader } = useContentCreation();
  const [feed, setFeed] = useState<Feed>('for-you');
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [active, setActive] = useState(0);
  const muted = false;
  const [manualPlayback, setManualPlayback] = useState<{ id: string; play: boolean } | null>(null);
  const [blockedId, setBlockedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [visiblePage, setVisiblePage] = useState(true);
  const [feedRevision, setFeedRevision] = useState(0);
  const { prefs: contentPrefs, hydrated: contentPrefsReady } = useContentPrefs();
  const [networkSaveData, setNetworkSaveData] = useState(false);
  const lowerData = contentPrefs.lowerData || networkSaveData;
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const sync = () => setNetworkSaveData(connection?.saveData === true);
    sync();
    connection?.addEventListener('change', sync);
    return () => connection?.removeEventListener('change', sync);
  }, []);
  const [commentsFor, setCommentsFor] = useState<Reel | null>(null);
  const [shareFor, setShareFor] = useState<Reel | null>(null);
  const [moreFor, setMoreFor] = useState<Reel | null>(null);
  const [deleteReelFor, setDeleteReelFor] = useState<Reel | null>(null);
  const [deleteReelSending, setDeleteReelSending] = useState(false);
  const [reportFor, setReportFor] = useState<Reel | null>(null);
  const [giftFor, setGiftFor] = useState<Reel | null>(null);
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([]);
  const [giftBalance, setGiftBalance] = useState(0);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftError, setGiftError] = useState('');
  const [comments, setComments] = useState<ReelComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const pendingActionsRef = useRef(new Set<string>());
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const viewed = useRef(new Set<string>());
  const [nextStart, setNextStart] = useState<number | null>(null);
  const feedSeedRef = useRef<string>(`sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const loadingMoreRef = useRef(false);
  const loadRequest = useRef(0);
  const commentsRequest = useRef(0);
  const reelsViewport = useRef<HTMLElement | null>(null);
  // Derived feed-mount signal used by the swipe effect below: the touch
  // listeners must attach only once the scroll viewport actually exists.
  const hasReels = reels.length > 0;
  const activeId = reels[active]?.id;
  const wantsPlayback = manualPlayback && manualPlayback.id === activeId ? manualPlayback.play : contentPrefsReady && contentPrefs.autoplay;
  const shouldPlay = !!(activeId && wantsPlayback && visiblePage && !loading);
  const playbackIntent = useRef({ id: activeId, play: shouldPlay });
  playbackIntent.current = { id: activeId, play: shouldPlay };
  const activeIndexRef = useRef(active);
  activeIndexRef.current = active;
  const playRequest = useRef(0);
  const pendingPlay = useRef<{id: string; video: HTMLVideoElement; request: number} | null>(null);

  const load = useCallback(async (start = 0, append = false, background = false) => {
    if (!append && !background) Object.values(videos.current).forEach(video => video?.pause());
    if (append) setLoadMoreError(false);
    const requestId = ++loadRequest.current;
    if (!append && !background) { setLoading(true); setLoadError(false); }
    try {
      const seed = encodeURIComponent(feedSeedRef.current);
      const result = await apiGet<{ items?: Reel[]; nextStart?: number | null; seed?: string } | Reel[]>(
        `/api/reels?feed=${feed}&limit=20&page=${Math.floor(start / 20)}&seed=${seed}`,
        token || undefined,
        { skipCache: true }
      );
      if (requestId !== loadRequest.current) return;
      const items = (Array.isArray(result) ? result : result.items || []).map(reel => ({
        ...reel,
        videoUrl: resolveMediaUrl(reel.videoUrl),
        hlsUrl: resolveMediaUrl(reel.hlsUrl) || undefined,
        thumbnailUrl: resolveMediaUrl(reel.thumbnailUrl) || undefined,
        author: { ...reel.author, isFollowing: reel.author?.isFollowing ?? reel.isFollowing },
      }));
      if (append) {
        setReels(previous => {
          const seen = new Set(previous.map(item => item.id));
          return [...previous, ...items.filter(item => !seen.has(item.id))];
        });
      } else {
        setReels(items);
      }
      setNextStart(Array.isArray(result) ? null : (result?.nextStart ?? null));
      if (!append) { setActive(0); setManualPlayback(null); setBlockedId(null); setPlayingId(null); setFeedRevision(value => value + 1); }
    } catch (reason: any) {
      if (requestId !== loadRequest.current) return;
      // A pull-to-refresh failure surfaces through the gesture (retry hint)
      // instead of replacing the whole Reels screen with an error state.
      if (background) {
        if (reason?.statusCode !== 499) throw reason;
      } else if (reason?.statusCode !== 499) {
        if (append) setLoadMoreError(true);
        else setLoadError(true);
      }
    } finally {
      if (requestId === loadRequest.current && !background) setLoading(false);
    }
  }, [feed, token]);

  // Pull-to-refresh: rotate the session seed so the request brings in a fresh
  // shuffle of Reels, and reload WITHOUT the full-screen loading state so the
  // active Reel and its playback keep working until new items actually arrive.
  const refreshReels = useCallback(async () => {
    feedSeedRef.current = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await load(0, false, true);
  }, [load]);

  // Re-shuffle when a user returns to the Reels experience after leaving the
  // app/page in the background (including mobile app task switching).
  useEffect(() => {
    let wasHidden = document.visibilityState === 'hidden';
    setVisiblePage(!wasHidden);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
        playbackIntent.current.play = false;
        setVisiblePage(false);
        Object.values(videos.current).forEach(video => video?.pause());
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        setVisiblePage(true);
        void refreshReels().catch(() => undefined);
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void refreshReels().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refreshReels]);

  useEffect(() => {
    // Each feed tab gets its own stable but distinct session seed so the random
    // order doesn't repeat identically across For You / Following / Trending.
    feedSeedRef.current = `sess-${feed}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setNextStart(null);
    void load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (nextStart == null || loadingMoreRef.current || loading || loadMoreError) return;
    loadingMoreRef.current = true;
    void load(nextStart, true).finally(() => { loadingMoreRef.current = false; });
  }, [nextStart, load, loading, loadMoreError]);

  // Infinite scroll: preload the next page as the user approaches the end of the
  // loaded Reels. The order stays stable because the session seed is fixed and the
  // server returns the same deterministic shuffle for every page request.
  useEffect(() => {
    if (visiblePage && active >= reels.length - (lowerData ? 1 : 3)) void loadMore();
  }, [active, reels.length, loadMore, visiblePage, lowerData]);

  // Every page is exactly the scrollport height. Choose the nearest snap
  // position on scroll rather than guessing from partial observer entries.
  useEffect(() => {
    const root = reelsViewport.current;
    if (!root || loading || !hasReels) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const index = reelIndexAtScroll(root.scrollTop, root.clientHeight, reels.length);
      if (index !== activeIndexRef.current) {
        activeIndexRef.current = index;
        playbackIntent.current.play = false;
        playRequest.current += 1;
        Object.values(videos.current).forEach(video => video?.pause());
        setActive(index);
        setManualPlayback(null);
        setBlockedId(null);
        setPlayingId(null);
      }
    };
    const scroll = () => { if (!frame) frame = window.requestAnimationFrame(sync); };
    root.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', scroll);
    scroll();
    return () => { root.removeEventListener('scroll', scroll); window.removeEventListener('resize', scroll); if (frame) cancelAnimationFrame(frame); };
  }, [loading, hasReels, reels.length]);

  const requestedId = params.get('reel');
  const requestedIndex = reels.findIndex(reel => reel.id === requestedId);
  useEffect(() => {
    const root = reelsViewport.current;
    if (!root || loading) return;
    root.scrollTo({ top: Math.max(0, requestedIndex) * root.clientHeight, behavior: 'auto' });
  }, [feedRevision, requestedIndex, loading]);

  const tryPlay = useCallback((id: string) => {
    const video = videos.current[id];
    if (!video || playbackIntent.current.id !== id || !playbackIntent.current.play || document.hidden) return;
    // One playback owner. Read current intent, not the render that queued the event.
    Object.entries(videos.current).forEach(([otherId, other]) => { if (otherId !== id) other?.pause(); });
    if (!video.paused || (pendingPlay.current?.video === video && pendingPlay.current.request === playRequest.current)) return;
    const request = ++playRequest.current;
    pendingPlay.current = {id, video, request};
    void video.play().then(() => {
      if (playbackIntent.current.id !== id || !playbackIntent.current.play || document.hidden) video.pause();
      else if (request === playRequest.current) setBlockedId(null);
    }).catch((error: unknown) => {
      if (request !== playRequest.current || playbackIntent.current.id !== id || !playbackIntent.current.play) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') setBlockedId(id);
    }).finally(() => { if (pendingPlay.current?.request === request) pendingPlay.current = null; });
  }, []);

  useEffect(() => {
    playRequest.current += 1;
    Object.entries(videos.current).forEach(([id, video]) => {
      if (id !== activeId || !shouldPlay) video?.pause();
    });
    if (activeId && shouldPlay) tryPlay(activeId);
  }, [activeId, shouldPlay, tryPlay, feedRevision]);

  const togglePlayback = useCallback((id: string) => {
    if (playbackIntent.current.id !== id || document.hidden) return;
    const video = videos.current[id];
    if (!video) return;
    // An explicit tap on blocked playback is a play request, not a pause.
    const play = !playbackIntent.current.play || video.paused;
    playbackIntent.current.play = play;
    setManualPlayback({ id, play });
    setBlockedId(null);
    if (play) tryPlay(id);
    else { playRequest.current += 1; video.pause(); }
  }, [tryPlay]);

  const playbackStarted = useCallback((id: string) => {
    if (playbackIntent.current.id !== id || !playbackIntent.current.play || document.hidden) {
      videos.current[id]?.pause();
      return;
    }
    setBlockedId(null);
    setPlayingId(id);
  }, []);
  const playbackStopped = useCallback((id: string) => setPlayingId(current => current === id ? null : current), []);

  // Count only real playing time, never a buffering or blocked video.
  useEffect(() => {
    if (!token || !activeId || playingId !== activeId || !shouldPlay || viewed.current.has(activeId)) return;
    const timer = window.setTimeout(() => {
      const video = videos.current[activeId];
      if (!video || video.paused || document.hidden || playbackIntent.current.id !== activeId || !playbackIntent.current.play) return;
      viewed.current.add(activeId);
      void apiPost<{ counted: boolean; views: number }>(`/api/reels/${activeId}/views`, { watchTime: 2 }, token)
        .then(result => setReels(items => items.map(item => item.id === activeId ? { ...item, views: result.views } : item)))
        .catch(() => viewed.current.delete(activeId));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [activeId, playingId, shouldPlay, token]);

  useEffect(() => () => {
    playbackIntent.current.play = false;
    Object.values(videos.current).forEach(video => video?.pause());
  }, []);

  const jump = useCallback((index: number) => {
    const reel = reels[index];
    if (reel) sections.current[reel.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [reels]);

  // Feed order defines the swipe direction convention: swiping LEFT moves to
  // the NEXT feed (For You → Following → Trending), swiping RIGHT moves BACK
  // (Trending → Following → For You). This mirrors the tab order left→right.
  const FEED_ORDER: Feed[] = ['for-you', 'following', 'trending'];

  const applyFeedSwipe = useCallback((direction: -1 | 0 | 1) => {
    const target = feedFromSwipe(FEED_ORDER, feed, direction);
    if (target !== feed) setFeed(target);
  }, [feed]);

  // Horizontal swipe between feeds. Classification lives in `lib/feedSwipe`
  // (pure + unit-tested); this effect only bridges touch events to it. The
  // gesture may become a feed switch ONLY when the sideways displacement
  // clearly dominates the vertical one — every other gesture (vertical swipes,
  // taps, diagonal undershoots) is left completely to native behavior and this
  // handler never preventDefaults it.
  //
  // NOTE: the listeners must be (re)attached whenever the scroll viewport
  // element exists. On a fresh page load the feed is in a loading/empty state
  // first, so `reelsViewport.current` is null when the effect first runs and a
  // dependency that only tracks `feed` (applyFeedSwipe) is not enough to re-run
  // it once reels actually mount. Depending on `loading`/`loadError`/hasReels
  // guarantees the handlers are attached in production after the feed renders.
  useEffect(() => {
    const root = reelsViewport.current;
    if (!root) return;
    let gesture = startFeedSwipe();
    let fromX = 0;
    let fromY = 0;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      fromX = touch.clientX;
      fromY = touch.clientY;
      gesture = startFeedSwipe();
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const next = trackFeedSwipe(gesture, touch.clientX - fromX, touch.clientY - fromY);
      gesture = next;
      if (next.locked === 'horizontal' && event.cancelable) {
        // Locked horizontal gesture: stop the browser from interpreting it as
        // a vertical reel scroll or an OS back/forward page swipe.
        event.preventDefault();
      }
    };
    const onEnd = () => {
      const direction = settleFeedSwipe(gesture);
      if (direction !== 0) applyFeedSwipe(direction);
      gesture = startFeedSwipe();
    };
    const onCancel = () => { gesture = startFeedSwipe(); };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onCancel);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onCancel);
    };
  }, [applyFeedSwipe, loading, loadError, hasReels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || target.isContentEditable || target.closest('input, textarea, select, button, a, [role="dialog"]')) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); jump(active + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); jump(active - 1); }
      if (event.key === ' ' && activeId) { event.preventDefault(); togglePlayback(activeId); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, activeId, jump, togglePlayback]);

  const patch = useCallback((id: string, changes: Partial<Reel>) => {
    setReels(items => items.map(item => item.id === id ? { ...item, ...changes } : item));
  }, []);

  const confirmDeleteReel = async () => {
    if (!token || !deleteReelFor || deleteReelSending) return;
    const reel = deleteReelFor;
    setDeleteReelSending(true);
    try {
      await apiDelete(`/api/reels/${reel.id}`, token);
      setDeleteReelFor(null);
      setReels(items => items.filter(item => item.id !== reel.id));
      setActive(0);
      setManualPlayback(null);
      toast.success('Reel deleted');
    } catch (reason: any) {
      toast.error('Reel not deleted', reason?.message);
    } finally {
      setDeleteReelSending(false);
    }
  };

  const toggle = async (reel: Reel, action: 'like' | 'save', ensureLike = false) => {
    if (!token) { toast.error('Sign in required'); return; }
    const key = `${action}:${reel.id}`;
    if (pendingActionsRef.current.has(key)) return;
    const was = action === 'like' ? !!reel.isLiked : !!reel.isSaved;
    if (action === 'like' && nextReelLike(was, ensureLike) === null) return;
    pendingActionsRef.current.add(key);
    setPending(items => ({ ...items, [key]: true }));
    patch(reel.id, action === 'like' ? { isLiked: !was, likes: Math.max(0, reel.likes + (was ? -1 : 1)) } : { isSaved: !was });
    try {
      const result = await apiPost<{ liked?: boolean; saved?: boolean; likes?: number; likeCount?: number }>(`/api/reels/${reel.id}/${action}`, {}, token);
      patch(reel.id, action === 'like' ? { isLiked: typeof result.liked === 'boolean' ? result.liked : !was, likes: Number.isFinite(Number(result.likes ?? result.likeCount)) ? Number(result.likes ?? result.likeCount) : Math.max(0, reel.likes + (was ? -1 : 1)) } : { isSaved: typeof result.saved === 'boolean' ? result.saved : !was });
    } catch (reason: any) {
      patch(reel.id, action === 'like' ? { isLiked: was, likes: reel.likes } : { isSaved: was });
      toast.error('Reel update failed', reason?.message);
    } finally {
      pendingActionsRef.current.delete(key);
      setPending(items => ({ ...items, [key]: false }));
    }
  };

  const follow = async (reel: Reel) => {
    const isOwn = Boolean(user && ((user.id && String(reel.author.id) === String(user.id)) || (user.username && reel.author.username?.toLowerCase() === user.username.toLowerCase())));
    if (isOwn) { toast.error('That is your own Reel'); return; }
    if (!token) { toast.error('Sign in required'); return; }
    const key = `follow:${reel.author.id}`;
    if (pendingActionsRef.current.has(key)) return;
    pendingActionsRef.current.add(key);
    const was = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);
    setPending(items => ({ ...items, [key]: true }));
    setReels(items => items.map(item => item.author.id === reel.author.id ? {
      ...item,
      isFollowing: !was,
      author: { ...item.author, following: !was, isFollowing: !was },
    } : item));
    try {
      if (was) await apiDelete(`/api/profiles/${reel.author.username}/follow`, token);
      else await apiPost(`/api/profiles/${reel.author.username}/follow`, {}, token);
    } catch (reason: any) {
      setReels(items => items.map(item => item.author.id === reel.author.id ? {
        ...item,
        isFollowing: was,
        author: { ...item.author, following: was, isFollowing: was },
      } : item));
      toast.error('Follow update failed', reason?.message);
    } finally {
      pendingActionsRef.current.delete(key);
      setPending(items => ({ ...items, [key]: false }));
    }
  };

  const openComments = async (reel: Reel) => {
    const requestId = ++commentsRequest.current;
    setCommentsFor(reel);
    setComments([]);
    setCommentsLoading(true);
    try {
      const result = await apiGet<{ items?: ReelComment[] }>(`/api/reels/${reel.id}/comments?limit=30`, token || undefined, { skipCache: true });
      if (requestId === commentsRequest.current) setComments(result.items || []);
    } catch {
      if (requestId === commentsRequest.current) toast.error('Comments unavailable');
    } finally {
      if (requestId === commentsRequest.current) setCommentsLoading(false);
    }
  };

  const submitComment = async () => {
    if (!token || !commentsFor || !commentText.trim() || commentSending) return;
    const reelId = commentsFor.id;
    const requestId = commentsRequest.current;
    const content = commentText.trim();
    setCommentSending(true);
    try {
      const created = await apiPost<ReelComment>(`/api/reels/${reelId}/comments`, { content }, token);
      setReels(items => items.map(item => item.id === reelId ? { ...item, comments: item.comments + 1 } : item));
      if (commentsRequest.current === requestId) {
        setComments(items => [created, ...items]);
        setCommentsFor(current => current?.id === reelId ? { ...current, comments: current.comments + 1 } : current);
        setCommentText('');
      }
    } catch (reason: any) {
      if (commentsRequest.current === requestId) toast.error('Comment not saved', reason?.message);
    } finally {
      setCommentSending(false);
    }
  };

  const deleteComment = async (comment: ReelComment): Promise<boolean> => {
    if (!token || !commentsFor) return false;
    const reelId = commentsFor.id;
    const requestId = commentsRequest.current;
    const key = `comment-delete:${reelId}:${comment.id}`;
    if (pendingActionsRef.current.has(key)) return false;
    pendingActionsRef.current.add(key);
    try {
      await apiDelete(`/api/reels/${reelId}/comments/${comment.id}`, token);
      setReels(items => items.map(item => item.id === reelId ? { ...item, comments: Math.max(0, item.comments - 1) } : item));
      if (commentsRequest.current === requestId) {
        setComments(items => items.filter(item => item.id !== comment.id));
        setCommentsFor(current => current?.id === reelId ? { ...current, comments: Math.max(0, current.comments - 1) } : current);
      }
      return true;
    } catch (reason: any) {
      if (commentsRequest.current === requestId) toast.error('Comment not deleted', reason?.message);
      return false;
    } finally {
      pendingActionsRef.current.delete(key);
    }
  };

  const toggleCommentLike = async (comment: ReelComment) => {
    if (!token || !commentsFor) { toast.error('Sign in to like comments'); return; }
    const reelId = commentsFor.id;
    const requestId = commentsRequest.current;
    const key = `comment-like:${reelId}:${comment.id}`;
    if (pendingActionsRef.current.has(key)) return;
    pendingActionsRef.current.add(key);
    const wasLiked = Boolean(comment.liked);
    const previousCount = Number(comment._count?.likes ?? 0);
    const optimisticLiked = !wasLiked;
    const optimisticCount = Math.max(0, previousCount + (wasLiked ? -1 : 1));
    const apply = (items: ReelComment[], liked: boolean, count: number) => items.map(item => item.id === comment.id
      ? { ...item, liked, _count: { ...item._count, likes: count } }
      : item);
    setComments(items => apply(items, optimisticLiked, optimisticCount));
    try {
      const result = await apiPost<{ liked: boolean; likes: number }>(`/api/reels/${reelId}/comments/${comment.id}/like`, {}, token);
      if (commentsRequest.current === requestId) {
        setComments(items => apply(items, result.liked, result.likes));
      }
    } catch (reason: any) {
      if (commentsRequest.current === requestId) {
        setComments(items => apply(items, wasLiked, previousCount));
        toast.error('Comment like failed', reason?.message);
      }
    } finally {
      pendingActionsRef.current.delete(key);
    }
  };

  const share = async (reel: Reel, mode: 'copy' | 'native') => {
    const url = `${location.origin}/reels/${reel.id}`;
    try {
      if (mode === 'native') {
        const data = { title: reel.title || 'VANTA Reel', text: reel.description || undefined, url };
        if (typeof navigator.share === 'function') {
          await navigator.share(data);
        } else if (window.VantaNative?.shareText && window.__VANTA_NATIVE_SHARE_NONCE) {
          const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `share-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await new Promise<void>((resolve, reject) => {
            let timeout: number | undefined;
            const finish = (error?: Error) => {
              if (timeout !== undefined) window.clearTimeout(timeout);
              window.removeEventListener('vanta-native-share-result', onResult);
              error ? reject(error) : resolve();
            };
            const onResult = (event: Event) => {
              const detail = (event as CustomEvent<{ requestId: string; ok: boolean }>).detail;
              if (detail?.requestId !== requestId) return;
              finish(detail.ok ? undefined : new Error('Android could not open the share sheet'));
            };
            window.addEventListener('vanta-native-share-result', onResult);
            timeout = window.setTimeout(() => finish(new Error('Share sheet timed out')), 15000);
            window.VantaNative?.shareText(`${data.text ? data.text + '\\n' : ''}${url}`, window.__VANTA_NATIVE_SHARE_NONCE!, requestId);
          });
        } else {
          await navigator.clipboard.writeText(url);
          toast.success('Reel link copied');
        }
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Reel link copied');
      }
      if (token) {
        const result = await apiPost<{ shares: number }>(`/api/reels/${reel.id}/share`, {}, token);
        patch(reel.id, { shares: result.shares });
      }
      setShareFor(null);
    } catch (reason: any) {
      if (reason?.name !== 'AbortError') toast.error('Unable to share this Reel', reason?.message);
    }
  };

  const sendToChat = async (conversationId: string) => {
    if (!shareFor) return;
    try { await apiPost('/api/messages/send', { conversationId, content: `${location.origin}/reels/${shareFor.id}`, type: 'TEXT' }, token || undefined); }
    catch (reason: any) { toast.error('Could not send', reason?.message); throw reason; }
  };

  const loadGiftData = async () => {
    if (!token) return;
    setGiftLoading(true);
    setGiftError('');
    try {
      const [catalog, wallet] = await Promise.all([
        apiGet<any>('/api/monetization/gifts', token, { skipCache: true }),
        apiGet<any>('/api/monetization/wallet', token, { skipCache: true }),
      ]);
      const items = Array.isArray(catalog) ? catalog : catalog?.items || catalog?.gifts || [];
      setGifts(normalizeGiftCatalog(items));
      const coinBalance = Number(wallet?.coinBalance);
      if (!Number.isSafeInteger(coinBalance) || coinBalance < 0) throw new Error('Wallet returned an invalid VANTA balance.');
      setGiftBalance(coinBalance);
    } catch (reason: any) {
      setGifts([]);
      setGiftError(reason?.message || 'The gift service is unavailable.');
    } finally {
      setGiftLoading(false);
    }
  };

  const openGift = (reel: Reel) => {
    if (!token) { toast.error('Sign in required'); return; }
    setGiftFor(reel);
    setGifts([]);
    setGiftError('');
    void loadGiftData();
  };

  const report = async (reel: Reel, category: string) => {
    if (!token) { toast.error('Sign in required'); return; }
    const key = `report:${reel.id}`;
    if (pending[key]) return;
    setPending(items => ({ ...items, [key]: true }));
    try {
      await apiPost('/api/compliance/reports', { targetType: 'VIDEO', targetId: reel.id, targetUserId: reel.author.id, category, description: 'Reported from VANTA Reels' }, token);
      toast.success('Report submitted');
      setReportFor(null);
    } catch (reason: any) {
      toast.error('Report unavailable', reason?.message);
    } finally {
      setPending(items => ({ ...items, [key]: false }));
    }
  };

  if (loading) return <div role="status" aria-label="Loading Reels" className="grid min-h-[100dvh] place-items-center bg-[#050505]"><Loader2 className="animate-spin text-[#c9a227]" size={30} strokeWidth={2.5} /></div>;
  if (loadError) return <State title="" copy="" action="Try again" onAction={() => void load()} />;
  if (!reels.length) return <State title={feed === 'following' ? 'Your Following feed is empty.' : 'Nothing to watch yet.'} copy={feed === 'following' ? 'Follow creators to see their Reels here.' : 'Follow creators or share your first Reel with VANTA.'} action={feed === 'following' ? 'Discover Creators' : 'Create Reel'} secondaryAction={feed === 'following' ? 'Create Reel' : 'Discover Creators'} onAction={feed === 'following' ? () => router.push('/discover') : openReelUploader} onSecondary={feed === 'following' ? openReelUploader : () => router.push('/discover')} />;

  return (
    <div data-dark-surface className="relative h-[var(--vanta-vh,100dvh)] overflow-hidden bg-[#050505] text-[#f5f5f5] [--reel-page-height:var(--vanta-vh,100dvh)]">
      <header className="pointer-events-none fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-center bg-black/35 px-16 backdrop-blur-sm">
        <div className="pointer-events-auto flex items-center gap-5" role="tablist" aria-label="Reel feeds">
          {(['for-you', 'following', 'trending'] as Feed[]).map(tab => (
            <button key={tab} type="button" role="tab" aria-selected={feed === tab} onClick={() => setFeed(tab)} className={cn('relative h-10 text-xs font-semibold text-white/55 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a227]', feed === tab && 'text-[#e6c35a]')}>
              {feedLabel(tab)}
              {feed === tab && <motion.span layoutId="reel-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-[#c9a227] shadow-[0_0_10px_rgba(201,162,39,.45)]" />}
            </button>
          ))}
        </div>
        <span className="absolute right-4 hidden text-[10px] uppercase text-white/35 ">{active + 1} / {reels.length}</span>
      </header>

      <PullToRefresh
        scrollRef={reelsViewport}
        onRefresh={refreshReels}
        ariaLabel="VANTA Reels feed"
        className="h-full min-h-0 w-full flex-none snap-y snap-mandatory touch-pan-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {reels.map((reel, index) => (
          <ReelCard
            key={reel.id}
            reel={reel}
            isOwn={Boolean(user && ((user.id && String(reel.author.id) === String(user.id)) || (user.username && reel.author.username?.toLowerCase() === user.username.toLowerCase())))}
            index={index}
            active={active === index}
            preload={shouldMountReelVideo(index, active, visiblePage, lowerData) ? reelPreload(index, active, lowerData, visiblePage, playingId === activeId) : null}
            muted={muted}
            shouldPlay={active === index && shouldPlay}
            blocked={blockedId === reel.id}
            onReady={tryPlay}
            onPlaying={playbackStarted}
            onStopped={playbackStopped}
            videos={videos}
            sections={sections}
            followPending={!!pending[`follow:${reel.author.id}`]}
            onPlayToggle={() => togglePlayback(reel.id)}
            onLike={() => void toggle(reel, 'like')}
            onEnsureLike={() => void toggle(reel, 'like', true)}
            likePending={!!pending[`like:${reel.id}`]}
            onSave={() => void toggle(reel, 'save')}
            onComment={() => void openComments(reel)}
            onGift={() => openGift(reel)}
            onFollow={() => void follow(reel)}
            onMore={() => setMoreFor(reel)}
            onShare={() => setShareFor(reel)}
            onCreator={() => router.push(`/profile/${reel.author.username}`)}
          />
        ))}
      </PullToRefresh>

      {loadMoreError && nextStart != null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <button type="button" onClick={() => {
            if (loadingMoreRef.current) return;
            loadingMoreRef.current = true;
            void load(nextStart, true).finally(() => { loadingMoreRef.current = false; });
          }} className="pointer-events-auto rounded-full border border-white/15 bg-[#1f2630] px-4 py-2 text-xs font-medium text-[#e6c35a] shadow-lg" aria-label="Retry loading more Reels">
            Couldn&apos;t load more Reels. Retry
          </button>
        </div>
      )}

      <AnimatePresence>
        {commentsFor && <CommentsPanel reel={commentsFor} items={comments} loading={commentsLoading} text={commentText} sending={commentSending} currentUserId={user?.id} setText={setCommentText} submit={submitComment} remove={deleteComment} toggleLike={toggleCommentLike} close={() => { commentsRequest.current += 1; setCommentsFor(null); }} />}
        {shareFor && (() => {
          const liveReel = reels.find(item => item.id === shareFor.id) ?? shareFor;
          return <ReelShareSheet
            token={token}
            url={`${typeof window !== 'undefined' ? window.location.origin : ''}/reels/${encodeURIComponent(liveReel.id)}`}
            title={liveReel.title || 'VANTA Reel'}
            saved={Boolean(liveReel.isSaved)}
            close={() => setShareFor(null)}
            onCopy={() => void share(liveReel, 'copy')}
            onNative={() => void share(liveReel, 'native')}
            onSave={() => { void toggle(liveReel, 'save'); setShareFor(null); }}
            onReport={() => { setReportFor(liveReel); setShareFor(null); }}
            onSend={sendToChat}
          />;
        })()}
        {moreFor && <MorePanel reel={moreFor} isOwn={Boolean(user && ((user.id && String(moreFor.author.id) === String(user.id)) || (user.username && moreFor.author.username?.toLowerCase() === user.username.toLowerCase())))} share={() => { setMoreFor(null); setShareFor(moreFor); }} save={() => { void toggle(moreFor, 'save'); setMoreFor(null); }} follow={() => { void follow(moreFor); setMoreFor(null); }} profile={() => router.push(`/profile/${moreFor.author.username}`)} report={() => { setReportFor(moreFor); setMoreFor(null); }} remove={() => { setDeleteReelFor(moreFor); setMoreFor(null); }} close={() => setMoreFor(null)} />}
        {deleteReelFor && <DeleteReelDialog reel={deleteReelFor} sending={deleteReelSending} onCancel={() => setDeleteReelFor(null)} onConfirm={() => void confirmDeleteReel()} />}
        {reportFor && <ReportPanel reel={reportFor} pending={!!pending[`report:${reportFor.id}`]} submit={category => void report(reportFor, category)} close={() => setReportFor(null)} />}
        {giftFor && token && <GiftPickerBoundary onClose={() => setGiftFor(null)}><GiftPicker gifts={gifts} balance={giftBalance} recipient={giftFor.author} token={token} videoId={giftFor.id} loading={giftLoading} loadError={giftError} onRetry={() => void loadGiftData()} onClose={() => setGiftFor(null)} onSent={(remaining, _amount, gift, quantity = 1) => { setGiftBalance(remaining); patch(giftFor.id, { gifts: (giftFor.gifts || 0) + quantity, isGifted: true }); toast.success('Gift sent', `You sent ${gift.name} to ${giftFor.author.fullName || giftFor.author.username}`); }} /></GiftPickerBoundary>}
      </AnimatePresence>
    </div>
  );
}

function ReelCard({ reel, isOwn, index, active, preload, muted, shouldPlay, blocked, onReady, onPlaying, onStopped, videos, sections, followPending, onPlayToggle, onLike, onEnsureLike, likePending, onSave, onComment, onGift, onFollow, onMore, onShare, onCreator }: {
  reel: Reel; isOwn: boolean; index: number; active: boolean; preload: 'auto' | 'metadata' | null; muted: boolean; shouldPlay: boolean; blocked: boolean;
  onReady: (id: string) => void; onPlaying: (id: string) => void; onStopped: (id: string) => void;
  videos: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  sections: MutableRefObject<Record<string, HTMLElement | null>>;
  followPending: boolean; onPlayToggle: () => void; onLike: () => void; onEnsureLike: () => void; likePending: boolean; onSave: () => void; onComment: () => void; onGift: () => void; onFollow: () => void; onMore: () => void; onShare: () => void; onCreator: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [progress, setProgress] = useState(0);
  const [likedPulse, setLikedPulse] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [posterFailed, setPosterFailed] = useState(false);
  const [nativeHlsSupported, setNativeHlsSupported] = useState(false);
  const [failedHlsUrl, setFailedHlsUrl] = useState<string | null>(null);
  useEffect(() => {
    setNativeHlsSupported(Boolean(document.createElement('video').canPlayType('application/vnd.apple.mpegurl')));
  }, []);
  const playbackSource = chooseReelPlaybackSource(reel.videoUrl, reel.hlsUrl, nativeHlsSupported, failedHlsUrl === reel.hlsUrl);
  const pulseTimer = useRef<number>();
  const tapTimer = useRef<number>();
  const lastTap = useRef<ReelTap | null>(null);
  const pointer = useRef<(ReelTap & { id: number }) | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const followed = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);

  const clearTap = useCallback(() => {
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    tapTimer.current = undefined;
    lastTap.current = null;
    pointer.current = null;
  }, []);
  useEffect(() => {
    if (!active) {
      clearTap();
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
      setLikedPulse(false);
    }
    return clearTap;
  }, [active, clearTap]);
  useEffect(() => () => { if (pulseTimer.current) window.clearTimeout(pulseTimer.current); }, []);
  useEffect(() => {
    setHasFrame(false); setVideoLoading(true); setVideoFailed(false); setVideoError(''); setProgress(0);
  }, [playbackSource, preload === null, retryKey]);
  useEffect(() => { setPosterFailed(false); }, [reel.thumbnailUrl]);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    const old = videos.current[reel.id];
    if (old && old !== node) old.pause();
    videos.current[reel.id] = node;
  }, [reel.id, videos]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!activeRef.current || !event.isPrimary || event.button !== 0) { clearTap(); return; }
    pointer.current = { x: event.clientX, y: event.clientY, at: performance.now(), id: event.pointerId };
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointer.current;
    if (start && (start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14)) clearTap();
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointer.current;
    pointer.current = null;
    const end = { x: event.clientX, y: event.clientY, at: performance.now() };
    if (!activeRef.current || !start || start.id !== event.pointerId || !isReelTap(start, end)) { clearTap(); return; }
    if (isReelDoubleTap(lastTap.current, end)) {
      clearTap();
      if (!reel.isLiked && !likePending) onEnsureLike();
      if (reel.isLiked || !likePending) {
        setLikedPulse(true);
        if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
        pulseTimer.current = window.setTimeout(() => setLikedPulse(false), 650);
      }
      return;
    }
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    lastTap.current = end;
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = null; tapTimer.current = undefined;
      if (activeRef.current) onPlayToggle();
    }, REEL_TAP_WINDOW_MS);
  };

  const fullscreen = async () => {
    const video = videos.current[reel.id];
    if (!video) return;
    try { await video.requestFullscreen(); } catch {}
  };

  const retry = () => {
    clearTap();
    setHasFrame(false);
    setVideoFailed(false);
    setVideoError('');
    setVideoLoading(true);
    setRetryKey(value => value + 1);
  };

  return (
    <section ref={node => { sections.current[reel.id] = node; }} data-index={index} className="relative flex h-[var(--reel-page-height,100dvh)] min-h-[var(--reel-page-height,100dvh)] w-full shrink-0 snap-start items-center justify-center bg-[#050505] pt-0">
      <div className="flex h-full min-h-full w-full items-center justify-center">
        <div className="relative h-full w-full overflow-hidden bg-black md:max-w-[480px]">
          {/* Keep the ambient fill as a thumbnail only. A second video decoder
              is unnecessary and can compete with the active Reel on Android. */}
          {active && reel.thumbnailUrl && !posterFailed ? (
            <img
              src={resolveMediaUrl(reel.thumbnailUrl)}
              alt=""
              aria-hidden="true"
              onError={() => setPosterFailed(true)}
              className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-110 object-cover blur-[28px]"
            />
          ) : null}
          {reel.thumbnailUrl && !posterFailed && <img src={resolveMediaUrl(reel.thumbnailUrl)} alt="" loading={active ? 'eager' : 'lazy'} decoding="async" onError={() => setPosterFailed(true)} className={cn('pointer-events-none absolute inset-0 z-[2] h-full w-full object-contain transition-opacity duration-150', hasFrame && !videoFailed && 'opacity-0')} />}
          {preload && (
            <video
              key={retryKey}
              ref={attachVideo}
              src={resolveMediaUrl(playbackSource)}
              poster={reel.thumbnailUrl && !posterFailed ? reel.thumbnailUrl : 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'}
              preload={preload}
              loop
              playsInline
              muted={muted}
              controls={false}
              disablePictureInPicture
              disableRemotePlayback
              onLoadStart={() => { setHasFrame(false); setVideoLoading(true); setVideoError(''); }}
              onError={(event) => {
                if (nativeHlsSupported && reel.hlsUrl && playbackSource === reel.hlsUrl && failedHlsUrl !== reel.hlsUrl) {
                  onStopped(reel.id);
                  setFailedHlsUrl(reel.hlsUrl);
                  setHasFrame(false);
                  setVideoLoading(true);
                  return;
                }
                const mediaError = event.currentTarget.error;
                const code = mediaError?.code;
                const detail = mediaError?.message || '';
                let message = 'This video could not be played.';
                if (code === 1) message = 'Playback was interrupted.';
                else if (code === 2) message = `The video could not be downloaded (network error)${detail ? `: ${detail}` : ''}.`;
                else if (code === 3) message = `The video file could not be decoded${detail ? `: ${detail}` : ''}.`;
                else if (code === 4) message = `The server returned no playable video source${detail ? `: ${detail}` : ''}.`;
                onStopped(reel.id);
                setVideoFailed(true);
                setVideoLoading(false);
                setVideoError(message);
                if (process.env.NODE_ENV !== 'production') console.error('[Reels] media load failed', { reelId: reel.id, src: event.currentTarget.currentSrc || reel.videoUrl, mediaError });
              }}
              onLoadedData={() => { setHasFrame(true); setVideoLoading(false); onReady(reel.id); }}
              onCanPlay={() => { setHasFrame(true); setVideoLoading(false); onReady(reel.id); }}
              onWaiting={() => { setVideoLoading(true); onStopped(reel.id); }}
              onPlaying={() => { setHasFrame(true); setVideoLoading(false); onPlaying(reel.id); }}
              onPause={() => onStopped(reel.id)}
              onStalled={() => { if (!hasFrame) setVideoLoading(true); }}
              onTimeUpdate={event => { const video = event.currentTarget; setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0); }}
              className={cn("vanta-reel-video pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain", !hasFrame && "opacity-0")}
              aria-label={`Reel by ${reel.author.username}`}
            />
          )}
          <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/90 via-transparent to-black/35" />

          {active && videoLoading && !videoFailed && shouldPlay && !blocked && <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center"><Loader2 className="animate-spin text-[#dfbd55]" size={24} /></div>}
          {active && !videoFailed && <button type="button" aria-label={shouldPlay && !blocked ? "Pause Reel" : "Play Reel"} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={clearTap} onPointerLeave={() => { if (pointer.current) clearTap(); }} onClick={event => { if (event.detail === 0) onPlayToggle(); }} className="absolute inset-0 z-[4] grid touch-pan-y place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfbd55]">{(!shouldPlay || blocked) && <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-[#dfbd55]"><Play size={22} fill="currentColor" /></span>}</button>}
          {videoFailed && <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 px-8 text-center"><div><Clapperboard className="mx-auto text-white/40" /><h3 className="mt-4 font-semibold">Unable to load Reel</h3><p className="mt-1 max-w-xs text-xs leading-5 text-white/45">{videoError || 'The video could not be played.'}</p><button type="button" onClick={retry} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm"><RefreshCw size={15} />Retry</button></div></div>}

          <div className="absolute right-3 top-16 z-10 flex gap-2">
            <button type="button" onClick={() => void fullscreen()} className="grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-label="Enter fullscreen"><Maximize size={16} /></button>
          </div>

          <AnimatePresence>{likedPulse && <motion.div initial={{ opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: [0.5, 1.2, 1] }} exit={{ opacity: 0, scale: 1.25 }} className="pointer-events-none absolute inset-0 z-20 grid place-items-center"><Heart size={84} fill="#f2c75c" stroke="#c9a227" className="drop-shadow-[0_0_18px_rgba(242,199,92,.9)]" /></motion.div>}</AnimatePresence>

          <div className="absolute bottom-[calc(1.25rem_+_var(--vanta-native-reel-action-offset,calc(4rem_+_env(safe-area-inset-bottom))))] left-4 right-20 z-10">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onCreator} className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <Avatar src={reel.author.avatar} alt={reel.author.username} size="sm" />
                <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{reel.author.fullName || reel.author.username}</span>{reel.author.verified && reel.author.verificationType && <VerificationBadge verified type={reel.author.verificationType} size="sm" />}</span><small className="block truncate text-[11px] text-white/60">@{reel.author.username}</small></span>
              </button>
              {!isOwn && <button type="button" disabled={followPending} onClick={onFollow} className={cn('min-w-[76px] rounded-md border px-3 py-1.5 text-xs font-semibold transition', followed ? 'border-white/15 bg-white/10 text-white/75' : 'border-white/50 text-white', followPending && 'opacity-60')}>
                {followPending ? <Loader2 className="mx-auto animate-spin" size={14} /> : followed ? 'Following' : 'Follow'}
              </button>}
            </div>
            <p className={cn('mt-3 max-w-[44ch] text-sm leading-5 text-white/90', !expanded && 'line-clamp-2', expanded && 'max-h-[36dvh] overflow-y-auto')}>{renderTextWithLinks(reel.description || reel.title || 'A new Reel on VANTA.', 'linkify', { mentions: true, hashtags: true, richPreviews: expanded })}</p>
            {((reel.description?.length || reel.title?.length || 0) > 110 || /(?:https?:\/\/|www\.)/i.test(reel.description || reel.title || '')) && <button type="button" onClick={() => setExpanded(value => !value)} className="mt-0.5 text-xs text-white/60">{expanded ? 'less' : 'more'}</button>}
          </div>

          <div className="absolute bottom-[calc(1.5rem_+_var(--vanta-native-reel-action-offset,calc(4rem_+_env(safe-area-inset-bottom))))] right-3 z-10 flex flex-col items-center gap-3 ">
            <div className="flex flex-col items-center gap-0.5 text-[10px] leading-3 text-white/65" aria-label={`${reel.views} views`}><span className="grid h-7 w-10 place-items-center"><Eye size={18} /></span><span>{formatCount(reel.views)}</span></div>
            <Action icon={<Heart className={reel.isLiked ? 'fill-[#f2c75c] text-[#c9a227] drop-shadow-[0_0_6px_rgba(242,199,92,.85)]' : 'text-[#8a8a8a]'} />} label={formatCount(reel.likes)} ariaLabel={reel.isLiked ? 'Unlike Reel' : 'Like Reel'} onClick={onLike} active={reel.isLiked} />
            <Action icon={<MessageCircle />} label={formatCount(reel.comments)} ariaLabel="Open comments" onClick={onComment} />
            <Action icon={<Share2 />} label={formatCount(reel.shares || 0)} ariaLabel={`Share Reel · ${reel.shares || 0} shares`} onClick={onShare} />
            <Action icon={<Gift className={reel.isGifted ? 'fill-current' : ''} />} label={formatCount(reel.gifts || 0)} ariaLabel={`Send a gift · ${reel.gifts || 0} gifts`} onClick={onGift} active={Boolean(reel.isGifted)} />
            <Action icon={<MoreHorizontal />} label="More" ariaLabel="More Reel actions" onClick={onMore} />
          </div>

          <div className="absolute inset-x-0 bottom-[var(--vanta-native-reel-action-offset,calc(4rem_+_env(safe-area-inset-bottom)))] z-20 h-0.5 bg-white/15"><span className="block h-full bg-[#c9a227] shadow-[0_0_8px_rgba(201,162,39,.5)] transition-[width] duration-100" style={{ width: `${progress}%` }} /></div>
        </div>

      </div>
    </section>
  );
}

function Action({ icon, label, ariaLabel, onClick, active }: { icon: ReactNode; label: string; ariaLabel: string; onClick: () => void; active?: boolean }) {
  const [pulse, setPulse] = useState(0);
  return <motion.button type="button" onClick={() => { setPulse(value => value + 1); onClick(); }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }} className={cn('flex min-h-10 min-w-10 flex-col items-center gap-0.5 text-[10px] leading-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60', active ? 'text-[#c9a227]' : 'text-[#8a8a8a] hover:text-white')} aria-label={ariaLabel} aria-pressed={active}>
    <span className="relative grid h-7 w-10 place-items-center">
      <motion.span key={pulse} initial={{ scale: 0.65, rotate: -18 }} animate={{ scale: [0.65, 1.35, 0.95, 1], rotate: [-18, 10, -4, 0] }} transition={{ duration: 0.42, times: [0, 0.42, 0.72, 1], ease: 'easeOut' }}>{icon}</motion.span>
    </span><span>{label}</span>
  </motion.button>;
}

function CommentsPanel({ reel, items, loading, text, sending, currentUserId, setText, submit, remove, toggleLike, close }: { reel: Reel; items: ReelComment[]; loading: boolean; text: string; sending: boolean; currentUserId?: string; setText: (value: string) => void; submit: () => void; remove: (comment: ReelComment) => Promise<boolean>; toggleLike: (comment: ReelComment) => void; close: () => void }) {
  const [deleteFor, setDeleteFor] = useState<ReelComment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const confirmRemove = async () => {
    if (!deleteFor || deleteBusy) return;
    setDeleteBusy(true);
    try {
      if (await remove(deleteFor)) setDeleteFor(null);
    } finally {
      setDeleteBusy(false);
    }
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { token } = useAuth();
  const mentions = useMentionSuggestions({ value: text, onChange: setText, token, inputRef });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return createPortal(<>
    <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close comments" className="fixed inset-0 z-[79] bg-black/35" />
    <motion.section
      initial={{ y: '100%', opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0.6 }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      role="dialog"
      aria-modal="true"
      aria-label="Reel comments"
      className="vanta-reel-comments fixed inset-x-0 z-[80] mx-auto flex w-full max-w-[520px] flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-white/10 bg-[var(--background)] shadow-2xl"
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-4">
        <h2 className="text-[15px] font-semibold text-[#dfbd55]">Comments <span className="font-normal text-white/40">{reel.comments > 0 ? `(${reel.comments})` : ''}</span></h2>
        <button type="button" onClick={close} className="-mr-1 grid h-9 w-9 place-items-center rounded-lg text-[#dfbd55] transition hover:bg-white/[.06]" aria-label="Close comments"><X size={18} /></button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-1" aria-live="polite">
        {loading ? (
          <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-[#dfbd55]" /></div>
        ) : items.length ? items.map(item => (
          <article key={item.id} className="flex gap-3 py-3">
            <Link href={item.user?.username ? `/profile/${encodeURIComponent(item.user.username)}` : '/profile'} aria-label={`Open ${item.user?.username ? '@' + item.user.username : 'commenter'} profile`} className="h-9 w-9 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a227]">
              <Avatar src={item.user?.avatar} alt={item.user?.username || ''} size="sm" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="inline-flex min-w-0 items-center gap-1 text-[13px] font-semibold text-[#f5f5f5]">
                  <Link href={item.user?.username ? `/profile/${encodeURIComponent(item.user.username)}` : '/profile'} className="truncate hover:underline">{item.user?.fullName || item.user?.username || 'VANTA user'}</Link>
                  {item.user?.verified && item.user?.verificationType && <VerificationBadge verified type={item.user.verificationType} size="xs" className="shrink-0 align-[-1px]" />}
                </b>
                {item.createdAt && <time className="shrink-0 text-[11px] leading-none text-white/35">{timeAgo(item.createdAt)}</time>}
              </div>
              <p className="mt-1 break-words text-sm leading-5 text-white/75">{renderTextWithLinks(item.content, 'linkify', { mentions: true, hashtags: true })}</p>
              <button type="button" onClick={() => toggleLike(item)} aria-label={item.liked ? 'Unlike comment' : 'Like comment'} aria-pressed={Boolean(item.liked)} className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition hover:bg-white/[.06]', item.liked ? 'text-[#c9a227]' : 'text-white/45 hover:text-white')}>
                <Heart size={13} fill={item.liked ? 'currentColor' : 'none'} /> Like {item._count?.likes || 0}
              </button>
            </div>
            {currentUserId && (item.userId === currentUserId || item.user?.id === currentUserId) && (
              <button type="button" onClick={() => setDeleteFor(item)} className="-mr-1 grid h-7 w-7 shrink-0 place-items-center self-center rounded-lg text-white/30 transition hover:text-white" aria-label="Delete your comment"><Trash2 size={14} /></button>
            )}
          </article>
        )) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <MessageCircle className="mx-auto text-[#dfbd55]/65" size={26} />
              <p className="mt-3 text-sm text-white/45">Be the first to comment.</p>
            </div>
          </div>
        )}
      </div>

      <div className="vanta-comment-composer relative flex shrink-0 flex-col gap-1 border-t border-white/[.07] bg-[var(--background)] px-3 pt-2">
        <MentionSuggestions mention={mentions} className="!max-h-[min(24dvh,140px)] rounded-lg" />
        <div className="flex items-end gap-2">
        <MentionTextarea surfaceClassName="rounded-full bg-[var(--surface)]"
          rows={1}
          ref={inputRef}
          value={text}
          onChange={event => { setText(event.target.value); mentions.syncCaret(event.currentTarget); }}
          onClick={event => mentions.syncCaret(event.currentTarget)}
          onKeyUp={event => mentions.syncCaret(event.currentTarget)}
          onKeyDown={event => { if (mentions.onKeyDown(event)) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
          maxLength={1000}
          placeholder="Add a comment..."
          className="min-w-0 flex-1 resize-none rounded-full border border-white/10 bg-[var(--surface)] px-4 py-2 text-[15px] text-[#f5f5f5] outline-none placeholder:text-white/35 focus:border-[#dfbd55]/50"
        />
        <button type="button" disabled={!text.trim() || sending} onClick={submit} aria-label="Send comment" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c9a227] text-[#1f2630] transition disabled:opacity-40"><Send size={15} /></button>
        </div>
      </div>
    </motion.section>
    {deleteFor && <DeleteConfirmDialog title="Delete this comment?" description="This cannot be undone. The comment will be removed permanently." confirmLabel="Delete comment" busy={deleteBusy} onCancel={() => { if (!deleteBusy) setDeleteFor(null); }} onConfirm={() => void confirmRemove()} />}
  </>, document.body);
}

function MorePanel({ reel, isOwn, share, save, follow, profile, report, remove, close }: { reel: Reel; isOwn: boolean; share: () => void; save: () => void; follow: () => void; profile: () => void; report: () => void; remove: () => void; close: () => void }) {
  const followed = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);
  return <Dialog title="More" close={close}><div className="space-y-1.5"><MenuButton icon={<Share2 size={17} />} label={`Share Reel · ${formatCount(reel.shares || 0)}`} onClick={share} /><MenuButton icon={<User size={17} />} label="View creator profile" onClick={profile} /><MenuButton icon={<BookmarkIcon size={17} saved={Boolean(reel.isSaved)} />} label={reel.isSaved ? 'Remove from saved' : 'Save Reel'} onClick={save} />{isOwn ? <MenuButton icon={<Trash2 size={17} />} label="Delete Reel" onClick={remove} /> : <MenuButton icon={followed ? <X size={17} /> : <Check size={17} />} label={followed ? 'Unfollow creator' : 'Follow creator'} onClick={follow} />}<MenuButton icon={<Flag size={17} />} label="Report Reel" onClick={report} /></div></Dialog>;
}

function DeleteReelDialog({ sending, onCancel, onConfirm }: { reel: Reel; sending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <DeleteConfirmDialog title="Delete this Reel?" description="This cannot be undone. The Reel will be removed from VANTA immediately." confirmLabel="Delete Reel" busy={sending} onCancel={onCancel} onConfirm={onConfirm} />;
}

function ReportPanel({ reel, pending, submit, close }: { reel: Reel; pending: boolean; submit: (category: string) => void; close: () => void }) {
  const categories = ['Spam or misleading', 'Harassment or hate', 'Nudity or sexual content', 'Violence or dangerous acts', 'Copyright infringement'];
  return <Dialog title="Report Reel" close={close}><p className="mb-3 text-sm text-white/50">Tell us why this Reel by @{reel.author.username} should be reviewed.</p><div className="space-y-1">{categories.map(category => <button key={category} type="button" disabled={pending} onClick={() => submit(category)} className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-white/75 hover:bg-white/[.05] disabled:opacity-50"><span>{category}</span>{pending && <Loader2 className="animate-spin" size={14} />}</button>)}</div></Dialog>;
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label={`Close ${title}`} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" /><motion.section initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} role="dialog" aria-modal="true" aria-label={title} className="fixed bottom-[var(--vanta-kb,0px)] left-0 right-0 z-[60] mx-auto max-h-[calc(var(--vanta-vh,100dvh)-8px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border border-white/[0.08] bg-[#1F2630] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"><header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-lg text-white/50 hover:bg-white/[.06]" aria-label="Close"><X size={18} /></button></header>{children}</motion.section></>;
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-white/85 transition hover:bg-white/[.06] active:bg-white/[.08]">{icon}{label}</button>;
}

function State({ title, copy, action, secondaryAction, onAction, onSecondary, loading = false }: { title: string; copy: string; action?: string; secondaryAction?: string; onAction?: () => void; onSecondary?: () => void; loading?: boolean }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white"><div>{loading ? <Loader2 className="mx-auto mb-5 animate-spin text-[#8a8a8a]" size={38} /> : <Clapperboard className="mx-auto mb-5 text-[#8a8a8a]" size={42} />}<h1 className="text-2xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-white/50">{copy}</p><div className="mt-6 flex flex-wrap justify-center gap-2">{action && <button type="button" onClick={onAction} className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black">{action}</button>}{secondaryAction && <button type="button" onClick={onSecondary} className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/75">{secondaryAction}</button>}</div></div></div>;
}