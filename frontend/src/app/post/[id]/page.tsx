'use client';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Eye, Heart, Loader2, MessageCircle, MoreHorizontal, RefreshCw, Share2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';
import PageHeader from '@/components/ui/PageHeader';
import PostMedia, { PostMediaCarousel, type PostAttachment } from '@/components/social/PostMedia';
import CommentPanel from '@/components/social/CommentPanel';
import FeedPostMoreSheet from '@/components/social/FeedPostMoreSheet';
import FeedPostShareSheet from '@/components/social/FeedPostShareSheet';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { renderTextWithLinks } from '@/lib/linkify';
import QuoteEmbed from '@/components/social/QuoteEmbed';
import { extractQuoteRef } from '@/lib/quotePost';

type Post = {
  id: string; content: string; mediaUrl?: string | null; attachments?: PostAttachment[]; createdAt: string;
  likesCount?: number; commentsCount?: number; shareCount?: number; views?: number;
  isLiked?: boolean; liked?: boolean; saved?: boolean; shares?: number; likes?: number; comments?: number;
  hashtags?: string[];
  author: { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean; verificationType?: VerificationType | null; verificationBadge?: { badgeType?: string | null } | null; following?: boolean; isFollowing?: boolean };
};

const mediaSrc = (value?: string | null) => resolveMediaUrl(value);

/**
 * PostDetailPage
 * --------------
 * A clean, full-width post detail surface modelled on the readability of X
 * (Twitter): no nested cards, no dashboard chrome. The post flows directly
 * from the compact sticky header into the author row, the post body and
 * media, a lightweight engagement toolbar, a compact metadata line, and then
 * straight into the conversation — one continuous scroll.
 *
 * All actions hit the real backend endpoints already used by Home/Profile:
 * like (`POST /api/feed/:id/like`), save (`POST|DELETE /api/feed/:id/save`),
 * share (`POST /api/feed/:id/share` + the shared share sheet), view tracking
 * (`POST /api/feed/:id/views`) and comments via the shared CommentPanel (inline
 * mode) so auth, permissions, replies, likes, edits and realtime are identical
 * to the rest of VANTA.
 */
