import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

export const PART_BYTES = 5 * 1024 * 1024;
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024 * 1024;
const HEADER = Buffer.from('age-encryption.org/v1\n');
const fail = message => { throw new Error(message); };
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

// No environment reads, network client construction or scheduler. Callers must
// supply an approved bucket-scoped SDK client and an already encrypted file.
// Production scope is an explicit operator-only namespace, not activation.
// This low-level primitive does not establish source fencing or authorization.
export async function uploadEncryptedArtifact({ client, sdk, bucket, runId, kind, file, maxBytes, scope = 'acceptance' }) {
  if (bucket !== 'vanta-backups' || !validId(runId) || !['acceptance', 'production', 'production-db', 'production-media'].includes(scope) ||
      (scope === 'production-db' && !['database.dump.age', 'manifest.json.age'].includes(kind)) ||
      (scope === 'production-media' && !['media.tar.age', 'manifest.json.age'].includes(kind)) ||
      !['database.dump.age', 'media.tar.age', 'fixture.age', 'manifest.json.age'].includes(kind) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < HEADER.length || maxBytes > MAX_ARTIFACT_BYTES) {
    fail('Invalid acceptance backup parameters');
  }
  const key = backupPrefix(scope, runId) + kind;
  const send = command => client.send(command, { abortSignal: AbortSignal.timeout(60000) });
  // Reject symlinked files; caller must own the trusted private scratch directory.
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let uploadId, completed = false, completionAttempted = false;
  const readExactly = async (length, offset) => {
    const buffer = Buffer.alloc(length);
    for (let pos = 0; pos < length;) {
      const result = await fd.read(buffer, pos, length - pos, offset + pos);
      if (!result.bytesRead) fail('Backup file changed during read');
      pos += result.bytesRead;
    }
    return buffer;
  };
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.size <= HEADER.length || before.size > maxBytes ||
        (before.mode & 0o077) !== 0) fail('Invalid or oversized encrypted backup file');
    if (!(await readExactly(HEADER.length, 0)).equals(HEADER)) fail('Expected age ciphertext');
    const hash = createHash('sha256');
    for (let offset = 0; offset < before.size; offset += PART_BYTES) {
      hash.update(await readExactly(Math.min(PART_BYTES, before.size - offset), offset));
    }
    const sha256 = hash.digest('hex');
    const created = await send(new sdk.CreateMultipartUploadCommand({
      Bucket: bucket, Key: key, ContentType: 'application/octet-stream',
      Metadata: { 'test-id': runId, sha256 },
    }));
    uploadId = created.UploadId;
    if (!uploadId) fail('Missing multipart upload identity');
    const parts = [], uploadedHash = createHash('sha256');
    for (let offset = 0, number = 1; offset < before.size; number++) {
      const body = await readExactly(Math.min(PART_BYTES, before.size - offset), offset);
      uploadedHash.update(body);
      const response = await send(new sdk.UploadPartCommand({
        Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: number,
        ContentLength: body.length, Body: body,
      }));
      if (!response.ETag) fail('Missing multipart part identity');
      parts.push({ PartNumber: number, ETag: response.ETag });
      offset += body.length;
    }
    const after = await fd.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        uploadedHash.digest('hex') !== sha256) fail('Backup changed during upload');
    completionAttempted = true;
    await send(new sdk.CompleteMultipartUploadCommand({
      Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts },
      IfNoneMatch: '*',
    }));
    completed = true;
    // Verify the complete object, not just metadata or multipart ETag.
    const response = await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
    try {
      if (response.ContentLength !== before.size || response.Metadata?.['test-id'] !== runId ||
          response.Metadata?.sha256 !== sha256) fail('Uploaded backup identity mismatch');
      const remoteHash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of response.Body) {
        bytes += chunk.length;
        if (bytes > before.size) fail('Remote backup exceeds expected size');
        remoteHash.update(chunk);
      }
      if (bytes !== before.size || remoteHash.digest('hex') !== sha256) fail('Remote backup checksum mismatch');
    } finally { response.Body?.destroy?.(); }
    return Object.freeze({ key, bytes: before.size, sha256, parts: parts.length, verified: true });
  } catch {
    let abortVerified = false;
    if (uploadId && !completed) {
      try {
        await send(new sdk.AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
        abortVerified = true;
      } catch (error) { abortVerified = error?.$metadata?.httpStatusCode === 404; }
    }
    // Never delete a completed or potentially completed object on error. A
    // timed-out completion can succeed remotely; operator reconciliation is
    // required, not a blind retry or deletion. Do not log raw provider errors.
    const error = new Error('Encrypted backup transfer failed');
    error.reconciliation = { key, completionAttempted, completed, abortVerified };
    throw error;
  } finally { await fd.close(); }
}

