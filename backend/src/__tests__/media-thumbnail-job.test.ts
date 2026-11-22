import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateLocalThumbnail } from '../services/media-thumbnail-job';

describe('local media thumbnail processing', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-thumb-'));
    fs.writeFileSync(path.join(root, 'image.jpg'), 'fixture');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const fakeEncoder = () => {
    const chain: any = {};
    chain.rotate = jest.fn(() => chain);
    chain.resize = jest.fn(() => chain);
    chain.webp = jest.fn(() => chain);
    chain.toFile = jest.fn(async (filename: string) => {
      fs.writeFileSync(filename, 'encoded-webp');
    });
    return jest.fn(() => chain);
  };

  it('writes an output atomically and skips a completed retry', async () => {
    const sharp = fakeEncoder();
    const job = { inputPath: 'image.jpg', outputName: 'image' };
    await expect(generateLocalThumbnail(root, job, sharp)).resolves.toBe('/uploads/thumbnails/image_thumb.webp');
    expect(fs.readFileSync(path.join(root, 'thumbnails', 'image_thumb.webp'), 'utf8')).toBe('encoded-webp');
    await generateLocalThumbnail(root, job, sharp);
    expect(sharp).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(root, 'thumbnails'))).toEqual(['image_thumb.webp']);
  });

  it('rejects traversal and never invokes the encoder', async () => {
    const sharp = fakeEncoder();
    await expect(generateLocalThumbnail(root, { inputPath: '../secret.jpg', outputName: 'x' }, sharp))
      .rejects.toThrow();
    await expect(generateLocalThumbnail(root, { inputPath: 'image.jpg', outputName: '../escape' }, sharp))
      .rejects.toThrow();
    expect(sharp).not.toHaveBeenCalled();
  });

  it('validates missing and unsafe input before loading the optional Sharp dependency', async () => {
    await expect(generateLocalThumbnail(root, {
      inputPath: '../outside.jpg', outputName: 'unsafe',
    })).rejects.toThrow();
    await expect(generateLocalThumbnail(root, {
      inputPath: 'missing.jpg', outputName: 'missing',
    })).rejects.toThrow();
  });

  it('cleans temporary output after an encoder error', async () => {
    const chain: any = {};
    chain.rotate = () => chain;
    chain.resize = () => chain;
    chain.webp = () => chain;
    chain.toFile = async () => { throw new Error('encoder failed'); };
    await expect(generateLocalThumbnail(root, { inputPath: 'image.jpg', outputName: 'broken' }, (() => chain) as any))
      .rejects.toThrow('encoder failed');
    expect(fs.readdirSync(path.join(root, 'thumbnails'))).toEqual([]);
  });
});
