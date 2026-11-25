import fs from 'fs';
import path from 'path';
import { resolveLocalMediaInput } from './media-job-paths';

/**
 * Delete only expired files under the dedicated temporary-media directory.
 * Permanent uploads and other paths are never eligible for cleanup.
 */
export function cleanupExpiredMediaTemp(
  storageRoot: string,
  relativePath: string,
  olderThanMs = 60 * 60 * 1000,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(olderThanMs) || olderThanMs < 60_000) {
    throw new Error('Temporary media retention must be at least one minute');
  }
  const root = fs.realpathSync(path.resolve(storageRoot));
  const temporaryRoot = path.join(root, '.media-temp');
  if (!fs.existsSync(temporaryRoot)) return false;
  if (fs.realpathSync(temporaryRoot) !== temporaryRoot) throw new Error('Unsafe temporary media directory');
  const candidatePath = path.resolve(temporaryRoot, relativePath);
  const rel = path.relative(temporaryRoot, candidatePath);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('Temporary media path escapes storage');
  }
  if (!fs.existsSync(candidatePath)) return false;
  const candidate = resolveLocalMediaInput(temporaryRoot, relativePath);
  // Never unlink a different file reached through a symlink alias, even
  // when both names are inside the temporary directory.
  if (candidate !== candidatePath) throw new Error('Unsafe temporary media symlink');
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile()) throw new Error('Temporary media target must be a regular file');
  if (now - stat.mtimeMs < olderThanMs) return false;
  fs.unlinkSync(candidate);
  return true;
}
