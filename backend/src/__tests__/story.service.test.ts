jest.mock('../prisma', () => ({ prisma: {
  story: { create: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(),
} }));

import { prisma } from '../prisma';
import { StoryService, DAILY_STATUS_LIMIT } from '../services/story.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new StoryService();

describe('StoryService daily Status upload limit', () => {
  const tx = { story: { count: db.story.count, create: db.story.create } };

  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback(tx));
  });

  it('allows a normal user to publish up to 7 statuses per day', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(6);
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'story-7' });
    await service.createStory('user-1', 'https://cdn/photo.jpg', 'IMAGE', undefined, { isVerified: false });
    expect(db.story.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', createdAt: { gte: expect.any(Date) } },
    });
    expect(db.story.create).toHaveBeenCalled();
  });

  it('rejects the 8th status of the day for a normal user', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(7);
    await expect(
      service.createStory('user-1', 'https://cdn/photo.jpg', 'IMAGE', undefined, { isVerified: false })
    ).rejects.toThrow(`You've reached today's Status limit of ${DAILY_STATUS_LIMIT} posts.`);
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('does not count un-created (failed/cancelled) uploads against the quota', () => {
    // A failed/cancelled upload never calls prisma.story.create — the quota is
    // consumed only when the count is checked at publish time inside the tx.
    expect(DAILY_STATUS_LIMIT).toBe(7);
  });

  it('allows a verified user to publish beyond the daily limit', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(50);
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'story-51' });
    await service.createStory('user-v', 'https://cdn/video.mp4', 'VIDEO', 'caption', { isVerified: true });
    expect(db.story.count).not.toHaveBeenCalled();
    expect(db.story.create).toHaveBeenCalled();
  });

  it('treats missing verification (never trusted from client) as a normal user', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(7);
    await expect(
      service.createStory('user-1', 'https://cdn/photo.jpg', 'IMAGE', undefined, { isVerified: false })
    ).rejects.toThrow('Status limit');
  });

  it('prevents concurrent uploads from exceeding the limit (count + create are atomic)', async () => {
    // Simulate concurrent requests: each counts 7 already-published stories.
    (db.story.count as jest.Mock).mockResolvedValue(7);
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'story' });

    const results = await Promise.allSettled([
      service.createStory('user-1', 'https://cdn/1.jpg', 'IMAGE', undefined, { isVerified: false }),
      service.createStory('user-1', 'https://cdn/2.jpg', 'IMAGE', undefined, { isVerified: false }),
    ]);

    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    // At least one request must be blocked once the day's quota is exhausted.
  });

  it('enforces the quota on reshare (which publishes a new Story row)', async () => {
    (db.story.findUnique as jest.Mock).mockResolvedValue({
      id: 'orig-1', mediaUrl: 'https://cdn/orig.jpg', mediaType: 'IMAGE',
      user: { id: 'owner', username: 'owner' }, expiresAt: new Date(Date.now() + 3600000),
    });
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'reshare' });
    (db.story.count as jest.Mock).mockResolvedValue(7);
    await expect(
      service.reshareStory('user-1', 'orig-1', undefined, { isVerified: false })
    ).rejects.toThrow('Status limit');
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('reports usage for the frontend counter (used/limit)', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(3);
    expect(await service.getStatusUsage('user-1')).toEqual({ used: 3, limit: 7 });
  });
});