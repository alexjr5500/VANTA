/**
 * Withdrawal state machine tests (Phase 9).
 *
 * Guards against: duplicate processing, concurrent rejection (double refund),
 * invalid state transitions, and non-owner cancellation.
 */
import { WalletService } from '../services/wallet.service';
import { prisma } from '../prisma';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => {
  const mock = {
    wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    transferLimit: { create: jest.fn() },
    withdrawal: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    walletTransaction: { create: jest.fn(), updateMany: jest.fn() },
    walletAuditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma: mock };
});

jest.mock('../services/notification.service', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue({}), notifyWithdrawalStatus: jest.fn() },
}));

const walletService = new WalletService();

const walletRow: any = {
  id: 'wallet1', userId: 'user1', coinBalance: 0, earningsBalance: 200,
  totalWithdrawn: 0, totalCoinsPurchased: 0, totalCoinsReceived: 0, totalCoinsSent: 0,
  totalGiftsSent: 0, totalGiftsReceived: 0, lifetimeEarnings: 0, bonusCoins: 0,
  lockedCoins: 0, isFrozen: false, usdtWalletAddress: null,
};

const pendingWithdrawal = { id: 'wd1', userId: 'user1', amount: 100, fee: 10, netAmount: 90, status: 'PENDING', walletAddress: '0xabc', createdAt: new Date() };

function txMock() {
  return {
    wallet: {
      update: jest.fn().mockResolvedValue({ ...walletRow, earningsBalance: 100 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(walletRow),
    },
    withdrawal: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'wd1', ...pendingWithdrawal }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pendingWithdrawal),
    },
    walletTransaction: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    walletAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(walletRow);
  (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(pendingWithdrawal);
  (prisma.withdrawal.findUniqueOrThrow as jest.Mock).mockResolvedValue(pendingWithdrawal);
});
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(walletRow);
  (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(pendingWithdrawal);
  (prisma.withdrawal.findUniqueOrThrow as jest.Mock).mockResolvedValue(pendingWithdrawal);
});

describe('WalletService.requestWithdrawal', () => {
  test('creates a PENDING withdrawal and debits earnings once', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    const result = await walletService.requestWithdrawal('user1', 100, '0xabc');

    expect(result.status).toBe('PENDING');
    expect(tx.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user1', earningsBalance: { gte: 100 } }) })
    );
    expect(tx.withdrawal.create).toHaveBeenCalledTimes(1);
  });

  test('aborts when the earnings balance cannot cover the amount (CAS count 0)', async () => {
    const tx = txMock();
    tx.wallet.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.requestWithdrawal('user1', 100, '0xabc')).rejects.toThrow('Insufficient earnings balance');
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });
});

describe('WalletService.processWithdrawal', () => {
  test('a second concurrent approval cannot succeed (CAS count 0)', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.processWithdrawal('wd1', 'admin1')).rejects.toThrow('Withdrawal can only be processed once');
    expect(tx.walletTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.walletAuditLog.create).not.toHaveBeenCalled();
  });
});
describe('WalletService.rejectWithdrawal', () => {
  test('rejects a PENDING withdrawal and refunds earnings exactly once', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    tx.withdrawal.findUniqueOrThrow.mockResolvedValue({ ...pendingWithdrawal, status: 'FAILED' });
    const result = await walletService.rejectWithdrawal('wd1', 'admin1', 'policy');
    expect(result.status).toBe('FAILED');
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ earningsBalance: { increment: 100 } }) })
    );
  });

  test('a concurrent double-rejection is impossible', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.rejectWithdrawal('wd1', 'admin2', 'duplicate')).rejects.toThrow('Withdrawal can only be rejected once');
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});

describe('WalletService.cancelWithdrawal', () => {
  test('only the owner can cancel', async () => {
    (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(pendingWithdrawal);
    await expect(walletService.cancelWithdrawal('wd1', 'attacker')).rejects.toThrow('only cancel your own');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('cancels a PENDING withdrawal and refunds once', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    tx.withdrawal.findUniqueOrThrow.mockResolvedValue({ ...pendingWithdrawal, status: 'CANCELLED' });
    const result = await walletService.cancelWithdrawal('wd1', 'user1');
    expect(result.status).toBe('CANCELLED');
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ earningsBalance: { increment: 100 } }) })
    );
  });

  test('cannot cancel a non-PENDING withdrawal', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.cancelWithdrawal('wd1', 'user1')).rejects.toThrow('can no longer be cancelled');
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});
