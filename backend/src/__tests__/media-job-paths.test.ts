import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveLocalMediaInput, safeMediaOutputName } from '../services/media-job-paths';

describe('durable media job path safety', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-media-'));
    fs.writeFileSync(path.join(root, 'source.jpg'), 'test');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('accepts an existing regular file inside storage', () => {
    expect(resolveLocalMediaInput(root, 'source.jpg')).toBe(path.join(root, 'source.jpg'));
  });

  it('rejects traversal and absolute paths outside storage', () => {
    expect(() => resolveLocalMediaInput(root, '../outside.jpg')).toThrow();
    expect(() => resolveLocalMediaInput(root, '/etc/passwd')).toThrow();
  });

  it('rejects remote URLs and nonexistent files', () => {
    expect(() => resolveLocalMediaInput(root, 'https://example.com/image.jpg')).toThrow();
    expect(() => resolveLocalMediaInput(root, 'missing.jpg')).toThrow();
  });

  it('rejects symlinks escaping the storage root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.jpg'), 'private');
      fs.symlinkSync(path.join(outside, 'secret.jpg'), path.join(root, 'linked.jpg'));
      expect(() => resolveLocalMediaInput(root, 'linked.jpg')).toThrow('symlink');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects directories and unsafe output names', () => {
    expect(() => resolveLocalMediaInput(root, '.')).toThrow('regular file');
    expect(safeMediaOutputName('reel-123.mp4')).toBe('reel-123.mp4');
    for (const name of ['../escape', 'bad/name', '..', 'a..b', '']) {
      expect(() => safeMediaOutputName(name)).toThrow();
    }
  });
});
