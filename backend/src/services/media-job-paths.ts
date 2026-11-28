import fs from 'fs';
import path from 'path';

/**
 * Resolve an existing local upload for a background media job.
 * Never allow a queued payload to read outside the configured storage root.
 * Cloudinary references and remote URLs are not local filesystem paths.
 */
export function resolveLocalMediaInput(storageRoot: string, requestedPath: string): string {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw new Error('Media input path is required');
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\\\\)/i.test(requestedPath)) {
    throw new Error('Remote media paths are not supported by local workers');
  }
  const root = fs.realpathSync(path.resolve(storageRoot));
  const candidate = path.resolve(root, requestedPath);
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Media path escapes upload storage');
  }
  const realCandidate = fs.realpathSync(candidate);
  const realRelative = path.relative(root, realCandidate);
  if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) {
    throw new Error('Media symlink escapes upload storage');
  }
  if (!fs.statSync(realCandidate).isFile()) {
    throw new Error('Media input is not a regular file');
  }
  return realCandidate;
}

/** Reject unsafe names before deriving output paths from queued payloads. */
export function safeMediaOutputName(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ||
      value === '.' || value === '..' || value.includes('..')) {
    throw new Error('Invalid media output name');
  }
  return value;
}
