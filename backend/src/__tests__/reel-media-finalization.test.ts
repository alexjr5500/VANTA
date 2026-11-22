import { finalizeReel } from '../controllers/reel.controller';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    video: { findUnique: jest.fn(), update: jest.fn() },
    uploadedFile: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services', () => ({ uploadService: {} }));
jest.mock('../services/content-view.service', () => ({ contentViewService: {} }));
jest.mock('../services/reel-feed.service', () => ({ buildReelFeed: jest.fn() }));
jest.mock('../services/public-verification', () => ({
  BADGE_USER_SELECT: {},
  enrichItemAuthors: (v: unknown) => v,
  enrichPublicUser: (v: unknown) => v,
}));

describe('Reel media finalization', () => {
  const originalReel = {
    id: 'reel-1', creatorId: 'creator-1', duration: 10,
    thumbnailUrl: null, publishStatus: 'UPLOADING',
  };
  const uploaded = {
    id: 'upload-1', userId: 'creator-1', fileType: 'VIDEO',
    category: 'reel', recordType: 'Video', recordId: 'reel-1',
    deletedAt: null, url: 'https://res.cloudinary.com/test/video/upload/clip.mp4',
  };

  const makeResponse = () => {
    const response: any = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response;
  };
  const tx = {
    uploadedFile: { updateMany: jest.fn() },
    video: { update: jest.fn() },
  };
  const request = (fileId = 'upload-1') => ({
    user: { userId: 'creator-1' },
    params: { id: 'reel-1' },
    body: { fileId, duration: 12 },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.video.findUnique as jest.Mock).mockResolvedValue({ ...originalReel });
    (prisma.uploadedFile.findUnique as jest.Mock).mockResolvedValue({ ...uploaded });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    tx.uploadedFile.updateMany.mockResolvedValue({ count: 1 });
    tx.video.update.mockResolvedValue({ ...originalReel, videoUrl: uploaded.url, publishStatus: 'PUBLISHED' });
  });

  it('links the owned upload before publishing the Reel within one transaction', async () => {
    const res = makeResponse();
    await finalizeReel(request() as any, res);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.uploadedFile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'upload-1', userId: 'creator-1', fileType: 'VIDEO', deletedAt: null,
        OR: [{ recordId: null }, { recordType: 'Video', recordId: 'reel-1' }],
      },
      data: { recordType: 'Video', recordId: 'reel-1', category: 'reel' },
    });
    expect(tx.video.update).toHaveBeenCalledWith({
      where: { id: 'reel-1', creatorId: 'creator-1' },
      data: {
        videoUrl: uploaded.url, thumbnailUrl: null,
        duration: 12, publishStatus: 'PUBLISHED',
      },
    });
    expect(tx.uploadedFile.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.video.update.mock.invocationCallOrder[0]);
    expect(prisma.video.update).not.toHaveBeenCalled();
    expect(prisma.uploadedFile.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not publish when an upload has been deleted, reassigned, or linked elsewhere', async () => {
    tx.uploadedFile.updateMany.mockResolvedValue({ count: 0 });
    const res = makeResponse();
    await finalizeReel(request() as any, res);
    expect(tx.video.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Uploaded Reel media is no longer available for this Reel',
    });
  });

  it('propagates publication failures so the transaction rejects and must roll back the media link', async () => {
    tx.video.update.mockRejectedValue(new Error('database write failed'));
    const res = makeResponse();
    await finalizeReel(request() as any, res);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'database write failed' });
  });

  it('refuses to finalize another creator\'s Reel before modifying records', async () => {
    (prisma.video.findUnique as jest.Mock).mockResolvedValue({ ...originalReel, creatorId: 'another-user' });
    const res = makeResponse();
    await finalizeReel(request() as any, res);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('refuses to finalize a deleted or non-video upload', async () => {
    (prisma.uploadedFile.findUnique as jest.Mock).mockResolvedValue({ ...uploaded, deletedAt: new Date() });
    const res = makeResponse();
    await finalizeReel(request() as any, res);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
