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
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => {
  const mock = {
    wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    transferLimit: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    transferOtpChallenge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    coinTransfer: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    walletTransaction: { create: jest.fn() },
    walletAuditLog: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma: mock };
});

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

const senderWallet: any = { id: 'wallet1', userId: 'user1', coinBalance: 1_000_000, earningsBalance: 0, totalCoinsPurchased: 0, totalCoinsReceived: 0, totalCoinsSent: 0, totalGiftsSent: 0, totalGiftsReceived: 0, totalWithdrawn: 0, lifetimeEarnings: 0, bonusCoins: 0, lockedCoins: 0, isFrozen: false, usdtWalletAddress: null };

const receiverWallet: any = { id: 'wallet2', userId: 'user2', coinBalance: 0, earningsBalance: 0, totalCoinsReceived: 0, totalCoinsSent: 0, totalGiftsReceived: 0, lockedCoins: 0, isFrozen: false };

const defaultLimit: any = { id: 'limit1', walletId: 'wallet1', dailyLimit: 10_000_000, dailyUsed: 0, lastResetDate: new Date(), singleTxLimit: 10_000_000, otpThreshold: 10_000 };

const senderInfo = { id: 'user1', username: 'alice', displayName: 'Alice' };
const receiverInfo = { id: 'user2', username: 'bob', displayName: 'Bob' };

function txMock() {
  return {
    wallet: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(senderWallet),
      update: jest.fn().mockResolvedValue(receiverWallet),
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
  (prisma.wallet.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { userId: string } }) =>
    where.userId === 'user1' ? senderWallet : receiverWallet
  );
  (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue(defaultLimit);
  (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'user1' ? senderInfo : receiverInfo
  );
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

    const result = await walletService.transferCoins('user1', 'user2', 2000);

    expect(result.requiresOTP).toBe(true);
    expect(result.challengeId).toBe('challenge1');
    expect(prisma.transferOtpChallenge.create).toHaveBeenCalledTimes(1);
    const challengeData = (prisma.transferOtpChallenge.create as jest.Mock).mock.calls[0][0].data;
    expect(challengeData.otpHash).toBe('hashed_otp'); // never plaintext
    expect(challengeData.receiverId).toBe('user2');
    expect(challengeData.amount).toBe(2100); // 100 + 5% fee — intent bound to total deduction
    expect(notificationService.createNotification).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an invalid OTP inside the transaction and aborts the transfer', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const tx = txMock();
    tx.transferOtpChallenge.findUnique.mockResolvedValue({
      id: 'challenge1', userId: 'user1', sessionId: 'session1', receiverId: 'user2', amount: 2100,
      otpHash: 'hashed_wrong', expiresAt: new Date(Date.now() + 60_000), maxAttempts: 3, attempts: 0, consumedAt: null,
    });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(
      walletService.transferCoins('user1', 'user2', 2000, undefined, '000000', '127.0.0.1', undefined, undefined, 'challenge1', 'session1')
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
      walletService.transferCoins('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1')
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
      walletService.transferCoins('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1')
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

    const result = await walletService.transferCoins('user1', 'user2', 2000, undefined, '123456', '127.0.0.1', undefined, undefined, 'challenge1', 'session1');

    expect(result.transfer.id).toBe('transfer1');
    expect(tx.transferOtpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'challenge1', consumedAt: null }), data: expect.objectContaining({ consumedAt: expect.any(Date) }) })
    );
    const debitCall = (tx.wallet.updateMany as jest.Mock).mock.calls[0];
    expect(debitCall[0].where).toEqual(expect.objectContaining({ userId: 'user1', isFrozen: false, coinBalance: { gte: 2100 } }));
  });
});
describe('WalletService.transferCoins — concurrency & idempotency (Phase 4)', () => {
  test('rejects a transfer above the platform maximum', async () => {
    await expect(walletService.transferCoins('user1', 'user2', PLATFORM_TRANSFER_LIMITS.maxPerTransfer + 1)).rejects.toThrow('platform maximum');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('preflight rejects an insufficient balance before touching the ledger', async () => {
    (prisma.wallet.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { userId: string } }) => ({
      ...senderWallet, userId: where.userId, coinBalance: 10, lockedCoins: 0,
    }));

    await expect(walletService.transferCoins('user1', 'user2', 100)).rejects.toThrow('Insufficient balance');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('CAS debit of count 0 aborts the transfer and writes no ledger rows', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => {
      const tx = txMock();
      tx.wallet.updateMany.mockResolvedValue({ count: 0 }); // balance changed concurrently
      return cb(tx);
    });

    await expect(walletService.transferCoins('user1', 'user2', 100)).rejects.toThrow('Insufficient coins');
  });

  test('returns the committed transfer when a requestId is retried (idempotent)', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(txMock()));
    const first = await walletService.transferCoins('user1', 'user2', 100, 'note', undefined, 'ip', undefined, 'req-abc-123');
    expect(first.transfer.id).toBe('transfer1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    (prisma.coinTransfer.findUnique as jest.Mock).mockResolvedValue({ id: 'transfer1', senderId: 'user1', amount: 100 });
    const replay = await walletService.transferCoins('user1', 'user2', 100, 'note', undefined, 'ip', undefined, 'req-abc-123');
    expect(replay.replayed).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('enforces the daily limit inside the transaction', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, dailyLimit: 50, dailyUsed: 0, lastResetDate: new Date() });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(txMock()));

    await expect(walletService.transferCoins('user1', 'user2', 100)).rejects.toThrow('Daily transfer limit');
  });
});

describe('WalletService.transferCoins — legacy OTP bypass blocked', () => {
  test('cannot complete a high-value transfer with a random 6-digit code and no challenge', async () => {
    (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ ...defaultLimit, otpThreshold: 1000 });
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.transferCoins('user1', 'user2', 2000, undefined, '123456', 'ip')).rejects.toThrow('An OTP challenge id is required');
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
