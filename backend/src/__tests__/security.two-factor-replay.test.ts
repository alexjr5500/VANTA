import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    trustedDevice: { deleteMany: jest.fn() },
  },
}));
jest.mock('../security/config', () => ({
  config: { twoFactor: { issuer: 'VANTA', backupCodesCount: 10, trustedDeviceExpiryDays: 30 } },
}));
jest.mock('../security/crypto', () => ({
  CryptoUtils: {
    generateRecoveryCode: jest.fn(),
    sha256: (value: string) => `hash:${value}`,
  },
}));
jest.mock('../security/auditLog', () => ({
  auditLog: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('speakeasy', () => ({
  totp: { verifyDelta: jest.fn() },
}));

import { prisma } from '../prisma';
import { twoFactorAuth } from '../security/twoFactorAuth';

const speakeasy = require('speakeasy') as { totp: { verifyDelta: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    twoFactorSecret: 'BASE32SECRET',
    twoFactorEnabled: true,
    backupCodes: null,
  });
  (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.user.update as jest.Mock).mockResolvedValue({});
  speakeasy.totp.verifyDelta.mockReturnValue({ delta: 0 });
});

describe('TOTP replay protection', () => {
  test('atomically consumes a valid TOTP time-step', async () => {
    const result = await twoFactorAuth.verifyLogin('user1', '123456');
    expect(result).toEqual({ valid: true, isBackupCode: false });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'user1',
        twoFactorEnabled: true,
        OR: [
          { twoFactorLastUsedStep: null },
          { twoFactorLastUsedStep: { lt: expect.any(Number) } },
        ],
      }),
      data: { twoFactorLastUsedStep: expect.any(Number) },
    }));
  });

  test('rejects replay when another request already consumed the same time-step', async () => {
    (prisma.user.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    const result = await twoFactorAuth.verifyLogin('user1', '123456');
    expect(result).toEqual({ valid: false, isBackupCode: false });
  });

  test('rejects invalid TOTP without changing the stored time-step', async () => {
    speakeasy.totp.verifyDelta.mockReturnValue(null);
    const result = await twoFactorAuth.verifyLogin('user1', '000000');
    expect(result).toEqual({ valid: false, isBackupCode: false });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  test('recovery code rotation refuses missing, invalid or replayed authenticator tokens', async () => {
    await expect(twoFactorAuth.regenerateBackupCodes('user1')).rejects.toThrow('fresh authenticator code');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    (prisma.user.updateMany as jest.Mock).mockResolvedValueOnce({count:0});
    await expect(twoFactorAuth.regenerateBackupCodes('user1','123456')).rejects.toThrow('fresh authenticator code');
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  test('backup codes are consumed with compare-and-swap', async () => {
    const backupCodes = JSON.stringify(['hash:RECOVERY1', 'hash:RECOVERY2']);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      twoFactorSecret: 'BASE32SECRET',
      twoFactorEnabled: true,
      backupCodes,
    });
    speakeasy.totp.verifyDelta.mockReturnValue(null);
    (prisma.user.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    const result = await twoFactorAuth.verifyLogin('user1', 'RECOVERY1');
    expect(result).toEqual({ valid: false, isBackupCode: false });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user1', twoFactorEnabled: true, backupCodes },
      data: { backupCodes: JSON.stringify(['hash:RECOVERY2']) },
    });
  });

  test('2FA enrollment consumes the setup code so it cannot immediately be replayed at login', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      twoFactorSecret: 'BASE32SECRET',
      twoFactorEnabled: false,
      email: 'user@example.test',
    });
    const result = await twoFactorAuth.enable('user1', '123456');
    expect(result).toEqual({ success: true });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user1', twoFactorEnabled: false, twoFactorSecret: 'BASE32SECRET' },
      data: { twoFactorEnabled: true },
    }));
    expect(prisma.user.updateMany).toHaveBeenCalled();
  });
});
