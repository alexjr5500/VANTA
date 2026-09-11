// @vitest-environment node
/**
 * Regression coverage for the Home-feed Reel identity bug.
 *
 * Symptom: a Reel that works from the Reels page — but when the SAME Reel is
 * liked from the Home feed — fails with "Could not update post — Post not
 * found."
 *
 * Root cause: the Home feed mixes Posts (prisma.post) and Reels (prisma.video).
 * Reels are serialized as `{ type: 'reel', id: 'video-<videoId>', … }`, and the
 * Home flow was sending that Video id to the POST endpoints (/api/feed/:id/like)
 * which resolve against prisma.post. The Video id has no Post row, so the
 * backend answered "Post not found".
 *
 * These tests pin the fix: every Reel must be addressed by its canonical
 * prisma.video id through /api/reels (exactly like the Reels page), and no
 * Reel may be sent to /api/feed. A "Post not found" only applies to an
 * identifier that genuinely does not exist.
 */
import { describe, expect, test } from 'vitest';
import { cleanId, isVideoItem, actionEndpointFor, detailPathFor, type FeedItem } from './feedIdentity';

const VIDEO_ID = 'cmts0ah3r0059hkluzfoh2iot';

// A Reel exactly as the Home feed's backend returns it (formatVideo).
const homeReel: FeedItem = {
  id: `video-${VIDEO_ID}`,
  type: 'reel',
  content: 'Hehe',
  media: '/uploads/clip.mp4',
  thumbnail: '/uploads/thumb.jpg',
  author: { id: 'u1', username: 'alex' },
};

// The SAME Reel exactly as the Reels page returns it (getReels/getReelById).
const reelsPageReel: FeedItem = {
  id: VIDEO_ID,
  title: 'Hehe',
  videoUrl: '/uploads/clip.mp4',
  creator: { id: 'u1', username: 'alex' },
};

// A regular text Post as the Home feed returns it (formatPost).
const homePost: FeedItem = {
  id: 'post-abc123',
  type: 'post',
  content: 'hello world',
  author: { id: 'u2', username: 'bob' },
};

describe('Test C — Home Reel ID equals Reels Reel canonical ID', () => {
  test('the Home and Reels serializations resolve to the same canonical Video id', () => {
    expect(cleanId(homeReel)).toBe(VIDEO_ID);
    expect(cleanId(reelsPageReel)).toBe(VIDEO_ID);
    expect(cleanId(homeReel)).toBe(cleanId(reelsPageReel));
  });

  test('the canonical id is never a feed prefix, index, media, author or client id', () => {
    expect(cleanId(homeReel)).toBe(VIDEO_ID);
    expect(cleanId(homeReel)).not.toBe('video-' + VIDEO_ID);
    expect(cleanId(homeReel)).not.toBe(homeReel.media);
    expect(cleanId(homeReel)).not.toBe(homeReel.author.id);
  });

  test('strips the live/community/creator prefixes the same way for navigation', () => {
    expect(cleanId({ id: 'live-abc' } as FeedItem)).toBe('abc');
    expect(cleanId({ id: 'community-xyz' } as FeedItem)).toBe('xyz');
    expect(cleanId({ id: 'creator-qrs' } as FeedItem)).toBe('qrs');
  });
});

describe('Reels are detected and routed through /api/reels (not /api/feed)', () => {
  test('a Home feed Reel is classified as a Reel', () => {
    expect(isVideoItem(homeReel)).toBe(true);
  });

  test('a Reels page Reel is classified as a Reel', () => {
    expect(isVideoItem(reelsPageReel)).toBe(true);
  });

  test('a text Post is not misclassified as a Reel', () => {
    expect(isVideoItem(homePost)).toBe(false);
  });

  test('a Reel routes its mutations to /api/reels (never /api/feed) [Test B root cause]', () => {
    expect(actionEndpointFor(homeReel)).toBe('/api/reels');
    expect(actionEndpointFor(reelsPageReel)).toBe('/api/reels');
  });

  test('a Post routes its mutations to /api/feed', () => {
    expect(actionEndpointFor(homePost)).toBe('/api/feed');
  });

  test('a Reel opened from Home navigates to the canonical /reels/:id detail [Test A/B]', () => {
    expect(detailPathFor(homeReel)).toBe(`/reels/${VIDEO_ID}`);
    expect(detailPathFor(reelsPageReel)).toBe(`/reels/${VIDEO_ID}`);
    expect(detailPathFor(homePost)).toBe('/post/post-abc123');
  });
});

describe('Test D — "Post not found" only when the id genuinely does not exist', () => {
  test('an existing Reel must resolve to a valid app path and reel endpoint', () => {
    // The canonical id exists in the video table, so it must route to reels.
    const base = actionEndpointFor(homeReel);
    const likeUrl = `${base}/${cleanId(homeReel)}/like`;
    expect(likeUrl).toBe(`/api/reels/${VIDEO_ID}/like`);
    // It must never be built against the Post resource.
    expect(likeUrl.startsWith('/api/feed')).toBe(false);
  });

  test('a missing id carries no hidden feed prefix and is not auto-rewritten', () => {
    // If the reel truly does not exist the id is a plain (unknown) video id whose
    // endpoint is still /api/reels; the backend would 404 "Reel not found", NOT a
    // Post lookup. Nothing here fabricates or regenerates an id.
    const ghost = { id: `video-does-not-exist-1`, type: 'reel' } as FeedItem;
    expect(cleanId(ghost)).toBe('does-not-exist-1');
    expect(`${actionEndpointFor(ghost)}/${cleanId(ghost)}`).toBe('/api/reels/does-not-exist-1');
  });
});