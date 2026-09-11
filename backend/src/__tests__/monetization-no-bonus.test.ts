// ============================================================================
// ZERO-BONUS — LEGACY /api/monetization purchase path
//
// The canonical "Buy VANTA Coins" flow lives at /api/wallets/* (see
// coin-purchase-no-bonus.test.ts). This legacy monetization purchase path must
// follow the SAME business rule: a package credits EXACTLY its coin amount and
// there are ZERO bonus coins.
// ============================================================================

import { monetizationService } from '../services/monetization.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    sparkCoinPackage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      upsert: jest.fn(),
    },
    walletTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn((txs: any[]) => Promise.all(txs)),
  },
}));

jest.mock('../services/notification.service', () => ({
  notificationService: { createNotification: jest.fn() },
  setNotificationIO: jest.fn(),
}));

describe('MonetizationService legacy purchase — EXACT package amount, ZERO bonus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createPurchaseOrder persists EXACTLY the package coin amount (never coins + bonus)', async () => {
    const pkg = {
      id: 'pkg_standard', name: 'Standard', coins: 1000, price: 10, isActive: true,
      bonusCoins: 999999, // even a legacy non-zero bonus field must be ignored
    };
    (prisma.sparkCoinPackage.findUnique as jest.Mock).mockResolvedValue(pkg);
    (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue({ id: 'order1' });

    await monetizationService.createPurchaseOrder('user1', pkg.id);

    const createdData = (prisma.purchaseOrder.create as jest.Mock).mock.calls[0][0].data;
    // coinsCredited = package.coinAmount EXACTLY — bonus never added.
    expect(createdData.coins).toBe(1000);
    expect(createdData.amount).toBe(10);
  });

  it('completePurchase credits the wallet and ledger with EXACTLY the order.coins (package amount)', async () => {
    const order = {
      id: 'order1', userId: 'user1', coins: 5000, amount: 50,
      status: 'PENDING', paymentMethod: 'usdt-bep20',
    };
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(order);
    (prisma.purchaseOrder.update as jest.Mock).mockResolvedValue({ ...order, status: 'COMPLETED' });
    (prisma.wallet.upsert as jest.Mock).mockResolvedValue({ id: 'wallet1', coinBalance: 5000 });
    (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });

    await monetizationService.completePurchase(order.id, 'live-ref', 'usdt-bep20');

    // Wallet credited EXACTLY the package amount.
    expect(prisma.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { coinBalance: { increment: 5000 } },
      })
    );
    // Ledger records the EXACT purchased amount.
    expect(prisma.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 5000 }),
      })
    );
  });
});