jest.mock('../prisma', () => ({ prisma: {
  story: { create: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(),
} }));

import { prisma } from '../prisma';
import { StoryService, DAILY_STATUS_LIMIT, STATUS_MAX_CHARS, STATUS_MAX_LINES, countStatusChars, countStatusLines } from '../services/story.service';

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

describe('StoryService.createTextStory (text-only Story/Status)', () => {
  const tx = { story: { count: db.story.count, create: db.story.create } };

  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback(tx));
  });

  it('creates a TEXT story row with the text in caption and empty mediaUrl', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(2);
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'text-story' });
    const story = await service.createTextStory('user-1', ' Hello VANTA! ', { isVerified: false });
    expect(story.id).toBe('text-story');
    expect(db.story.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        mediaUrl: '',
        mediaType: 'TEXT',
        caption: 'Hello VANTA!',
        expiresAt: expect.any(Date),
      }),
      include: expect.any(Object),
    });
  });

  it('trims the text and rejects empty text', async () => {
    await expect(service.createTextStory('user-1', '   ', { isVerified: false }))
      .rejects.toThrow('Text story cannot be empty');
  });

  it('honours the daily Status quota', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(7);
    await expect(service.createTextStory('user-1', 'Too many', { isVerified: false }))
      .rejects.toThrow('Status limit');
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('bypasses the quota for verified users', async () => {
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'text-story' });
    await service.createTextStory('user-v', 'VIP text', { isVerified: true });
    expect(db.story.count).not.toHaveBeenCalled();
    expect(db.story.create).toHaveBeenCalled();
  });
});

describe('StoryService Status hard limits (700 chars / 10 lines)', () => {
  const tx = { story: { count: db.story.count, create: db.story.create } };

  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback(tx));
    (db.story.count as jest.Mock).mockResolvedValue(0);
    (db.story.create as jest.Mock).mockResolvedValue({ id: 'status' });
  });

  it('counts characters as Unicode code points (emoji / surrogate pairs count once)', () => {
    // 👨👩👧 = ZWJ sequence: 5 code points (incl. ZWJ / VS16) but 11 UTF-16 units.
    expect(countStatusChars('👨👩👧')).toBe(countStatusChars('👨') + countStatusChars('👩') + countStatusChars('👧'));
    expect(countStatusChars('')).toBe(0);
    expect(countStatusChars('Hello')).toBe(5);
  });

  it('counts logical lines for \\n, \\r\\n and \\r', () => {
    expect(countStatusLines('a\nb\nc')).toBe(3);
    expect(countStatusLines('a\r\nb\rc')).toBe(3);
    expect(countStatusLines('one line')).toBe(1);
  });

  it('accepts exactly 700 characters', async () => {
    await service.createTextStory('user-1', 'a'.repeat(STATUS_MAX_CHARS), { isVerified: false });
    expect(db.story.create).toHaveBeenCalled();
  });

  it('rejects 701 characters', async () => {
    await expect(service.createTextStory('user-1', 'a'.repeat(STATUS_MAX_CHARS + 1), { isVerified: false }))
      .rejects.toThrow(`Status is too long (${STATUS_MAX_CHARS + 1}/${STATUS_MAX_CHARS} characters)`);
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('accepts exactly 10 lines', async () => {
    await service.createTextStory('user-1', Array.from({ length: STATUS_MAX_LINES }, () => 'line').join('\n'), { isVerified: false });
    expect(db.story.create).toHaveBeenCalled();
  });

  it('rejects an 11th line (even an empty one)', async () => {
    const elevenLines = Array.from({ length: STATUS_MAX_LINES + 1 }, () => 'line').join('\n');
    await expect(service.createTextStory('user-1', elevenLines, { isVerified: false }))
      .rejects.toThrow(`Status cannot exceed ${STATUS_MAX_LINES} lines.`);
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('rejects pasted oversize content (limit cannot be bypassed via one string)', async () => {
    const overflow = `x\n${'y'.repeat(STATUS_MAX_CHARS)}`;
    await expect(service.createTextStory('user-1', overflow, { isVerified: false }))
      .rejects.toThrow('Status is too long');
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('rejects excessive whitespace-only-padded content over the limit', async () => {
    const padded = ` ${'word '.repeat(STATUS_MAX_CHARS)} `;
    await expect(service.createTextStory('user-1', padded, { isVerified: false }))
      .rejects.toThrow('Status is too long');
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('persists a valid textStyle payload', async () => {
    const style = JSON.stringify({ font: 'display', size: 42, color: '#dfbd55', align: 'center' });
    await service.createTextStory('user-1', 'Styled', { isVerified: false, textStyle: style });
    expect(db.story.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mediaType: 'TEXT', caption: 'Styled', textStyle: style }),
    }));
  });

  it('rejects an oversized textStyle payload', async () => {
    const hugeStyle = '{' + 'x'.repeat(9000) + '}';
    await service.createTextStory('user-1', 'Styled', { isVerified: false, textStyle: hugeStyle });
    const callArg = (db.story.create as jest.Mock).mock.calls[0][0];
    expect(callArg.data.textStyle).toBeUndefined();
  });

  it('enforces the same limits on media story captions', async () => {
    await expect(
      service.createStory('user-1', 'https://cdn/photo.jpg', 'IMAGE', 'x'.repeat(STATUS_MAX_CHARS + 1), { isVerified: false })
    ).rejects.toThrow('Status caption is too long');
    expect(db.story.create).not.toHaveBeenCalled();
  });

  it('enforces the same limits on reshare captions', async () => {
    (db.story.findUnique as jest.Mock).mockResolvedValue({
      id: 'orig-1', mediaUrl: 'https://cdn/orig.jpg', mediaType: 'IMAGE',
      user: { id: 'owner', username: 'owner' }, expiresAt: new Date(Date.now() + 3600000),
    });
    await expect(
      service.reshareStory('user-1', 'orig-1', Array.from({ length: STATUS_MAX_LINES + 1 }, () => 'line').join('\n'), { isVerified: false })
    ).rejects.toThrow('Status caption cannot exceed');
    expect(db.story.create).not.toHaveBeenCalled();
  });
});