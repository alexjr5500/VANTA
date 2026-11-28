import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditMediaStorage, StorageAuditRow } from '../services/media-storage-audit';

describe('isolated media storage audit', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-storage-audit-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const row = (id: string, filename: string, size = 4, storagePath: string | null = null): StorageAuditRow =>
    ({ id, filename, size, path: storagePath });
  const source = (rows: StorageAuditRow[]) => jest.fn(async (after: string | null, limit: number) =>
    rows.filter(r => after === null || r.id > after).slice(0, limit));

  it('detects missing, truncated, unsafe and remote-unverified originals without exposing filenames', async () => {
    fs.writeFileSync(path.join(root, 'good.jpg'), 'data');
    fs.writeFileSync(path.join(root, 'short.jpg'), 'a');
    fs.symlinkSync(path.join(root, 'good.jpg'), path.join(root, 'link.jpg'));
    fs.mkdirSync(path.join(root, 'directory.jpg'));
    const fetch = source([
      row('1', 'good.jpg'), row('2', 'missing.jpg'), row('3', 'short.jpg'),
      row('4', 'link.jpg'), row('5', '../outside.jpg'), row('6', 'directory.jpg'),
      row('7', 'remote.jpg', 4, 'cloudinary:image:vanta/example'),
      row('8', 'bad-remote.jpg', 4, 'cloudinary:unknown:asset'),
    ]);
    const report = await auditMediaStorage(root, fetch, 20, 2);
    expect(report).toEqual({
      scanned: 8, localVerified: 1, remoteUnverified: 1, missing: 1,
      sizeMismatch: 1, unsafe: 4, unreadable: 0, complete: true, status: 'failed',
    });
    expect(JSON.stringify(report)).not.toMatch(/good\.jpg|outside\.jpg|vanta\/example/);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([null, '2', '4', '6', '8']);
    expect(fs.readFileSync(path.join(root, 'good.jpg'), 'utf8')).toBe('data');
  });

  it('distinguishes complete scans from bounded scans and does not call empty or remote-only data healthy', async () => {
    fs.writeFileSync(path.join(root, 'ok.jpg'), 'data');
    const rows = [row('1', 'ok.jpg'), row('2', 'ok.jpg')];
    await expect(auditMediaStorage(root, source(rows), 1, 1)).resolves.toMatchObject({
      scanned: 1, complete: false, status: 'incomplete',
    });
    await expect(auditMediaStorage(root, source(rows), 2, 1)).resolves.toMatchObject({
      scanned: 2, complete: true, status: 'ok',
    });
    await expect(auditMediaStorage(root, source([]))).resolves.toMatchObject({ status: 'incomplete' });
    await expect(auditMediaStorage(root, source([row('1', 'r.jpg', 4, 'cloudinary:image:vanta/r')])))
      .resolves.toMatchObject({ complete: true, remoteUnverified: 1, status: 'incomplete' });
  });

  it('fails closed on invalid bounds, root or stalled cursor', async () => {
    const fetch = source([]);
    await expect(auditMediaStorage('relative', fetch)).rejects.toThrow();
    await expect(auditMediaStorage(root, fetch, 0)).rejects.toThrow();
    const stalled = async () => [row('1', 'missing.jpg')];
    await expect(auditMediaStorage(root, stalled, 5, 1)).rejects.toThrow('cursor');
    expect(fetch).not.toHaveBeenCalled();
  });
});
