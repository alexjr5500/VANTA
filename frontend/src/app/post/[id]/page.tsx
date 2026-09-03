'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, Heart, Loader2, MessageCircle, Share2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { apiGet, apiPost } from '@/lib/apiClient';

type Post = {
  id: string; content: string; mediaUrl?: string | null; createdAt: string;
  likesCount?: number; commentsCount?: number; shareCount?: number; views?: number; isLiked?: boolean;
  author: { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean };
};

const mediaSrc = (value?: string | null) => resolveMediaUrl(value);

export default function PostDetailPage({ params }: { params: { id: string } }) {
  const { token } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const id = useMemo(() => decodeURIComponent(params.id).trim(), [params.id]);

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
    setPost({ ...post, isLiked: !post.isLiked, likesCount: Math.max(0, (post.likesCount || 0) + (post.isLiked ? -1 : 1)) });
    try { await apiPost(`/api/feed/${post.id}/like`, {}, token); } catch { setPost(before); }
  };

  if (loading) return <State loading title="Loading post" />;
  if (unavailable || !post) return <State title="Post unavailable" copy="This post may have been deleted or is no longer available." />;
  const media = mediaSrc(post.mediaUrl);
  const video = /\.(mp4|webm|mov)(\?|$)/i.test(media);

  return <main className="min-h-[100dvh] w-full bg-[#050505] text-white">
    <PageHeader back="/home" title="Post" className="mb-4" />
    <article className="w-full min-w-0 rounded-2xl border border-white/10 bg-[#101010]">
      <header className="flex items-center gap-3 p-4"><Avatar src={post.author.avatar} alt={post.author.username} size="md"/><div className="min-w-0"><Link href={`/profile/${post.author.username}`} className="flex items-center gap-1.5 truncate font-semibold"><span className="truncate">{post.author.fullName || post.author.username}</span>{post.author.verified && <VerificationBadge verified size="sm" />}</Link><p className="truncate text-xs text-white/45">@{post.author.username}</p></div></header>
      {post.content && <p className="whitespace-pre-wrap break-words px-4 pb-4 text-sm leading-6 text-white/85">{post.content}</p>}
      {media && (video ? <video src={media} controls playsInline preload="metadata" className="max-h-[70dvh] w-full bg-black object-contain"/> : <img src={media} alt="Post media" className="h-auto w-full object-cover"/>)}
      <div className="flex items-center gap-1.5 border-t border-white/[.07] px-4 py-2 text-xs text-white/45" aria-label={`${post.views || 0} views`}><Eye size={14}/>{formatCount(post.views || 0)} views</div>
      <footer className="grid grid-cols-3 border-t border-white/10 p-2 text-sm text-white/65">
        <button onClick={toggleLike} className="flex min-h-11 items-center justify-center gap-2"><Heart size={18} fill={post.isLiked ? 'currentColor' : 'none'}/>{post.likesCount || 0}</button>
        <button className="flex min-h-11 items-center justify-center gap-2"><MessageCircle size={18}/>{post.commentsCount || 0}</button>
        <button onClick={() => navigator.share?.({ title: 'VANTA post', url: location.href })} className="flex min-h-11 items-center justify-center gap-2"><Share2 size={18}/>{post.shareCount || 0}</button>
      </footer>
    </article>
  </main>;
}

const formatCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K` : String(value);

function State({ title, copy, loading }: { title: string; copy?: string; loading?: boolean }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white"><div>{loading && <Loader2 className="mx-auto mb-5 animate-spin text-white/50"/>}<h1 className="text-2xl font-semibold">{title}</h1>{copy && <p className="mt-3 max-w-xs text-sm leading-6 text-white/50">{copy}</p>}<Link href="/home" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-bold text-black">Back to VANTA</Link></div></main>;
}