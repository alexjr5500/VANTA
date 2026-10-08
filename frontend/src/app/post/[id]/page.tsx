'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Bookmark, Eye, Heart, Loader2, MessageCircle, MoreHorizontal, RefreshCw, Share2, Trash2, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';
import PageHeader from '@/components/ui/PageHeader';
import PostMedia from '@/components/social/PostMedia';
import CommentPanel from '@/components/social/CommentPanel';
import FeedPostMoreSheet from '@/components/social/FeedPostMoreSheet';
import FeedPostShareSheet from '@/components/social/FeedPostShareSheet';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { renderTextWithLinks } from '@/lib/linkify';

type Post = {
  id: string; content: string; mediaUrl?: string | null; createdAt: string;
  likesCount?: number; commentsCount?: number; shareCount?: number; views?: number;
  isLiked?: boolean; liked?: boolean; saved?: boolean; shares?: number; likes?: number; comments?: number;
  hashtags?: string[];
  author: { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean; verificationType?: VerificationType | null };
};

const mediaSrc = (value?: string | null) => resolveMediaUrl(value);

/**
 * PostDetailPage
 * --------------
 * Premium, conversational post detail surface. The post is the visual focus
 * (compact ← / ⋮ navigation instead of a generic "Post" title), the author row
 * mirrors the feed card, and the conversation lives INLINE beneath the post so
 * the page reads as "entering the post" instead of "opening a record".
 *
 * All actions hit the real backend endpoints already used by Home/Profile:
 * like (`POST /api/feed/:id/like`), save (`POST|DELETE /api/feed/:id/save`),
 * share (`POST /api/feed/:id/share` + the shared share sheet), view tracking
 * (`POST /api/feed/:id/views`) and comments via the shared CommentPanel (inline
 * mode) so auth, permissions, replies, likes, edits and realtime are identical
 * to the rest of VANTA.
 */
export default function PostDetailPage({ params }: { params: { id: string } }) {
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
  const conversationRef = useRef<HTMLDivElement>(null);
  const id = useMemo(() => decodeURIComponent(params.id).trim(), [params.id]);

  // Derived engagement state — declared before event handlers so the toggles
  // can read the current post state safely.
  const liked = Boolean(post?.liked ?? post?.isLiked ?? false);
  const savedState = Boolean(post?.saved ?? false);
  const likeCount = Number(post?.likes ?? post?.likesCount ?? 0);
  const commentCount = Number(post?.comments ?? post?.commentsCount ?? 0);
  const shareCount = Number(post?.shares ?? post?.shareCount ?? 0);
  const actionClass = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#c8c8cc] transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
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
    setPost({ ...post, isLiked: !nowLiked, liked: !nowLiked, likesCount: Math.max(0, count + (nowLiked ? -1 : 1)) });
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
    return <main className="min-w-0 w-full text-white">
      <PageHeader
        back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }}
        sticky bleed className="mb-1 px-4"
        actions={<span className="grid h-10 w-10 place-items-center rounded-lg text-white/25"><MoreHorizontal size={19} /></span>}
      />
      <PostDetailSkeleton />
    </main>;
  }

  if (unavailable || !post) {
    return <main className="min-w-0 w-full text-white">
      <PageHeader
        back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }}
        sticky bleed className="mb-1 px-4"
      />
      <PostErrorState onRetry={loadPost} />
    </main>;
  }

  const media = mediaSrc(post.mediaUrl);
  const isOwn = post.author.id === user?.id;
