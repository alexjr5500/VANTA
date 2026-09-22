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
      expect(state.receivedIndexes.sort()).toEqual([0, 2]);
    });
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

  describe('completeChunkSession', () => {
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