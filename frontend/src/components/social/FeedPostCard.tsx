'use client';

import { motion } from 'framer-motion';
import { BarChart2, Bookmark, Gift, Heart, MessageCircle, MoreHorizontal, Repeat2, Share } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiPost } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import PostMedia, { PostMediaCarousel, type PostAttachment } from '@/components/social/PostMedia';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { isVideoItem, detailPathFor, cleanId } from '@/lib/feedIdentity';
import { useContentPrefs } from '@/lib/useContentPrefs';
import { renderTextWithLinks } from '@/lib/linkify';
import QuoteEmbed from '@/components/social/QuoteEmbed';
import { extractQuoteRef } from '@/lib/quotePost';

/**
 * FeedPostCard
 * ------------
 * The SINGLE production post component for VANTA. Home (the source of truth),
 * Profile, and any feed context render every post through this one component so
 * avatar, display name, @username, timestamp, context/metadata, caption, media,
 * and the like/comment/share/gift/save/bookmark/more interaction UI are always
 * pixel-identical and behaviour-identical.
 *
 * The creator identity always comes from `item.author` (falling back to the
 * other serialization keys) — never from the viewing user, so posts by other
 * people show that person's avatar/name/username regardless of whose profile
 * the post is rendered on.
 *
 * LAYOUT (compact, alignment-aware):
 *   The avatar lives in a fixed 40px leading column; every other piece of the
 *   post — display name, @username, timestamp, caption, hashtags, MEDIA, and the
 *   action row — lives inside the same content column that starts right after the
 *   avatar. That guarantees text posts and media posts share one horizontal
 *   content boundary (no media ever breaks out to the feed edge).
 */

type Item = Record<string, any>;

type FeedPostCardProps = {
  item: Item;
  /** The logged-in viewer's id, used only to decide "own content" controls. */
  currentUserId?: string | null;
  onLike: (_item: Item) => void;
  onSave: (_item: Item) => void;
  onComment: (_item: Item) => void;
  onShare: (_item: Item) => void;
  onGift: (_item: Item) => void;
  onFollow: (_item: Item) => void;
  onMore: (_item: Item) => void;
  /** Shorter caption preview for the Home feed only. */
  compactCaption?: boolean;
  feedCompactMedia?: boolean;
  hideFollowButton?: boolean;
  /** Profile Reposts tab: X-style 'You reposted' row, views and a share-link action. */
  repostContext?: string;
  onShareLink?: (_item: Item) => void;
};

const formatCount = (value = 0) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);
const relativeTime = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};
const getAuthor = (item: Item) => item.author || item.user || item.creator || item.host || {};
const mediaUrl = (item: Item) => resolveMediaUrl(item.media || item.mediaUrl || item.image || item.thumbnail || item.coverUrl || item.playbackUrl);
const mediaPoster = (item: Item) => resolveMediaUrl(item.thumbnailUrl || item.thumbnail || item.posterUrl || item.previewImageUrl || item.coverUrl || item.previewUrl || '');

/**
 * Ordered media attachments for a post. VANTA multi-media posts return an
 * `attachments` array; single-media posts keep working through `mediaUrl`, so
 * both shapes collapse into one ordered list here.
 */