export function backupPrefix(scope, runId) {
  if (!validId(runId) || !['acceptance', 'production', 'production-db', 'production-media'].includes(scope)) fail('Invalid backup scope');
  return (scope === 'production-media' ? 'production-media/v1/' : scope === 'production-db' ? 'production-db/v1/' : scope === 'production' ? 'production/v1/' : 'acceptance/pr-282/') + runId + '/';
}

export function verifiedBackupSet(database, media, runId, scope = 'acceptance') {
  if (!validId(runId) || !['acceptance','production'].includes(scope)) fail('Invalid backup set identity');
  const prefix = backupPrefix(scope, runId);
  for (const [artifact, kind] of [[database, 'database.dump.age'], [media, 'media.tar.age']]) {
    if (artifact?.verified !== true || artifact.key !== prefix + kind ||
        !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= HEADER.length ||
        artifact.bytes > MAX_ARTIFACT_BYTES || !validDigest(artifact.sha256)) fail('Unverified backup artifact');
  }
  // This is a local manifest candidate, not proof of source consistency or
  // recoverability. It must be independently restored before release approval.
  return { version: 1, runId, artifacts: [database, media].map(({ key, bytes, sha256 }) => ({ key, bytes, sha256 })) };
}

/** Publish a commit marker only after both encrypted data artifacts have passed
 * full remote checksum verification. The injected encryptManifest must be the
 * trusted age writer; the injected uploader must be the verified uploader.
 * No plaintext manifest is uploaded. A failed marker transfer is not success.
 */
export async function publishEncryptedBackupSet({ database, media, runId, encryptManifest, uploadManifest, scope = 'acceptance' }) {
  const manifest = verifiedBackupSet(database, media, runId, scope);
  const plaintext = Buffer.from(JSON.stringify(manifest) + '\n', 'utf8');
  const encryptedFile = await encryptManifest(plaintext);
  const marker = await uploadManifest({ runId, kind: 'manifest.json.age', file: encryptedFile });
  if (marker?.verified !== true || marker.key !== backupPrefix(scope, runId) + 'manifest.json.age' ||
      !Number.isSafeInteger(marker.bytes) || marker.bytes <= HEADER.length ||
      marker.bytes > 64 * 1024 || !validDigest(marker.sha256)) fail('Unverified encrypted manifest');
  return Object.freeze({ manifest, marker, transferVerified: true });
}

/** Validate a decrypted marker before selecting recovery objects. This checks
 * structure and binds the pair to the expected run. It does not authenticate
 * the writer: the age public recipient is not a signing key. */
export function parseBackupManifest(bytes, expectedRunId, scope = 'acceptance') {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 16 * 1024 ||
      !validId(expectedRunId)) fail('Invalid backup manifest input');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('Invalid backup manifest JSON'); }
  if (!value || value.version !== 1 || value.runId !== expectedRunId ||
      Object.keys(value).length !== 3 || !Array.isArray(value.artifacts) ||
      value.artifacts.length !== 2) fail('Invalid backup manifest shape');
  const artifacts = value.artifacts.map(a => {
    if (!a || typeof a !== 'object' || Object.keys(a).length !== 3 ||
        !Object.hasOwn(a, 'key') || !Object.hasOwn(a, 'bytes') || !Object.hasOwn(a, 'sha256')) fail('Invalid manifest artifact shape');
    return { ...a, verified: true };
  });
  return verifiedBackupSet(artifacts[0], artifacts[1], expectedRunId, scope);
}
