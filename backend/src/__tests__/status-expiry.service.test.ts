jest.mock('../prisma', () => ({ prisma: {
  $queryRaw: jest.fn(), $transaction: jest.fn(),
  story: { deleteMany: jest.fn() }, contentView: { deleteMany: jest.fn() },
  uploadedFile: { findUnique: jest.fn(), updateMany: jest.fn() },
} }));
jest.mock('../services/upload.service', () => ({ uploadService: { deleteFile: jest.fn() } }));
import { prisma } from '../prisma';
import { uploadService } from '../services/upload.service';
import { sweepExpiredStatuses } from '../services/status-expiry.service';

describe('expired Status cleanup', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  beforeEach(() => {
    jest.resetAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.story.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.contentView.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.uploadedFile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });
  it('deletes due rows and only eligible orphaned storage files', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ id: 'expired' }]).mockResolvedValueOnce([{ id: 'f1', filename: 'status.mp4' }]);
    (uploadService.deleteFile as jest.Mock).mockResolvedValue(true);
    (prisma.uploadedFile.findUnique as jest.Mock).mockResolvedValue({ deletedAt: now });
    expect(await sweepExpiredStatuses(now)).toEqual({ stories: 1, files: 1, failed: 0 });
    expect(prisma.story.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['expired'] }, expiresAt: { lte: now }, moderationRemovedAt: null } });
    expect(prisma.contentView.deleteMany).toHaveBeenCalledWith({ where: { contentType: 'STORY', contentId: { in: ['expired'] } } });
    expect(uploadService.deleteFile).toHaveBeenCalledWith('status.mp4', 'f1');
    const sql = (prisma.$queryRaw as jest.Mock).mock.calls[1][0].join(' ');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "Story"');
    expect(sql).toContain('"moderationOriginalPath" IS NULL');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "CopyrightClaim"');
  });
  it('keeps failed file deletion eligible for a later retry', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'retry', filename: 'retry.mp4' }]);
    (uploadService.deleteFile as jest.Mock).mockRejectedValue(new Error('provider unavailable'));
    expect(await sweepExpiredStatuses(now)).toEqual({ stories: 0, files: 0, failed: 1 });
    expect(prisma.uploadedFile.updateMany).toHaveBeenCalledWith({ where: { id: 'retry', deletedAt: null }, data: { updatedAt: now } });
  });
});
