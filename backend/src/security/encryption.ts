import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Enterprise-grade encryption service for sensitive data at rest.
 * Uses AES-256-GCM for authenticated encryption.
 */
class Encryption {
  private getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    // Derive a 256-bit key from the provided key using PBKDF2
    const salt = Buffer.from(process.env.ENCRYPTION_SALT || 'vanta-encryption-salt', 'utf8');
    return crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha512');
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(plaintext: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:ciphertext (all hex encoded)
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt data that was encrypted with encrypt()
   */
  decrypt(encryptedData: string): string {
    const key = this.getEncryptionKey();
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Hash a value using SHA-256 (for non-reversible operations like backup codes)
   */
  hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Generate a cryptographically secure random token
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate backup codes (for 2FA recovery)
   */
  generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Encrypt sensitive fields in a user object before storing
   */
  encryptSensitiveFields(data: Record<string, any>, fields: string[]): Record<string, any> {
    const encrypted = { ...data };
    for (const field of fields) {
      if (encrypted[field]) {
        encrypted[field] = this.encrypt(encrypted[field]);
      }
    }
    return encrypted;
  }

  /**
   * Generate a checksum for data integrity verification
   */
  generateChecksum(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

export const encryption = new Encryption();