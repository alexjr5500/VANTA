/**
 * Wallet reconciliation tests (Phase 10).
 *
 * Reconcile must compute the ledger balance from WalletTransaction rows,
 * compare it to the stored balance, record an auditable log row, and NEVER
 * silently fix a discrepancy (optionally freezing the wallet instead).
 */
import { WalletService } from '../services/wallet.service';
import { prisma } from '../prisma';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => {
  const mock = {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    transferLimit: { create: jest.fn() },
    walletTransaction: { findMany: jest.fn() },
    walletAuditLog: { create: jest.fn() },
    walletReconciliationLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma: mock };
});

jest.mock('../services/notification.service', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue({}), notifyWithdrawalStatus: jest.fn() },
}));

const walletService = new WalletService();

const walletRow = { id: 'wallet1', userId: 'user1', coinBalance: 1_000, earningsBalance: 49.3, lockedCoins: 0, isFrozen: false };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
  (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(walletRow);
  (prisma.walletReconciliationLog.create as jest.Mock).mockImplementation(
    async ({ data }: { data: any }) => ({ id: 'rec1', ...data })
  );
  (prisma.walletAuditLog.create as jest.Mock).mockResolvedValue({});
});

describe('WalletService.reconcileWallet', () => {
  test('reports MATCH when the ledger equals the stored balance', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'PURCHASE', amount: 500, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'GIFT_RECEIVED', amount: 700, currency: 'VANTA', status: 'COMPLETED', metadata: JSON.stringify({ autoConverted: true, creatorEarningsUsd: 4.66 }) },
      { type: 'GIFT_SENT', amount: 200, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'WITHDRAWAL', amount: 0.7, currency: 'USD', status: 'PENDING' },
      { type: 'CREATOR_EARNING', amount: 50, currency: 'USD', status: 'COMPLETED' },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user1', currency: { in: ['VANTA', 'USD'] } },
    }));
    expect(result.status).toBe('MATCH');
    expect(result.ledgerBalance).toBe(1000); // +500 +700 -200
    expect(result.difference).toBe(0);
    expect(result.earningsStatus).toBe('MATCH');
    expect(result.storedEarningsBalance).toBe(49.3);
    expect(result.ledgerEarningsBalance).toBe(49.3);
    expect(prisma.walletReconciliationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'VANTA_COIN', status: 'MATCH', storedBalance: 1000, ledgerBalance: 1000 }) })
    );
    expect(prisma.walletReconciliationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'USD_CENTS', status: 'MATCH', storedBalance: 4930, ledgerBalance: 4930 }) })
    );
    expect(prisma.walletAuditLog.create).not.toHaveBeenCalled();
  });

  test('keeps legacy cash gift credits out of VANTA coins and in USD earnings', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'GIFT_RECEIVED', amount: 0.04, currency: 'VANTA', status: 'COMPLETED', metadata: JSON.stringify({ creatorEarningsUsd: 0.04, giftCoinValue: 6 }) },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(result.ledgerBalance).toBe(0);
    expect(result.ledgerEarningsBalance).toBe(0.04);
  });

  test('excludes failed, cancelled and reversed rows from the current USD earnings ledger', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'CREATOR_EARNING', amount: 49.3, currency: 'USD', status: 'COMPLETED' },
      { type: 'WITHDRAWAL', amount: 10, currency: 'USD', status: 'CANCELLED' },
      { type: 'CREATOR_EARNING', amount: 5, currency: 'USD', status: 'REVERSED' },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(result.earningsStatus).toBe('MATCH');
    expect(result.ledgerEarningsBalance).toBe(49.3);
  });

  test('normalizes legacy signed transaction amounts and ignores reversed coin rows', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'GIFT_SENT', amount: -100, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'GIFT_RECEIVED', amount: 80, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'GIFT_RECEIVED', amount: 20, currency: 'VANTA', status: 'REVERSED' },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(result.ledgerBalance).toBe(-20);
  });

  test('reports DISCREPANCY, audits it, and never mutates the stored balance', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'PURCHASE', amount: 500 },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(result.status).toBe('DISCREPANCY');
    expect(result.storedBalance).toBe(1000);
    expect(result.ledgerBalance).toBe(500);
    expect(result.difference).toBe(500);
    expect(prisma.walletReconciliationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISCREPANCY', difference: 500 }) })
    );
    // Audited, not fixed.
    const auditCall = (prisma.walletAuditLog.create as jest.Mock).mock.calls[0];
    expect(auditCall[0].data.action).toBe('RECONCILIATION_DISCREPANCY');
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  test('uses one repeatable-read snapshot for balance, ledger and audit evidence', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'PURCHASE', amount: 1500, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'REFUND', amount: -600, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'REFUND', amount: 100, currency: 'VANTA', status: 'COMPLETED' },
      { type: 'CREATOR_EARNING', amount: 49.3, currency: 'USD', status: 'COMPLETED' },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(result.status).toBe('MATCH');
    expect(result.ledgerBalance).toBe(1000);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }));
  });

  test('rejects automated freezing before any wallet or ledger query', async () => {
    await expect(walletService.reconcileAllWallets({ freezeOnDiscrepancy: true }))
      .rejects.toThrow('Automatic reconciliation freeze is disabled');
    expect(prisma.wallet.findMany).not.toHaveBeenCalled();
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
  });

  test('does not create a missing wallet during reconciliation', async () => {
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(walletService.reconcileWallet('missing')).rejects.toThrow('Wallet not found');
    expect(prisma.wallet.create).not.toHaveBeenCalled();
    expect(prisma.walletReconciliationLog.create).not.toHaveBeenCalled();
  });
});
