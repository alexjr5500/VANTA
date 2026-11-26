import { randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, rename, unlink, readdir, rmdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const check = (value, message) => { if (!value) throw Error(message); };
const safe = n => Number.isSafeInteger(n) && n >= 0;
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
async function syncDir(path) { const fd = await open(path, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function privateDir(path) {
  const s = await lstat(path);
  check(s.isDirectory() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid(), 'Private control directory required');
}
async function readRecord(path) {
  const s = await lstat(path);
  check(s.isFile() && s.size > 0 && s.size <= 32768 && (s.mode & 0o077) === 0, 'Invalid backup journal record');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function createRecord(path, data) {
  const fd = await open(path, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(data) + '\n'); await fd.sync(); } finally { await fd.close(); }
}
async function replaceRecord(dir, name, data) {
  const temp = join(dir, '.journal-' + randomUUID());
  await createRecord(temp, data);
  await rename(temp, join(dir, name));
  await syncDir(dir);
}

/** Persistent single-writer ownership on the SAME durable, private local
 * filesystem. No lease expiry or automatic crash takeover; an operator must
 * reconcile a stale lock and unfinished attempt. Not a multi-volume lock. */
export async function openBackupJournal(controlDir) {
  await privateDir(controlDir);
  const lockDir = join(controlDir, 'writer.lock'), lockFile = join(lockDir, 'owner.json');
  const current = join(controlDir, 'current.json');
  let token, activeRun;
  async function healthy() {
    if (!token) return false;
    try { return (await readRecord(lockFile)).token === token; } catch { return false; }
  }
  async function requireOwner() { check(await healthy(), 'Backup writer ownership lost'); }
  async function readCurrent() {
    try {
      const value = await readRecord(current);
      check(uuid(value.runId) && ['acceptance','production'].includes(value.scope) &&
        ['pending','failed','transfer_verified'].includes(value.state), 'Unknown backup journal state');
      return value;
    } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
  }
  return {
    async acquireExclusiveWriter() {
      check(!token, 'Writer already acquired by this handle');
      try { await mkdir(lockDir, { mode: 0o700 }); }
      catch (e) { if (e?.code === 'EEXIST') return null; throw e; }
      // A failed write deliberately leaves the lock for reviewed reconciliation.
      const owner = randomUUID();
      await createRecord(lockFile, { token: owner, acquiredAtMs: Date.now() });
      await syncDir(lockDir); await syncDir(controlDir); token = owner;
      return { healthy, release: async () => {
        await requireOwner(); await unlink(lockFile); await rmdir(lockDir); await syncDir(controlDir); token = undefined; activeRun = undefined;
      }};
    },
    async unresolvedAttempt() {
      await requireOwner();
      const record = await readCurrent();
      // Unexpected leftover temp journal also fails closed.
      const files = await readdir(controlDir);
      return files.some(f => f.startsWith('.journal-')) || (record !== null && record.state !== 'transfer_verified');
    },
    async beginAttempt({ scope, runId }) {
      await requireOwner(); check(uuid(runId) && ['acceptance','production'].includes(scope), 'Invalid backup attempt');
      check(!await this.unresolvedAttempt(), 'Prior attempt requires reconciliation');
      const previous = await readCurrent();
      if (previous) {
        // Immutable history keeps the prior verified-transfer evidence.
        await createRecord(join(controlDir, previous.runId + '.json'), previous);
        await syncDir(controlDir);
      }
      await replaceRecord(controlDir, 'current.json', { scope, runId, state: 'pending', startedAtMs: Date.now() });
      activeRun = runId;
    },
    async recordFailure({ scope, runId, phase }) {
      await requireOwner(); check(activeRun === runId, 'Wrong active attempt');
      const previous = await readCurrent();
      check(previous?.runId === runId && previous.scope === scope && previous.state === 'pending', 'Invalid failure transition');
      check(typeof phase === 'string' && /^[a-z_]{1,32}$/.test(phase), 'Invalid backup failure phase');
      await replaceRecord(controlDir, 'current.json', { ...previous, state: 'failed', phase, failedAtMs: Date.now() });
    },
    async recordVerifiedTransfer({ scope, runId, capturedAtMs, marker, manifest }) {
      await requireOwner(); check(activeRun === runId, 'Wrong active attempt');
      const previous = await readCurrent();
      check(previous?.runId === runId && previous.scope === scope && previous.state === 'pending' &&
        safe(capturedAtMs) && marker?.verified === true && manifest?.runId === runId, 'Invalid transfer transition');
      await replaceRecord(controlDir, 'current.json', { ...previous, state: 'transfer_verified', capturedAtMs,
        verifiedAtMs: Date.now(), marker, manifest, independentRestoreVerified: false });
    },
    readCurrent,
  };
}

/** Count every object in the bucket. Any unfinished upload blocks a new run;
 * do not guess its bytes or assume a failed multipart upload was removed.
 * Bound pagination and refuse incomplete or nonprogressing inventory. */
export async function measureR2Inventory({ client, sdk, bucket, maxPages = 100 }) {
  check(bucket === 'vanta-backups' && Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 1000, 'Invalid inventory scope');
  const send = cmd => client.send(cmd, { abortSignal: AbortSignal.timeout(30000) });
  let token, storedBytes = 0, objectCount = 0, complete = false;
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    const r = await send(new sdk.ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken: token }));
    for (const entry of r.Contents ?? []) {
      check(typeof entry.Key === 'string' && safe(entry.Size) && !seen.has(entry.Key), 'Invalid inventory object');
      seen.add(entry.Key);
      storedBytes += entry.Size; objectCount++;
      check(safe(storedBytes), 'Inventory byte overflow');
    }
    if (r.IsTruncated === false || r.IsTruncated === undefined) { complete = true; break; }
    check(typeof r.NextContinuationToken === 'string' && r.NextContinuationToken && r.NextContinuationToken !== token, 'Inventory pagination failed');
    token = r.NextContinuationToken;
  }
  check(complete, 'Bucket inventory limit reached');
  const uploads = await send(new sdk.ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1 }));
  check(!uploads.IsTruncated && !(uploads.Uploads ?? []).length, 'Incomplete uploads require reconciliation');
  return { storedBytes, incompleteUploadBytes: 0, inventoryComplete: true, inventoryAtMs: Date.now(), objectCount };
}

export async function measureScratchFreeBytes(path) {
  await privateDir(path);
  const s = await statfs(path, { bigint: true });
  const bytes = s.bavail * s.bsize;
  check(bytes >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER), 'Invalid scratch capacity');
  return Number(bytes);
}
