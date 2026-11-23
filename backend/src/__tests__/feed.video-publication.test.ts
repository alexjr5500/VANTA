import { createPost } from '../controllers/feed.controller';
import { prisma } from '../prisma';
import { feedService, uploadService } from '../services';

jest.mock('../prisma', () => ({
  prisma: {
    uploadedFile: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../services', () => ({
  feedService: { createPost: jest.fn(), deletePost: jest.fn() },
  uploadService: { linkFile: jest.fn() },
}));
jest.mock('../services/cache.service', () => ({
  cacheService: { delPattern: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined) },
  CACHE_KEYS: { TRENDING: 'trending', EXPLORE: 'explore' },
}));

const uploaded = (id: string, fileType: 'VIDEO' | 'IMAGE') => ({
  id, userId: 'user-1', fileType, category: fileType === 'VIDEO' ? 'post-video' : 'post-image',
  recordType: null, url: `https://assets.example/${id}.${fileType === 'VIDEO' ? 'mp4' : 'jpg'}`,
});

const response = () => {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
const request = (files: string[], content = 'My video') => ({
  user: { userId: 'user-1' },
  body: { content, media: { fileIds: files, urls: [] } },
} as any);

describe('Create Post publishes video assets into the canonical Reel feed', () => {
  const tx = {
    post: { create: jest.fn() },
    video: { create: jest.fn() },
    uploadedFile: { updateMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.post.create.mockResolvedValue({ id: 'post-1' });
    tx.video.create.mockResolvedValue({ id: 'reel-1', publishStatus: 'PUBLISHED' });
    tx.uploadedFile.updateMany.mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(async callback => callback(tx));
  });

  it('creates a published Reel, never an ordinary Post, for video-only creation', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([uploaded('video-1', 'VIDEO')]);
    const res = response();
    await createPost(request(['video-1']), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.video.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      creatorId: 'user-1', publishStatus: 'PUBLISHED', title: 'My video', videoUrl: 'https://assets.example/video-1.mp4',
    }) });
    expect(tx.uploadedFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'video-1', userId: 'user-1', deletedAt: null, recordType: null },
      data: { recordType: 'Video', recordId: 'reel-1', category: 'reel' },
    });
    expect(tx.post.create).not.toHaveBeenCalled();
    expect(feedService.createPost).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'reel', id: 'video-reel-1' }));
  });

  it('splits mixed photos and videos into a Post and a published Reel, with no duplicated file linkage', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([
      uploaded('image-1', 'IMAGE'), uploaded('video-1', 'VIDEO'),
    ]);
    const res = response();
    await createPost(request(['image-1', 'video-1'], 'Family memories'), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.post.create).toHaveBeenCalledWith({ data: {
      authorId: 'user-1', content: 'Family memories', mediaUrl: 'https://assets.example/image-1.jpg',
    } });
    expect(tx.uploadedFile.updateMany).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'post', id: 'post-1' }));
  });

  it('rejects missing/unowned media instead of creating a visible Reel', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([]);
    const res = response();
    await createPost(request(['missing-video']), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(tx.video.create).not.toHaveBeenCalled();
  });

  it('keeps ordinary photo-only creation on the Post endpoint', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([uploaded('image-1', 'IMAGE')]);
    (feedService.createPost as jest.Mock).mockResolvedValue({ id: 'post-2' });
    const res = response();
    await createPost(request(['image-1'], ''), res);
    expect(feedService.createPost).toHaveBeenCalledWith('user-1', '', undefined);
    expect(uploadService.linkFile).toHaveBeenCalled();
    expect(tx.video.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
