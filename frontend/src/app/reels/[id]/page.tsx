'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Bookmark, Clapperboard, Eye, Heart, Loader2, MessageCircle, MoreHorizontal, Play, RefreshCw, Share2, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';
import CommentPanel from '@/components/social/CommentPanel';
import FeedPostMoreSheet from '@/components/social/FeedPostMoreSheet';
import FeedPostShareSheet from '@/components/social/FeedPostShareSheet';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { renderTextWithLinks } from '@/lib/linkify';
import { cn } from '@/lib/utils';

type Creator = {
  id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  verified?: boolean;
  verificationType?: VerificationType | null;
};

type Reel = {
  id: string;
  title?: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  createdAt?: string;
  views?: number;
  likesCount?: number;
  likes?: number;
  commentsCount?: number;
  comments?: number;
  savesCount?: number;
  isLiked?: boolean;
  isSaved?: boolean;
  creator?: Creator;
  author?: Creator;
};

const formatCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K` : String(value);

const timeAgo = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};

/**
 * ReelDetailPage
 * --------------
 * A dedicated, immersive Reel viewer — TikTok-style. The Reel owns the whole
 * viewport: the video is presented full-height with its intrinsic aspect ratio
 * (object-contain, never stretched), creator info and caption overlay the
 * bottom-left with a contrast scrim, and the like/comment/share/save/more
 * actions live in a lightweight vertical rail on the right. Comments open in
 * a dedicated bottom sheet only when requested, so the video is never
 * permanently covered.
 *
 * Every action hits the same real backend endpoints the Reels feed uses:
 * like/save (`POST /api/reels/:id/like|save`), report (`POST /api/compliance/reports`,
 * targetType VIDEO), view tracking (`POST /api/reels/:id/views`), deletion
 * (`DELETE /api/reels/:id`) and comments via the shared CommentPanel (sheet
 * `kind="reel"` mode). Sharing is client-side (copy / native / message) because
 * Reels have no server-side share counter.
 */
export default function ReelDetailPage({ params }: { params: { id: string } }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [reel, setReel] = useState<Reel | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // Immersive player state — play/pause, mute, buffering, progress, caption
  // expansion, double-tap-like pulse and the comments bottom sheet.
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expandedCaption, setExpandedCaption] = useState(false);
  const [likedPulse, setLikedPulse] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [signInPromptOpen, setSignInPromptOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tapTimerRef = useRef<number>();
  const lastTapRef = useRef(0);
  const id = useMemo(() => decodeURIComponent(params.id).trim(), [params.id]);

  // Derived engagement state — declared before event handlers so the toggles
  // can read the current Reel state safely.
  const liked = Boolean(reel?.isLiked ?? false);
  const savedState = Boolean(reel?.isSaved ?? false);
  const likeCount = Number(reel?.likes ?? reel?.likesCount ?? 0);
  const commentCount = Number(reel?.comments ?? reel?.commentsCount ?? 0);
  // The detail endpoint serialises the badge-aware creator under `creator`
  // (matching the GET /api/reels/:id payload); the feed uses `author`, so accept
  // either so the page behaves identically from both entry points.
  const creator = reel?.creator ?? reel?.author;
  const isOwn = Boolean(creator && creator.id === user?.id);

  useEffect(() => {
    let active = true;
    setLoading(true); setUnavailable(false);
    void apiGet<Reel>(`/api/reels/${encodeURIComponent(id)}`, token || undefined, { skipCache: true })
      .then(data => { if (active && data?.id) setReel(data); else if (active) setUnavailable(true); })
      .catch(error => { if (active && error?.statusCode !== 499) setUnavailable(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, token, retryKey]);

  // Count the view once, after 2s of watch (the backend only credits views with
  // watchTime >= 2s), exactly like the Reels feed does.
  useEffect(() => {
    if (!token || !reel?.id) return;

    const timer = window.setTimeout(() => {
      void apiPost<{ counted: boolean; views: number }>(`/api/reels/${encodeURIComponent(reel.id)}/views`, { watchTime: 2 }, token)
        .then(result => setReel(current => current?.id === reel.id ? { ...current, views: result.views } : current))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [reel?.id, token]);

  const loadReel = () => setRetryKey(key => key + 1);

  const back = () => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/reels'); };

  const toggleLike = async () => {
    if (!token || !reel) return;
    const before = reel;
    const nowLiked = Boolean(reel.isLiked);
    setReel({ ...reel, isLiked: !nowLiked, likesCount: Math.max(0, likeCount + (nowLiked ? -1 : 1)), likes: likeCount + (nowLiked ? -1 : 1) });
    try { await apiPost(`/api/reels/${reel.id}/like`, {}, token); }
    catch { setReel(before); }
  };

  const toggleSave = async () => {
    if (!token || !reel) return;
    const before = reel;
    setReel({ ...reel, isSaved: !savedState });
    try { await apiPost(`/api/reels/${reel.id}/save`, {}, token); }
    catch { setReel(before); }
  };

  const share = async (destination: string) => {
    if (!reel) return;
    const url = `${window.location.origin}/reels/${encodeURIComponent(reel.id)}`;
    try {
      if (destination === 'COPY_LINK') await navigator.clipboard.writeText(url);
      else if (destination === 'NATIVE' && navigator.share) await navigator.share({ title: reel.title || 'VANTA Reel', url });
      else if (destination === 'MESSAGE') router.push(`/chat?share=${encodeURIComponent(url)}`);
      toast.success('Shared successfully');
      setShareOpen(false);
    } catch (reason: any) {
      toast.error('Share failed', reason?.message);
    }
  };

  const report = async (category: string) => {
    if (!token || !reel || !creator || reportPending) return;
    setReportPending(true);
    try {
      await apiPost('/api/compliance/reports', { targetType: 'VIDEO', targetId: reel.id, targetUserId: creator.id, category, description: 'Reported from Reel detail' }, token);
      toast.success('Report submitted');
      setReportOpen(false);
    } catch (reason: any) {
      toast.error('Report unavailable', reason?.message);
    } finally {
      setReportPending(false);
    }
  };

  // Immersive player behaviour — single tap toggles playback, double tap likes
  // (mirroring the Reels feed). Timers are cleaned up on unmount.
  useEffect(() => () => { if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current); }, []);

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) { setPaused(false); void element.play().catch(() => setPaused(true)); }
    else { element.pause(); setPaused(true); }
  };

  const likeWithFeedback = () => {
    if (!liked) void toggleLike();
    setLikedPulse(true);
    window.setTimeout(() => setLikedPulse(false), 520);
  };

  const handleVideoTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
      likeWithFeedback();
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
    tapTimerRef.current = window.setTimeout(togglePlay, 280);
  };

  const retryVideo = () => {
    setVideoFailed(false);
    setVideoLoading(true);
    setProgress(0);
    videoRef.current?.load();
    void videoRef.current?.play().then(() => setPaused(false)).catch(() => setPaused(true));
  };

  // Comments open in a dedicated bottom sheet (the video is never permanently
  // covered); signed-out viewers get a compact sign-in prompt instead.
  const openComments = () => {
    if (token) setCommentsOpen(true);
    else setSignInPromptOpen(true);
  };

  const confirmDelete = async () => {
    if (!token || !reel || deleting) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/reels/${reel.id}`, token);
      toast.success('Reel deleted');
      router.push('/reels');
    } catch (reason: any) {
      setDeleting(false);
      setDeleteConfirm(false);
      toast.error('Reel not deleted', reason?.message);
    }
  };

  if (loading) {
    return <main className="relative h-[100dvh] w-full overflow-hidden bg-[#050505] text-white">
      <ReelOverlayBack back={back} />
      <ReelDetailSkeleton />
    </main>;
  }

  if (unavailable || !reel || !creator) {
    return <main className="relative h-[100dvh] w-full overflow-hidden bg-[#050505] text-white">
      <ReelOverlayBack back={back} />
      <ReelErrorState onRetry={loadReel} />
    </main>;
  }
  const videoSrc = resolveMediaUrl(reel.videoUrl);
  const posterSrc = resolveMediaUrl(reel.thumbnailUrl);
  const captionText = reel.description || reel.title || '';

  return <main className="relative h-[100dvh] w-full overflow-hidden bg-black text-white">
    {/* Immersive stage — edge-to-edge on mobile, centred on desktop. The video
        keeps its intrinsic aspect ratio (object-contain, never stretched). */}
    <div className="relative mx-auto h-full w-full max-w-[520px] overflow-hidden bg-black">
      {/* Poster frame beneath the video while it loads or when it fails. */}
      {posterSrc && (
        <img
          src={posterSrc}
          alt=""
          aria-hidden="true"
          className={cn('absolute inset-0 h-full w-full object-contain transition-opacity duration-300', !videoLoading && !videoFailed && 'opacity-0')}
        />
      )}
      <video
        ref={videoRef}
        src={videoSrc}
        poster={posterSrc || undefined}
        autoPlay
        loop
        playsInline
        muted={muted}
        preload="auto"
        onClick={handleVideoTap}
        onDoubleClick={likeWithFeedback}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onLoadStart={() => { setVideoLoading(true); setVideoFailed(false); }}
        onWaiting={() => setVideoLoading(true)}
        onPlaying={() => { setVideoLoading(false); setVideoFailed(false); }}
        onCanPlay={() => setVideoLoading(false)}
        onTimeUpdate={event => { const element = event.currentTarget; setProgress(element.duration ? (element.currentTime / element.duration) * 100 : 0); }}
        onError={() => { setVideoFailed(true); setVideoLoading(false); }}
        className="absolute inset-0 h-full w-full object-contain"
        aria-label={`Reel by ${creator.username}`}
      />

      {/* Contrast scrim so overlay copy stays readable on bright frames. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />

      {/* Top overlay — back, mute, more. */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
        <button type="button" onClick={back} aria-label="Go back" className="grid h-10 w-10 place-items-center rounded-full text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"><ArrowLeft size={21} /></button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMuted(value => !value)} aria-label={muted ? 'Unmute reel' : 'Mute reel'} className="grid h-10 w-10 place-items-center rounded-full text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
          <button type="button" onClick={() => setMoreOpen(true)} aria-label="More reel options" className="grid h-10 w-10 place-items-center rounded-full text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"><MoreHorizontal size={19} /></button>
        </div>
      </div>

      {/* Buffering indicator. */}
      {videoLoading && !videoFailed && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <Loader2 size={30} className="animate-spin text-white/80" />
        </div>
      )}

      {/* Paused affordance. */}
      {paused && !videoFailed && !videoLoading && (
        <button type="button" onClick={togglePlay} aria-label="Play reel" className="absolute inset-0 z-10 m-auto grid h-14 w-14 place-items-center rounded-full bg-black/45 text-white backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <Play size={23} fill="white" />
        </button>
      )}

      {/* Double-tap like pulse. */}
      <AnimatePresence>
        {likedPulse && (
          <motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.15 }} className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
            <Heart size={76} fill="white" className="drop-shadow-2xl text-white" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Playback error — retry without leaving the viewer. */}
      {videoFailed && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/85 px-6 text-center">
          <div>
            <Clapperboard size={30} className="mx-auto text-white/40" />
            <p className="mt-3 text-sm font-medium text-white/75">This Reel couldn&apos;t be played.</p>
            <button type="button" onClick={retryVideo} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#f5f5f5] px-4 text-sm font-semibold text-black transition hover:bg-white"><RefreshCw size={15} /> Try again</button>
          </div>
        </div>
      )}

      {/* Bottom-left overlay — creator, caption, compact metadata. */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pr-20">
        <Link href={`/profile/${creator.username}`} className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <Avatar src={creator.avatar} alt={creator.username} size="sm" />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1 text-sm font-semibold text-white">
              <span className="truncate">{creator.fullName || creator.username}</span>
              {creator.verified && creator.verificationType && <VerificationBadge verified type={creator.verificationType} size="sm" />}
            </span>
            <span className="block truncate text-[11px] text-white/60">@{creator.username}</span>
          </span>
        </Link>
        {captionText && (
          <p className={cn('mt-2 max-w-[44ch] whitespace-pre-wrap break-words text-sm leading-5 text-white/90', !expandedCaption && 'line-clamp-2')}>{renderTextWithLinks(captionText, 'linkify')}</p>
        )}
        {captionText.length > 110 && (
          <button type="button" onClick={() => setExpandedCaption(value => !value)} className="mt-0.5 text-xs text-white/60 hover:text-white">{expandedCaption ? 'less' : 'more'}</button>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-white/60">
          {typeof reel.views === 'number' && <span className="inline-flex items-center gap-1"><Eye size={12} /><span className="tabular-nums">{formatCount(reel.views)} views</span></span>}
          {timeAgo(reel.createdAt) && <span>· {timeAgo(reel.createdAt)}</span>}
        </div>
      </div>
      {/* Right action rail — lightweight icon actions, gold active states. */}
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+20px)] right-2 z-20 flex flex-col items-center gap-3">
        <ReelRailAction icon={<Heart className={liked ? 'fill-current' : ''} />} label={formatCount(likeCount)} ariaLabel={liked ? 'Unlike reel' : 'Like reel'} onClick={() => void toggleLike()} active={liked} />
        <ReelRailAction icon={<MessageCircle />} label={formatCount(commentCount)} ariaLabel="Open comments" onClick={openComments} />
        <ReelRailAction icon={<Share2 />} label="Share" ariaLabel="Share reel" onClick={() => setShareOpen(true)} />
        <ReelRailAction icon={<Bookmark className={savedState ? 'fill-current' : ''} />} label={savedState ? 'Saved' : 'Save'} ariaLabel={savedState ? 'Remove from saved' : 'Save reel'} onClick={() => void toggleSave()} active={savedState} />
        <ReelRailAction icon={<MoreHorizontal />} label="More" ariaLabel="More reel actions" onClick={() => setMoreOpen(true)} />
      </div>

      {/* Playback progress. */}
      <div className="absolute inset-x-0 bottom-0 z-30 h-0.5 bg-white/15">
        <span className="block h-full bg-white transition-[width] duration-100" style={{ width: `${progress}%` }} />
      </div>
    </div>

    {/* Comments — dedicated bottom sheet, opened on demand (the video is never
        permanently covered); the sheet handles keyboard and safe areas. */}
    <AnimatePresence>
      {commentsOpen && token && (
        <CommentPanel
          kind="reel"
          postId={id}
          postAuthor={creator}
          initialCount={commentCount}
          token={token}
          currentUser={user}
          onClose={() => setCommentsOpen(false)}
          onCountChange={count => setReel(current => current ? { ...current, commentsCount: count, comments: count } : current)}
        />
      )}
      {signInPromptOpen && <ReelSignInSheet close={() => setSignInPromptOpen(false)} />}
    </AnimatePresence>

    <AnimatePresence>
      {moreOpen && (
        <FeedPostMoreSheet
          item={{ saved: savedState }}
          isOwn={isOwn}
          reel
          close={() => setMoreOpen(false)}
          openProfile={() => { setMoreOpen(false); router.push(`/profile/${creator.username}`); }}
          save={() => { void toggleSave(); setMoreOpen(false); }}
          report={() => { setMoreOpen(false); setReportOpen(true); }}
          remove={() => { setMoreOpen(false); setDeleteConfirm(true); }}
        />
      )}
      {shareOpen && (
        <FeedPostShareSheet title="Share reel" close={() => setShareOpen(false)} share={destination => void share(destination)} />
      )}
      {reportOpen && (
        <ReportReelSheet
          username={creator.username}
          pending={reportPending}
          submit={category => void report(category)}
          close={() => setReportOpen(false)}
        />
      )}
    </AnimatePresence>

    {deleteConfirm && (
      <div className="fixed inset-0 z-[90]" role="alertdialog" aria-modal="true" aria-label="Delete reel">
        <button type="button" aria-label="Cancel delete" onClick={() => setDeleteConfirm(false)} className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
        <div className="absolute left-1/2 top-1/2 w-[min(380px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#151517] p-5 shadow-2xl">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Delete this reel?</h2>
            <button type="button" onClick={() => setDeleteConfirm(false)} className="grid h-9 w-9 place-items-center rounded-full text-[#c8c8cc]" aria-label="Close"><X size={18} /></button>
          </header>
          <p className="mb-5 text-sm leading-6 text-[#c8c8cc]/65">This cannot be undone. The Reel will be removed from VANTA immediately.</p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDeleteConfirm(false)} disabled={deleting} className="min-h-11 rounded-lg border border-white/10 px-4 text-sm text-[#c8c8cc] transition hover:bg-white/[0.05]">Cancel</button>
            <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#b4232f] px-4 text-sm font-semibold text-white transition hover:bg-[#9f1d2a] disabled:opacity-40">{deleting ? <Loader2 size={15} className="animate-spin" /> : <><Trash2 size={15} /> Delete reel</>}</button>
          </div>
        </div>
      </div>
    )}
  </main>;
}
function ReelDetailSkeleton() {
  // Lightweight pulse skeleton for the immersive viewer — no card chrome.
  return (
    <div className="absolute inset-0 grid place-items-center px-8">
      <div className="w-full max-w-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-20 animate-pulse rounded bg-white/[0.07]" />
          </div>
        </div>
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.07]" />
      </div>
    </div>
  );
}

function ReelErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/[0.04]"><Clapperboard size={22} className="text-white/40" /></div>
        <h1 className="mt-4 text-lg font-semibold text-white">Couldn&apos;t load this Reel.</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/50">It may have been deleted or VANTA couldn&apos;t reach it. Try again in a moment.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onRetry} className="rounded-lg bg-[#f5f5f5] px-5 py-3 text-sm font-semibold text-black transition hover:bg-white">Retry</button>
          <Link href="/reels" className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/75 transition hover:text-white">Back to Reels</Link>
        </div>
      </div>
    </div>
  );
}

/** Floating back affordance used by the immersive loading / error states. */
function ReelOverlayBack({ back }: { back: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
      <button type="button" onClick={back} aria-label="Go back" className="grid h-10 w-10 place-items-center rounded-full text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"><ArrowLeft size={21} /></button>
    </div>
  );
}

/** Vertical action-rail button — lightweight icon + count, gold when active. */
function ReelRailAction({ icon, label, ariaLabel, onClick, active }: { icon: ReactNode; label: string; ariaLabel: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn('flex flex-col items-center gap-1 text-[10px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 active:scale-95', active ? 'text-[#f2c75c]' : 'text-white/85 hover:text-white')}
    >
      <span className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-[#161616]/80 backdrop-blur">{icon}</span>
      <span className="tabular-nums">{label}</span>
    </button>
  );
}

