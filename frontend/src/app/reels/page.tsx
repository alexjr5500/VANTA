'use client';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
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
import { renderTextWithLinks } from '@/lib/linkify';
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
  const [paused, setPaused] = useState(false);
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
  const userInteractedRef = useRef(false);
  const [nextStart, setNextStart] = useState<number | null>(null);
  const feedSeedRef = useRef<string>(`sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const loadingMoreRef = useRef(false);
  const loadRequest = useRef(0);
  const reelsViewport = useRef<HTMLElement | null>(null);
  // Derived feed-mount signal used by the swipe effect below: the touch
  // listeners must attach only once the scroll viewport actually exists.
  const hasReels = reels.length > 0;

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
      if (!append) { setActive(0); setPaused(false); }
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
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
        Object.values(videos.current).forEach(video => video?.pause());
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        void refreshReels();
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void refreshReels();
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
    if (active >= reels.length - 3) void loadMore();
  }, [active, reels.length, loadMore]);

  useEffect(() => {
    const requested = params.get('reel');
    const index = reels.findIndex(reel => reel.id === requested);
    if (index >= 0) window.setTimeout(() => sections.current[reels[index].id]?.scrollIntoView(), 0);
  }, [params, reels]);

  useEffect(() => {
    const root = reelsViewport.current;
    if (!root) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) {
        const nextActive = Number((visible.target as HTMLElement).dataset.index);
        setActive(previous => previous === nextActive ? previous : nextActive);
        setPaused(false);
      }
    }, { root, threshold: [0.65, 0.8] });
    Object.values(sections.current).forEach(node => node && observer.observe(node));
    return () => observer.disconnect();
  }, [reels]);

  useEffect(() => {
    reels.forEach((reel, index) => {
      const video = videos.current[reel.id];
      if (!video) return;
      video.muted = muted;
      if (index === active && !paused) {
        // Calling play here, rather than relying only on the attribute, makes
        // activation deterministic after an IntersectionObserver transition.
        void video.play().catch(error => {
          // Autoplay may be temporarily blocked while the element is mounting;
          // keep the feed in autoplay mode and retry from media readiness events.
          if (process.env.NODE_ENV !== 'production') console.warn('[Reels] autoplay deferred', { reelId: reel.id, src: video.currentSrc || video.src, error });
        });
      } else {
        // Explicitly pause every non-active element so a fast swipe can never
        // leave two videos playing at once.
        video.pause();
      }
    });
    const reel = reels[active];
    if (!token || !reel || viewed.current.has(reel.id) || paused) return;
    const timer = window.setTimeout(() => {
      viewed.current.add(reel.id);
      void apiPost<{ counted: boolean; views: number }>(`/api/reels/${reel.id}/views`, { watchTime: 2 }, token)
        .then(result => setReels(items => items.map(item => item.id === reel.id ? { ...item, views: result.views } : item)))
        .catch(() => viewed.current.delete(reel.id));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [active, muted, paused, reels, token]);

  useEffect(() => () => {
    Object.values(videos.current).forEach(video => video?.pause());
  }, []);

  // Graceful autoplay-with-sound handling: some mobile/desktop browsers block
  // autoplay WITH audio until the user interacts. VANTA never intentionally mutes
  // Reels — if the active video couldn't start with sound, we retry it as soon as
  // the user taps/keys, preserving their audio preference (`muted`) for the feed.
  useEffect(() => {
    const retrySound = () => {
      if (!userInteractedRef.current) return;
      const activeVideo = videos.current[reels[active]?.id];
      if (activeVideo && activeVideo.paused && !paused && !muted) {
        void activeVideo.play().catch(() => undefined);
      }
    };
    const markInteraction = (event: Event) => {
      if (!userInteractedRef.current) userInteractedRef.current = true;
      retrySound();
    };
    window.addEventListener('pointerdown', markInteraction);
    window.addEventListener('touchstart', markInteraction);
    window.addEventListener('keydown', markInteraction);
    return () => {
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('keydown', markInteraction);
    };
  }, [active, muted, paused, reels]);

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
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); jump(active + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); jump(active - 1); }
      if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, jump]);

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
      setPaused(false);
      toast.success('Reel deleted');
    } catch (reason: any) {
      toast.error('Reel not deleted', reason?.message);
    } finally {
      setDeleteReelSending(false);
    }
  };

  const toggle = async (reel: Reel, action: 'like' | 'save') => {
    if (!token) { toast.error('Sign in required'); return; }
    const key = `${action}:${reel.id}`;
    if (pendingActionsRef.current.has(key)) return;
    pendingActionsRef.current.add(key);
    const was = action === 'like' ? !!reel.isLiked : !!reel.isSaved;
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
    if (pending[key]) return;
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
      setPending(items => ({ ...items, [key]: false }));
    }
  };

  const openComments = async (reel: Reel) => {
    setCommentsFor(reel);
    setComments([]);
    setCommentsLoading(true);
    try {
      const result = await apiGet<{ items?: ReelComment[] }>(`/api/reels/${reel.id}/comments?limit=30`, token || undefined, { skipCache: true });
      setComments(result.items || []);
    } catch {
      toast.error('Comments unavailable');
    } finally {
      setCommentsLoading(false);
    }
  };

  const submitComment = async () => {
    if (!token || !commentsFor || !commentText.trim() || commentSending) return;
    setCommentSending(true);
    try {
      const created = await apiPost<ReelComment>(`/api/reels/${commentsFor.id}/comments`, { content: commentText.trim() }, token);
      setComments(items => [created, ...items]);
      patch(commentsFor.id, { comments: commentsFor.comments + 1 });
      setCommentsFor(current => current ? { ...current, comments: current.comments + 1 } : current);
      setCommentText('');
    } catch (reason: any) {
      toast.error('Comment not saved', reason?.message);
    } finally {
      setCommentSending(false);
    }
  };

  const deleteComment = async (comment: ReelComment): Promise<boolean> => {
    if (!token || !commentsFor) return false;
    try {
      await apiDelete(`/api/reels/${commentsFor.id}/comments/${comment.id}`, token);
      setComments(items => items.filter(item => item.id !== comment.id));
      patch(commentsFor.id, { comments: Math.max(0, commentsFor.comments - 1) });
      setCommentsFor(current => current ? { ...current, comments: Math.max(0, current.comments - 1) } : current);
      return true;
    } catch (reason: any) {
      toast.error('Comment not deleted', reason?.message);
      return false;
    }
  };

  const toggleCommentLike = async (comment: ReelComment) => {
    if (!token || !commentsFor) { toast.error('Sign in to like comments'); return; }
    const wasLiked = Boolean(comment.liked);
    const previousCount = Number(comment._count?.likes || 0);
    const optimisticLiked = !wasLiked;
    const optimisticCount = Math.max(0, previousCount + (wasLiked ? -1 : 1));
    const apply = (items: ReelComment[], liked: boolean, count: number) => items.map(item => item.id === comment.id
      ? { ...item, liked, _count: { likes: count, replies: 0 } }
      : item);
    setComments(items => apply(items, optimisticLiked, optimisticCount));
    try {
      const result = await apiPost<{ liked: boolean; likes: number }>(`/api/reels/${commentsFor.id}/comments/${comment.id}/like`, {}, token);
      setComments(items => apply(items, result.liked, result.likes));
    } catch (reason: any) {
      setComments(items => apply(items, wasLiked, previousCount));
      toast.error('Comment like failed', reason?.message);
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
    <div data-dark-surface className="relative h-[100dvh] overflow-hidden bg-[#050505] text-[#f5f5f5] ">
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
        className="h-[100dvh] min-h-[100dvh] w-full flex-none snap-y snap-mandatory touch-pan-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {reels.map((reel, index) => (
          <ReelCard
            key={reel.id}
            reel={reel}
            isOwn={Boolean(user && ((user.id && String(reel.author.id) === String(user.id)) || (user.username && reel.author.username?.toLowerCase() === user.username.toLowerCase())))}
            index={index}
            active={active === index}
            nearby={Math.abs(active - index) <= 1}
            muted={muted}
            paused={paused}
            videos={videos}
            sections={sections}
            followPending={!!pending[`follow:${reel.author.id}`]}
            onPlayToggle={() => setPaused(value => !value)}
            onLike={() => void toggle(reel, 'like')}
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

      

      <AnimatePresence>
        {commentsFor && <CommentsPanel reel={commentsFor} items={comments} loading={commentsLoading} text={commentText} sending={commentSending} currentUserId={user?.id} setText={setCommentText} submit={submitComment} remove={deleteComment} toggleLike={toggleCommentLike} close={() => setCommentsFor(null)} />}
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

function ReelCard({ reel, isOwn, index, active, nearby, muted, paused, videos, sections, followPending, onPlayToggle, onLike, onSave, onComment, onGift, onFollow, onMore, onShare, onCreator }: {
  reel: Reel; isOwn: boolean; index: number; active: boolean; nearby: boolean; muted: boolean; paused: boolean;
  videos: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  sections: MutableRefObject<Record<string, HTMLElement | null>>;
  followPending: boolean; onPlayToggle: () => void; onLike: () => void; onSave: () => void; onComment: () => void; onGift: () => void; onFollow: () => void; onMore: () => void; onShare: () => void; onCreator: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [progress, setProgress] = useState(0);
  const [likedPulse, setLikedPulse] = useState<'like' | 'unlike' | null>(null);
  const pulseTimer = useRef<number>();
  const tapTimer = useRef<number>();
  const lastTap = useRef(0);
  const followed = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);

  // Device-local Autoplay preference: when disabled, active reels load but do
  // not start until the user taps.
  const { prefs: contentPrefs, hydrated: contentPrefsReady } = useContentPrefs();
  const autoplayEnabled = contentPrefsReady ? contentPrefs.autoplay : true;

  useEffect(() => () => {
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
  }, []);

  // Double-tap toggles like/unlike through the same handler as the Like button.
  const likeWithFeedback = () => {
    setLikedPulse(reel.isLiked ? 'unlike' : 'like');
    onLike();
    if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setLikedPulse(null), 700);
  };

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      likeWithFeedback();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(onPlayToggle, 280);
  };

  const fullscreen = async () => {
    const video = videos.current[reel.id];
    if (!video) return;
    try { await video.requestFullscreen(); } catch {}
  };

  const retry = () => {
    const video = videos.current[reel.id];
    setVideoFailed(false);
    setVideoError('');
    setVideoLoading(true);
    video?.load();
    if (active && !paused && autoplayEnabled) void video?.play().catch(() => {});
  };

  return (
    <section ref={node => { sections.current[reel.id] = node; }} data-index={index} className="relative flex h-[100dvh] min-h-[100dvh] w-full snap-start items-center justify-center bg-[#050505] pt-0">
      <div className="flex h-full min-h-full w-full items-center justify-center">
        <div className="relative h-full w-full overflow-hidden bg-black md:max-w-[480px]">
          {/* Keep the ambient fill as a thumbnail only. A second video decoder
              is unnecessary and can compete with the active Reel on Android. */}
          {reel.thumbnailUrl ? (
            <img
              src={resolveMediaUrl(reel.thumbnailUrl)}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-110 object-cover blur-[28px]"
            />
          ) : null}
          {reel.thumbnailUrl && <img src={resolveMediaUrl(reel.thumbnailUrl)} alt="" className={cn('absolute inset-0 z-0 h-full w-full object-contain transition-opacity duration-300', !videoLoading && !videoFailed && 'opacity-0')} />}
          {nearby && !videoFailed && (
            <video
              ref={node => { videos.current[reel.id] = node; }}
              src={resolveMediaUrl(reel.videoUrl)}
              poster={resolveMediaUrl(reel.thumbnailUrl)}
              preload={active ? 'auto' : 'metadata'}
              autoPlay={active && !paused && autoplayEnabled}
              loop
              playsInline
              muted={muted}
              onClick={handleTap}
              onLoadStart={() => { setVideoLoading(true); setVideoError(''); }}
              onError={(event) => {
                const mediaError = event.currentTarget.error;
                const code = mediaError?.code;
                const detail = mediaError?.message || '';
                let message = 'This video could not be played.';
                if (code === 1) message = 'Playback was interrupted.';
                else if (code === 2) message = `The video could not be downloaded (network error)${detail ? `: ${detail}` : ''}.`;
                else if (code === 3) message = `The video file could not be decoded${detail ? `: ${detail}` : ''}.`;
                else if (code === 4) message = `The server returned no playable video source${detail ? `: ${detail}` : ''}.`;
                setVideoFailed(true);
                setVideoLoading(false);
                setVideoError(message);
                if (process.env.NODE_ENV !== 'production') console.error('[Reels] media load failed', { reelId: reel.id, src: event.currentTarget.currentSrc || reel.videoUrl, mediaError });
              }}
              onCanPlay={event => {
                setVideoLoading(false);
                if (active && !paused) void event.currentTarget.play().catch(() => {});
              }}
              onWaiting={() => setVideoLoading(true)}
              onPlaying={() => setVideoLoading(false)}
              onTimeUpdate={event => { const video = event.currentTarget; setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0); }}
              className="absolute inset-0 z-[1] h-full w-full object-contain"
              aria-label={`Reel by ${reel.author.username}`}
            />
          )}
          <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/90 via-transparent to-black/35" />

          {videoLoading && !videoFailed && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="animate-spin text-white/70" size={28} /></div>}
          {videoFailed && <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 px-8 text-center"><div><Clapperboard className="mx-auto text-white/40" /><h3 className="mt-4 font-semibold">Unable to load Reel</h3><p className="mt-1 max-w-xs text-xs leading-5 text-white/45">{videoError || 'The video could not be played.'}</p><button type="button" onClick={retry} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm"><RefreshCw size={15} />Retry</button></div></div>}

          <div className="absolute right-3 top-16 z-10 flex gap-2">
            <button type="button" onClick={() => void fullscreen()} className="grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-label="Enter fullscreen"><Maximize size={16} /></button>
          </div>

          {active && paused && !videoFailed && <button type="button" onClick={onPlayToggle} className="absolute inset-0 z-10 m-auto grid h-14 w-14 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label="Play Reel"><Play size={23} fill="white" /></button>}
          <AnimatePresence>{likedPulse && <motion.div key={likedPulse} initial={{ opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: likedPulse === 'like' ? [0.5, 1.2, 1] : 1 }} exit={{ opacity: 0, scale: likedPulse === 'like' ? 1.25 : 0.85 }} className="pointer-events-none absolute inset-0 z-20 grid place-items-center">{likedPulse === 'like' ? <span className="relative"><Heart size={84} fill="#f2c75c" stroke="#c9a227" className="drop-shadow-[0_0_18px_rgba(242,199,92,.9)]" /><motion.span initial={{ opacity: 0, scale: .4, rotate: -20 }} animate={{ opacity: [0, 1, 0], scale: [.4, 1.2, .8], rotate: [-20, 10, 25] }} transition={{ duration: .6 }} className="absolute -right-4 -top-4 text-[#f2c75c]"><Sparkles size={28} /></motion.span><motion.span initial={{ opacity: 0, scale: .4 }} animate={{ opacity: [0, 1, 0], scale: [.4, 1, .7] }} transition={{ duration: .6, delay: .1 }} className="absolute -bottom-3 -left-5 text-[#ffe08a]"><Sparkles size={20} /></motion.span></span> : <Heart size={76} fill="none" stroke="#8a8a8a" className="drop-shadow-2xl" />}</motion.div>}</AnimatePresence>

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
            <p className={cn('mt-3 max-w-[44ch] text-sm leading-5 text-white/90', !expanded && 'line-clamp-2')}>{reel.description || reel.title || 'A new Reel on VANTA.'}</p>
            {(reel.description?.length || reel.title?.length || 0) > 110 && <button type="button" onClick={() => setExpanded(value => !value)} className="mt-0.5 text-xs text-white/60">{expanded ? 'less' : 'more'}</button>}
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
  // Track the on-screen keyboard via the visual viewport so the sheet pins
  // itself above it (and never lets the keyboard cover the composer).
  const [keyboard, setKeyboard] = useState({ open: false, bottom: 0, viewHeight: typeof window !== 'undefined' ? window.innerHeight : 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const gap = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setKeyboard({ open: gap > 140, bottom: gap > 140 ? gap : 0, viewHeight: vv.height });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // When the keyboard opens, keep the newest comments in view and make sure
  // the composer stays reachable.
  useEffect(() => {
    if (keyboard.open) {
      const raf = window.requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: 0 });
        inputRef.current?.scrollIntoView({ block: 'nearest' });
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [keyboard.open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  const sheetHeight = Math.min(Math.max(260, Math.round(keyboard.viewHeight * 0.92)), 760);

  return <>
    <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close comments" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
    <motion.section
      initial={{ y: '100%', opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0.6 }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      role="dialog"
      aria-modal="true"
      aria-label="Reel comments"
      className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-[28rem] flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-white/10 bg-[#101010] shadow-2xl"
      style={{ bottom: keyboard.bottom, height: sheetHeight }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-5">
        <h2 className="text-[15px] font-semibold text-[#f5f5f5]">Comments <span className="font-normal text-white/40">{reel.comments > 0 ? `(${reel.comments})` : ''}</span></h2>
        <button type="button" onClick={close} className="-mr-1 grid h-9 w-9 place-items-center rounded-lg text-white/50 transition hover:bg-white/[.06] hover:text-white" aria-label="Close comments"><X size={18} /></button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-1" aria-live="polite">
        {loading ? (
          <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-white/40" /></div>
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
              <MessageCircle className="mx-auto text-white/25" size={26} />
              <p className="mt-3 text-sm text-white/45">Be the first to comment.</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/[.07] bg-[#101010] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input
          ref={inputRef}
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
          maxLength={1000}
          placeholder="Add a comment..."
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[.05] px-4 py-2.5 text-[15px] text-[#f5f5f5] outline-none placeholder:text-white/35 focus:border-white/25"
        />
        <button type="button" disabled={!text.trim() || sending} onClick={submit} aria-label="Send comment" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black transition disabled:opacity-40"><Send size={15} /></button>
      </div>
    </motion.section>
    {deleteFor && <DeleteConfirmDialog title="Delete this comment?" description="This cannot be undone. The comment will be removed permanently." confirmLabel="Delete comment" busy={deleteBusy} onCancel={() => { if (!deleteBusy) setDeleteFor(null); }} onConfirm={() => void confirmRemove()} />}
  </>;
}

function MorePanel({ reel, isOwn, share, save, follow, profile, report, remove, close }: { reel: Reel; isOwn: boolean; share: () => void; save: () => void; follow: () => void; profile: () => void; report: () => void; remove: () => void; close: () => void }) {
  const followed = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);
  return <Dialog title="More" close={close}><div className="space-y-1.5"><MenuButton icon={<Share2 size={17} />} label={`Share Reel · ${formatCount(reel.shares || 0)}`} onClick={share} /><MenuButton icon={<User size={17} />} label="View creator profile" onClick={profile} /><MenuButton icon={<Bookmark size={17} />} label={reel.isSaved ? 'Remove from saved' : 'Save Reel'} onClick={save} />{isOwn ? <MenuButton icon={<Trash2 size={17} />} label="Delete Reel" onClick={remove} /> : <MenuButton icon={followed ? <X size={17} /> : <Check size={17} />} label={followed ? 'Unfollow creator' : 'Follow creator'} onClick={follow} />}<MenuButton icon={<Flag size={17} />} label="Report Reel" onClick={report} /></div></Dialog>;
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