const postAttachments = (item: Item): PostAttachment[] => {
  const raw = (item as any).attachments;
  if (Array.isArray(raw) && raw.length > 0) {
    const resolved = raw
      .map((attachment: any) => ({
        id: attachment?.id,
        url: resolveMediaUrl(attachment?.url || attachment?.src || ''),
        type: attachment?.type,
        mimeType: attachment?.mimeType,
        poster: resolveMediaUrl(attachment?.thumbnailUrl || attachment?.posterUrl || attachment?.previewUrl || ''),
      }))
      .filter((attachment: PostAttachment) => Boolean(attachment.url));
    if (resolved.length > 0) return resolved;
  }
  const single = mediaUrl(item);
  return single ? [{ url: single, poster: mediaPoster(item) || undefined }] : [];
};
export default function FeedPostCard({ item, currentUserId, onLike, onSave, onComment, onShare, onGift, onMore, feedCompactMedia = false, repostContext, onShareLink }: FeedPostCardProps) {
  const router = useRouter();
  const { token } = useAuth();
  const viewArticleRef = useRef<HTMLElement>(null);
  const [confirmedViews, setConfirmedViews] = useState<number | null>(null);
  // Count a genuine feed impression, not just a tap on /post/[id].
  // The server enforces one ContentView per viewer/content, so moving
  // between Home, Profile and the detail page never double-counts.
  useEffect(() => {
    setConfirmedViews(null);
    const node = viewArticleRef.current;
    if (!node || !token || !item.id || item.type === 'live' || typeof IntersectionObserver === 'undefined') return;
    let requested = false;
    let impressionTimer: number | null = null;
    const reel = isVideoItem(item);
    const endpoint = reel ? '/api/reels' : '/api/feed';
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
        if (impressionTimer !== null || requested) return;
        impressionTimer = window.setTimeout(() => {
          impressionTimer = null;
          requested = true;
          void apiPost<{ counted: boolean; views: number }>(
            `${endpoint}/${encodeURIComponent(cleanId(item))}/views`,
            reel ? { watchTime: 2 } : {},
            token,
          ).then(result => {
            if (Number.isFinite(Number(result.views))) setConfirmedViews(Number(result.views));
          }).catch(() => {
            // Permit a retry after the next genuine visible impression.
            requested = false;
          });
        }, 700);
      } else if (impressionTimer !== null) {
        window.clearTimeout(impressionTimer);
        impressionTimer = null;
      }
    }, { threshold: [0, 0.25, 0.5] });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (impressionTimer !== null) window.clearTimeout(impressionTimer);
    };
  }, [item.id, item.type, token]);
  const { prefs: contentPrefs, hydrated: contentPrefsHydrated } = useContentPrefs();
  // Feed video autoplay follows the persisted Video Autoplay preference.
  // Before localStorage hydrates it stays OFF, so default-off users never
  // see a video start on first paint.
  const feedAutoplayOn = contentPrefsHydrated ? contentPrefs.homeAutoplay : false;
  const creator = getAuthor(item);
  const creatorAvatar = creator.avatarUrl || creator.profile?.avatarUrl || creator.avatar || creator.profilePicture || '';
  const isOwn = creator.id === currentUserId;
  const attachments = postAttachments(item);
  const source = mediaUrl(item) || attachments[0]?.url || '';
  const poster = mediaPoster(item) || attachments[0]?.poster || '';
  const singleIsVideo = isVideoItem(item) || /video/i.test(String(attachments[0]?.type || attachments[0]?.mimeType || '')) || /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(source);
  const profilePath = creator.username ? `/profile/${creator.username}` : '/profile';
  const actionClass = 'flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] text-[#8a8a8a] transition hover:bg-white/[.045] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
  const caption = item.content || item.description;
  const rawCaption = typeof caption === 'string' ? caption : '';
  // Quote posts carry the source post URL in their text; render it as an embed card.
  const [host, setHost] = useState<string | undefined>(undefined);
  useEffect(() => setHost(window.location.host), []);
  const quoted = extractQuoteRef(rawCaption, host);
  const captionText = quoted ? quoted.rest : rawCaption;
  const captionRef = useRef<HTMLParagraphElement>(null);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [likePulse, setLikePulse] = useState(0);
  const [captionOverflows, setCaptionOverflows] = useState(false);

  // Measure the real rendered text so the expand control appears only when
  // the five-line preview actually clips content at the current screen width.
  useEffect(() => {
    const element = captionRef.current;
    if (!element || !captionText) {
      setCaptionOverflows(false);
      return;
    }
    const measure = () => {
      // Measure the collapsed preview even after expansion; otherwise the
      // expanded paragraph reports no overflow and hides "Show less".
      const wasExpanded = captionExpanded;
      if (wasExpanded) {
        element.style.display = '-webkit-box';
        element.style.setProperty('-webkit-box-orient', 'vertical');
        element.style.setProperty('-webkit-line-clamp', '5');
        element.style.overflow = 'hidden';
      }
      setCaptionOverflows(element.scrollHeight > element.clientHeight + 2);
      if (wasExpanded) {
        element.style.removeProperty('display');
        element.style.removeProperty('-webkit-box-orient');
        element.style.removeProperty('-webkit-line-clamp');
        element.style.removeProperty('overflow');
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [captionText, captionExpanded]);

  // Tapping anywhere on the card (except an interactive control) opens the
  // canonical post/reel detail page — the same single detail route the comment
  // count and share actions lead to. Inner controls keep their own handlers.
  const openDetail = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, video, audio, [role="tab"], [contenteditable]')) return;
    router.push(detailPathFor(item));
  };

  return <motion.article ref={viewArticleRef} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24 }} onClick={openDetail} className="flex min-w-0 flex-col pt-2 pb-0.5 cursor-pointer">
    {repostContext && <div className="flex items-center gap-1.5 pb-1 pl-[54px] text-[11px] font-semibold text-[#777]"><Repeat2 size={13}/><span>{repostContext}</span></div>}
    <header className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-start gap-2.5">
      <button
        type="button"
        onClick={() => router.push(profilePath)}
        aria-label={`Open ${creator.username || 'creator'} profile`}
        className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/[.05]"
      ><Avatar src={creatorAvatar} alt={creator.username || 'Creator'} size="md" wrapperClassName="!h-11 !w-11" className="!h-11 !w-11" verified={Boolean(creator.verified && creator.verificationType)} verificationType={creator.verificationType} /></button>
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex min-w-0 items-center justify-between gap-x-1.5">
          <button
            type="button"
            onClick={() => router.push(profilePath)}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-left"
          >
            <span className="min-w-0 truncate text-[12px] font-semibold text-[#f5f5f5]">{creator.fullName || creator.username || 'VANTA creator'}</span>
            {creator.verified && creator.verificationType && <VerificationBadge type={creator.verificationType} size="sm" />}
            <span className="truncate text-[11px] text-[#777]">@{creator.username}</span>
            <span className="text-[11px] text-[#666]">· {relativeTime(item.createdAt)}</span>
          </button>
          <button type="button" onClick={() => onMore(item)} aria-label="More post options" className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-[#666] transition hover:bg-white/[.05] hover:text-white"><MoreHorizontal size={17}/></button>
        </div>
        {item.location && <p className="truncate text-[10px] text-[#666]">{item.location}</p>}
        {captionText && <><p ref={captionRef} style={captionExpanded ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 5, overflow: 'hidden' }} className="whitespace-pre-wrap break-words text-[14px] leading-[1.4] text-[#dedede]">{renderTextWithLinks(captionText, 'linkify', { mentions: true, hashtags: true })}</p>{captionOverflows && <button type="button" onClick={() => setCaptionExpanded(value => !value)} aria-expanded={captionExpanded} className="-mt-0.5 self-start text-[13px] font-medium text-[#c9a227] transition hover:text-[#e0bb4f]">{captionExpanded ? 'Show less' : 'Show more'}</button>}</>}
        {quoted && <QuoteEmbed quote={quoted.ref} />}
        {item.hashtags && <p className="text-[11px] text-[#c9a227]">{Array.isArray(item.hashtags) ? item.hashtags.map((tag: string) => `#${tag}`).join(' ') : item.hashtags}</p>}
        {/* Media sits INSIDE the content column so it aligns with the caption,
            matching text posts exactly. No full-bleed, no negative margins. */}
        {attachments.length > 0 && (
          <div className="mt-0.5 w-full min-w-0 overflow-hidden rounded-lg border border-white/[.07] bg-[#080808]">
            {attachments.length > 1 ? (
              <PostMediaCarousel
                attachments={attachments}
                alt={caption || `Post by ${creator.username || 'creator'}`}
                onDoubleClick={() => { if (!item.liked) onLike(item); }}
                autoplayOnView={feedAutoplayOn}
                feedCompact={feedCompactMedia}
              />
            ) : (
              <PostMedia src={source} poster={poster || undefined} isVideo={singleIsVideo} alt={caption || `Post by ${creator.username || 'creator'}`} autoplayOnView={feedAutoplayOn} feedCompact={feedCompactMedia} onDoubleClick={() => { if (!item.liked) onLike(item); }}/>
            )}
          </div>
        )}
        <footer className="flex min-w-0 items-center justify-between gap-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <motion.button type="button" onClick={() => { setLikePulse(value => value + 1); onLike(item); }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }} aria-label={item.liked ? 'Unlike post' : 'Like post'} aria-pressed={item.liked} className={cn(actionClass, 'transition-colors', item.liked && 'text-[#f2c75c]')}><motion.span key={likePulse} initial={{ scale: 0.55, rotate: -24 }} animate={{ scale: [0.55, 1.38, 0.94, 1], rotate: [-24, 9, -4, 0] }} transition={{ duration: 0.42, times: [0, 0.42, 0.72, 1], ease: 'easeOut' }}><Heart size={17} className={item.liked ? 'fill-current' : ''}/></motion.span><motion.span key={Number(item.likes || 0)} initial={{ y: 3, opacity: 0.55 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.16 }}>{formatCount(item.likes)}</motion.span></motion.button>
            <button type="button" onClick={() => onComment(item)} aria-label="Open comments" className={actionClass}><MessageCircle size={17}/><span>{formatCount(item.comments)}</span></button>
            <button type="button" onClick={() => onShare(item)} aria-label="Repost" aria-pressed={Boolean(item.isReposted)} className={cn(actionClass, 'transition-colors', item.isReposted && 'text-[#f2c75c]')}><Repeat2 size={17}/><span>{formatCount(item.reposts ?? item.shares)}</span></button>
            {!isOwn ? <button type="button" onClick={() => onGift(item)} aria-label="Send gift" className={cn(actionClass, 'transition-colors hover:text-[#c9a227]', item.isGifted && 'text-[#f2c75c]')}><Gift size={17} className={item.isGifted ? 'fill-current' : ''}/><span>{formatCount(item.tips ?? item.tipCount ?? item.giftsReceived ?? 0)}</span></button> : <span className={cn(actionClass, 'pointer-events-none', item.isGifted && 'text-[#f2c75c]')} aria-label="Tips"><Gift size={17} className={item.isGifted ? 'fill-current' : ''}/><span>{formatCount(item.tips ?? item.tipCount ?? item.giftsReceived ?? 0)}</span></span>}
            <span className={cn(actionClass, 'pointer-events-none')} aria-label="Views"><BarChart2 size={17}/><span>{formatCount(confirmedViews ?? item.views ?? 0)}</span></span>
          </div>
          <button type="button" onClick={() => onSave(item)} aria-label={item.saved ? 'Remove saved post' : 'Save post'} aria-pressed={item.saved} className={cn(actionClass, item.saved && 'text-white')}><Bookmark size={17} className={item.saved ? 'fill-current' : ''}/><span className="sr-only">{item.saved ? 'Saved' : 'Save'}</span></button>
          {repostContext && onShareLink && <button type="button" onClick={() => onShareLink(item)} aria-label="Share" className={actionClass}><Share size={17}/></button>}
        </footer>
      </div>
    </header>
  </motion.article>;
}