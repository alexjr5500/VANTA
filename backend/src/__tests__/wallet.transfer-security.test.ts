/**
 * Wallet transfer security tests — Transaction OTP challenge, CAS concurrency,
 * idempotency keys, platform-mandated transfer limits.
 *
 * These tests cover the highest-risk financial paths (Phases 4/5/6):
 *   - transferCoins must never accept an arbitrary OTP (no-op verification).
 *   - transferCoins must be race-safe (compare-and-swap debit) and idempotent
 *     (requestId) — a double-submit or retry can never debit twice.
 *   - updateTransferLimit must clamp user settings to platform maximums.
 */
import { WalletService, resolveEffectiveTransferLimits, TRANSFER_OTP_CONSTANTS } from '../services/wallet.service';
import { PLATFORM_TRANSFER_LIMITS } from '../config/wallet.config';
import { notificationService } from '../services/notification.service';
import { emailService } from '../services/email.service';
import { prisma } from '../prisma';
import { twoFactorAuth } from '../security/twoFactorAuth';
import bcrypt from 'bcryptjs';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => {
  const mock = {
    wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    walletPIN: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    transferLimit: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    transferOtpChallenge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    coinTransfer: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    walletTransaction: { create: jest.fn() },
    walletAuditLog: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  return { prisma: mock };
});

jest.mock('../security/twoFactorAuth', () => ({ twoFactorAuth: { verifyLogin: jest.fn().mockResolvedValue({ valid: true, isBackupCode: false }) } }));

jest.mock('../services/email.service', () => ({ emailService: { sendTransferOtpEmail: jest.fn().mockResolvedValue({ delivered: true, transport: 'sendgrid' }) } }));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    createNotification: jest.fn().mockResolvedValue({}),
    notifyWithdrawalStatus: jest.fn(),
  },
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_otp'),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue('salt'),
}));

const walletService = new WalletService();
const transferWithPin = (...args: any[]) => {
  const positional = [...args];
  const twoFactorCode = positional.length > 10 ? positional.pop() : undefined;
  while (positional.length < 10) positional.push(undefined);
  if (!positional[7]) positional[7] = 'test-request-id';
  return walletService.transferCoins(...positional, '1234', twoFactorCode);
};

const senderWallet: any = { id: 'wallet1', userId: 'user1', coinBalance: 1_000_000, earningsBalance: 0, totalCoinsPurchased: 0, totalCoinsReceived: 0, totalCoinsSent: 0, totalGiftsSent: 0, totalGiftsReceived: 0, totalWithdrawn: 0, lifetimeEarnings: 0, bonusCoins: 0, lockedCoins: 0, isFrozen: false, usdtWalletAddress: null };

const receiverWallet: any = { id: 'wallet2', userId: 'user2', coinBalance: 0, earningsBalance: 0, totalCoinsReceived: 0, totalCoinsSent: 0, totalGiftsReceived: 0, lockedCoins: 0, isFrozen: false };

const defaultLimit: any = { id: 'limit1', walletId: 'wallet1', dailyLimit: 10_000_000, dailyUsed: 0, lastResetDate: new Date(), singleTxLimit: 10_000_000, otpThreshold: 10_000 };

const senderInfo = { id: 'user1', username: 'alice', displayName: 'Alice', email: 'alice@example.test', emailVerified: true };
const receiverInfo = { id: 'user2', username: 'bob', displayName: 'Bob', email: 'bob@example.test', emailVerified: true };

