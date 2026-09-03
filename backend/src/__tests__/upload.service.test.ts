import { UploadService, getFileType, buildUploadUrl } from '../services/upload.service';
import { prisma } from '../prisma';
import fs from 'fs';
import path from 'path';

jest.mock('../prisma', () => ({
  prisma: {
    uploadedFile: {
      create: jest.fn().mockResolvedValue({
        id: 'file-id-1',
        filename: 'test.jpg',
        originalName: 'test.jpg',
        url: 'http://localhost:5000/uploads/test.jpg',
        path: '/tmp/test.jpg',
        mimeType: 'image/jpeg',
        fileType: 'IMAGE',
        size: 1024,
        category: 'generic',
      }),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'file-id-1',
        filename: 'test.jpg',
      }),
    },
  },
}));

jest.mock('../services/image-optimizer.service', () => ({
  imageOptimizer: {
    optimize: jest.fn().mockResolvedValue({
      webp: '/uploads/optimized/test.webp',
      original: '/tmp/test.jpg',
    }),
  },
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  copyFileSync: jest.fn(),
  openSync: jest.fn().mockReturnValue(1),
  readSync: jest.fn((_fd, buffer: Buffer) => {
    Buffer.from([0xff, 0xd8, 0xff]).copy(buffer);
    return 3;
  }),
  closeSync: jest.fn(),
}));

const uploadService = new UploadService();

describe('UploadService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getFileType', () => {
    test('should return IMAGE for image mime types', () => {
      expect(getFileType('image/jpeg')).toBe('IMAGE');
      expect(getFileType('image/png')).toBe('IMAGE');
      expect(getFileType('image/webp')).toBe('IMAGE');
    });

    test('should return VIDEO for video mime types', () => {
      expect(getFileType('video/mp4')).toBe('VIDEO');
      expect(getFileType('video/webm')).toBe('VIDEO');
    });

    test('should return AUDIO for audio mime types', () => {
      expect(getFileType('audio/mpeg')).toBe('AUDIO');
      expect(getFileType('audio/wav')).toBe('AUDIO');
    });

    test('should return DOCUMENT for other types', () => {
      expect(getFileType('application/pdf')).toBe('DOCUMENT');
      expect(getFileType('text/plain')).toBe('DOCUMENT');
    });
  });

  describe('buildUploadUrl', () => {
    test('should generate a portable relative upload URL', () => {
      const mockReq = {
        protocol: 'http',
        get: jest.fn().mockImplementation((name: string) => (name === 'host' ? 'localhost:5000' : undefined)),
      };
      const url = buildUploadUrl(mockReq, 'test.jpg');
      // Upload URLs are portable, same-origin paths so the browser always
      // requests media from the API origin currently in use. Baking an absolute
      // host here produces dead URLs on phones / after a LAN IP rotates.
      expect(url).toBe('/uploads/test.jpg');
    });

    test('should default to a same-origin relative URL when no host is available', () => {
      const mockReq = { protocol: 'http', get: jest.fn().mockReturnValue(null) };
      const url = buildUploadUrl(mockReq, 'test.jpg');
      expect(url).toBe('/uploads/test.jpg');
    });
  });

  describe('uploadFile', () => {
    test('should upload file and persist metadata', async () => {
      const mockReq = {
        protocol: 'http',
        get: jest.fn().mockImplementation((name: string) => (name === 'host' ? 'localhost:5000' : undefined)),
        user: { userId: 'user-123' },
      };
      const mockFile = {
        filename: 'test.jpg',
        originalname: 'original.jpg',
        mimetype: 'image/jpeg',
        path: path.resolve(__dirname, '../../public/uploads/test.jpg'),
        size: 1024,
      } as Express.Multer.File;

      const result = await uploadService.uploadFile(mockReq, mockFile, { category: 'avatar' });

      expect(result.url).toBe('/uploads/optimized/test.webp');
      expect(result.type).toBe('IMAGE');
      expect(result.filename).toBe('test.jpg');
      expect(result.category).toBe('avatar');
      expect(prisma.uploadedFile.create).toHaveBeenCalled();
    });
  });

  describe('deleteFile', () => {
    test('should delete file if exists', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {});

      const result = await uploadService.deleteFile('test.jpg', 'file-id-1');
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(prisma.uploadedFile.update).toHaveBeenCalled();
    });

    test('should not throw if file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await uploadService.deleteFile('nonexistent.jpg');
      expect(result).toBe(false);
    });
  });

  describe('deletePreviousForUser', () => {
    test('should delete previous file for user+category', async () => {
      (prisma.uploadedFile.findFirst as jest.Mock).mockResolvedValue({
        id: 'old-file',
        filename: 'old-avatar.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await uploadService.deletePreviousForUser('user-123', 'avatar', 'new-file-id');

      expect(prisma.uploadedFile.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          category: 'avatar',
          deletedAt: null,
          id: { not: 'new-file-id' },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('getUserFiles', () => {
    test('should return user files', async () => {
      const result = await uploadService.getUserFiles('user-123', 'avatar');
      expect(prisma.uploadedFile.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          deletedAt: null,
          category: 'avatar',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([]);
    });
  });

  describe('getFilenameFromUrl', () => {
    test('should extract filename from full URL', () => {
      const filename = uploadService.getFilenameFromUrl('http://localhost:5000/uploads/test-123.jpg');
      expect(filename).toContain('test-123.jpg');
    });

    test('should handle plain filename', () => {
      const filename = uploadService.getFilenameFromUrl('test-123.jpg');
      expect(filename).toBe('test-123.jpg');
    });
  });
});