/**
 * Story self-comment restriction — server-side enforcement.
 *
 * A user must NEVER be able to comment on their OWN story, even via a direct
 * API request that bypasses the UI. The frontend hides the composer for the
 * owner, but the real security control lives here in StoryService.addComment.
 * Commenting on ANOTHER user's story must remain fully functional.
 */
jest.mock('../prisma', () => ({
  prisma: {
    story: { findUnique: jest.fn() },
    storyComment: { create: jest.fn() },
  },
}));

import { prisma } from '../prisma';
import { StoryService } from '../services/story.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new StoryService();

const activeStory = (ownerId: string) => ({
  id: 'story-1',
  userId: ownerId,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000), // active
  publishStatus: 'PUBLISHED',
});

describe('StoryService.addComment — owner cannot comment on own story', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a self-comment (owner === commenter) with a clear error', async () => {
    (db.story.findUnique as jest.Mock).mockResolvedValue(activeStory('owner-1'));

    await expect(service.addComment('story-1', 'owner-1', 'nice story')).rejects.toThrow(
      'You cannot comment on your own story'
    );
    // The critical guarantee: no comment row is ever created.
    expect(db.storyComment.create).not.toHaveBeenCalled();
  });

  it('still allows commenting on ANOTHER user\'s story', async () => {
    (db.story.findUnique as jest.Mock).mockResolvedValue(activeStory('owner-1'));
    (db.storyComment.create as jest.Mock).mockResolvedValue({
      id: 'comment-1',
      storyId: 'story-1',
      userId: 'viewer-2',
      content: 'great!',
      user: { id: 'viewer-2', username: 'viewer' },
    });

    const result = await service.addComment('story-1', 'viewer-2', 'great!');
    expect(db.storyComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storyId: 'story-1', userId: 'viewer-2', content: 'great!' }) })
    );
    expect(result.id).toBe('comment-1');
  });

  it('rejects empty / whitespace comments before any ownership logic', async () => {
    await expect(service.addComment('story-1', 'viewer-2', '   ')).rejects.toThrow('Comment cannot be empty');
    expect(db.storyComment.create).not.toHaveBeenCalled();
  });
});