function txMock() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked-row' }]),
    wallet: {
      findUniqueOrThrow: jest.fn()
        .mockResolvedValueOnce(senderWallet)
        .mockResolvedValueOnce({ ...senderWallet, coinBalance: senderWallet.coinBalance - 105 })
        .mockResolvedValueOnce(receiverWallet),
      update: jest.fn().mockResolvedValue({ ...receiverWallet, coinBalance: receiverWallet.coinBalance + 100 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transferOtpChallenge: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinTransfer: {
      create: jest.fn().mockResolvedValue({ id: 'transfer1', senderId: 'user1', receiverId: 'user2', amount: 100 }),
    },
    walletTransaction: { create: jest.fn().mockResolvedValue({}) },
    transferLimit: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    walletAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (bcrypt.compare as jest.Mock).mockReset().mockResolvedValue(true);
  (prisma.wallet.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { userId: string } }) =>
    where.userId === 'user1' ? senderWallet : receiverWallet
  );
  (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue(defaultLimit);
  (prisma.coinTransfer.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.walletPIN.findUnique as jest.Mock).mockResolvedValue({ id: 'pin1', walletId: 'wallet1', pinHash: 'hashed_pin', failedAttempts: 0, lockedUntil: null });
  (prisma.walletPIN.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ failedAttempts: 1, lockedUntil: null }]);
  (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'user1' ? { ...senderInfo, twoFactorEnabled: false } : { ...receiverInfo, twoFactorEnabled: false }
  );
  (twoFactorAuth.verifyLogin as jest.Mock).mockResolvedValue({ valid: true, isBackupCode: false });
  (prisma.transferOtpChallenge.create as jest.Mock).mockResolvedValue({ id: 'challenge1', userId: 'user1', receiverId: 'user2', amount: 105 });
  (prisma.coinTransfer.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.coinTransfer.count as jest.Mock).mockResolvedValue(0);
});
describe('resolveEffectiveTransferLimits (Phase 6)', () => {
  test('clamps user values above platform maximums', () => {
    const limits = resolveEffectiveTransferLimits({ dailyLimit: 999_999_999, singleTxLimit: 999_999_999, otpThreshold: 999_999_999 });
    expect(limits.dailyLimit).toBe(PLATFORM_TRANSFER_LIMITS.maxDaily);
    expect(limits.singleTxLimit).toBe(PLATFORM_TRANSFER_LIMITS.maxSingleTxLimit);
    expect(limits.otpThreshold).toBe(PLATFORM_TRANSFER_LIMITS.maxOtpThreshold);
  });

  test('honors stricter (lower) user limits for daily/single caps', () => {
    const limits = resolveEffectiveTransferLimits({ dailyLimit: 500, singleTxLimit: 250, otpThreshold: 1_000 });
    expect(limits.dailyLimit).toBe(500);
    expect(limits.singleTxLimit).toBe(250);
    expect(limits.otpThreshold).toBe(1_000);
  });

  test('defaults to platform caps when no limit row exists', () => {
    const limits = resolveEffectiveTransferLimits(null);
    expect(limits.dailyLimit).toBe(PLATFORM_TRANSFER_LIMITS.maxDaily);
    expect(limits.singleTxLimit).toBe(PLATFORM_TRANSFER_LIMITS.maxSingleTxLimit);
    expect(limits.otpThreshold).toBe(PLATFORM_TRANSFER_LIMITS.maxOtpThreshold);
  });
});

