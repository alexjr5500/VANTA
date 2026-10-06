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
  };
  return { prisma: mock };
});

jest.mock('../services/notification.service', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue({}), notifyWithdrawalStatus: jest.fn() },
}));

const walletService = new WalletService();

const walletRow = { id: 'wallet1', userId: 'user1', coinBalance: 1_000, lockedCoins: 0, isFrozen: false };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(walletRow);
  (prisma.walletReconciliationLog.create as jest.Mock).mockImplementation(
    async ({ data }: { data: any }) => ({ id: 'rec1', ...data })
  );
  (prisma.walletAuditLog.create as jest.Mock).mockResolvedValue({});
});

describe('WalletService.reconcileWallet', () => {
  test('reports MATCH when the ledger equals the stored balance', async () => {
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
      { type: 'PURCHASE', amount: 500 },
      { type: 'GIFT_RECEIVED', amount: 700 },
      { type: 'GIFT_SENT', amount: 200 },
    ]);
    const result = await walletService.reconcileWallet('user1');
    expect(result.status).toBe('MATCH');
    expect(result.ledgerBalance).toBe(1000); // +500 +700 -200
    expect(result.difference).toBe(0);
    expect(prisma.walletReconciliationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'MATCH', storedBalance: 1000, ledgerBalance: 1000 }) })
    );
    expect(prisma.walletAuditLog.create).not.toHaveBeenCalled();
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

  test('reconcileAllWallets can freeze a discrepant wallet with an auditable reason', async () => {
    (prisma.wallet.findMany as jest.Mock).mockResolvedValue([{ id: 'wallet1', userId: 'user1', coinBalance: 1000 }]);
    (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([{ type: 'PURCHASE', amount: 100 }]);
    (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await walletService.reconcileAllWallets({ freezeOnDiscrepancy: true });

    expect(result.checked).toBe(1);
    expect(result.discrepancies).toBe(1);
    expect(result.frozen).toBe(1);
    const freezeCall = (prisma.wallet.updateMany as jest.Mock).mock.calls[0];
    expect(freezeCall[0].data.isFrozen).toBe(true);
    expect(freezeCall[0].data.frozenBy).toBe('system:reconciliation');
  });
});