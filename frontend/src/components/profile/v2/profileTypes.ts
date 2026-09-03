import { resolveMediaUrl } from '@/lib/mediaUrl';

export type ProfileTab = 'posts' | 'reels' | 'live' | 'media' | 'likes' | 'about';
export type ProfileItem = Record<string, any>;
export type ProfileData = ProfileItem & {
  id: string;
  username: string;
  fullName?: string;
  displayName?: string;
  avatar?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  location?: string;
  website?: string;
  joinedAt?: string;
  createdAt?: string;
  verified?: boolean;
  isFollowing?: boolean;
  stats?: ProfileItem;
  _count?: ProfileItem;
};

export const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const formatCount = (value: unknown) => {
  const number = finite(value);
  if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
  return String(number);
};

export const unwrap = (value: any): ProfileItem[] => Array.isArray(value)
  ? value
  : value?.items || value?.data || value?.posts || value?.reels || value?.streams || value?.gifts || [];

// Gift catalog/wallet responses sometimes share the same transport shape as
// feed responses. Keep those feature records out of the social post renderer.
export const postOnly = (items: ProfileItem[]) => items.filter((item) => {
  if (!item || typeof item !== 'object') return false;
  const kind = String(item.type || item.kind || item.entityType || '').toLowerCase();
  const text = String(item.content || item.caption || '').trim().toLowerCase();
  return kind !== 'gift' && kind !== 'giftbox' && kind !== 'gift_box'
    && !/^gift\s*box(?:\s|$)/i.test(text);
});

export const mediaUrl = (item: ProfileItem) => resolveMediaUrl(item.mediaUrl || item.media || item.imageUrl
  || item.thumbnailUrl || item.thumbnail || item.attachments?.[0]?.url || item.mediaUrls?.[0]);

export type PostKind = 'video' | 'image' | 'text';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|m3u8)(\?.*)?$/i;

/**
 * Classify a profile grid item so text posts, image posts and reels/videos are
 * rendered as visually distinct tiles. Explicit `type` wins, then stream/playback
 * fields, then URL extension — falling back to `text` when no media is present.
 */
export const isVideoPost = (item: ProfileItem): boolean => {
  const kind = String(item.type || item.kind || item.entityType || '').toLowerCase();
  if (kind === 'video' || kind === 'reel' || kind === 'live' || kind === 'stream') return true;
  // Explicit text/image markers take priority so a stray thumbnail on a text
  // post is never mistaken for a video.
  if (kind === 'text' || kind === 'image' || kind === 'photo') return false;
  if (item.videoUrl || item.playbackUrl || item.duration || item.durationMs || item.durationSeconds) return true;
  if (String(item.mediaType || item.contentType || '').toLowerCase().includes('video')) return true;
  return VIDEO_EXT.test(String(item.videoUrl || item.playbackUrl || item.url || ''));
};

export const isImagePost = (item: ProfileItem): boolean => {
  if (isVideoPost(item)) return false;
  if (String(item.mediaType || item.contentType || '').toLowerCase().includes('video')) return false;
  return Boolean(mediaUrl(item));
};

export const postKind = (item: ProfileItem): PostKind => {
  if (isVideoPost(item)) return 'video';
  if (isImagePost(item)) return 'image';
  return 'text';
};

export const cleanPostId = (item: ProfileItem) => String(item.id || '').replace(/^(video-|community-)/, '');

export const joinedDate = (profile: ProfileData) => {
  const date = new Date(profile.joinedAt || profile.createdAt || '');
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export const safeWebsite = (website?: string) => {
  if (!website) return '';
  try { return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).href; }
  catch { return ''; }
};