describe('WalletService.updateTransferLimit (Phase 6)', () => {
  (prisma.transferLimit.update as jest.Mock).mockImplementation(async ({ data }: { data: any }) => ({ ...defaultLimit, ...data }));
  test('clamps a user attempt to raise limits beyond platform caps', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue(defaultLimit);
    const result = await walletService.updateTransferLimit('user1', { dailyLimit: 99_000_000, singleTxLimit: 99_000_000, otpThreshold: 99_000_000 });
    expect(result.effective.dailyLimit).toBe(PLATFORM_TRANSFER_LIMITS.maxDaily);
    expect(result.effective.singleTxLimit).toBe(PLATFORM_TRANSFER_LIMITS.maxSingleTxLimit);
    expect(result.effective.otpThreshold).toBe(PLATFORM_TRANSFER_LIMITS.maxOtpThreshold);
  });

  test('allows lowering limits (extra user safety)', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue(defaultLimit);
    const result = await walletService.updateTransferLimit('user1', { dailyLimit: 1_000, singleTxLimit: 500, otpThreshold: 2_000 });
    expect(result.effective.dailyLimit).toBe(1_000);
    expect(result.effective.singleTxLimit).toBe(500);
    expect(result.effective.otpThreshold).toBe(2_000);
  });
});
describe('WalletService.transferCoins — OTP challenge (Phase 5)', () => {
  test('issues a challenge (requiresOTP) when no OTP code is provided', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_otp');

    const result = await transferWithPin('user1', 'user2', 2000);

    expect(result.requiresOTP).toBe(true);
    expect(result.challengeId).toBe('challenge1');
    expect(prisma.transferOtpChallenge.create).toHaveBeenCalledTimes(1);
    const challengeData = (prisma.transferOtpChallenge.create as jest.Mock).mock.calls[0][0].data;
    expect(challengeData.otpHash).toBe('hashed_otp'); // never plaintext
    expect(challengeData.receiverId).toBe('user2');
    expect(challengeData.amount).toBe(2100); // 100 + 5% fee — intent bound to total deduction
    expect(emailService.sendTransferOtpEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.test',
      amount: 2100,
      recipient: 'alice',
      expiresInMinutes: 10,
    }));
    expect(notificationService.createNotification).toHaveBeenCalled();
    const notificationArgs = (notificationService.createNotification as jest.Mock).mock.calls[0];
    expect(notificationArgs[3]).not.toMatch(/\b\d{6}\b/);
    expect(notificationArgs[3]).toContain('not available in notifications');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('requires authenticator 2FA for a high-value transfer when the sender enabled it', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (prisma.transferOtpChallenge.findUnique as jest.Mock).mockResolvedValue({
      id: 'challenge1', userId: 'user1', receiverId: 'user2', amount: 2100, sessionId: 'session1',
      otpHash: 'hashed_otp', expiresAt: new Date(Date.now() + 60_000), maxAttempts: 3, attempts: 0, consumedAt: null,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    await expect(transferWithPin('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1'))
      .rejects.toThrow('Authenticator 2FA code is required');
    expect(twoFactorAuth.verifyLogin).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('verifies authenticator 2FA before a high-value transfer when enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    const challenge = {
      id: 'challenge1', userId: 'user1', receiverId: 'user2', amount: 2100, sessionId: 'session1',
      otpHash: 'hashed_otp', expiresAt: new Date(Date.now() + 60_000), maxAttempts: 3, attempts: 0, consumedAt: null,
    };
    (prisma.transferOtpChallenge.findUnique as jest.Mock).mockResolvedValue(challenge);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue(challenge);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await transferWithPin('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1', '654321');
    expect(twoFactorAuth.verifyLogin).toHaveBeenCalledWith('user1', '654321', true, 'TESTSECRET');
  });

  test('rejects an invalid OTP inside the transaction and aborts the transfer', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    // The first compare validates the wallet PIN; the second validates the deliberately wrong OTP.
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue({
      id: 'challenge1', userId: 'user1', sessionId: 'session1', receiverId: 'user2', amount: 2100,
      otpHash: 'hashed_wrong', expiresAt: new Date(Date.now() + 60_000), maxAttempts: 3, attempts: 0, consumedAt: null,
    });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(
      transferWithPin('user1', 'user2', 2000, undefined, '000000', '127.0.0.1', undefined, undefined, 'challenge1', 'session1')
    ).rejects.toThrow('Invalid OTP');

    expect(tx.coinTransfer.create).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    const failedAudit = (tx.walletAuditLog.create as jest.Mock).mock.calls.some((c: any[]) => c[0].data.action === 'OTP_FAILED');
    expect(failedAudit).toBe(true);
  });

  test('rejects a consumed (replayed) challenge', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue({
      id: 'challenge1', userId: 'user1', sessionId: 'session1', receiverId: 'user2', amount: 2100,
      otpHash: 'hashed', expiresAt: new Date(Date.now() + 60_000), maxAttempts: 3, attempts: 0, consumedAt: new Date(),
    });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(
      transferWithPin('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1')
    ).rejects.toThrow('OTP challenge has already been used');

    expect(tx.coinTransfer.create).not.toHaveBeenCalled();
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  test('rejects an expired challenge', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue({
      id: 'challenge1', userId: 'user1', receiverId: 'user2', amount: 2100,
      otpHash: 'hashed', expiresAt: new Date(Date.now() - 60_000), maxAttempts: 3, attempts: 0, consumedAt: null,
    });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(
      transferWithPin('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1')
    ).rejects.toThrow('OTP challenge has expired');
    expect(tx.coinTransfer.create).not.toHaveBeenCalled();
  });

  test('completes a transfer only when the OTP is verified and consumed exactly once', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue({
      id: 'challenge1', userId: 'user1', sessionId: 'session1', receiverId: 'user2', amount: 2100,
      otpHash: 'hashed', expiresAt: new Date(Date.now() + 60_000), maxAttempts: 3, attempts: 0, consumedAt: null,
    });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    const result = await transferWithPin('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1');

    expect(result.transfer.id).toBe('transfer1');
    expect(tx.transferOtpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'challenge1', consumedAt: null }), data: expect.objectContaining({ consumedAt: expect.any(Date) }) })
    );
    const debitCall = (tx.wallet.updateMany as jest.Mock).mock.calls[0];
    expect(debitCall[0].where).toEqual(expect.objectContaining({
      userId: 'user1', isFrozen: false, coinBalance: { gte: 2100 }, lockedCoins: 0,
    }));
  });
});
describe('WalletService.transferCoins — concurrency & idempotency (Phase 4)', () => {
  test('rejects a transfer above the platform maximum', async () => {
    await expect(transferWithPin('user1', 'user2', PLATFORM_TRANSFER_LIMITS.maxPerTransfer + 1)).rejects.toThrow('platform maximum');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('preflight rejects an insufficient balance before touching the ledger', async () => {
    (prisma.wallet.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { userId: string } }) => ({
      ...senderWallet, userId: where.userId, coinBalance: 10, lockedCoins: 0,
    }));

    await expect(transferWithPin('user1', 'user2', 100)).rejects.toThrow('Insufficient balance');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects fractional coin amounts instead of truncating them', async () => {
    await expect(transferWithPin('user1', 'user2', 100.75)).rejects.toThrow('positive whole number');
    expect(prisma.coinTransfer.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('CAS debit of count 0 aborts the transfer and writes no ledger rows', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => {
      const tx = txMock();
      tx.wallet.updateMany.mockResolvedValue({ count: 0 }); // balance changed concurrently
      return cb(tx);
    });

    await expect(transferWithPin('user1', 'user2', 100)).rejects.toThrow('Insufficient coins');
  });

  test('requires a valid idempotency key at the service boundary', async () => {
    await expect(walletService.transferCoins('user1', 'user2', 100, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '1234'))
      .rejects.toThrow('requestId');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.coinTransfer.create).not.toHaveBeenCalled();
  });

  test('records before-and-after balances for both sides of a transfer', async () => {
    let tx: any;
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => {
      tx = txMock();
      return cb(tx);
    });

    await transferWithPin('user1', 'user2', 100, undefined, undefined, 'ip', undefined, 'ledger-snapshot-123');

    expect(tx.walletTransaction.create).toHaveBeenCalledTimes(2);
    expect(tx.walletTransaction.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user1',
        type: 'TRANSFER_SENT',
        balanceBefore: senderWallet.coinBalance,
        balance: senderWallet.coinBalance - 105,
      }),
    }));
    expect(tx.walletTransaction.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user2',
        type: 'TRANSFER_RECEIVED',
        balanceBefore: receiverWallet.coinBalance,
        balance: receiverWallet.coinBalance + 100,
      }),
    }));
  });

  test('returns the committed transfer when a requestId is retried (idempotent)', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(txMock()));
    const first = await transferWithPin('user1', 'user2', 100, 'note', undefined, 'ip', undefined, 'req-abc-123');
    expect(first.transfer.id).toBe('transfer1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    (prisma.coinTransfer.findUnique as jest.Mock).mockResolvedValue({ id: 'transfer1', senderId: 'user1', receiverId: 'user2', amount: 100, note: 'note' });
    const replay = await transferWithPin('user1', 'user2', 100, 'note', undefined, 'ip', undefined, 'req-abc-123');
    expect(replay.replayed).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('rejects reuse of an idempotency key for a different transfer intent', async () => {
    (prisma.coinTransfer.findUnique as jest.Mock).mockResolvedValue({
      id: 'transfer1', senderId: 'user1', receiverId: 'user3', amount: 100, note: 'note',
    });
    await expect(transferWithPin('user1', 'user2', 100, 'note', undefined, 'ip', undefined, 'req-abc-123'))
      .rejects.toThrow('requestId is already used for a different transfer');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('does not report a committed transfer as failed when notification delivery fails', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(txMock()));
    (notificationService.createNotification as jest.Mock).mockRejectedValueOnce(new Error('notification service unavailable'));

    await expect(transferWithPin('user1', 'user2', 100)).resolves.toMatchObject({
      transfer: { id: 'transfer1' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('enforces the daily limit inside the transaction', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, dailyLimit: 50, dailyUsed: 0, lastResetDate: new Date() });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(txMock()));

    await expect(transferWithPin('user1', 'user2', 100)).rejects.toThrow('Daily transfer limit');
  });
});

