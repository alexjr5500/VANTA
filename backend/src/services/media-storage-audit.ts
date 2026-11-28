import fs from 'fs';
import path from 'path';

export interface StorageAuditRow {
  id: string;
  filename: string;
  path: string | null;
  size: number;
}

export interface StorageAuditResult {
  scanned: number;
  localVerified: number;
  remoteUnverified: number;
  missing: number;
  sizeMismatch: number;
  unsafe: number;
  unreadable: number;
  complete: boolean;
  status: 'ok' | 'incomplete' | 'failed';
}

type FetchPage = (after: string | null, limit: number) => Promise<readonly StorageAuditRow[]>;

/**
 * Offline/isolated storage reconciliation. No repairs, provider calls, or
 * identifying data in the report. A successful size check is not a checksum.
 * Use a quiescent restored database and its matching volume for meaningful results.
 */
export async function auditMediaStorage(
  storageRoot: string,
  fetchPage: FetchPage,
  maxRows = 10000,
  pageSize = 100,
): Promise<StorageAuditResult> {
  if (!path.isAbsolute(storageRoot) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error('Invalid storage audit bounds or root');
  }
  const root = path.resolve(storageRoot);
  if (fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory()) {
    throw new Error('Audit requires an existing non-symlink storage directory');
  }
  const result: StorageAuditResult = {
    scanned: 0, localVerified: 0, remoteUnverified: 0, missing: 0,
    sizeMismatch: 0, unsafe: 0, unreadable: 0, complete: false, status: 'incomplete',
  };
  let after: string | null = null;
  while (true) {
    // One extra row (at the overall limit) distinguishes exact completion from truncation.
    const limit = Math.min(pageSize, maxRows - result.scanned + 1);
    const rows = await fetchPage(after, limit);
    if (rows.length > limit) throw new Error('Storage audit page exceeded requested bounds');
    for (const row of rows) {
      if (!row.id || row.id === after) throw new Error('Storage audit cursor did not advance');
      if (result.scanned === maxRows) break;
      after = row.id;
      result.scanned++;
      if (row.path?.startsWith('cloudinary:')) {
        if (/^cloudinary:(image|video|raw):[^\s]+$/.test(row.path)) result.remoteUnverified++;
        else result.unsafe++;
        continue;
      }
      const name = row.filename;
      if (!name || name === '.' || name === '..' || path.basename(name) !== name ||
          /[\\\x00-\x1f\x7f]/.test(name) || !Number.isSafeInteger(row.size) || row.size < 1) {
        result.unsafe++;
        continue;
      }
      const candidate = path.join(root, name);
      try {
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(candidate) !== candidate) {
          result.unsafe++;
        } else if (stat.size !== row.size) {
          result.sizeMismatch++;
        } else {
          fs.accessSync(candidate, fs.constants.R_OK);
          result.localVerified++;
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') result.missing++;
        else result.unreadable++;
      }
    }
    if (rows.length < limit) {
      result.complete = true;
      break;
    }
    if (result.scanned === maxRows) {
      // If the last page was full, probe only one row to establish completion.
      const remaining = await fetchPage(after, 1);
      if (remaining.length > 1 || (remaining.length && remaining[0].id === after)) {
        throw new Error('Invalid storage audit continuation');
      }
      result.complete = remaining.length === 0;
      break;
    }
  }
  result.status = result.missing || result.sizeMismatch || result.unsafe || result.unreadable
    ? 'failed'
    : !result.complete || result.remoteUnverified || !result.scanned ? 'incomplete' : 'ok';
  return result;
}
