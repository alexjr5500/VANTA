import fs from 'fs';
import path from 'path';
import express from 'express';

jest.mock('../prisma', () => ({
  prisma: {
    uploadSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    uploadedFile: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '../prisma';
import { chunkUploadService, uploadChunk, UPLOAD_CHUNK_SIZE } from '../services/chunk-upload.service';
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
  (db.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
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
    it('rejects verification documents before creating a session', async () => {
      await expect(chunkUploadService.initChunkSession('user-1', {
        fileName: 'synthetic.pdf', fileSize: 100, mimeType: 'application/pdf', category: 'verification',
      })).rejects.toThrow('Secure verification document storage');
      expect(db.uploadSession.create).not.toHaveBeenCalled();
    });

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

  it('accepts a full-size multipart part and denies a non-owner before writing', async () => {
    (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({
      ...baseSession, fileSize: UPLOAD_CHUNK_SIZE, totalChunks: 1,
    });
    const app = express();
    app.post('/part', (request, _response, next) => {
      (request as any).user = { userId: request.header('x-fixture-user') };
      next();
    }, uploadChunk.single('chunk'), async (request, response) => {
      try {
        response.json(await chunkUploadService.acceptChunkPart(
          (request as any).user.userId, request.body.sessionId, request.body.index, request.file,
        ));
      } catch { response.status(400).end(); }
    });
    app.use((_error: any, _request: any, response: any, _next: any) => response.status(400).end());
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      const send = (user: string, value: number) => {
        const data = new FormData();
        data.append('sessionId', baseSession.id);
        data.append('index', '0');
        data.append('chunk', new Blob([new Uint8Array(UPLOAD_CHUNK_SIZE).fill(value)]), 'part');
        return fetch(`http://127.0.0.1:${address.port}/part`, {
          method: 'POST', headers: { 'x-fixture-user': user }, body: data,
        });
      };
      const valid = await send('user-1', 7);
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ receivedChunks: 1 });
      const accepted = partPath(baseSession.id, 0);
      expect(fs.statSync(accepted).size).toBe(UPLOAD_CHUNK_SIZE);
      const denied = await send('user-2', 9);
      expect(denied.status).toBe(400);
      await denied.arrayBuffer();
      expect(fs.readFileSync(accepted)).toEqual(Buffer.alloc(UPLOAD_CHUNK_SIZE, 7));
      expect(fs.readdirSync(stagingDir(baseSession.id))).toEqual(['000000.part']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 20000);

  describe('acceptChunkPart', () => {
    it('publishes a complete part and does not overwrite it with a short retry', async () => {
      fs.mkdirSync(stagingDir(baseSession.id), { recursive: true });
      const staged = path.join(stagingDir(baseSession.id), '000000.0123456789abcdef01234567.pending');
      const payload = Buffer.alloc(baseSession.fileSize, 7);
      fs.writeFileSync(staged, payload);
      await expect(chunkUploadService.acceptChunkPart('user-1', baseSession.id, '0', {
        path: staged, size: payload.length,
      } as any)).resolves.toMatchObject({ receivedChunks: 1, complete: true });
      expect(fs.readFileSync(partPath(baseSession.id, 0))).toEqual(payload);
      fs.writeFileSync(staged, Buffer.alloc(5, 9));
      await expect(chunkUploadService.acceptChunkPart('user-1', baseSession.id, '0', {
        path: staged, size: 5,
      } as any)).rejects.toThrow('expected size');
      expect(fs.existsSync(staged)).toBe(false);
      expect(fs.readFileSync(partPath(baseSession.id, 0))).toEqual(payload);
    });

    it('rejects a non-owner without changing the accepted part', async () => {
      fs.mkdirSync(stagingDir(baseSession.id), { recursive: true });
      const accepted = partPath(baseSession.id, 0);
      fs.writeFileSync(accepted, Buffer.alloc(baseSession.fileSize, 7));
      await expect(chunkUploadService.acceptChunkPart('user-2', baseSession.id, '0', {
        path: accepted, size: baseSession.fileSize,
      } as any)).rejects.toThrow('Upload session not found');
      expect(fs.existsSync(accepted)).toBe(true);
      expect(db.uploadSession.update).not.toHaveBeenCalled();
    });

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
    it('returns only the exact completed file, never the newest matching record', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, status: 'COMPLETE', completedFileId: 'file-original' });
      (db.uploadedFile.findFirst as jest.Mock).mockResolvedValue({ id: 'file-original', category: 'reel', url: '/uploads/original.mp4' });
      await expect(chunkUploadService.completeChunkSession(req, baseSession.id)).resolves.toMatchObject({ id: 'file-original' });
      expect(db.uploadedFile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'file-original', userId: 'user-1' }) }));
    });

    it('fails closed for legacy completed sessions without a verified file binding', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, status: 'COMPLETE' });
      await expect(chunkUploadService.completeChunkSession(req, baseSession.id)).rejects.toThrow('no verified file binding');
      expect(db.uploadedFile.findFirst).not.toHaveBeenCalled();
    });

    it('does not invoke the provider if the atomic completion claim loses', async () => {
      fs.mkdirSync(stagingDir(baseSession.id), { recursive: true });
      fs.writeFileSync(partPath(baseSession.id, 0), Buffer.alloc(baseSession.fileSize));
      (db.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const spy = jest.spyOn(uploadService, 'uploadFile');
      try {
        await expect(chunkUploadService.completeChunkSession(req, baseSession.id)).rejects.toThrow('already in progress');
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });

    it('does not downgrade a finalizing session on late abort or failure', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, status: 'FINALIZING' });
      (db.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(chunkUploadService.cancelChunkSession('user-1', baseSession.id)).resolves.toEqual({ cancelled: false });
      await expect(chunkUploadService.failChunkSession('user-1', baseSession.id)).resolves.toEqual({ failed: false });
    });

    it('rejects an existing verification session before returning a completed file', async () => {
      (db.uploadSession.findUnique as jest.Mock).mockResolvedValue({ ...baseSession, category: 'verification', status: 'COMPLETE' });
      await expect(chunkUploadService.completeChunkSession(req, baseSession.id)).rejects.toThrow('Secure verification document storage');
      expect(db.uploadedFile.findFirst).not.toHaveBeenCalled();
    });

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
      expect(db.uploadSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }), data: { status: 'FINALIZING' } })
      );
      expect(spy).toHaveBeenCalledWith(req, expect.anything(), expect.objectContaining({ chunkSessionId: baseSession.id }));
      fs.rmSync(path.join(uploadStorageDir, result.filename), { force: true });
      // Staging is cleaned up after a successful compose.
      expect(fs.existsSync(stagingDir(baseSession.id))).toBe(false);
      spy.mockRestore();
    });
  });
});