describe('WalletService.transferCoins — legacy OTP bypass blocked', () => {
  test('cannot complete a high-value transfer with a random 6-digit code and no challenge', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(transferWithPin('user1', 'user2', 2000, undefined, '123456', 'ip')).rejects.toThrow('An OTP challenge id is required');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('TransferOtpChallenge constants', () => {
  test('OTP policy is hard-coded to a safe configuration', () => {
    expect(TRANSFER_OTP_CONSTANTS.length).toBe(6);
    expect(TRANSFER_OTP_CONSTANTS.expiryMs).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(TRANSFER_OTP_CONSTANTS.maxAttempts).toBeLessThanOrEqual(5);
  });
});

describe('Wallet PIN transfer authorization and concurrent lockout', () => {
  test('refuses a transfer when the caller omits the wallet PIN', async () => {
    await expect(walletService.transferCoins('user1', 'user2', 100)).rejects.toThrow('wallet PIN is required');
    expect(prisma.coinTransfer.create).not.toHaveBeenCalled();
  });
  test('a valid PIN after lockout expiry resets the stale counter and lock timestamp', async () => {
    const expiredAt = new Date(Date.now() - 1000);
    (prisma.walletPIN.findUnique as jest.Mock).mockResolvedValue({ id: 'pin1', walletId: 'wallet1', pinHash: 'hashed_pin', failedAttempts: 5, lockedUntil: expiredAt });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    await expect(walletService.verifyPin('user1', '1234')).resolves.toEqual({ success: true, message: 'PIN verified' });
    expect(prisma.walletPIN.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pin1', failedAttempts: 5, lockedUntil: expiredAt }),
      data: { failedAttempts: 0, lockedUntil: null },
    }));
  });

  test('PIN updates use the shared lockout verifier before changing the hash', async () => {
    const verifySpy = jest.spyOn(walletService, 'verifyPin').mockRejectedValueOnce(new Error('PIN is locked'));
    await expect(walletService.updatePin('user1', '0000', '5678')).rejects.toThrow('PIN is locked');
    expect(verifySpy).toHaveBeenCalledWith('user1', '0000');
    expect(prisma.walletPIN.updateMany).not.toHaveBeenCalled();
    verifySpy.mockRestore();
  });

  test('PIN updates compare-and-swap the previously verified hash', async () => {
    const verifySpy = jest.spyOn(walletService, 'verifyPin').mockResolvedValue({ success: true, message: 'PIN verified' });
    (prisma.walletPIN.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    await expect(walletService.updatePin('user1', '1234', '5678')).resolves.toEqual({
      success: true, message: 'PIN updated successfully',
    });
    expect(verifySpy).toHaveBeenCalledWith('user1', '1234');
    expect(prisma.walletPIN.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pin1', pinHash: 'hashed_pin', failedAttempts: 0, lockedUntil: null },
      data: expect.objectContaining({ failedAttempts: 0, lockedUntil: null }),
    }));
    verifySpy.mockRestore();
  });

  test('atomic concurrent failures persist the lockout threshold', async () => {
    let attempts = 0;
    let lockedUntil: Date | null = null;
    (prisma.walletPIN.findUnique as jest.Mock).mockImplementation(async () => ({ id: 'pin1', walletId: 'wallet1', pinHash: 'hashed_pin', failedAttempts: attempts, lockedUntil }));
    (prisma.$queryRaw as jest.Mock).mockImplementation(async () => {
      if (lockedUntil && lockedUntil > new Date()) return [];
      attempts += 1;
      if (attempts >= 5) lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      return [{ failedAttempts: attempts, lockedUntil }];
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => walletService.verifyPin('user1', '0000')));
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(attempts).toBe(5);
    expect(lockedUntil).toBeInstanceOf(Date);
    await expect(walletService.verifyPin('user1', '1234')).rejects.toThrow('PIN is locked');
  });
});

