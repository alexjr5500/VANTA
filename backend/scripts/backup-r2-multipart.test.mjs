import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { uploadEncryptedArtifact, verifiedBackupSet, publishEncryptedBackupSet, parseBackupManifest, PART_BYTES } from './backup-r2-multipart.mjs';

const names = ['CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'GetObject', 'AbortMultipartUpload'];
const sdk = Object.fromEntries(names.map(name => [name + 'Command', class { constructor(input) { this.name = name; this.input = input; } }]));
async function fixture(t, failure) {
  const dir = await mkdtemp(join(tmpdir(), 'r2-unit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'fixture.age'), bytes = Buffer.alloc(PART_BYTES + 1024, 11);
  bytes.write('age-encryption.org/v1\n'); await writeFile(file, bytes, { mode: 0o600 });
  const runId = randomUUID(), calls = [], parts = []; let metadata;
  const client = { async send(command) {
    const { name, input } = command; calls.push(name);
    if (name === failure) throw Error('simulated provider failure');
    if (name === 'CreateMultipartUpload') { metadata = input.Metadata; return { UploadId: 'owned-upload' }; }
    if (name === 'UploadPart') { assert.equal(input.UploadId, 'owned-upload'); assert.ok(input.Body.length <= PART_BYTES); parts.push(input.Body); return { ETag: 'part-' + input.PartNumber }; }
    if (name === 'CompleteMultipartUpload') { assert.equal(input.IfNoneMatch, '*'); assert.equal(input.MultipartUpload.Parts.length, 2); return {}; }
    if (name === 'GetObject') {
      const body = Buffer.concat(parts);
      if (failure === 'corrupt') body[30] ^= 1;
      return { ContentLength: body.length, Metadata: metadata, Body: Readable.from([body]) };
    }
    if (name === 'AbortMultipartUpload') { assert.equal(input.UploadId, 'owned-upload'); return {}; }
    throw Error('unexpected command');
  }};
  return { args: { client, sdk, bucket: 'vanta-backups', runId, kind: 'database.dump.age', file, maxBytes: bytes.length }, calls, bytes, dir };
}
test('bounded parts, conditional completion and full checksum verification', async t => {
  const { args, calls, bytes } = await fixture(t);
  const result = await uploadEncryptedArtifact(args);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.parts, 2); assert.equal(result.verified, true);
  assert.deepEqual(calls, ['CreateMultipartUpload','UploadPart','UploadPart','CompleteMultipartUpload','GetObject']);
  const media = { ...result, key: result.key.replace('database.dump.age', 'media.tar.age') };
  assert.equal(verifiedBackupSet(result, media, args.runId).artifacts.length, 2);
  assert.throws(() => verifiedBackupSet(result, { ...media, verified: false }, args.runId));
  assert.throws(() => verifiedBackupSet(result, media, randomUUID()));
});
test('aborts owned upload on part failure; no completion', async t => {
  const { args, calls } = await fixture(t, 'UploadPart');
  await assert.rejects(uploadEncryptedArtifact(args), e => e.reconciliation.abortVerified && !e.reconciliation.completionAttempted);
  assert.deepEqual(calls, ['CreateMultipartUpload','UploadPart','AbortMultipartUpload']);
});
test('ambiguous completion failure is reported, never deletes objects', async t => {
  const { args, calls } = await fixture(t, 'CompleteMultipartUpload');
  await assert.rejects(uploadEncryptedArtifact(args), e => e.reconciliation.completionAttempted && !e.reconciliation.completed);
  assert.equal(calls.at(-1), 'AbortMultipartUpload');
});
test('remote corruption fails verification and preserves completed object', async t => {
  const { args, calls } = await fixture(t, 'corrupt');
  await assert.rejects(uploadEncryptedArtifact(args), e => e.reconciliation.completed);
  assert.equal(calls.at(-1), 'GetObject'); assert.ok(!calls.includes('AbortMultipartUpload'));
});
test('rejects non-acceptance targets, excessive size and symlinks without network writes', async t => {
  const { args, calls, dir } = await fixture(t);
  await assert.rejects(uploadEncryptedArtifact({ ...args, bucket: 'production' }));
  await assert.rejects(uploadEncryptedArtifact({ ...args, maxBytes: 1024 }));
  const link = join(dir, 'link.age'); await symlink(args.file, link);
  await assert.rejects(uploadEncryptedArtifact({ ...args, file: link }));
  await writeFile(args.file, 'not an encrypted archive but long enough');
  await assert.rejects(uploadEncryptedArtifact(args));
  assert.deepEqual(calls, []);
});

test('encrypted marker published last, binds exact pair to expected run', async t => {
  const { args } = await fixture(t);
  const database = await uploadEncryptedArtifact(args);
  const media = { ...database, key: database.key.replace('database.dump.age','media.tar.age') };
  let plain; const order = [];
  const publish = { database, media, runId: args.runId,
    encryptManifest: async bytes => { order.push('encrypt'); plain = bytes; return '/private/manifest.json.age'; },
    uploadManifest: async input => { order.push('upload'); assert.equal(input.kind, 'manifest.json.age'); assert.equal(input.file, '/private/manifest.json.age'); return { key: 'acceptance/pr-282/' + args.runId + '/manifest.json.age', bytes: 512, sha256: database.sha256, verified: true }; } };
  const result = await publishEncryptedBackupSet(publish);
  assert.deepEqual(order, ['encrypt','upload']);
  assert.deepEqual(parseBackupManifest(plain, args.runId), result.manifest);
  assert.throws(() => parseBackupManifest(plain, randomUUID()));
  const mutated = JSON.parse(plain); mutated.artifacts[1].key = database.key;
  assert.throws(() => parseBackupManifest(Buffer.from(JSON.stringify(mutated)), args.runId));
  await assert.rejects(publishEncryptedBackupSet({ ...publish, media: { ...media, verified: false } }));
  assert.deepEqual(order, ['encrypt','upload']);
  await assert.rejects(publishEncryptedBackupSet({ ...publish, uploadManifest: async () => { throw Error('marker failed'); } }));
  await assert.rejects(publishEncryptedBackupSet({ ...publish, uploadManifest: async () => ({ verified: false }) }));
});
