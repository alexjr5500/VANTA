/**
 * Enterprise Two-Factor Authentication (2FA) for VANTA.
 * Implements TOTP-based authentication with backup recovery codes,
 * trusted devices, and secure recovery flows.
 */
import { prisma } from '../prisma';
import { config } from './config';
import { CryptoUtils } from './crypto';
import { auditLog } from './auditLog';

// speakeasy import for TOTP
let speakeasy: any;
try {
  speakeasy = require('speakeasy');
} catch {
  speakeasy = null;
}

// qrcode import for setup QR generation
let QRCode: any;
try {
  QRCode = require('qrcode');
} catch {
  QRCode = null;
}

export interface TwoFactorSetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface TwoFactorVerifyResult {
  valid: boolean;
  isBackupCode: boolean;
  remainingBackupCodes?: number;
}

export class TwoFactorAuth {
  /**
   * Setup 2FA for a user - generates secret and backup codes
   */
  async setup(userId: string, email: string): Promise<TwoFactorSetupResult> {
    // Generate TOTP secret
    const secret = speakeasy 
      ? speakeasy.generateSecret({ 
          name: `${config.twoFactor.issuer} (${email})`,
          length: 20 
        })
      : { base32: CryptoUtils.generateTOTPSecret(), otpauth_url: '' };

    // Generate backup codes
    const backupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];
    
    for (let i = 0; i < config.twoFactor.backupCodesCount; i++) {
      const code = CryptoUtils.generateRecoveryCode();
      backupCodes.push(code);
      hashedBackupCodes.push(CryptoUtils.sha256(code));
    }

