'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import type { QuoteRef } from '@/lib/quotePost';

type Loaded = Record<string, any> | null;

const authorOf = (item: Record<string, any>) => item.author || item.user || item.creator || {};
const mediaOf = (item: Record<string, any>) => {
  const first = Array.isArray(item.attachments) ? item.attachments[0] : null;
  return resolveMediaUrl(first?.thumbnailUrl || first?.posterUrl || first?.url || item.thumbnailUrl || item.thumbnail || item.mediaUrl || item.media || item.image || '') || '';
};
const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url);

// X-style quoted post card: author, text, first media, clickable to the source post.
export default function QuoteEmbed({ quote, className = '' }: { quote: QuoteRef; className?: string }) {
  const router = useRouter();
  const { token } = useAuth();
  const key = `${quote.kind}:${quote.id}`;
  const [result, setResult] = useState<{ key: string; token: string | null; data: Loaded }>();
  const data = result?.key === key && result.token === token ? result.data : undefined;

  useEffect(() => {
    let active = true;
    const path = quote.kind === 'reel' ? `/api/reels/${encodeURIComponent(quote.id)}` : `/api/feed/${encodeURIComponent(quote.id)}`;
    void apiGet<Record<string, any>>(path, token || undefined, { skipCache: true })
      .then(res => { const v = res?.id ? res : null; if (active) setResult({ key, token, data: v }); })
      .catch(() => { if (active) setResult({ key, token, data: null }); });
    return () => { active = false; };
  }, [key, quote.id, quote.kind, token]);

  const open = (e: React.SyntheticEvent) => { e.stopPropagation(); router.push(quote.path); };
  const base = `block w-full min-w-0 overflow-hidden rounded-xl border border-white/[.12] bg-white/[.02] text-left transition hover:bg-white/[.045] ${className}`;

  if (data === undefined) return <div className={`${base} h-20 animate-pulse`} aria-busy="true" />;
  if (data === null) return <button type="button" onClick={open} className={`${base} p-3 text-[13px] text-[#8a8a8a]`}>This post is unavailable. Tap to open the link.</button>;

  const author = authorOf(data);
  const text = String(data.content || data.description || data.caption || data.title || '');
  const media = mediaOf(data);
  const avatar = author.avatarUrl || author.profile?.avatarUrl || author.avatar || author.profilePicture || '';
  return (
    <button type="button" onClick={open} aria-label={`Quoted post by ${author.username || 'creator'}`} className={base}>
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <Avatar src={avatar} alt={author.username || 'Creator'} size="sm" wrapperClassName="!h-5 !w-5" className="!h-5 !w-5" />
        <span className="truncate text-[13px] font-semibold text-[#f5f5f5]">{author.fullName || author.username || 'VANTA creator'}</span>
        {author.verified && author.verificationType && <VerificationBadge type={author.verificationType} size="sm" />}
        {author.username && <span className="truncate text-[12px] text-[#777]">@{author.username}</span>}
      </div>
      {text && <p className="line-clamp-4 whitespace-pre-wrap break-words px-3 pt-1 text-[13px] leading-[1.35] text-[#dedede]">{text}</p>}
      {media && (isVideoUrl(media)
        ? <video src={media} muted playsInline preload="metadata" className="mt-2 max-h-64 w-full bg-black object-cover" />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={media} alt="" loading="lazy" className="mt-2 max-h-64 w-full object-cover" />)}
      <div className="h-2.5" />
    </button>
  );
}
