import { feedService } from '../services/feed.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    postComment: { findUnique: jest.fn(), findFirst: jest.fn() },
    post: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    securityLog: { create: jest.fn() },
  },
}));
jest.mock('../security/auditLog', () => ({ appendAuditLog: jest.fn() }));
jest.mock('../services/cache.service', () => ({
  cacheService: { del: jest.fn(), delPattern: jest.fn() },
  CACHE_KEYS: { EXPLORE: 'explore', TRENDING: 'trending' },
  CACHE_TTL: { MEDIUM: 60 },
}));
jest.mock('../services/monitoring.service', () => ({ dbPerformanceTracker: { track: jest.fn() } }));
jest.mock('../services/social-events.service', () => ({ emitSocialEvent: jest.fn() }));
jest.mock('../services/notification.service', () => ({ notificationService: { createNotification: jest.fn(), notifyComment: jest.fn() } }));
jest.mock('../services/public-verification', () => ({
  BADGE_USER_SELECT: {},
  enrichPublicUser: jest.fn(value => value),
  enrichItemAuthors: jest.fn(value => value),
}));

const removedCommentActions: Array<[string, () => Promise<unknown>]> = [
  ['updateComment', () => feedService.updateComment('comment-1', 'user-1', 'edited')],
  ['deleteComment', () => feedService.deleteComment('comment-1', 'user-1')],
  ['likeComment', () => feedService.likeComment('comment-1', 'user-1')],
  ['reportComment', () => feedService.reportComment('comment-1', 'user-1', 'SPAM')],
];

describe('feed comment moderation guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(removedCommentActions)('%s fails closed when the comment is already moderation-removed', async (_name, action) => {
    (prisma.postComment.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(action()).rejects.toThrow('Comment not found');

    expect(prisma.postComment.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'comment-1', moderationRemovedAt: null },
    }));
  });

  test('comment creation rejects a post that is moderation-removed', async () => {
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ username: 'author', status: 'ACTIVE' });
    (prisma.postComment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(feedService.commentOnPost('post-removed', 'user-1', 'A comment')).rejects.toThrow('Post not found');

    expect(prisma.post.findUnique).toHaveBeenCalledWith({
      where: { id: 'post-removed', moderationRemovedAt: null },
      select: { authorId: true, content: true, replyAudience: true },
    });
  });

  test('comment editing and engagement also require the parent post to remain visible', async () => {
    (prisma.postComment.findUnique as jest.Mock).mockResolvedValue({
      id: 'comment-1',
      userId: 'user-1',
      postId: 'post-1',
      post: { moderationRemovedAt: new Date() },
    });

    await expect(feedService.updateComment('comment-1', 'user-1', 'edited')).rejects.toThrow('Comment not found');
    await expect(feedService.deleteComment('comment-1', 'user-1')).rejects.toThrow('Comment not found');
    await expect(feedService.likeComment('comment-1', 'user-1')).rejects.toThrow('Comment not found');
    await expect(feedService.reportComment('comment-1', 'user-1', 'SPAM')).rejects.toThrow('Comment not found');
  });
});
