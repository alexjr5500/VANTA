import { describe, it, expect } from 'vitest';
import { notificationDestination } from './notificationDestination';

describe('notification destinations', () => {
  it('opens the protected message request inbox', () => {
    expect(notificationDestination({ type: 'chat_request' })).toBe('/chat/requests');
  });
  it('opens the original post from legacy and modern like notifications', () => {
    expect(notificationDestination({ type: 'like', data: '{"postId":"p1"}' })).toBe('/post/p1');
    expect(notificationDestination({ type: 'LIKE', entityType: 'POST', entityId: 'p1', data: { destination: '/home?post=p1' } })).toBe('/post/p1');
    expect(notificationDestination({ data: { destination: '/home?post=p1' } })).toBe('/post/p1');
  });
  it('opens published mentions and comment replies on their post', () => {
    expect(notificationDestination({ type: 'mention', data: { postId: 'p1' } })).toBe('/post/p1');
    expect(notificationDestination({ type: 'mention', data: { postId: 'p1', commentId: 'c1' } })).toBe('/post/p1#comments');
    expect(notificationDestination({ type: 'comment', data: { postId: 'p1', commentId: 'c1' } })).toBe('/post/p1#comments');
  });
  it('opens reels and follower profiles', () => {
    expect(notificationDestination({ type: 'like', data: { videoId: 'r1' } })).toBe('/reels/r1');
    expect(notificationDestination({ entityType: 'reel', entityId: 'r2' })).toBe('/reels/r2');
    expect(notificationDestination({ type: 'follow', data: { followerUsername: 'anime' } })).toBe('/profile/anime');
  });
  it('preserves chat, live and balance routes and rejects unsafe redirects', () => {
    expect(notificationDestination({ data: { conversationId: 'chat1' } })).toBe('/chat?conversation=chat1');
    expect(notificationDestination({ data: { streamId: 'live1' } })).toBe('/live/live1');
    expect(notificationDestination({ type: 'wallet_deposit' })).toBe('/balance/transactions');
    expect(notificationDestination({ data: { destination: '//evil.example' } })).toBeNull();
    expect(notificationDestination({ data: '{not json' })).toBeNull();
  });
});
