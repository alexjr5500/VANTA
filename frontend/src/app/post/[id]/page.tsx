'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, Eye, Heart, Loader2, MessageCircle, Share2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import PageHeader from '@/components/ui/PageHeader';
import PostMedia from '@/components/social/PostMedia';
import CommentPanel from '@/components/social/CommentPanel';
import { useAuth } from '@/context/AuthContext';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { renderTextWithLinks } from '@/lib/linkify';

type Post = {
  id: string; content: string; mediaUrl?: string | null; createdAt: string;
  likesCount?: number; commentsCount?: number; shareCount?: number; views?: number;
  isLiked?: boolean; liked?: boolean; saved?: boolean; shares?: number; likes?: number; comments?: number;
  author: { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean };
};

const mediaSrc = (value?: string | null) => resolveMediaUrl(value);

export default function PostDetailPage({ params }: { params: { id: string } }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const id = useMemo(() => decodeURIComponent(params.id).trim(), [params.id]);

  // Derived engagement state — declared before event handlers so the toggles
  // can read the current post state safely.
  const liked = Boolean(post?.liked ?? post?.isLiked ?? false);
  const savedState = Boolean(post?.saved ?? false);
  const likeCount = Number(post?.likes ?? post?.likesCount ?? 0);
  const commentCount = Number(post?.comments ?? post?.commentsCount ?? 0);
  const shareCount = Number(post?.shares ?? post?.shareCount ?? 0);
  const actionClass = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#c8c8cc] transition hover:bg-white/[0.07] hover:text-white';

  useEffect(() => {
    let active = true;
    setLoading(true); setUnavailable(false);
    void apiGet<Post>(`/api/feed/${encodeURIComponent(id)}`, token || undefined, { skipCache: true })
      .then(data => { if (active && data?.id) setPost(data); else if (active) setUnavailable(true); })
      .catch(error => { if (active && error?.statusCode !== 499) setUnavailable(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, token]);

  useEffect(() => {
    if (!token || !post?.id) return;
    const timer = window.setTimeout(() => {
      void apiPost<{ counted: boolean; views: number }>(`/api/feed/${encodeURIComponent(post.id)}/views`, {}, token)
        .then(result => setPost(current => current?.id === post.id ? { ...current, views: result.views } : current))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [post?.id, token]);

  const toggleLike = async () => {
    if (!token || !post) return;
    const before = post;
    const nowLiked = Boolean(post.liked ?? post.isLiked);
    const count = Number(post.likes ?? post.likesCount ?? 0);
    setPost({ ...post, isLiked: !nowLiked, likesCount: Math.max(0, count + (nowLiked ? -1 : 1)) });
    try { await apiPost(`/api/feed/${post.id}/like`, {}, token); } catch { setPost(before); }
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

  const share = async () => {
    if (!post) return;
    const url = `${window.location.origin}/post/${encodeURIComponent(post.id)}`;
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'VANTA post', url }); return; } catch { /* fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); } catch { /* no clipboard */ }
  };

  if (loading) return <State loading title="Loading post" />;
  if (unavailable || !post) return <State title="Post unavailable" copy="This post may have been deleted or is no longer available." />;
  const media = mediaSrc(post.mediaUrl);

  return <main className="min-h-[100dvh] w-full bg-[#050505] pb-16 text-white">
    <PageHeader back={() => { if (typeof window !== 'undefined' && window.history.length > 1) router.back(); else router.push('/home'); }} title="Post" sticky className="mb-1" />
    <div className="mx-auto w-full min-w-0 max-w-[680px] px-3">
      <article className="w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
        <header className="flex items-start gap-3 p-3">
          <Link href={`/profile/${post.author.username}`} className="grid shrink-0 place-items-center">
            <Avatar src={post.author.avatar} alt={post.author.username} size="md" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link href={`/profile/${post.author.username}`} className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-[#f5f5f5]">
                <span className="min-w-0 truncate">{post.author.fullName || post.author.username}</span>
                {post.author.verified && <VerificationBadge verified size="xs" />}
              </Link>
              <span className="shrink-0 text-[11px] text-white/40">· {timeAgo(post.createdAt)}</span>
            </div>
            <p className="truncate text-xs text-white/45">@{post.author.username}</p>
          </div>
        </header>
        {post.content && <p className="whitespace-pre-wrap break-words px-4 text-[15px] leading-6 text-white/85">{renderTextWithLinks(post.content, 'linkify')}</p>}
        {media && <div className="bg-[#080808]"><PostMedia src={media} alt={post.author.username ? `Post by ${post.author.username}` : 'Post media'} autoplayOnView={false} preload="metadata" /></div>}
        <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-white/40"><Eye size={14} /><span className="tabular-nums">{formatCount(post.views || 0)} views</span></div>
        <footer className="flex items-center gap-2 border-t border-white/10 p-2">
          <button onClick={toggleLike} className={cn(actionClass, liked && 'text-[#f2c75c]')} aria-label={liked ? 'Unlike post' : 'Like post'} aria-pressed={liked}><Heart size={18} className={liked ? 'fill-current' : ''} /><span>{formatCount(likeCount)}</span></button>
          <button onClick={() => setCommentsOpen(true)} className={actionClass} aria-label="Open comments"><MessageCircle size={18} /><span>{formatCount(commentCount)}</span></button>
          <button onClick={() => void share()} className={actionClass} aria-label="Share post"><Share2 size={18} /><span>{formatCount(shareCount)}</span></button>
          <button onClick={() => void toggleSave()} className={cn(actionClass, savedState && 'text-white')} aria-label={savedState ? 'Remove from saved' : 'Save post'} aria-pressed={savedState}><Bookmark size={18} className={savedState ? 'fill-current' : ''} /></button>
        </footer>
      </article>
    </div>
    {commentsOpen && token && <CommentPanel
      kind="post"
      postId={id}
      postAuthor={post.author}
      initialCount={commentCount}
      token={token}
      currentUser={user}
      onClose={() => setCommentsOpen(false)}
      onCountChange={count => setPost(current => current ? { ...current, commentsCount: count, comments: count } : current)}
    />}
  </main>;
}

const formatCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K` : String(value);

const timeAgo = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');

function State({ title, copy, loading }: { title: string; copy?: string; loading?: boolean }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white"><div>{loading && <Loader2 className="mx-auto mb-5 animate-spin text-white/50"/>}<h1 className="text-2xl font-semibold">{title}</h1>{copy && <p className="mt-3 max-w-xs text-sm leading-6 text-white/50">{copy}</p>}<Link href="/home" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-bold text-black">Back to VANTA</Link></div></main>;
}