export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: routeId } = use(params);
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [likePulse, setLikePulse] = useState(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const id = useMemo(() => decodeURIComponent(routeId).trim(), [routeId]);

  // Derived engagement state — declared before event handlers so the toggles
  // can read the current post state safely.
  const liked = Boolean(post?.liked ?? post?.isLiked ?? false);
  const savedState = Boolean(post?.saved ?? false);
  const likeCount = Number(post?.likes ?? post?.likesCount ?? 0);
  const commentCount = Number(post?.comments ?? post?.commentsCount ?? 0);
  const shareCount = Number(post?.shares ?? post?.shareCount ?? 0);
  // Lightweight engagement-action base style: evenly distributed icon
  // actions with restrained transitions — a toolbar, not four rectangular
  // buttons. Active states use the VANTA gold accent.
  const toolClass = (extra?: string) => `flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.97] ${extra ?? ''}`;

  useEffect(() => {
    let active = true;
    setLoading(true); setUnavailable(false);
    void apiGet<Post>(`/api/feed/${encodeURIComponent(id)}`, token || undefined, { skipCache: true })
      .then(data => { if (active && data?.id) setPost(data); else if (active) setUnavailable(true); })
      .catch(error => { if (active && error?.statusCode !== 499) setUnavailable(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, token, retryKey]);

  useEffect(() => {
    if (!token || !post?.id) return;
    const timer = window.setTimeout(() => {
      void apiPost<{ counted: boolean; views: number }>(`/api/feed/${encodeURIComponent(post.id)}/views`, {}, token)
        .then(result => setPost(current => current?.id === post.id ? { ...current, views: result.views } : current))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [post?.id, token]);

  const loadPost = () => setRetryKey(key => key + 1);

  const toggleLike = async () => {
    if (!token || !post) return;
    const before = post;
    const nowLiked = Boolean(post.liked ?? post.isLiked);
    const count = Number(post.likes ?? post.likesCount ?? 0);
    setPost({ ...post, isLiked: !nowLiked, liked: !nowLiked, likes: Math.max(0, count + (nowLiked ? -1 : 1)), likesCount: Math.max(0, count + (nowLiked ? -1 : 1)) });
    try { await apiPost(`/api/feed/${post.id}/like`, {}, token); }
    catch { setPost(before); }
  };

  const toggleSave = async () => {
    if (!token || !post) return;
    const before = post;
    setPost({ ...post, saved: !savedState });
    try {
      if (savedState) await apiDelete(`/api/feed/${post.id}/save`, token);
      else await apiPost(`/api/feed/${post.id}/save`, {}, token);
    } catch { setPost(before); }
  };

  const share = async (destination: string) => {
    if (!post || !token) return;
    const url = `${window.location.origin}/post/${encodeURIComponent(post.id)}`;
    try {
      await apiPost(`/api/feed/${post.id}/share`, { destination }, token);
      if (destination === 'COPY_LINK') await navigator.clipboard.writeText(url);
      else if (destination === 'NATIVE' && navigator.share) await navigator.share({ title: 'VANTA', text: post.content, url });
      else if (destination === 'MESSAGE') router.push(`/chat?share=${encodeURIComponent(url)}`);
      toast.success('Shared successfully');
      setShareOpen(false);
    } catch (reason: any) {
      toast.error('Share failed', reason?.message);
    }
  };

  // Keep the existing "tap the comment action → conversation" behaviour even
  // though comments are now inline, by scrolling the conversation into view
  // right where the composer lives.
  const openComments = () => {
    conversationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // After submitting a reply in the focused composer, open the discussion
  // itself instead of dropping the user back at the top of the post.
  useEffect(() => {
    if (!post?.id || typeof window === 'undefined' || window.location.hash !== '#comments') return;
    const frame = window.requestAnimationFrame(() => conversationRef.current?.scrollIntoView({ block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [post?.id]);

  const confirmDelete = async () => {
    if (!token || !post || deleting) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/feed/${post.id}`, token);
      toast.success('Post deleted');
      router.push('/home');
    } catch (reason: any) {
      setDeleting(false);
      setDeleteConfirm(false);
      toast.error('Post not deleted', reason?.message);
    }
  };

  if (loading) {
    return <main data-post-detail className="min-w-0 w-full bg-[var(--background)] text-[var(--text-primary)]">
      <PageHeader
        back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }}
        sticky bleed className="h-14 min-h-14 px-4"
        actions={<span className="grid h-10 w-10 place-items-center rounded-lg text-white/25"><MoreHorizontal size={19} /></span>}
      />
      <PostDetailSkeleton />
    </main>;
  }

  if (unavailable || !post) {
    return <main data-post-detail className="min-w-0 w-full bg-[var(--background)] text-[var(--text-primary)]">
      <PageHeader
        back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }}
        sticky bleed className="h-14 min-h-14 px-4"
      />
      <PostErrorState onRetry={loadPost} />
    </main>;
  }

  const quote = post.content && typeof window !== 'undefined' ? extractQuoteRef(post.content, window.location.host) : null;
  const visibleText = quote ? quote.rest : post.content;
  const attachments = Array.isArray(post.attachments) ? post.attachments.map((attachment: any) => ({ ...attachment, url: mediaSrc(attachment?.url || attachment?.src || '') })).filter((attachment) => Boolean(attachment.url)) : [];
  const media = mediaSrc(post.mediaUrl) || attachments[0]?.url;
  const isOwn = post.author.id === user?.id;
  return (
    <main data-post-detail data-post-detail-version="4" className="min-h-full w-full min-w-0 bg-[var(--background)] text-[var(--text-primary)]">
      <PageHeader
        title="Post"
        back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }}
        sticky
        bleed
        className="h-12 min-h-12 bg-[var(--header-surface)] px-3"
        actions={
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More post options"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/65 transition hover:bg-white/[0.06] hover:text-white"
          >
            <MoreHorizontal size={22} />
          </button>
        }
      />

      <div className="mx-auto min-h-[calc(100dvh-3rem)] w-full min-w-0 max-w-[680px]">
        <section className="min-w-0">
          <article className="w-full min-w-0">
            <header className="flex min-w-0 items-center gap-2.5 px-3.5 py-2">
              <Link
                href={`/profile/${post.author.username}`}
                className="grid shrink-0 place-items-center"
                aria-label={`View ${post.author.username}'s profile`}
              >
                <Avatar
                  src={post.author.avatar}
                  alt={post.author.username}
                  size="sm"
                  verified={Boolean(post.author.verified && post.author.verificationType)}
                  verificationType={post.author.verificationType}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-nowrap items-center gap-x-1.5">
                  <Link
                    href={`/profile/${post.author.username}`}
                    className="min-w-0 max-w-[42%] shrink truncate text-[13px] font-bold text-white hover:underline"
                  >
                    {post.author.fullName || post.author.username}
                  </Link>
                  {post.author.verified && (
                    <VerificationBadge verified type={post.author.verificationType || (post.author.verificationBadge?.badgeType === 'BLUE' ? 'BLUE' : 'GOLD')} size="sm" />
                  )}
                  <span className="min-w-0 truncate text-[11px] text-white/40">@{post.author.username}</span>
                </div>
              </div>
            </header>
            {(visibleText || quote) && (
              <div className="px-3.5 pb-2 pt-2">
                <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.4] tracking-normal text-[#f0f0f0]">
                  {renderTextWithLinks(visibleText, 'linkify', { mentions: true, hashtags: true })}
                </p>
                {quote && <QuoteEmbed quote={quote.ref} className="mt-2" />}
              </div>
            )}

            {Array.isArray(post.hashtags) && post.hashtags.length > 0 && (
              <p className="px-3.5 pb-2 text-[12px] font-medium leading-5 text-[#d2ad35]">
                {post.hashtags.map(tag => `#${tag}`).join(' ')}
              </p>
            )}

            {media && (
              <div className="relative w-full min-w-0 overflow-hidden bg-[#080808]">
                {attachments.length > 1 ? (
                  <PostMediaCarousel
                    attachments={attachments}
                    alt={post.content || `Post by ${post.author.username || 'creator'}`}
                    autoplayOnView={false}
                  />
                ) : (
                  <PostMedia
                    src={media}
                    isVideo={Boolean((attachments[0] as any)?.type?.toLowerCase?.().includes('video'))}
                    alt={post.author.username ? `Post by ${post.author.username}` : 'Post media'}
                    autoplayOnView={false}
                    preload="metadata"
                  />
                )}
              </div>
            )}

            <div className="px-3.5 pt-1">
              <div className="flex min-h-8 items-center gap-2 pb-2 text-[10px] text-white/40">
                <time className="tabular-nums">{new Date(post.createdAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', year: 'numeric' })}</time><span>·</span><Eye size={13} /><span className="tabular-nums">{typeof post.views === 'number' ? formatCount(post.views) : '0'} views</span>
              </div>
              <footer className="flex min-h-10 w-full min-w-0 items-center gap-1">
                <motion.button
                  type="button"
                  onClick={() => { setLikePulse(value => value + 1); void toggleLike(); }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                  className={toolClass(liked ? '!text-[#d2ad35]' : 'text-white/55')}
                  aria-label={liked ? 'Unlike post' : 'Like post'}
                  aria-pressed={liked}
                >
                  <motion.span key={likePulse} initial={{ scale: 0.55, rotate: -24 }} animate={{ scale: [0.55, 1.38, 0.94, 1], rotate: [-24, 9, -4, 0] }} transition={{ duration: 0.42, times: [0, 0.42, 0.72, 1], ease: 'easeOut' }}>
                    <Heart size={18} className={liked ? 'fill-current' : ''} />
                  </motion.span>
                  <motion.span key={likeCount} initial={{ y: 3, opacity: 0.55 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.16 }} className="text-xs tabular-nums">{formatCount(likeCount)}</motion.span>
                </motion.button>
                <button type="button" onClick={openComments} className={toolClass()} aria-label="Go to comments">
                  <MessageCircle size={18} />
                  <span className="text-xs tabular-nums">{formatCount(commentCount)}</span>
                </button>
                <button type="button" onClick={() => setShareOpen(true)} className={toolClass()} aria-label="Share post">
                  <Share2 size={18} />
                  <span className="text-xs tabular-nums">{formatCount(shareCount)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleSave()}
                  className={toolClass(savedState ? '!text-[#d2ad35]' : 'text-white/55')}
                  aria-label={savedState ? 'Remove from saved' : 'Save post'}
                  aria-pressed={savedState}
                >
                  <Bookmark size={18} className={savedState ? 'fill-current' : ''} />
                  <span className="sr-only">{savedState ? 'Saved' : 'Save'}</span>
                </button>
              </footer>

            </div>
          </article>
        </section>

        <aside
          id="comments"
          ref={conversationRef}
          aria-label="Post comments"
          className="min-w-0 scroll-mt-12 bg-[var(--background)]"
        >
          {token ? (
            <CommentPanel
              kind="post"
              hideEmojiPicker
              enableAttachments
              postId={id}
              postAuthor={post.author}
              initialCount={commentCount}
              token={token}
              currentUser={user}
              inline
              compact
              onClose={() => undefined}
              onCountChange={count => setPost(current => current ? { ...current, commentsCount: count, comments: count } : current)}
            />
          ) : (
            <div className="px-4 py-14 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/[0.04]">
                <MessageCircle size={20} className="text-white/30" />
              </div>
              <p className="mt-3 text-sm font-medium text-white/65">Sign in to join the conversation.</p>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="mt-4 inline-flex min-h-10 items-center rounded-full bg-[#c9a227] px-5 text-sm font-semibold text-black transition hover:bg-[#dfbd55]"
              >
                Sign in
              </button>
            </div>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {moreOpen && post && (
          <FeedPostMoreSheet
            item={{ saved: savedState }}
            isOwn={isOwn}
            dropdown
            close={() => setMoreOpen(false)}
            openProfile={() => { setMoreOpen(false); router.push(`/profile/${post.author.username}`); }}
            save={() => { void toggleSave(); setMoreOpen(false); }}
            remove={() => { setMoreOpen(false); setDeleteConfirm(true); }}
          />
        )}
        {shareOpen && post && (
          <FeedPostShareSheet title="Share post" close={() => setShareOpen(false)} share={destination => void share(destination)} />
        )}
      </AnimatePresence>

      {deleteConfirm && (
        <DeleteConfirmDialog
          title="Delete this post?"
          description="This cannot be undone. The post will be removed from VANTA immediately."
          confirmLabel="Delete post"
          busy={deleting}
          onCancel={() => { if (!deleting) setDeleteConfirm(false); }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </main>
  );
}

const formatCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K` : String(value);

const timeAgo = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};

function PostDetailSkeleton() {
  return (
    <div className="mx-auto w-full min-w-0 px-3 sm:px-5">
      <div className="flex items-start gap-3 pt-4">
        <Skeleton variant="circular" width={44} height={44} />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="w-32" />
          <Skeleton className="w-20" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton />
        <Skeleton className="w-3/4" />
      </div>
      <Skeleton variant="rectangular" height={240} className="mt-4 rounded-xl" />
      <div className="mt-4 flex items-center justify-between pb-2">
        <Skeleton className="w-14" />
        <Skeleton className="w-14" />
        <Skeleton className="w-14" />
        <Skeleton className="w-14" />
      </div>
    </div>
  );
}

function PostErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto w-full min-w-0 px-4 py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/[0.04]"><RefreshCw size={22} className="text-white/40" /></div>
      <h1 className="mt-4 text-lg font-semibold text-white">Couldn&apos;t load this post.</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/50">It may have been deleted or VANTA couldn&apos;t reach it. Try again in a moment.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onRetry} className="rounded-lg bg-[#f5f5f5] px-5 py-3 text-sm font-semibold text-black transition hover:bg-white">Retry</button>
        <Link href="/home" className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/75 transition hover:text-white">Back to VANTA</Link>
      </div>
    </div>
  );
}