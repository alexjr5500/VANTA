'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Clapperboard, Eye, Heart, Loader2, MessageCircle, MoreHorizontal, Share2, Trash2, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';
import PageHeader from '@/components/ui/PageHeader';
import CommentPanel from '@/components/social/CommentPanel';
import FeedPostMoreSheet from '@/components/social/FeedPostMoreSheet';
import FeedPostShareSheet from '@/components/social/FeedPostShareSheet';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { renderTextWithLinks } from '@/lib/linkify';

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
 * Premium Reel detail surface — the "enter a Reel" view from a feed swipe or a
 * shared /reels/:id link. The Reel is the visual focus (compact ← / ⋮ navigation),
 * the creator row mirrors the feed, and the conversation lives INLINE beneath so
 * the page reads as "entering the Reel" instead of "opening a record".
 *
 * Every action hits the same real backend endpoints the Reels feed uses:
 * like/save (`POST /api/reels/:id/like|save`), report (`POST /api/compliance/reports`,
 * targetType VIDEO), view tracking (`POST /api/reels/:id/views`), deletion
 * (`DELETE /api/reels/:id`) and comments via the shared CommentPanel (inline
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
  const conversationRef = useRef<HTMLDivElement>(null);
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
  const actionClass = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#c8c8cc] transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

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

  const openComments = () => {
    conversationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return <main className="min-w-0 w-full text-white">
      <PageHeader back={back} sticky bleed className="mb-1 px-4" title="Reel"
        actions={<span className="grid h-10 w-10 place-items-center rounded-lg text-white/25"><MoreHorizontal size={19} /></span>} />
      <ReelDetailSkeleton />
    </main>;
  }

  if (unavailable || !reel || !creator) {
    return <main className="min-w-0 w-full text-white">
      <PageHeader back={back} sticky bleed className="mb-1 px-4" title="Reel" />
      <ReelErrorState onRetry={loadReel} />
    </main>;
  }
  const videoSrc = resolveMediaUrl(reel.videoUrl);
  const posterSrc = resolveMediaUrl(reel.thumbnailUrl);

  return <main className="min-w-0 w-full text-white">
    <PageHeader
      back={back}
      sticky bleed className="mb-1 px-4"
      title="Reel"
      actions={
        <button type="button" onClick={() => setMoreOpen(true)} aria-label="More reel options" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white">
          <MoreHorizontal size={19} />
        </button>
      }
    />

    <div className="mx-auto w-full min-w-0 max-w-[680px] px-3 pb-8">
      <article className="w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
        {/* Reel player */}
        <div className="relative mx-auto w-full bg-black">
          <video src={videoSrc} poster={posterSrc || undefined} controls autoPlay loop playsInline preload="metadata" className="max-h-[76dvh] w-full object-contain" aria-label={`Reel by ${creator.username}`} />
        </div>

        {/* Creator */}
        <header className="flex items-start gap-3 p-3">
          <Link href={`/profile/${creator.username}`} className="grid shrink-0 place-items-center" aria-label={`View ${creator.username}'s profile`}>
            <Avatar src={creator.avatar} alt={creator.username} size="md" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link href={`/profile/${creator.username}`} className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-[#f5f5f5] hover:text-white">
                <span className="min-w-0 truncate">{creator.fullName || creator.username}</span>
                {creator.verified && creator.verificationType && <VerificationBadge verified type={creator.verificationType} size="sm" />}
              </Link>
              <span className="shrink-0 text-[11px] text-white/40">· {timeAgo(reel.createdAt)}</span>
            </div>
            <p className="truncate text-xs text-white/45">@{creator.username} · Reel</p>
          </div>
        </header>

        {/* Reel text */}
        {(reel.title || reel.description) && (
          <div className="px-4 pb-2">
            {reel.title && <h2 className="text-[15px] font-semibold text-[#f5f5f5]">{reel.title}</h2>}
            {reel.description && <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-white/85">{renderTextWithLinks(reel.description, 'linkify')}</p>}
          </div>
        )}

        {/* Views — actual backend count */}
        {typeof reel.views === 'number' && (
          <div className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-white/40"><Eye size={14} /><span className="tabular-nums">{formatCount(reel.views)} views</span></div>
        )}

        {/* Engagement */}
        <footer className="flex items-center gap-2 border-t border-white/10 p-2">
          <button onClick={() => void toggleLike()} className={actionClass + (liked ? ' text-[#f2c75c]' : '')} aria-label={liked ? 'Unlike reel' : 'Like reel'} aria-pressed={liked}>
            <Heart size={18} className={liked ? 'fill-current' : ''} />
            <span>{formatCount(likeCount)}</span>
          </button>
          <button onClick={openComments} className={actionClass} aria-label="Open comments">
            <MessageCircle size={18} />
            <span>{formatCount(commentCount)}</span>
          </button>
          <button onClick={() => setShareOpen(true)} className={actionClass} aria-label="Share reel">
            <Share2 size={18} />
          </button>
          <button onClick={() => void toggleSave()} className={actionClass + (savedState ? ' text-white' : '')} aria-label={savedState ? 'Remove from saved' : 'Save reel'} aria-pressed={savedState}>
            <Bookmark size={18} className={savedState ? 'fill-current' : ''} />
          </button>
        </footer>
      </article>
      {/* Conversation — inline, beneath the Reel */}
      <div ref={conversationRef} className="mt-3 w-full min-w-0 scroll-mt-16 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
        {token && (
          <CommentPanel
            kind="reel"
            postId={id}
            postAuthor={creator}
            initialCount={commentCount}
            token={token}
            currentUser={user}
            inline
            onClose={() => undefined}
            onCountChange={count => setReel(current => current ? { ...current, commentsCount: count, comments: count } : current)}
          />
        )}
        {!token && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-white/55">Join VANTA to join the conversation.</p>
            <Link href="/login" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-bold text-black transition hover:bg-white/90">Sign in to comment</Link>
          </div>
        )}
      </div>
    </div>

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
  return (
    <div className="mx-auto w-full min-w-0 max-w-[680px] px-3">
      <div className="w-full rounded-2xl border border-white/10 bg-[#101010] p-4">
        <div className="flex items-center gap-3">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton className="w-32" />
            <Skeleton className="w-20" />
          </div>
        </div>
        <Skeleton variant="rectangular" height={420} className="mt-4" />
        <div className="mt-4 space-y-2">
          <Skeleton className="w-1/2" />
          <Skeleton className="w-3/4" />
        </div>
        <div className="mt-4 flex gap-2">
          <Skeleton variant="rectangular" height={44} className="flex-1" />
          <Skeleton variant="rectangular" height={44} className="flex-1" />
          <Skeleton variant="rectangular" height={44} className="flex-1" />
          <Skeleton variant="rectangular" height={44} className="flex-1" />
        </div>
      </div>
    </div>
  );
}

function ReelErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[680px] px-3 py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/[0.04]"><Clapperboard size={22} className="text-white/40" /></div>
      <h1 className="mt-4 text-lg font-semibold text-white">Couldn&apos;t load this Reel.</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/50">It may have been deleted or VANTA couldn&apos;t reach it. Try again in a moment.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onRetry} className="rounded-lg bg-[#f5f5f5] px-5 py-3 text-sm font-semibold text-black transition hover:bg-white">Retry</button>
        <Link href="/reels" className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/75 transition hover:text-white">Back to Reels</Link>
      </div>
    </div>
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
