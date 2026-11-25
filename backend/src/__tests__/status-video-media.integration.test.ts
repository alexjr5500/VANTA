/** Real media integration: synthetic clips only, no remote storage or database. */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { prisma } from '../prisma';
import { UploadService, probeVideoDuration, uploadStorageDir } from '../services/upload.service';

jest.mock('../prisma', () => ({
  prisma: { uploadedFile: { create: jest.fn(async ({data}) => ({id: 'synthetic-status-id', ...data})) } },
}));
jest.mock('../services/private-media.service', () => ({createPrivateMediaUrl: jest.fn()}));
jest.mock('../services/image-optimizer.service', () => ({imageOptimizer: {optimize: jest.fn()}}));

const integration = process.env.RUN_STATUS_MEDIA_INTEGRATION === '1' ? describe : describe.skip;

integration('Status upload with actual media binaries', () => {
  const service = new UploadService();
  const paths: string[] = [];
  const req = {user: {userId: 'synthetic-user'}, protocol: 'http', get: () => 'localhost'};
  function generate(extension: string, extra: string[], seconds = 2): Express.Multer.File {
    const filename = 'ci-status-' + randomUUID() + '.' + extension;
    const output = path.join(uploadStorageDir, filename);
    paths.push(output);
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=2',
      '-t', String(seconds), ...extra, output,
    ], {timeout: 20000});
    return {filename, originalname: filename, path: output, mimetype: 'video/' + extension, size: fs.statSync(output).size} as Express.Multer.File;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    if (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_SECRET) {
      throw Error('Run only in isolated CI without cloud storage credentials');
    }
  });
  afterEach(() => { for (const file of paths.splice(0)) fs.rmSync(file, {force: true}); });
  test('uploads an original MP4 and verifies persisted media again at publish', async () => {
    const file = generate('mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    expect(await probeVideoDuration(file.path)).toBeCloseTo(2, 1);
    const uploaded = await service.uploadFile(req, file, {category: 'story'});
    expect(uploaded.size).toBe(file.size);
    await expect(service.assertStatusMediaDuration({fileType:'VIDEO',path:null,filename:file.filename})).resolves.toBeUndefined();
  }, 30000);
  test('remuxes a streaming WebM with no duration and verifies the resulting local file', async () => {
    const file = generate('webm', ['-c:v', 'libvpx', '-f', 'webm', '-live', '1']);
    expect(await probeVideoDuration(file.path)).toBeUndefined();
    const uploaded = await service.uploadFile(req, file, {category: 'story'});
    expect(uploaded.size).toBe(fs.statSync(file.path).size);
    expect(await probeVideoDuration(file.path)).toBeCloseTo(2, 1);
    await expect(service.assertStatusMediaDuration({fileType:'VIDEO',path:null,filename:file.filename})).resolves.toBeUndefined();
  }, 30000);
  test('rejects and removes over-limit video without creating a record', async () => {
    const file = generate('mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], 121);
    await expect(service.uploadFile(req, file, {category: 'story'})).rejects.toThrow('2 minutes');
    expect(fs.existsSync(file.path)).toBe(false);
    expect(prisma.uploadedFile.create).not.toHaveBeenCalled();
  }, 30000);
});
