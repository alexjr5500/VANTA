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
   * Verify and atomically consume a TOTP time-step. Speakeasy's ordinary
   * verify() accepts a valid code repeatedly during its time window; storing
   * the last accepted step prevents replay, including simultaneous requests.
   */
  private async verifyAndConsumeTotp(
    userId: string,
    secret: string,
    token: string,
    requireEnabled: boolean
  ): Promise<boolean> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const delta = speakeasy.totp.verifyDelta({
      time: nowSeconds,
      secret,
      encoding: 'base32',
      token,
      window: 2,
    });
    if (!delta || !Number.isInteger(delta.delta)) return false;

    const acceptedStep = Math.floor(nowSeconds / 30) + delta.delta;
    const where: any = {
      id: userId,
      twoFactorSecret: secret,
      twoFactorEnabled: requireEnabled,
      OR: [
        { twoFactorLastUsedStep: null },
        { twoFactorLastUsedStep: { lt: acceptedStep } },
      ],
    };
    const consumed = await prisma.user.updateMany({
      where,
      data: { twoFactorLastUsedStep: acceptedStep, ...(requireEnabled ? {} : { twoFactorEnabled: true }) },
    });
    return consumed.count === 1;
  }

  /**
   * Setup 2FA for a user - generates secret and backup codes
   */
  async setup(userId: string, email: string): Promise<TwoFactorSetupResult> {
    if (!speakeasy) throw new Error('TOTP provider is unavailable; 2FA setup is disabled.');
    const secret = speakeasy.generateSecret({ name: `${config.twoFactor.issuer} (${email})`, length: 20 });

    // Generate backup codes
    const backupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];
    
    for (let i = 0; i < config.twoFactor.backupCodesCount; i++) {
      const code = CryptoUtils.generateRecoveryCode();
      backupCodes.push(code);
      hashedBackupCodes.push(CryptoUtils.sha256(code));
    }

    // Store secret and hashed backup codes
    const setup = await prisma.user.updateMany({
      where: { id: userId, twoFactorEnabled: false },
      data: {
        twoFactorSecret: secret.base32,
        backupCodes: JSON.stringify(hashedBackupCodes),
        twoFactorEnabled: false, // Not enabled until verified
        twoFactorLastUsedStep: null,
      },
    });

    if (setup.count !== 1) throw new Error('Cannot replace an active 2FA enrollment.');

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

    if (!speakeasy) throw new Error('TOTP provider is unavailable; refusing 2FA enrollment.');
    const verified = await this.verifyAndConsumeTotp(userId, user.twoFactorSecret, token, false);

    if (!verified) {
      return { success: false, error: 'Invalid verification code' };
    }

    // The time-step consumption and enablement were committed together.

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
  async verifyLogin(userId: string, token: string, requireEnabled = false, expectedSecret?: string | null): Promise<TwoFactorVerifyResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, backupCodes: true, twoFactorEnabled: true },
    });

    if (!user) return { valid: false, isBackupCode: false };
    if (expectedSecret !== undefined && user.twoFactorSecret !== expectedSecret) return { valid: false, isBackupCode: false };
    if (!user.twoFactorEnabled) {
      return { valid: !requireEnabled, isBackupCode: false };
    }
    if (!user.twoFactorSecret) return { valid: false, isBackupCode: false };
    if (!speakeasy) throw new Error('TOTP provider is unavailable; refusing 2FA login.');
    const totpValid = await this.verifyAndConsumeTotp(userId, user.twoFactorSecret!, token, true);

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
        // Consume with compare-and-swap so concurrent requests cannot redeem
        // the same backup code from a stale copy of the stored list.
        backupCodes.splice(codeIndex, 1);
        const consumed = await prisma.user.updateMany({
          where: { id: userId, twoFactorEnabled: true, twoFactorSecret: user.twoFactorSecret, backupCodes: user.backupCodes },
          data: { backupCodes: JSON.stringify(backupCodes) },
        });
        if (consumed.count !== 1) {
          return { valid: false, isBackupCode: false };
        }

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
        twoFactorLastUsedStep: null,
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