return <main className="min-w-0 w-full text-white">
    {/* Minimal navigation: ←                    ⋮ */}
    <PageHeader
      back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }}
      sticky bleed className="mb-1 px-4"
      actions={
        <button type="button" onClick={() => setMoreOpen(true)} aria-label="More post options" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white">
          <MoreHorizontal size={19} />
        </button>
      }
    />

    <div className="mx-auto w-full min-w-0 max-w-[680px] px-3 pb-8">
      <article className="w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
        {/* Author */}
        <header className="flex items-start gap-3 p-3">
          <Link href={`/profile/${post.author.username}`} className="grid shrink-0 place-items-center" aria-label={`View ${post.author.username}'s profile`}>
            <Avatar src={post.author.avatar} alt={post.author.username} size="md" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link href={`/profile/${post.author.username}`} className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-[#f5f5f5] hover:text-white">
                <span className="min-w-0 truncate">{post.author.fullName || post.author.username}</span>
                {post.author.verified && post.author.verificationType && <VerificationBadge verified type={post.author.verificationType} size="sm" />}
              </Link>
              <span className="shrink-0 text-[11px] text-white/40">· {timeAgo(post.createdAt)}</span>
            </div>
            <p className="truncate text-xs text-white/45">@{post.author.username}</p>
          </div>
        </header>

        {/* Post text */}
        {post.content && <p className="whitespace-pre-wrap break-words px-4 pb-2 text-[15px] leading-6 text-white/85">{renderTextWithLinks(post.content, 'linkify')}</p>}
        {Array.isArray(post.hashtags) && post.hashtags.length > 0 && (
          <p className="px-4 pb-2 text-[13px] font-medium text-[#c9a227]">{post.hashtags.map(tag => `#${tag}`).join(' ')}</p>
        )}

        {/* Media — part of the post, same PostMedia renderer as the feed */}
        {media && <div className="bg-[#080808]"><PostMedia src={media} alt={post.author.username ? `Post by ${post.author.username}` : 'Post media'} autoplayOnView={false} preload="metadata" /></div>}

        {/* Views — actual backend count */}
        {typeof post.views === 'number' && (
          <div className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-white/40"><Eye size={14} /><span className="tabular-nums">{formatCount(post.views)} views</span></div>
        )}

        {/* Engagement */}
        <footer className="flex items-center gap-2 border-t border-white/10 p-2">
          <button onClick={() => void toggleLike()} className={actionClass + (liked ? ' text-[#f2c75c]' : '')} aria-label={liked ? 'Unlike post' : 'Like post'} aria-pressed={liked}>
            <Heart size={18} className={liked ? 'fill-current' : ''} />
            <span>{formatCount(likeCount)}</span>
          </button>
          <button onClick={openComments} className={actionClass} aria-label="Open comments">
            <MessageCircle size={18} />
            <span>{formatCount(commentCount)}</span>
          </button>
          <button onClick={() => setShareOpen(true)} className={actionClass} aria-label="Share post">
            <Share2 size={18} />
            <span>{formatCount(shareCount)}</span>
          </button>
          <button onClick={() => void toggleSave()} className={actionClass + (savedState ? ' text-white' : '')} aria-label={savedState ? 'Remove from saved' : 'Save post'} aria-pressed={savedState}>
            <Bookmark size={18} className={savedState ? 'fill-current' : ''} />
          </button>
        </footer>
      </article>

      {/* Conversation — inline, beneath the post */}
      <div ref={conversationRef} className="mt-3 w-full min-w-0 scroll-mt-16 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
        {token && (
          <CommentPanel
            kind="post"
            postId={id}
            postAuthor={post.author}
            initialCount={commentCount}
            token={token}
            currentUser={user}
            inline
            onClose={() => undefined}
            onCountChange={count => setPost(current => current ? { ...current, commentsCount: count, comments: count } : current)}
          />
        )}
      </div>
    </div>
<AnimatePresence>
      {moreOpen && post && (
        <FeedPostMoreSheet
          item={{ saved: savedState }}
          isOwn={isOwn}
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
      <div className="fixed inset-0 z-[90]" role="alertdialog" aria-modal="true" aria-label="Delete post">
        <button type="button" aria-label="Cancel delete" onClick={() => setDeleteConfirm(false)} className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
        <div className="absolute left-1/2 top-1/2 w-[min(380px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#151517] p-5 shadow-2xl">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Delete this post?</h2>
            <button type="button" onClick={() => setDeleteConfirm(false)} className="grid h-9 w-9 place-items-center rounded-full text-[#c8c8cc]" aria-label="Close"><X size={18} /></button>
          </header>
          <p className="mb-5 text-sm leading-6 text-[#c8c8cc]/65">This cannot be undone. The post will be removed from VANTA immediately.</p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDeleteConfirm(false)} disabled={deleting} className="min-h-11 rounded-lg border border-white/10 px-4 text-sm text-[#c8c8cc] transition hover:bg-white/[0.05]">Cancel</button>
            <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#b4232f] px-4 text-sm font-semibold text-white transition hover:bg-[#9f1d2a] disabled:opacity-40">{deleting ? <Loader2 size={15} className="animate-spin" /> : <><Trash2 size={15} /> Delete post</>}</button>
          </div>
        </div>
      </div>
    )}
  </main>;
}

const formatCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K` : String(value);

const timeAgo = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};

function PostDetailSkeleton() {
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
        <div className="mt-4 space-y-2">
          <Skeleton />
          <Skeleton className="w-3/4" />
        </div>
        <Skeleton variant="rectangular" height={240} className="mt-4" />
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

function PostErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[680px] px-3 py-16 text-center">
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