/** Compact sign-in prompt for signed-out viewers tapping the comment action. */
function ReelSignInSheet({ close }: { close: () => void }) {
  return (
    <>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close sign-in prompt" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to comment"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 18 }}
        className="fixed bottom-[var(--vanta-kb,0px)] left-0 right-0 z-50 mx-auto w-full max-w-md rounded-t-xl border border-white/[0.1] bg-[#161616] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-white">Join the conversation</h2>
          <button type="button" onClick={close} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-[#8a8a8a] hover:bg-white/[0.05] hover:text-white"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-white/55">Sign in to VANTA to like and reply to comments on this Reel.</p>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} className="min-h-11 rounded-lg border border-white/10 px-4 text-sm text-[#c8c8cc] transition hover:bg-white/[0.05]">Not now</button>
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg bg-[#f5f5f5] px-5 text-sm font-semibold text-black transition hover:bg-white">Sign in</Link>
        </div>
      </motion.section>
    </>
  );
}

function ReportReelSheet({ username, pending, submit, close }: { username: string; pending: boolean; submit: (_category: string) => void; close: () => void }) {
  const categories = ['Spam or misleading', 'Harassment or hate', 'Nudity or sexual content', 'Violence or dangerous acts', 'Copyright infringement'];
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close report options" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
    <motion.section role="dialog" aria-modal="true" aria-label="Report reel" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} className="fixed bottom-[var(--vanta-kb,0px)] left-0 right-0 z-50 mx-auto max-h-[calc(var(--vanta-vh,100dvh)-8px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-lg border border-white/10 bg-[#161616] p-4 shadow-2xl">
      <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Report Reel</h2><button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-lg text-white/50 hover:bg-white/[.06]" aria-label="Close"><X size={18} /></button></header>
      <p className="mb-3 text-sm text-white/50">Tell us why this Reel by @{username} should be reviewed.</p>
      <div className="space-y-1">{categories.map(category => (
        <button key={category} type="button" disabled={pending} onClick={() => submit(category)} className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-white/75 hover:bg-white/[.05] disabled:opacity-50"><span>{category}</span>{pending && <Loader2 className="animate-spin" size={14} />}</button>
      ))}</div>
    </motion.section></>;
}
