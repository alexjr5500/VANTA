import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import argon2 from 'argon2';
import { config } from './config';

/**
 * Enterprise-grade cryptography utilities for VANTA.
 * All sensitive operations use industry-standard algorithms.
 *
 * New passwords are hashed with bcrypt to match the primary auth service.
 * Verification also supports existing Argon2 hashes created by older
 * registrations and the database seed.
 */
export class CryptoUtils {
  /**
   * Hash a password using bcrypt (cost factor from config, default 10)
   */
  static async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(config.bcrypt.rounds);
    return bcrypt.hash(password, salt);
  }

  /**
   * Verify a password against a supported hash format.
   */
  static async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      if (hash.startsWith('$argon2')) {
        return await argon2.verify(hash, password);
      }

      if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
        return await bcrypt.compare(password, hash);
      }

      // Unknown or malformed hashes must fail closed rather than throw a 500.
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Generate a cryptographically secure random token
   */
  static generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate a human-readable recovery code
   */
  static generateRecoveryCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[crypto.randomInt(chars.length)];
      if (i === 3) code += '-';
    }
    return code;
  }

  /**
   * Hash data using SHA-256
   */
  static sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   */
  static encrypt(text: string, key?: string): string {
    const encryptionKey = key || config.encryption.key();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt data encrypted with AES-256-GCM
   */
  static decrypt(encryptedText: string, key?: string): string {
    const encryptionKey = key || config.encryption.key();
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted text format');

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Generate a CSRF token
   */
  static generateCSRFToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Create a device fingerprint hash
   */
  static createDeviceFingerprint(userAgent: string, ipAddress: string): string {
    const raw = `${userAgent}|${ipAddress}`;
    return this.sha256(raw);
  }

  /**
   * Compare two strings in constant time (prevents timing attacks)
   */
  static constantTimeCompare(a: string, b: string): boolean {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Generate a TOTP-compatible secret for 2FA
   */
  static generateTOTPSecret(): string {
    return crypto.randomBytes(20).toString('base64url');
  }
}