test('valid PIN cannot authorize against a concurrently changed security snapshot', async () => {
  (prisma.walletPIN.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
  await expect(walletService.verifyPin('user1', '1234')).rejects.toThrow('PIN security state changed');
  expect(prisma.walletPIN.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ pinHash: 'hashed_pin', failedAttempts: 0, lockedUntil: null }) }));
});

describe('Transfer OTP challenge state fencing', () => {
  const challenge = () => ({
    id: 'challenge1', userId: 'user1', sessionId: 'session1', receiverId: 'user2',
    amount: 2100, otpHash: 'hashed_otp', expiresAt: new Date(Date.now() + 60_000),
    maxAttempts: 3, attempts: 2, consumedAt: null,
  });
  test('rejects a session-bound challenge when session is omitted', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue(challenge());
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(transferWithPin('user1', 'user2', 2000, undefined, '123456', 'ip', undefined, undefined, 'challenge1'))
      .rejects.toThrow('bound to another session');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
  test('rejects a correct OTP when concurrent consumption or failure changed the snapshot', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue(challenge());
    tx.transferOtpChallenge.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(transferWithPin('user1', 'user2', 2000, undefined, '123456', 'ip', undefined, undefined, 'challenge1', 'session1'))
      .rejects.toThrow('already been used');
    expect(tx.transferOtpChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ attempts: 2, maxAttempts: 3, otpHash: 'hashed_otp', sessionId: 'session1', expiresAt: { gte: expect.any(Date) } }),
    }));
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
  test('does not increment a stale failed attempt', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue(challenge());
    tx.transferOtpChallenge.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(transferWithPin('user1', 'user2', 2000, undefined, '000000', 'ip', undefined, undefined, 'challenge1', 'session1'))
      .rejects.toThrow('OTP challenge state changed');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.transferOtpChallenge.update).not.toHaveBeenCalled();
  });
  test('standalone OTP consumption must win the conditional update', async () => {
    (prisma.transferOtpChallenge.findUnique as jest.Mock).mockResolvedValue(challenge());
    (prisma.transferOtpChallenge.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await expect(walletService.verifyTransferOtp({ userId: 'user1', challengeId: 'challenge1', otpCode: '123456', sessionId: 'session1' }))
      .resolves.toEqual({ valid: false, reason: 'changed' });
  });
  test('standalone OTP rejects missing session without consuming', async () => {
    (prisma.transferOtpChallenge.findUnique as jest.Mock).mockResolvedValue(challenge());
    await expect(walletService.verifyTransferOtp({ userId: 'user1', challengeId: 'challenge1', otpCode: '123456' }))
      .resolves.toEqual({ valid: false, reason: 'session' });
    expect(prisma.transferOtpChallenge.updateMany).not.toHaveBeenCalled();
  });
});

describe('Financial authorization row fencing', () => {
  test('rejects changed PIN state before a low-value debit', async () => {
    const tx = txMock();
    tx.$queryRaw.mockResolvedValueOnce([]);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(transferWithPin('user1', 'user2', 100)).rejects.toThrow('PIN security state changed');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.coinTransfer.create).not.toHaveBeenCalled();
  });
  test('rejects changed authenticator state before a high-value debit or OTP consumption', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    const tx = txMock();
    tx.$queryRaw.mockResolvedValueOnce([]);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(transferWithPin('user1', 'user2', 2000, undefined, '123456', 'ip', undefined, undefined, 'challenge1', 'session1'))
      .rejects.toThrow('Authenticator security state changed');
    expect(tx.transferOtpChallenge.updateMany).not.toHaveBeenCalled();
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
});
