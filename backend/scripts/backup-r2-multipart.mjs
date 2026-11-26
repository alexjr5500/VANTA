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
// Still acceptance-only until production source and recovery gates are met.
export async function uploadEncryptedArtifact({ client, sdk, bucket, runId, kind, file, maxBytes }) {
  if (bucket !== 'vanta-backups' || !validId(runId) ||
      !['database.dump.age', 'media.tar.age', 'fixture.age'].includes(kind) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < HEADER.length || maxBytes > MAX_ARTIFACT_BYTES) {
    fail('Invalid acceptance backup parameters');
  }
  const key = 'acceptance/pr-282/' + runId + '/' + kind;
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

export function verifiedBackupSet(database, media, runId) {
  if (!validId(runId)) fail('Invalid backup set identity');
  const prefix = 'acceptance/pr-282/' + runId + '/';
  for (const [artifact, kind] of [[database, 'database.dump.age'], [media, 'media.tar.age']]) {
    if (artifact?.verified !== true || artifact.key !== prefix + kind ||
        !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= HEADER.length ||
        artifact.bytes > MAX_ARTIFACT_BYTES || !validDigest(artifact.sha256)) fail('Unverified backup artifact');
  }
  // This is a local manifest candidate, not proof of source consistency or
  // recoverability. It must be independently restored before release approval.
  return { version: 1, runId, artifacts: [database, media].map(({ key, bytes, sha256 }) => ({ key, bytes, sha256 })) };
}
