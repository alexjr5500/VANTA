import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Bounded single-object format for small acceptance artifacts, not a streaming
// production backup format. AAD binds ciphertext to its intended object key.
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const magic = Buffer.from('VANTABK1');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function validate(key, objectKey) {
  if (!Buffer.isBuffer(key) || key.length !== 32 ||
      typeof objectKey !== 'string' || !/^acceptance\/pr-282\/[a-f0-9-]{36}\/(db.dump|media.tar)\.enc$/.test(objectKey)) {
    throw new Error('Invalid backup key or acceptance object path');
  }
}
export function encryptBackup(bytes, key, objectKey) {
  validate(key, objectKey);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BACKUP_BYTES) throw new Error('Invalid backup size');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.concat([magic, Buffer.from(objectKey)]));
  return Buffer.concat([magic, nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
export function decryptBackup(bytes, key, objectKey) {
  validate(key, objectKey);
  if (!Buffer.isBuffer(bytes) || bytes.length <= 36 || bytes.length > MAX_BACKUP_BYTES + 36 ||
      !bytes.subarray(0, 8).equals(magic)) throw new Error('Invalid encrypted backup format');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
  decipher.setAAD(Buffer.concat([magic, Buffer.from(objectKey)]));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(20, -16)), decipher.final()]);
}
