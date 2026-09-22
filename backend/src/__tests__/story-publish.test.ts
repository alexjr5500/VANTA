jest.mock('../prisma', () => ({
  prisma: {
    story: { create: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    uploadedFile: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../prisma';
import { StoryService } from '../services/story.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new StoryService();

const draftStory = {
  id: 'story-1',
  userId: 'user-1',
  mediaUrl: null,
  mediaType: 'IMAGE',
  publishStatus: 'UPLOADING',
  caption: 'hi',
  expiresAt: new Date(Date.now() + 3600000),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Story background publish lifecycle', () => {
  it('creates an instant draft (UPLOADING, no media yet)', async () => {
    (db.story.count as jest.Mock).mockResolvedValue(0);
    (db.story.create as jest.Mock).mockResolvedValue({ ...draftStory });

    const story = await service.createStoryDraft('user-1', 'hi');

    expect(story.publishStatus).toBe('UPLOADING');
    expect(db.story.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mediaUrl: null, publishStatus: 'UPLOADING' }) })
    );
  });

  it('finalize publishes the draft only when the media URL exists', async () => {
    const tx = {
      story: {
        findUnique: jest.fn().mockResolvedValue({ ...draftStory }),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ ...draftStory, mediaUrl: '/uploads/x.jpg', publishStatus: 'PUBLISHED' }),
      },
    };
    (db.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
    (db.uploadedFile.findUnique as jest.Mock).mockResolvedValue({ id: 'file-1', userId: 'user-1', deletedAt: null, url: '/uploads/x.jpg', fileType: 'IMAGE' });
    (db.uploadedFile.update as jest.Mock).mockResolvedValue({});

    const story = await service.finalizeStoryMedia('user-1', 'story-1', 'file-1', { isVerified: false });

    expect(story.publishStatus).toBe('PUBLISHED');
    expect(story.mediaUrl).toBe('/uploads/x.jpg');
    expect(db.uploadedFile.update).toHaveBeenCalled();
  });

  it('rejects finalize when the uploaded file is not owned by the user', async () => {
    (db.uploadedFile.findUnique as jest.Mock).mockResolvedValue({ id: 'file-1', userId: 'someone-else', deletedAt: null, url: '/uploads/x.jpg', fileType: 'IMAGE' });

    await expect(service.finalizeStoryMedia('user-1', 'story-1', 'file-1')).rejects.toThrow('not owned');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});