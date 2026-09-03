'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
  Check,
  Clapperboard,
  Compass,
  Copy,
  ExternalLink,
  Flag,
  Gift,
  Heart,
  Home,
  Eye,
  Loader2,
  Maximize,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import { useToast } from '@/components/ui/Toast';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import GiftPicker, { GiftCatalogItem } from '@/components/social/GiftPicker';
import GiftPickerBoundary from '@/components/social/GiftPickerBoundary';
import { normalizeGiftCatalog } from '@/lib/giftCatalog';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';

type Feed = 'for-you' | 'following' | 'trending';
type Author = {
  id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  verified?: boolean;
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
  user?: { id: string; username: string; fullName?: string; avatar?: string };
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
  const { openCreateHub, openReelUploader } = useContentCreation();
  const [feed, setFeed] = useState<Feed>('for-you');
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Reel | null>(null);
  const [shareFor, setShareFor] = useState<Reel | null>(null);
  const [moreFor, setMoreFor] = useState<Reel | null>(null);
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
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const viewed = useRef(new Set<string>());
  const loadRequest = useRef(0);
  const reelsViewport = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    setLoadError(false);
    try {
      const result = await apiGet<{ items?: Reel[] } | Reel[]>(`/api/reels?feed=${feed}&limit=20`, token || undefined, { skipCache: true });
      if (requestId !== loadRequest.current) return;
      const items = Array.isArray(result) ? result : result.items || [];
      setReels(items.map(reel => ({
        ...reel,
        videoUrl: resolveMediaUrl(reel.videoUrl),
        thumbnailUrl: resolveMediaUrl(reel.thumbnailUrl) || undefined,
        author: { ...reel.author, isFollowing: reel.author?.isFollowing ?? reel.isFollowing },
      })));
      setActive(0);
      setPaused(false);
    } catch (reason: any) {
      if (requestId === loadRequest.current && reason?.statusCode !== 499) setLoadError(true);
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, [feed, token]);

  useEffect(() => { void load(); }, [load]);

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

  const jump = useCallback((index: number) => {
    const reel = reels[index];
    if (reel) sections.current[reel.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [reels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); jump(active + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); jump(active - 1); }
      if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
      if (event.key.toLowerCase() === 'm') setMuted(value => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, jump]);

  const patch = useCallback((id: string, changes: Partial<Reel>) => {
    setReels(items => items.map(item => item.id === id ? { ...item, ...changes } : item));
  }, []);

  const toggle = async (reel: Reel, action: 'like' | 'save') => {
    if (!token) { toast.error('Sign in required'); return; }
    const key = `${action}:${reel.id}`;
    if (pending[key]) return;
    const was = action === 'like' ? !!reel.isLiked : !!reel.isSaved;
    setPending(items => ({ ...items, [key]: true }));
    patch(reel.id, action === 'like' ? { isLiked: !was, likes: Math.max(0, reel.likes + (was ? -1 : 1)) } : { isSaved: !was });
    try {
      const result = await apiPost<{ liked?: boolean; saved?: boolean }>(`/api/reels/${reel.id}/${action}`, {}, token);
      patch(reel.id, action === 'like' ? { isLiked: !!result.liked } : { isSaved: !!result.saved });
    } catch (reason: any) {
      patch(reel.id, action === 'like' ? { isLiked: was, likes: reel.likes } : { isSaved: was });
      toast.error('Reel update failed', reason?.message);
    } finally {
      setPending(items => ({ ...items, [key]: false }));
    }
  };

  const follow = async (reel: Reel) => {
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

  const deleteComment = async (comment: ReelComment) => {
    if (!token || !commentsFor) return;
    try {
      await apiDelete(`/api/reels/${commentsFor.id}/comments/${comment.id}`, token);
      setComments(items => items.filter(item => item.id !== comment.id));
      patch(commentsFor.id, { comments: Math.max(0, commentsFor.comments - 1) });
      setCommentsFor(current => current ? { ...current, comments: Math.max(0, current.comments - 1) } : current);
    } catch (reason: any) {
      toast.error('Comment not deleted', reason?.message);
    }
  };

  const share = async (reel: Reel, mode: 'copy' | 'native') => {
    const url = `${location.origin}/reels/${reel.id}`;
    try {
      if (mode === 'native' && navigator.share) await navigator.share({ title: reel.title || 'VANTA Reel', url });
      else { await navigator.clipboard.writeText(url); toast.success('Reel link copied'); }
      setShareFor(null);
    } catch (reason: any) {
      if (reason?.name !== 'AbortError') toast.error('Unable to share this Reel');
    }
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

  const nav = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/discover', label: 'Discover', icon: Compass },
    { href: '', label: 'Create', icon: Plus, create: true },
    { href: '/chat', label: 'Chat', icon: MessageCircle },
    { href: '/profile', label: 'Profile', icon: User },
  ];

  if (loading) return <State title="Loading Reels" copy="Preparing your next story." loading />;
  if (loadError) return <State title="Reels need a refresh" copy="We couldn't bring in the latest videos." action="Try again" onAction={() => void load()} />;
  if (!reels.length) return <State title={feed === 'following' ? 'Your Following feed is empty.' : 'Nothing to watch yet.'} copy={feed === 'following' ? 'Follow creators to see their Reels here.' : 'Follow creators or share your first Reel with VANTA.'} action={feed === 'following' ? 'Discover Creators' : 'Create Reel'} secondaryAction={feed === 'following' ? 'Create Reel' : 'Discover Creators'} onAction={feed === 'following' ? () => router.push('/discover') : openReelUploader} onSecondary={feed === 'following' ? openReelUploader : () => router.push('/discover')} />;

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-[#050505] text-[#f5f5f5] ">
      <header className="pointer-events-none fixed left-0 right-0 top-0 z-30 flex h-16 items-center justify-center bg-gradient-to-b from-black/75 to-transparent px-16 ">
        <div className="pointer-events-auto flex items-center gap-5" role="tablist" aria-label="Reel feeds">
          {(['for-you', 'following', 'trending'] as Feed[]).map(tab => (
            <button key={tab} type="button" role="tab" aria-selected={feed === tab} onClick={() => setFeed(tab)} className={cn('relative h-10 text-xs font-medium text-white/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60', feed === tab && 'text-white')}>
              {feedLabel(tab)}
              {feed === tab && <motion.span layoutId="reel-tab" className="absolute inset-x-1 -bottom-px h-px bg-[#b8b8b8]" />}
            </button>
          ))}
        </div>
        <span className="absolute right-4 hidden text-[10px] uppercase text-white/35 ">{active + 1} / {reels.length}</span>
      </header>

      <main ref={reelsViewport} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="VANTA Reels feed">
        {reels.map((reel, index) => (
          <ReelCard
            key={reel.id}
            reel={reel}
            index={index}
            active={active === index}
            nearby={Math.abs(active - index) <= 1}
            muted={muted}
            paused={paused}
            videos={videos}
            sections={sections}
            followPending={!!pending[`follow:${reel.author.id}`]}
            onPlayToggle={() => setPaused(value => !value)}
            onMute={() => setMuted(value => !value)}
            onLike={() => void toggle(reel, 'like')}
            onSave={() => void toggle(reel, 'save')}
            onComment={() => void openComments(reel)}
            onShare={() => setShareFor(reel)}
            onGift={() => openGift(reel)}
            onFollow={() => void follow(reel)}
            onMore={() => setMoreFor(reel)}
            onCreator={() => router.push(`/profile/${reel.author.username}`)}
          />
        ))}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(64px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-white/[.08] bg-[#080808]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl " aria-label="Mobile navigation">
        {nav.map(item => item.create ? (
          <button key={item.label} type="button" onClick={openCreateHub} className="mx-auto grid h-12 w-12 place-items-center self-center rounded-full bg-[#c9a227] text-black" aria-label="Create"><Plus size={22} /></button>
        ) : (
          <Link key={item.href} href={item.href} className="flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] text-white/45 transition hover:text-white"><item.icon size={19} /><span>{item.label}</span></Link>
        ))}
      </nav>

      <AnimatePresence>
        {commentsFor && <CommentsPanel reel={commentsFor} items={comments} loading={commentsLoading} text={commentText} sending={commentSending} currentUserId={user?.id} setText={setCommentText} submit={submitComment} remove={deleteComment} close={() => setCommentsFor(null)} />}
        {shareFor && <SharePanel reel={shareFor} share={share} close={() => setShareFor(null)} />}
        {moreFor && <MorePanel reel={moreFor} save={() => { void toggle(moreFor, 'save'); setMoreFor(null); }} follow={() => { void follow(moreFor); setMoreFor(null); }} profile={() => router.push(`/profile/${moreFor.author.username}`)} report={() => { setReportFor(moreFor); setMoreFor(null); }} close={() => setMoreFor(null)} />}
        {reportFor && <ReportPanel reel={reportFor} pending={!!pending[`report:${reportFor.id}`]} submit={category => void report(reportFor, category)} close={() => setReportFor(null)} />}
        {giftFor && token && <GiftPickerBoundary onClose={() => setGiftFor(null)}><GiftPicker gifts={gifts} balance={giftBalance} recipient={giftFor.author} token={token} loading={giftLoading} loadError={giftError} onRetry={() => void loadGiftData()} onClose={() => setGiftFor(null)} onSent={(remaining, _amount, gift) => { setGiftBalance(remaining); toast.success('Gift sent', `You sent ${gift.name} to ${giftFor.author.fullName || giftFor.author.username}`); }} /></GiftPickerBoundary>}
      </AnimatePresence>
    </div>
  );
}

function ReelCard({ reel, index, active, nearby, muted, paused, videos, sections, followPending, onPlayToggle, onMute, onLike, onSave, onComment, onShare, onGift, onFollow, onMore, onCreator }: {
  reel: Reel; index: number; active: boolean; nearby: boolean; muted: boolean; paused: boolean;
  videos: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  sections: MutableRefObject<Record<string, HTMLElement | null>>;
  followPending: boolean; onPlayToggle: () => void; onMute: () => void; onLike: () => void; onSave: () => void; onComment: () => void; onShare: () => void; onGift: () => void; onFollow: () => void; onMore: () => void; onCreator: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [progress, setProgress] = useState(0);
  const [likedPulse, setLikedPulse] = useState(false);
  const tapTimer = useRef<number>();
  const lastTap = useRef(0);
  const followed = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);

  const likeWithFeedback = () => {
    if (!reel.isLiked) onLike();
    setLikedPulse(true);
    window.setTimeout(() => setLikedPulse(false), 520);
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
    if (active && !paused) void video?.play().catch(() => {});
  };

  return (
    <section ref={node => { sections.current[reel.id] = node; }} data-index={index} className="relative flex h-[100dvh] snap-start items-center justify-center bg-[#050505] pb-[calc(64px+env(safe-area-inset-bottom))] pt-0  ">
      <div className="flex h-full w-full items-center justify-center   ">
        <div className="relative h-full w-full overflow-hidden bg-black      ">
          {reel.thumbnailUrl && <img src={resolveMediaUrl(reel.thumbnailUrl)} alt="" className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', !videoLoading && !videoFailed && 'opacity-0')} />}
          {nearby && !videoFailed && (
            <video
              ref={node => { videos.current[reel.id] = node; }}
              src={resolveMediaUrl(reel.videoUrl)}
              poster={resolveMediaUrl(reel.thumbnailUrl)}
              preload={active ? 'auto' : 'metadata'}
              autoPlay={active && !paused}
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
              className="h-full w-full object-cover"
              aria-label={`Reel by ${reel.author.username}`}
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/35" />

          {videoLoading && !videoFailed && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="animate-spin text-white/70" size={28} /></div>}
          {videoFailed && <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 px-8 text-center"><div><Clapperboard className="mx-auto text-white/40" /><h3 className="mt-4 font-semibold">Unable to load Reel</h3><p className="mt-1 max-w-xs text-xs leading-5 text-white/45">{videoError || 'The video could not be played.'}</p><button type="button" onClick={retry} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm"><RefreshCw size={15} />Retry</button></div></div>}

          <div className="absolute right-3 top-16 z-10 flex gap-2">
            <button type="button" onClick={onMute} className="grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-label={muted ? 'Unmute Reel' : 'Mute Reel'}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
            <button type="button" onClick={() => void fullscreen()} className="grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-label="Enter fullscreen"><Maximize size={16} /></button>
          </div>

          {active && paused && !videoFailed && <button type="button" onClick={onPlayToggle} className="absolute inset-0 z-10 m-auto grid h-14 w-14 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label="Play Reel"><Play size={23} fill="white" /></button>}
          <AnimatePresence>{likedPulse && <motion.div initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.15 }} className="pointer-events-none absolute inset-0 z-20 grid place-items-center"><Heart size={76} fill="white" className="drop-shadow-2xl" /></motion.div>}</AnimatePresence>

          <div className="absolute bottom-5 left-4 right-20 z-10 ">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onCreator} className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <Avatar src={reel.author.avatar} alt={reel.author.username} size="sm" />
                <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{reel.author.fullName || reel.author.username}</span>{reel.author.verified && <VerificationBadge verified size="sm" />}</span><small className="block truncate text-[11px] text-white/60">@{reel.author.username}</small></span>
              </button>
              <button type="button" disabled={followPending} onClick={onFollow} className={cn('min-w-[76px] rounded-md border px-3 py-1.5 text-xs font-semibold transition', followed ? 'border-white/15 bg-white/10 text-white/75' : 'border-white/50 text-white', followPending && 'opacity-60')}>
                {followPending ? <Loader2 className="mx-auto animate-spin" size={14} /> : followed ? 'Following' : 'Follow'}
              </button>
            </div>
            <p className={cn('mt-3 max-w-[44ch] text-sm leading-5 text-white/90', !expanded && 'line-clamp-2')}>{reel.description || reel.title || 'A new Reel on VANTA.'}</p>
            {(reel.description?.length || reel.title?.length || 0) > 110 && <button type="button" onClick={() => setExpanded(value => !value)} className="mt-0.5 text-xs text-white/60">{expanded ? 'less' : 'more'}</button>}
            <button type="button" className="mt-2 flex items-center gap-2 text-xs text-white/60" aria-label="Original audio"><Music2 size={13} />Original audio</button>
          </div>

          <div className="absolute bottom-6 right-3 z-10 flex flex-col items-center gap-3 ">
            <div className="flex flex-col items-center gap-1 text-[10px] text-white/65" aria-label={`${reel.views} views`}><span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#161616]/88 backdrop-blur"><Eye size={18} /></span><span>{formatCount(reel.views)}</span></div>
            <Action icon={<Heart className={reel.isLiked ? 'fill-white' : ''} />} label={formatCount(reel.likes)} ariaLabel={reel.isLiked ? 'Unlike Reel' : 'Like Reel'} onClick={onLike} active={reel.isLiked} />
            <Action icon={<MessageCircle />} label={formatCount(reel.comments)} ariaLabel="Open comments" onClick={onComment} />
            <Action icon={<Share2 />} label="Share" ariaLabel="Share Reel" onClick={onShare} />
            <Action icon={<Gift />} label="Gift" ariaLabel="Send a gift" onClick={onGift} />
            <Action icon={<MoreHorizontal />} label="More" ariaLabel="More Reel actions" onClick={onMore} />
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/15"><span className="block h-full bg-white transition-[width] duration-100" style={{ width: `${progress}%` }} /></div>
        </div>

      </div>
    </section>
  );
}

function Action({ icon, label, ariaLabel, onClick, active }: { icon: ReactNode; label: string; ariaLabel: string; onClick: () => void; active?: boolean }) {
  return <button type="button" onClick={onClick} className={cn('flex flex-col items-center gap-1 text-[10px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60', active ? 'text-white' : 'text-white/70 hover:text-white')} aria-label={ariaLabel} aria-pressed={active}><span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#161616]/88 backdrop-blur">{icon}</span><span>{label}</span></button>;
}

function CommentsPanel({ reel, items, loading, text, sending, currentUserId, setText, submit, remove, close }: { reel: Reel; items: ReelComment[]; loading: boolean; text: string; sending: boolean; currentUserId?: string; setText: (value: string) => void; submit: () => void; remove: (comment: ReelComment) => void; close: () => void }) {
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
            <Avatar src={item.user?.avatar} alt={item.user?.username || ''} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <b className="truncate text-[13px] font-semibold text-[#f5f5f5]">{item.user?.fullName || item.user?.username || 'VANTA user'}</b>
                {item.createdAt && <time className="shrink-0 text-[11px] leading-none text-white/35">{timeAgo(item.createdAt)}</time>}
              </div>
              <p className="mt-1 break-words text-sm leading-5 text-white/75">{item.content}</p>
            </div>
            {currentUserId && (item.userId === currentUserId || item.user?.id === currentUserId) && (
              <button type="button" onClick={() => remove(item)} className="-mr-1 grid h-7 w-7 shrink-0 place-items-center self-center rounded-lg text-white/30 transition hover:text-white" aria-label="Delete your comment"><Trash2 size={14} /></button>
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
  </>;
}

function SharePanel({ reel, share, close }: { reel: Reel; share: (reel: Reel, mode: 'copy' | 'native') => void; close: () => void }) {
  const native = typeof navigator !== 'undefined' && !!navigator.share;
  return <Dialog title="Share Reel" close={close}><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => share(reel, 'copy')} className="rounded-lg border border-white/10 p-4 text-sm text-white/70 hover:bg-white/[.05]"><Copy className="mx-auto mb-2" size={20} />Copy link</button>{native && <button type="button" onClick={() => share(reel, 'native')} className="rounded-lg border border-white/10 p-4 text-sm text-white/70 hover:bg-white/[.05]"><ExternalLink className="mx-auto mb-2" size={20} />Share via device</button>}</div></Dialog>;
}

function MorePanel({ reel, save, follow, profile, report, close }: { reel: Reel; save: () => void; follow: () => void; profile: () => void; report: () => void; close: () => void }) {
  const followed = !!(reel.author.following || reel.author.isFollowing || reel.isFollowing);
  return <Dialog title="Reel options" close={close}><div className="space-y-1"><MenuButton icon={<User size={17} />} label="View creator profile" onClick={profile} /><MenuButton icon={<Bookmark size={17} />} label={reel.isSaved ? 'Remove save' : 'Save Reel'} onClick={save} /><MenuButton icon={followed ? <X size={17} /> : <Check size={17} />} label={followed ? 'Unfollow creator' : 'Follow creator'} onClick={follow} /><MenuButton icon={<Flag size={17} />} label="Report Reel" onClick={report} /></div></Dialog>;
}

function ReportPanel({ reel, pending, submit, close }: { reel: Reel; pending: boolean; submit: (category: string) => void; close: () => void }) {
  const categories = ['Spam or misleading', 'Harassment or hate', 'Nudity or sexual content', 'Violence or dangerous acts', 'Copyright infringement'];
  return <Dialog title="Report Reel" close={close}><p className="mb-3 text-sm text-white/50">Tell us why this Reel by @{reel.author.username} should be reviewed.</p><div className="space-y-1">{categories.map(category => <button key={category} type="button" disabled={pending} onClick={() => submit(category)} className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-white/75 hover:bg-white/[.05] disabled:opacity-50"><span>{category}</span>{pending && <Loader2 className="animate-spin" size={14} />}</button>)}</div></Dialog>;
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label={`Close ${title}`} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" /><motion.section initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} role="dialog" aria-modal="true" aria-label={title} className="fixed bottom-0 left-0 right-0 z-[60] mx-auto w-full max-w-md rounded-t-lg border border-white/10 bg-[#161616] p-4 shadow-2xl    "><header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-lg text-white/50 hover:bg-white/[.06]" aria-label="Close"><X size={18} /></button></header>{children}</motion.section></>;
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/75 hover:bg-white/[.05]">{icon}{label}</button>;
}

function State({ title, copy, action, secondaryAction, onAction, onSecondary, loading = false }: { title: string; copy: string; action?: string; secondaryAction?: string; onAction?: () => void; onSecondary?: () => void; loading?: boolean }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white"><div>{loading ? <Loader2 className="mx-auto mb-5 animate-spin text-[#8a8a8a]" size={38} /> : <Clapperboard className="mx-auto mb-5 text-[#8a8a8a]" size={42} />}<h1 className="text-2xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-white/50">{copy}</p><div className="mt-6 flex flex-wrap justify-center gap-2">{action && <button type="button" onClick={onAction} className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black">{action}</button>}{secondaryAction && <button type="button" onClick={onSecondary} className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/75">{secondaryAction}</button>}</div></div></div>;
}