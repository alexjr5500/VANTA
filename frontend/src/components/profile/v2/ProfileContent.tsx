'use client';

import { useState } from 'react';
import { Eye, Film, Heart, Image as ImageIcon, MessageCircle, Play, Radio, Trash2 } from 'lucide-react';
import FeedPostCard from '@/components/social/FeedPostCard';
import ImageViewer from '@/components/ui/ImageViewer';
import type { ProfileData, ProfileItem, ProfileTab } from './profileTypes';
import { cleanPostId, formatCount, mediaUrl, postKind } from './profileTypes';

type Props = {
  tab: ProfileTab; rows: ProfileItem[]; profile: ProfileData; own: boolean; router: any;
  currentUserId?: string | null;
  onLike: (_item: ProfileItem) => void; onSave: (_item: ProfileItem) => void;
  onComment: (_item: ProfileItem) => void; onGift: (_item: ProfileItem) => void;
  onDelete: (_item: ProfileItem) => void; onShare: (_item: ProfileItem) => void;
  onFollow: (_item: ProfileItem) => void; onMore: (_item: ProfileItem) => void;
  onCreate?: () => void;
  onShareLink?: (_item: ProfileItem) => void;
};

/**
 * Profile content renders the "Posts" and "Liked" tabs through the SAME shared
 * FeedPostCard component the Home feed uses, so every post on a profile shows the
 * creator's avatar/name/@username, the Home metadata, media behaviour and the
 * like/comment/share/gift/save + more interaction UI — never a second grid tile.
 * Reels/Media/Live remain media galleries that link to their own detail pages.
 */
