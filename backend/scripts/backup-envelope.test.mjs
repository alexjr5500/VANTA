import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptBackup, decryptBackup, MAX_BACKUP_BYTES, sha256 } from './backup-envelope.mjs';
const path = 'acceptance/pr-282/00000000-0000-4000-8000-000000000000/db.dump.enc';
const key = randomBytes(32);
const source = Buffer.from('synthetic database backup');
test('round trip and random nonce', () => {
  const a = encryptBackup(source, key, path), b = encryptBackup(source, key, path);
  assert.deepEqual(decryptBackup(a, key, path), source);
  assert.notEqual(sha256(a), sha256(b));
  assert.equal(a.length, source.length + 36);
});
test('rejects wrong keys, swapped objects, tampering and truncation', () => {
  const a = encryptBackup(source, key, path);
  const corrupt = Buffer.from(a); corrupt[20] ^= 1;
  for (const [bytes, k, name] of [[a, randomBytes(32), path], [a, key, path.replace('db.dump', 'media.tar')], [corrupt, key, path], [a.subarray(0, -1), key, path]]) {
    assert.throws(() => decryptBackup(bytes, k, name));
  }
});
test('rejects non-acceptance paths, invalid keys and unbounded inputs', () => {
  assert.throws(() => encryptBackup(source, key, 'production/db.dump.enc'));
  assert.throws(() => encryptBackup(source, Buffer.alloc(31), path));
  assert.throws(() => encryptBackup(Buffer.alloc(0), key, path));
  assert.throws(() => encryptBackup(Buffer.alloc(MAX_BACKUP_BYTES + 1), key, path));
  assert.throws(() => decryptBackup(Buffer.alloc(MAX_BACKUP_BYTES + 37), key, path));
});
