'use client';

import { motion } from 'framer-motion';
import { Bookmark, Gift, Heart, MessageCircle, MoreHorizontal, Share2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import PostMedia from '@/components/social/PostMedia';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { isVideoItem } from '@/lib/feedIdentity';

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
};

const formatCount = (value = 0) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);
const relativeTime = (value?: string) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};
const getAuthor = (item: Item) => item.author || item.user || item.creator || item.host || {};
const mediaUrl = (item: Item) => resolveMediaUrl(item.media || item.mediaUrl || item.image || item.thumbnail || item.coverUrl || item.playbackUrl);
export default function FeedPostCard({ item, currentUserId, onLike, onSave, onComment, onShare, onGift, onFollow, onMore }: FeedPostCardProps) {
  const router = useRouter();
  const creator = getAuthor(item);
  const isOwn = creator.id === currentUserId;
  const source = mediaUrl(item);
  const profilePath = creator.username ? `/profile/${creator.username}` : '/profile';
  const actionClass = 'flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[11px] text-[#8a8a8a] transition hover:bg-white/[.045] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
  const caption = item.content || item.description;

  return <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24 }} className="flex flex-col pt-2 pb-0.5">
    <header className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-2.5">
      <button
        type="button"
        onClick={() => router.push(profilePath)}
        aria-label={`Open ${creator.username || 'creator'} profile`}
        className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/[.05]"
      ><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="md"/></button>
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex min-w-0 items-center justify-between gap-x-1.5">
          <button
            type="button"
            onClick={() => router.push(profilePath)}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-left"
          >
            <span className="min-w-0 truncate text-[13px] font-semibold text-[#f5f5f5]">{creator.fullName || creator.username || 'VANTA creator'}</span>
            {creator.verified && <VerificationBadge type="BLUE" size="sm" />}
            <span className="truncate text-[11px] text-[#666]">@{creator.username}</span>
            <span className="text-[11px] text-[#666]">· {relativeTime(item.createdAt)}</span>
          </button>
          {!isOwn && <button type="button" onClick={() => onFollow(item)} className="shrink-0 min-h-8 rounded-lg border border-white/[.12] px-2.5 text-[11px] font-semibold text-[#d8d8d8] transition hover:bg-white hover:text-black">{item.following ? 'Following' : 'Follow'}</button>}
          <button type="button" onClick={() => onMore(item)} aria-label="More post options" className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-[#666] transition hover:bg-white/[.05] hover:text-white"><MoreHorizontal size={17}/></button>
        </div>
        {item.location && <p className="truncate text-[10px] text-[#666]">{item.location}</p>}
        {caption && <p className="whitespace-pre-wrap text-[13px] leading-5 text-[#dedede]">{caption}</p>}
        {item.hashtags && <p className="text-[11px] text-[#c9a227]">{Array.isArray(item.hashtags) ? item.hashtags.map((tag: string) => `#${tag}`).join(' ') : item.hashtags}</p>}
        {/* Media sits INSIDE the content column so it aligns with the caption,
            matching text posts exactly. No full-bleed, no negative margins. */}
        {source && <div className="mt-0.5 overflow-hidden rounded-lg border border-white/[.07] bg-[#080808]"><PostMedia src={source} isVideo={isVideoItem(item)} alt={caption || `Post by ${creator.username || 'creator'}`} onDoubleClick={() => { if (!item.liked) onLike(item); }}/></div>}
        <footer className="flex min-w-0 items-center justify-between gap-1 pt-0.5">
          <div className="flex min-w-0 items-center">
            <button type="button" onClick={() => onLike(item)} aria-label={item.liked ? 'Unlike post' : 'Like post'} aria-pressed={item.liked} className={cn(actionClass, item.liked && 'text-[#f2c75c]')}><Heart size={17} className={item.liked ? 'fill-current' : ''}/><span>{formatCount(item.likes)}</span></button>
            <button type="button" onClick={() => onComment(item)} aria-label="Open comments" className={actionClass}><MessageCircle size={17}/><span>{formatCount(item.comments)}</span></button>
            <button type="button" onClick={() => onShare(item)} aria-label="Share post" className={actionClass}><Share2 size={17}/><span>{formatCount(item.shares)}</span></button>
            {!isOwn && <button type="button" onClick={() => onGift(item)} aria-label="Send gift" className={cn(actionClass, 'hover:text-[#c9a227]')}><Gift size={17}/><span className="sr-only">Gift</span></button>}
          </div>
          <button type="button" onClick={() => onSave(item)} aria-label={item.saved ? 'Remove saved post' : 'Save post'} aria-pressed={item.saved} className={cn(actionClass, item.saved && 'text-white')}><Bookmark size={17} className={item.saved ? 'fill-current' : ''}/><span className="sr-only">{item.saved ? 'Saved' : 'Save'}</span></button>
        </footer>
      </div>
    </header>
  </motion.article>;
}