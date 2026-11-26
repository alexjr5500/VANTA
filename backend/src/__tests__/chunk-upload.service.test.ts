import fs from 'fs';
import path from 'path';

jest.mock('../prisma', () => ({
  prisma: {
    uploadSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    uploadedFile: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '../prisma';
import { chunkUploadService, UPLOAD_CHUNK_SIZE } from '../services/chunk-upload.service';
import { uploadService, uploadStorageDir } from '../services/upload.service';

const db = prisma as jest.Mocked<typeof prisma>;

const baseSession = {
  id: 'sess-1',
  userId: 'user-1',
  fileName: 'clip.mp4',
  fileSize: 100,
  mimeType: 'video/mp4',
  category: 'reel',
  chunkSize: UPLOAD_CHUNK_SIZE,
  totalChunks: 1,
  receivedChunks: 0,
  receivedBytes: 0,
  status: 'ACTIVE' as const,
  recordType: 'Video',
  recordId: 'video-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: new Date(Date.now() + 3600000),
};

const stagingDir = (sessionId: string) => path.join(uploadStorageDir, '.chunks', sessionId);
const partPath = (sessionId: string, index: number) => path.join(stagingDir(sessionId), `${String(index).padStart(6, '0')}.part`);

const req = { user: { userId: 'user-1', role: 'USER' } } as any;

beforeEach(() => {
  jest.clearAllMocks();
  (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession });
});

afterEach(() => {
  try {
    fs.rmSync(stagingDir(baseSession.id), { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('ChunkUploadService', () => {
  describe('limitFor', () => {
    it('maps avatar category to the avatar byte limit', () => {
      expect(chunkUploadService.limitFor('avatar', 'image/jpeg')).toBe(5 * 1024 * 1024);
    });

    it('maps a video mime to the video limit for stories/reels', () => {
      expect(chunkUploadService.limitFor('reel', 'video/mp4')).toBe(100 * 1024 * 1024);
    });
  });

  describe('initChunkSession', () => {
    it('rejects a disallowed mime type before any bytes transfer', async () => {
      (db.uploadSession.create as jest.Mock).mockResolvedValue({ ...baseSession });
      await expect(
        chunkUploadService.initChunkSession('user-1', { fileName: 'x.exe', fileSize: 100, mimeType: 'application/x-msdownload', category: 'reel' })
      ).rejects.toThrow('not allowed');
      expect(db.uploadSession.create).not.toHaveBeenCalled();
    });

    it('rejects an oversized file for its category', async () => {
      await expect(
        chunkUploadService.initChunkSession('user-1', { fileName: 'big.jpg', fileSize: 6 * 1024 * 1024, mimeType: 'image/jpeg', category: 'avatar' })
      ).rejects.toThrow(/too large/);
      expect(db.uploadSession.create).not.toHaveBeenCalled();
    });

    it('computes the correct total chunk count', async () => {
      const size = Math.floor(UPLOAD_CHUNK_SIZE * 2.5);
      (db.uploadSession.create as jest.Mock).mockImplementation(async ({ data }: any) => ({ ...baseSession, fileSize: data.fileSize, totalChunks: data.totalChunks }));
      const session = await chunkUploadService.initChunkSession('user-1', { fileName: 'v.webm', fileSize: size, mimeType: 'video/webm', category: 'reel', recordType: 'Video', recordId: 'video-1' });
      expect(session.totalChunks).toBe(3);
      expect(db.uploadSession.create).toHaveBeenCalled();
    });
  });

  describe('getChunkState (resume support)', () => {
    it('reports only the parts that actually arrived on disk', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, totalChunks: 3, fileSize: 12 });
      fs.mkdirSync(stagingDir(baseSession.id), { recursive: true });
      fs.writeFileSync(partPath(baseSession.id, 0), Buffer.from('AAAA'));
      fs.writeFileSync(partPath(baseSession.id, 2), Buffer.from('CCCC'));

      const state = await chunkUploadService.getChunkState('user-1', baseSession.id);
      expect(state.complete).toBe(false);
      expect(state.status).toBe('ACTIVE');
      expect(state.receivedIndexes.sort()).toEqual([0, 2]);
    });
  });

  it('reports a completed upload even when its staging parts were cleaned up', async () => {
    (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, status: 'COMPLETE' });
    const state = await chunkUploadService.getChunkState('user-1', baseSession.id);
    expect(state.status).toBe('COMPLETE');
    expect(state.receivedIndexes).toEqual([]);
    expect(state.complete).toBe(false); // byte-staging flag is not the persistence status
  });

  describe('acceptChunkPart', () => {
    it('rejects a chunk whose path is outside the session staging dir', async () => {
      await expect(
        chunkUploadService.acceptChunkPart('user-1', baseSession.id, 0, {
          path: path.join(uploadStorageDir, 'somewhere-else.part'),
          size: 10,
        } as any)
      ).rejects.toThrow('could not be staged');
    });
  });

  describe('cancelChunkSession', () => {
    it('does not downgrade a completed upload to CANCELLED', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, status: 'COMPLETE' });
      const result = await chunkUploadService.cancelChunkSession('user-1', baseSession.id);
      expect(result).toEqual({ cancelled: false });
      expect(db.uploadSession.update).not.toHaveBeenCalled();
    });
  });

  describe('completeChunkSession', () => {
    it.each([
      { category: 'post-image' },
      { recordType: 'Post' },
      { recordId: 'other-record' },
    ])('rejects changed session metadata %j before assembly', async options => {
      const spy = jest.spyOn(uploadService, 'uploadFile');
      try {
        await expect(chunkUploadService.completeChunkSession(req, baseSession.id, options)).rejects.toThrow('original session');
        expect(spy).not.toHaveBeenCalled();
        expect(db.uploadSession.update).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });

    it('does not reclassify a verification document session as public media', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, category: 'verification', recordType: 'VerificationRequest', recordId: 'user-1' });
      await expect(chunkUploadService.completeChunkSession(req, baseSession.id, { category: 'post-image' })).rejects.toThrow('original session');
      expect(db.uploadSession.update).not.toHaveBeenCalled();
    });

    it('checks the original binding before returning a completed upload', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, status: 'COMPLETE' });
      await expect(chunkUploadService.completeChunkSession(req, baseSession.id, { recordId: 'other-record' })).rejects.toThrow('original session');
      expect(db.uploadedFile.findFirst).not.toHaveBeenCalled();
    });

    it('throws when not all parts have arrived (incomplete upload)', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, totalChunks: 2, fileSize: 8 });
      fs.mkdirSync(stagingDir(baseSession.id), { recursive: true });
      fs.writeFileSync(partPath(baseSession.id, 0), Buffer.from('AAAA'));
      const spy = jest.spyOn(uploadService, 'uploadFile').mockResolvedValue({ id: 'file-1', url: '/uploads/x.mp4' } as any);
      await expect(chunkUploadService.completeChunkSession(req, baseSession.id)).rejects.toThrow(/incomplete/);
      spy.mockRestore();
    });

    it('assembles the parts, persists through uploadService and marks the session COMPLETE', async () => {
      const payload = Buffer.from('REAL-VIDEO-BYTES');
      fs.mkdirSync(stagingDir(baseSession.id), { recursive: true });
      fs.writeFileSync(partPath(baseSession.id, 0), payload);

      const spy = jest.spyOn(uploadService, 'uploadFile').mockImplementation(async (_r, file: any) => ({
        id: 'file-1',
        url: `/uploads/${file.filename}`,
        type: 'VIDEO',
        filename: file.filename,
        mimeType: 'video/mp4',
        size: payload.length,
        category: 'reel',
      }));
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, fileSize: payload.length });

      const result = await chunkUploadService.completeChunkSession(req, baseSession.id);

      expect(result.url).toContain('/uploads/');
      expect(spy).toHaveBeenCalled();
      expect(db.uploadSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETE' }) })
      );
      // Staging is cleaned up after a successful compose.
      expect(fs.existsSync(stagingDir(baseSession.id))).toBe(false);
      spy.mockRestore();
    });
  });
});