/**
 * Unit coverage for getStorageDiagnostics() — the /health + startup beacon that
 * surfaces the production Reel playback root cause (uploadedFile rows pointing
 * at files that no longer exist on an EPHEMERAL uploads disk) before browsers
 * start reporting "Unable to load Reel / MEDIA_ELEMENT_ERROR".
 */
import { getStorageDiagnostics } from '../services/upload.service';
import { prisma } from '../prisma';
import fs from 'fs';

jest.mock('../prisma', () => ({
  prisma: { uploadedFile: { findMany: jest.fn().mockResolvedValue([]) } },
}));

// upload.service reads fs.existsSync/mkdirSync during module load (storage dir
// bootstrap) and fs.existsSync/readdirSync/statSync inside getStorageDiagnostics.
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  openSync: jest.fn().mockReturnValue(1),
  readSync: jest.fn((_fd: number, buffer: Buffer) => (buffer.length > 0 ? buffer.length : 0)),
  closeSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  statSync: jest.fn(() => ({ isFile: () => true })),
}));

const existsSyncMock = () => fs.existsSync as jest.Mock;
const readdirSyncMock = () => fs.readdirSync as jest.Mock;
const statSyncMock = () => fs.statSync as jest.Mock;

describe('getStorageDiagnostics', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks storage healthy when every referenced file still exists on disk', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([
      { filename: '1788000000001-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4' },
      { filename: '1788000000002-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4' },
    ]);
    existsSyncMock().mockReturnValue(true);
    readdirSyncMock().mockReturnValue(['1788000000001-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4', 'ignored.txt']);
    statSyncMock().mockImplementation((name: string) => ({ isFile: () => !String(name).endsWith('optimized') }));

    const diag = await getStorageDiagnostics();

    expect(diag.mode).toBe('local');
    expect(diag.cloudinaryConfigured).toBe(false);
    expect(diag.dbReferencedUploads).toBe(2);
    expect(diag.presentOnDisk).toBe(2);
    expect(diag.missingOnDisk).toBe(0);
    expect(diag.healthy).toBe(true);
    expect(diag.filesOnDisk).toBe(2);
  });

  test('flags the production signature: DB rows survive but the files are gone (ephemeral disk wipe)', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([
      { filename: '1788831833464-9a1b2a6bd0cf60925e9934a66df2f5ea.mp4' },
      { filename: '1788832080910-35940a5ab64ec43b076d298765f9f598.jpg' },
    ]);
    existsSyncMock().mockReturnValue(false); // the on-disk bytes were wiped on redeploy
    readdirSyncMock().mockReturnValue([]);
    statSyncMock().mockImplementation((name: string) => ({ isFile: () => !String(name).endsWith('optimized') }));

    const diag = await getStorageDiagnostics();

    expect(diag.dbReferencedUploads).toBe(2);
    expect(diag.presentOnDisk).toBe(0);
    expect(diag.missingOnDisk).toBe(2);
    expect(diag.filesOnDisk).toBe(0);
    expect(diag.healthy).toBe(false);
  });

  test('warns when the storage directory is not explicitly configured', async () => {
    (prisma.uploadedFile.findMany as jest.Mock).mockResolvedValue([]);
    existsSyncMock().mockReturnValue(true);
    readdirSyncMock().mockReturnValue([]);

    const diag = await getStorageDiagnostics();

    expect(diag.storageDirEnvConfigured).toBe(false);
    // The default directory must still be reported so ops can see where uploads land.
    expect(diag.uploadStorageDir).toMatch(/uploads/);
  });

  test('does not crash when the database is unavailable (returns partial diagnostics)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      (prisma.uploadedFile.findMany as jest.Mock).mockRejectedValue(new Error('db down'));
      existsSyncMock().mockReturnValue(true);
      readdirSyncMock().mockReturnValue([]);

      const diag = await getStorageDiagnostics();

      expect(diag.dbReferencedUploads).toBe(0);
      expect(diag.presentOnDisk).toBe(0);
      expect(diag.missingOnDisk).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});