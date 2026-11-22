import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertReadableBackendUploads } from '../services/media-storage-readiness';

describe('local media worker upload-readiness check', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-media-ready-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts a backend upload with a matching filename and nonzero byte length', () => {
    fs.writeFileSync(path.join(root, 'known.mp4'), 'sample-video');
    expect(() => assertReadableBackendUploads(root, [
      { filename: 'lost.mp4', size: 5 },
      { filename: 'known.mp4', size: 12 },
    ])).not.toThrow();
  });

  it('fails when the worker volume is empty despite valid backend metadata', () => {
    expect(() => assertReadableBackendUploads(root, [
      { filename: 'backend-upload.mp4', size: 1200 },
    ])).toThrow('cannot read any sampled backend upload');
  });

  it('does not treat empty metadata as proof of shared storage', () => {
    expect(() => assertReadableBackendUploads(root, [])).toThrow('no local backend uploads');
  });

  it('rejects mismatched file sizes and empty files', () => {
    fs.writeFileSync(path.join(root, 'known.jpg'), 'bytes');
    fs.writeFileSync(path.join(root, 'empty.jpg'), '');
    expect(() => assertReadableBackendUploads(root, [
      { filename: 'known.jpg', size: 999 },
      { filename: 'empty.jpg', size: 0 },
    ])).toThrow('cannot read any sampled backend upload');
  });

  it('does not accept path traversal or symlinked files as shared uploads', () => {
    fs.writeFileSync(path.join(root, 'real.jpg'), 'image');
    fs.symlinkSync(path.join(root, 'real.jpg'), path.join(root, 'link.jpg'));
    expect(() => assertReadableBackendUploads(root, [
      { filename: '../real.jpg', size: 5 },
      { filename: 'link.jpg', size: 5 },
      { filename: 'folder\\real.jpg', size: 5 },
    ])).toThrow('cannot read any sampled backend upload');
  });
});
