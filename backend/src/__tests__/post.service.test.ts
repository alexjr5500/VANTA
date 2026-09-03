import { PostService } from '../services/post.service';
import { prisma } from '../prisma';
import { emitSocialEvent, emitSocialEventToUser } from '../services/social-events.service';

jest.mock('../prisma', () => ({
  prisma: {
    postSave: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
    post: { update: jest.fn(), findUnique: jest.fn() },
    interactionEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/social-events.service', () => ({
  emitSocialEvent: jest.fn(),
  emitSocialEventToUser: jest.fn(),
}));

describe('PostService social interactions', () => {
  const service = new PostService();

  beforeEach(() => jest.clearAllMocks());

  test('savePost creates one bookmark and emits a user-scoped update', async () => {
    (prisma.postSave.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.postSave.create as jest.Mock).mockResolvedValue({ id: 'save-1' });

    await expect(service.savePost('user-1', 'post-1')).resolves.toMatchObject({ saved: true });
    expect(prisma.postSave.create).toHaveBeenCalledWith({ data: { userId: 'user-1', postId: 'post-1' } });
    expect(emitSocialEventToUser).toHaveBeenCalledWith('user-1', 'social:bookmark-updated', { postId: 'post-1', saved: true });
  });

  test('savePost removes an existing bookmark instead of creating a duplicate', async () => {
    (prisma.postSave.findUnique as jest.Mock).mockResolvedValue({ id: 'save-1' });

    await expect(service.savePost('user-1', 'post-1')).resolves.toMatchObject({ saved: false });
    expect(prisma.postSave.delete).toHaveBeenCalledWith({ where: { id: 'save-1' } });
    expect(prisma.postSave.create).not.toHaveBeenCalled();
  });

  test('getSavedPosts returns original post data with counts and a cursor', async () => {
    const post = { id: 'post-1', content: 'Saved post', _count: { likes: 4, comments: 2, saves: 1 } };
    (prisma.postSave.findMany as jest.Mock).mockResolvedValue([
      { id: 'save-1', createdAt: new Date('2026-08-06'), post },
      { id: 'save-2', createdAt: new Date('2026-08-05'), post: { ...post, id: 'post-2' } },
    ]);

    const result = await service.getSavedPosts('user-1', undefined, 1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'post-1', likesCount: 4, commentsCount: 2, savesCount: 1, isSaved: true });
    expect(result.nextCursor).toBe('save-2');
  });

  test('sharePost updates the count and records its destination atomically', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async callback => callback({
      post: { update: jest.fn().mockResolvedValue({ shareCount: 8 }) },
      interactionEvent: { create: jest.fn().mockResolvedValue({}) },
    }));

    await expect(service.sharePost('post-1', 'user-1', 'WHATSAPP')).resolves.toEqual({ shared: true, shareCount: 8 });
    expect(emitSocialEvent).toHaveBeenCalledWith('social:post-updated', { postId: 'post-1', shares: 8 });
  });
});