export default function ProfileContent(props: Props) {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const { tab, rows, profile, own, router, currentUserId, onLike, onSave, onComment, onGift, onDelete, onShare, onFollow, onMore, onCreate, onShareLink } = props;
  if (!rows.length) return <Empty tab={tab} own={own} onCreate={onCreate} />;
  if (tab === 'posts' || tab === 'likes') {
    return <div className="profile-post-feed">{rows.map(item => <FeedPostCard key={item.id} item={item} currentUserId={currentUserId} onLike={onLike} onSave={onSave} onComment={onComment} onShare={onShare} onGift={onGift} onFollow={onFollow} onMore={onMore} feedCompactMedia hideFollowButton />)}</div>;
  }
  if (tab === 'reposts') {
    const label = own ? 'You reposted' : `${profile.fullName || profile.displayName || profile.username} reposted`;
    return <div className="profile-post-feed">{rows.map(item => <FeedPostCard key={item.repostId || item.id} item={{ ...item, type: 'reel' }} currentUserId={currentUserId} onLike={onLike} onSave={onSave} onComment={onComment} onShare={onShare} onGift={onGift} onFollow={onFollow} onMore={onMore} onShareLink={onShareLink} repostContext={label} feedCompactMedia hideFollowButton />)}</div>;
  }
  // The grid renders the reels/media/live galleries. Keep the full ProfileTab type
  // so the (unreachable-for-posts) post/like tile branches below still typecheck.
  const gridTab = tab as ProfileTab;
  return <><div className="content-grid">{rows.map(item => {
    const image = mediaUrl(item);
    const isLive = gridTab === 'live';
    const kind = isLive || gridTab === 'reels' || gridTab === 'reposts' ? 'video' : postKind(item);
    const isVideo = kind === 'video';
    const videoSource = isVideo ? mediaUrl({ videoUrl: item.videoUrl || item.playbackUrl || item.mediaUrl || item.media || item.url }) : '';
    const isText = kind === 'text';
    // Video URLs must never be used as <img src>. Prefer their poster/thumbnail
    // and show the existing fallback tile when a video has no poster image.
    const tileImage = isVideo
      ? mediaUrl({ thumbnailUrl: item.thumbnailUrl || item.thumbnail || item.posterUrl || item.previewImageUrl })
      : image;
    const destination = isLive ? `/live/${item.id}` : gridTab === 'reels' || gridTab === 'reposts' ? `/reels/${item.id}` : `/post/${cleanPostId(item)}`;
    const isProfileMedia = gridTab === 'media';
    return <article className={isText ? 'content-tile tile-text' : 'content-tile'} key={item.id}>
      {isText ? (
        <button className="tile-open tile-text-open" onClick={() => isProfileMedia ? undefined : router.push(destination)} aria-label={`Open ${gridTab} item`}>
          <span className="tile-text-icon"><MessageCircle size={18} /></span>
          <p className="tile-text-body">{item.content || item.title || 'Text post'}</p>
        </button>
      ) : (
        <button className="tile-open" onClick={() => { if (isProfileMedia && !isVideo) { if (image) setPreview({ src: image, alt: item.title || `${profile.username}'s media` }); } else router.push(destination); }} aria-label={isProfileMedia ? `View ${item.title || 'profile media'}` : `Open ${gridTab} item`}>{tileImage ? <img src={tileImage} alt={item.content || item.title || `${gridTab} item`} loading="lazy" /> : isVideo && !isLive && videoSource ? <video src={videoSource} poster={mediaUrl({ thumbnailUrl: item.thumbnailUrl || item.thumbnail || item.posterUrl || item.previewImageUrl }) || undefined} aria-label={item.content || item.title || 'Reel preview'} muted playsInline preload="metadata" onLoadedMetadata={event => { const video = event.currentTarget; if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0) { try { video.currentTime = Math.min(0.1, video.duration / 2); } catch { /* metadata-only preview */ } } }} /> : <div className="tile-fallback"><span>{isLive ? <Radio /> : gridTab === 'reels' ? <Film /> : <ImageIcon />}</span><small>{item.content || item.title || 'VANTA'}</small></div>}</button>
      )}
      {isVideo && !isLive && <span className="tile-type"><Play size={11} className="tile-type-play" />{gridTab === 'reels' || gridTab === 'reposts' ? 'REEL' : 'VIDEO'}</span>}
      {isLive && <span className={`tile-type ${item.status === 'LIVE' ? 'is-live' : ''}`}>{item.status === 'LIVE' ? 'LIVE' : 'STREAM'}</span>}
      {isVideo && !isLive && <span className="tile-play"><span className="tile-play-chip"><Play size={16} fill="currentColor" /></span></span>}
      {!isText && gridTab !== 'media' && <div className="tile-overlay"><div className="tile-metrics">{isLive || gridTab === 'reels' || gridTab === 'reposts' ? <><Eye size={16} />{formatCount(item.views ?? item.viewerCount ?? item.totalViewers)}</> : <><button onClick={() => onLike(item)} aria-label={item.liked ? "Unlike" : "Like"} aria-pressed={Boolean(item.liked)} className={item.liked ? "text-[#c9a227]" : "text-[#8a8a8a]"}><Heart size={17} fill={item.liked ? "currentColor" : "none"} />{formatCount(item.likes ?? item._count?.likes)}</button><button onClick={() => onComment(item)} aria-label="Comments"><MessageCircle size={17} />{formatCount(item.comments ?? item._count?.comments)}</button></>}</div><div className="tile-actions">{gridTab === 'reels' && own && <button onClick={() => onDelete(item)} aria-label="Delete"><Trash2 size={16} /></button>}</div></div>}
    </article>;
  })}</div><ImageViewer src={preview?.src ?? null} alt={preview?.alt} onClose={() => setPreview(null)} /></>;
}

function Empty({ tab, own, onCreate }: { tab: ProfileTab; own: boolean; onCreate?: () => void }) {
  const title = tab === 'likes' && !own ? 'Liked posts are private or unavailable' : `No ${tab === 'live' ? 'live streams' : tab} yet`;
  const Icon = tab === 'live' ? Radio : tab === 'reels' ? Film : tab === 'media' ? ImageIcon : MessageCircle;
  return <div className="profile-empty"><span><Icon /></span><h2>{title}</h2><p>{own ? 'Your published content will appear here.' : 'There is nothing public to show here.'}</p>{own && tab === 'posts' && onCreate && <button className="profile-button primary" onClick={onCreate}>Create post</button>}</div>;
}