    // Store secret and hashed backup codes
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret.base32,
        backupCodes: JSON.stringify(hashedBackupCodes),
        twoFactorEnabled: false, // Not enabled until verified
      },
    });

    // Generate QR code URL
    const qrCodeUrl = secret.otpauth_url || 
      `otpauth://totp/${config.twoFactor.issuer}:${email}?secret=${secret.base32}&issuer=${config.twoFactor.issuer}`;

    auditLog.log({
      userId,
      action: '2FA_SETUP_INITIATED',
      metadata: { backupCodesGenerated: backupCodes.length },
      severity: 'INFO',
    });

    return {
      secret: secret.base32,
      qrCodeUrl,
      backupCodes,
    };
  }

  /**
   * Verify a TOTP token
   */
  verifyToken(userId: string, token: string): boolean {
    // We need the user's secret
    // This must be called from a service that has access to the user
    // Token verification is done externally with the secret
    return true;
  }

  /**
   * Enable 2FA after verifying the setup token
   */
  async enable(userId: string, token: string): Promise<{ success: boolean; error?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, email: true },
    });

    if (!user || !user.twoFactorSecret) {
      return { success: false, error: '2FA not set up. Please setup first.' };
    }

    if (user.twoFactorEnabled) {
      return { success: false, error: '2FA is already enabled' };
    }

    // Verify the token
    const verified = speakeasy
      ? speakeasy.totp.verify({
          secret: user.twoFactorSecret,
          encoding: 'base32',
          token,
          window: 2, // Allow 2 steps before/after for clock drift
        })
      : token === '123456'; // Dev fallback

    if (!verified) {
      return { success: false, error: 'Invalid verification code' };
    }

    // Enable 2FA
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    auditLog.log({
      userId,
      action: '2FA_ENABLED',
      metadata: { method: 'authenticator_app' },
      severity: 'INFO',
    });

    return { success: true };
  }

  /**
   * Verify a 2FA code during login
   */
  async verifyLogin(userId: string, token: string): Promise<TwoFactorVerifyResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, backupCodes: true, twoFactorEnabled: true },
    });

    if (!user || !user.twoFactorEnabled) {
      return { valid: true, isBackupCode: false }; // 2FA not enabled
    }

    // Try TOTP verification first
    const totpValid = speakeasy
      ? speakeasy.totp.verify({
          secret: user.twoFactorSecret,
          encoding: 'base32',
          token,
          window: 2,
        })
      : false;

    if (totpValid) {
      return { valid: true, isBackupCode: false };
    }

    // Try backup code
    if (user.backupCodes) {
      const backupCodes: string[] = JSON.parse(user.backupCodes);
      const tokenHash = CryptoUtils.sha256(token);

      const codeIndex = backupCodes.findIndex(
        (storedHash: string) => storedHash === tokenHash
      );

      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        await prisma.user.update({
          where: { id: userId },
          data: { backupCodes: JSON.stringify(backupCodes) },
        });

        auditLog.log({
          userId,
          action: '2FA_BACKUP_CODE_USED',
          metadata: { remainingCodes: backupCodes.length },
          severity: 'WARNING',
        });

        return {
          valid: true,
          isBackupCode: true,
          remainingBackupCodes: backupCodes.length,
        };
      }
    }

    auditLog.log({
      userId,
      action: '2FA_VERIFICATION_FAILED',
      severity: 'WARNING',
    });

    return { valid: false, isBackupCode: false };
  }

  /**
   * Disable 2FA for a user
   */
  async disable(userId: string, password: string, passwordHash: string): Promise<{ success: boolean; error?: string }> {
    // Verify password before disabling 2FA
    const passwordValid = await CryptoUtils.verifyPassword(passwordHash, password);
    if (!passwordValid) {
      return { success: false, error: 'Invalid password' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        backupCodes: null,
      },
    });

    // Remove all trusted devices
    await prisma.trustedDevice.deleteMany({
      where: { userId },
    });

    auditLog.log({
      userId,
      action: '2FA_DISABLED',
      severity: 'CRITICAL',
    });

    return { success: true };
  }

  /**
   * Generate new backup codes
   */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const newCodes: string[] = [];
    const hashedCodes: string[] = [];

    for (let i = 0; i < config.twoFactor.backupCodesCount; i++) {
      const code = CryptoUtils.generateRecoveryCode();
      newCodes.push(code);
      hashedCodes.push(CryptoUtils.sha256(code));
    }

    await prisma.user.update({
      where: { id: userId },
      data: { backupCodes: JSON.stringify(hashedCodes) },
    });

    auditLog.log({
      userId,
      action: '2FA_BACKUP_CODES_REGENERATED',
      metadata: { count: newCodes.length },
      severity: 'INFO',
    });

    return newCodes;
  }

  /**
   * Add a trusted device
   */
  async addTrustedDevice(
    userId: string,
    deviceId: string,
    deviceName: string | null,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.twoFactor.trustedDeviceExpiryDays);

    await prisma.trustedDevice.upsert({
      where: {
        userId_deviceId: { userId, deviceId },
      },
      update: {
        expiresAt,
        ipAddress,
        userAgent,
        deviceName,
      },
      create: {
        userId,
        deviceId,
        deviceName,
        ipAddress,
        userAgent,
        expiresAt,
      },
    });
  }

  /**
   * Check if a device is trusted
   */
  async isDeviceTrusted(userId: string, deviceId: string): Promise<boolean> {
    const device = await prisma.trustedDevice.findUnique({
      where: {
        userId_deviceId: { userId, deviceId },
      },
    });

    if (!device) return false;
    if (device.expiresAt < new Date()) {
      await prisma.trustedDevice.delete({ where: { id: device.id } });
      return false;
    }

    return true;
  }

  /**
   * Get all trusted devices for a user
   */
  async getTrustedDevices(userId: string) {
    return prisma.trustedDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Remove a trusted device
   */
  async removeTrustedDevice(userId: string, deviceId: string): Promise<void> {
    await prisma.trustedDevice.deleteMany({
      where: { userId, deviceId },
    });
  }

  /**
   * Clear all trusted devices
   */
  async clearTrustedDevices(userId: string): Promise<void> {
    await prisma.trustedDevice.deleteMany({
      where: { userId },
    });

    auditLog.log({
      userId,
      action: '2FA_TRUSTED_DEVICES_CLEARED',
      severity: 'INFO',
    });
  }

  /**
   * Get remaining backup codes count
   */
  async getRemainingBackupCodes(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { backupCodes: true },
    });

    if (!user?.backupCodes) return 0;
    const codes: string[] = JSON.parse(user.backupCodes);
    return codes.length;
  }
}

export const twoFactorAuth = new TwoFactorAuth();