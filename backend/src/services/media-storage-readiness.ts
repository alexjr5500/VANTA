import fs from 'fs';
import path from 'path';

export interface UploadedMediaSample {
  filename: string;
  size: number;
}

/**
 * A local-only media worker must see real uploads written by the HTTP backend.
 * Checking a directory's existence is insufficient when each Railway service
 * has its own isolated volume. This is a fail-closed startup smoke test, not a
 * substitute for a real end-to-end upload/transcode acceptance test.
 */
export function assertReadableBackendUploads(
  storageRoot: string,
  samples: readonly UploadedMediaSample[],
): void {
  if (!samples.length) {
    throw new Error('Media worker cannot verify shared uploads: no local backend uploads were found');
  }
  const root = fs.realpathSync(path.resolve(storageRoot));
  let readable = false;
  for (const sample of samples) {
    if (!sample || typeof sample.filename !== 'string' ||
        !sample.filename || path.basename(sample.filename) !== sample.filename ||
        sample.filename === '.' || sample.filename === '..' ||
        sample.filename.includes('\\') ||
        !Number.isSafeInteger(sample.size) || sample.size < 1) continue;

    const candidate = path.join(root, sample.filename);
    try {
      const entry = fs.lstatSync(candidate);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== sample.size) continue;
      if (fs.realpathSync(candidate) !== candidate) continue;
      fs.accessSync(candidate, fs.constants.R_OK);
      readable = true;
      break;
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'EACCES' || error?.code === 'EPERM') continue;
      throw error;
    }
  }
  if (!readable) {
    throw new Error(
      'Media worker cannot read any sampled backend upload at its storage root; ' +
      'provision shared storage and verify an end-to-end upload before enabling media jobs',
    );
  }
}
