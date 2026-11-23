/**
 * feedIdentity.ts
 *
 * Canonical identity + endpoint routing for mixed feed items.
 *
 * The engine serializes content into two distinct database tables:
 *   - Posts  -> prisma.post  (fields: author, content, likes via PostLike…)
 *   - Reels  -> prisma.video (fields: creator, videoUrl, views…)
 *
 * A Reel surfaced through the Home feed is returned by the backend as
 * `{ type: 'reel', id: 'video-<videoId>', … }`, while the Reels page returns
 * `{ id: '<videoId>', … }`. The `video-` prefix is purely a serialization
 * marker for the feed; it MUST NOT be used as the canonical identifier.
 *
 * The canonical database id for a Reel is the raw `prisma.video` record id
 * (identical to what the Reels page uses). All Reel mutations/lookups must go
 * through `/api/reels/:videoId` (NOT `/api/feed/:videoId`), because the feed
 * endpoints resolve against prisma.post and a Video id has no Post row, so the
 * backend answers "Post not found".
 */
export type FeedItem = Record<string, any>;

/** Feed serialization prefixes that must be stripped to recover the DB id. */
const PREFIX_RE = /^(video-|live-|community-|creator-)/;

/** Remove the feed serialization prefix to obtain the canonical database id. */
export const cleanId = (item: FeedItem | string) =>
  String(typeof item === 'string' ? item : item?.id ?? '').replace(PREFIX_RE, '');

/** True when the item is a Reel (backed by prisma.video), never a Post. */
export const isVideoItem = (item: FeedItem) => {
  // A legacy Post with an MP4 attachment was serialized with type='video'.
  // That is NOT a prisma.video Reel: it still has a Post id and must use
  // /api/feed. Only explicit Reel identities or Video model URLs route as Reels.
  if (item?.type === 'post') return false;
  return item?.type === 'reel'
    || (typeof item?.id === 'string' && item.id.startsWith('video-'))
    || Boolean(item?.videoUrl || item?.playbackUrl);
};

/** API resource base for mutations: Reels -> /api/reels, Posts -> /api/feed. */
export const actionEndpointFor = (item: FeedItem) => (isVideoItem(item) ? '/api/reels' : '/api/feed');

/** Route to the canonical detail page for a feed item (Reel vs Post). */
export const detailPathFor = (item: FeedItem) =>
  isVideoItem(item) ? `/reels/${cleanId(item)}` : `/post/${cleanId(item)}`;