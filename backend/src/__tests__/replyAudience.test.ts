import { assertReplyAllowed, parseReplyAudience } from '../security/replyAudience';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: { follow: { findUnique: jest.fn(), findFirst: jest.fn() } },
}));

const authorId = 'author-1';
const viewer = { id: 'viewer-2', username: 'visitor', verified: false };
const post = (replyAudience: string, content = 'Hi everyone') => ({ authorId, content, replyAudience });

describe('reply audience enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.follow.findFirst as jest.Mock).mockResolvedValue(null);
  });

  test('defaults legacy rows to everyone and rejects unknown policies', async () => {
    expect(parseReplyAudience(undefined)).toBe('EVERYONE');
    expect(parseReplyAudience('EXTENDED')).toBe('EXTENDED');
    expect(() => parseReplyAudience('HACKED')).toThrow('Invalid reply audience');
    await expect(assertReplyAllowed(post('EVERYONE'), viewer)).resolves.toBeUndefined();
    expect(prisma.follow.findUnique).not.toHaveBeenCalled();
  });

  test('authors and explicitly mentioned users can always respond', async () => {
    await expect(assertReplyAllowed(post('MENTIONED'), { ...viewer, id: authorId })).resolves.toBeUndefined();
    await expect(assertReplyAllowed(post('MENTIONED', 'Welcome @Visitor and @someone'), viewer)).resolves.toBeUndefined();
    await expect(assertReplyAllowed(post('VERIFIED', 'Hi @visitor'), viewer)).resolves.toBeUndefined();
    await expect(assertReplyAllowed(post('MENTIONED', 'Hello everyone'), viewer))
      .rejects.toThrow('Only accounts mentioned');
  });

  test('requires a verified account for VERIFIED', async () => {
    await expect(assertReplyAllowed(post('VERIFIED'), viewer)).rejects.toThrow('Only verified accounts');
    await expect(assertReplyAllowed(post('VERIFIED'), { ...viewer, verified: true })).resolves.toBeUndefined();
  });

  test('FOLLOWING requires the author to follow the viewer', async () => {
    await expect(assertReplyAllowed(post('FOLLOWING'), viewer)).rejects.toThrow('Only accounts followed');
    expect(prisma.follow.findUnique).toHaveBeenCalledWith({
      where: { followerId_followingId: { followerId: authorId, followingId: viewer.id } },
      select: { id: true },
    });
    (prisma.follow.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'follow-1' });
    await expect(assertReplyAllowed(post('FOLLOWING'), viewer)).resolves.toBeUndefined();
  });

  test('EXTENDED includes accounts followed by accounts the author follows', async () => {
    await expect(assertReplyAllowed(post('EXTENDED'), viewer)).rejects.toThrow('follow network');
    expect(prisma.follow.findFirst).toHaveBeenCalledWith({
      where: { followingId: viewer.id, follower: { followers: { some: { followerId: authorId } } } },
      select: { id: true },
    });
    (prisma.follow.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'second-degree-follow' });
    await expect(assertReplyAllowed(post('EXTENDED'), viewer)).resolves.toBeUndefined();
    (prisma.follow.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'direct-follow' });
    await expect(assertReplyAllowed(post('EXTENDED'), viewer)).resolves.toBeUndefined();
  });
});
