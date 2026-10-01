// ============================================================================
// ZERO-BONUS — LEGACY /api/monetization purchase path
//
// The canonical "Buy VANTA Coins" flow lives at /api/wallets/* (see
// coin-purchase-no-bonus.test.ts). This legacy monetization purchase path must
// follow the SAME business rule: a package credits EXACTLY its coin amount and
// there are ZERO bonus coins. Completion is server-guarded (simulate token in
// test mode; provider verification in live mode) so a client can never
// self-credit coins.
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
      findFirst: jest.fn(),
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

jest.mock('../services/wallet.service', () => ({
  walletService: { completeCoinPurchase: jest.fn() },
}));

const { walletService } = require('../services/wallet.service');

describe('MonetizationService legacy purchase — EXACT package amount, ZERO bonus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    delete process.env.VANTA_COIN_PAYMENT_MODE;
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
    // The order always stores the real database package id (FK-safe).
    expect(createdData.packageId).toBe('pkg_standard');
  });

  it('createPurchaseOrder rejects a package that is not a real/active database row', async () => {
    (prisma.sparkCoinPackage.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(monetizationService.createPurchaseOrder('user1', 'pkg_fake'))
      .rejects.toThrow('This purchase package is currently unavailable. Please try again.');
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('completePurchase cannot credit coins from a plain client request (live mode)', async () => {
    // Default (unset mode) resolves to LIVE. There is no simulate token and no
    // provider verification, so the completion must be refused.
    const order = {
      id: 'order1', userId: 'user1', coins: 5000, amount: 50,
      status: 'PENDING', paymentMethod: 'usdt-bep20',
    };
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(order);

    await expect(
      monetizationService.completePurchase('user1', order.id, { providerOrderId: 'live-ref', paymentMethod: 'usdt-bep20' })
    ).rejects.toThrow('This payment must be verified by the payment provider before coins are credited.');

    // Nothing was credited and the wallet service was never invoked.
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  it('completePurchase in TEST mode delegates to the verified/idempotent completion path', async () => {
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    const order = {
      id: 'order1', userId: 'user1', coins: 5000, amount: 50,
      status: 'PENDING', paymentMethod: 'usdt-bep20',
    };
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(order);
    (walletService.completeCoinPurchase as jest.Mock).mockResolvedValue({
      order: { ...order, status: 'COMPLETED' },
      coins: 5000,
      alreadyCompleted: false,
    });

    await monetizationService.completePurchase('user1', 'order1', { simulateToken: 'tok' });

    // The wallet credit (EXACT package/order coin amount) is performed by the
    // same atomic, idempotent completion used by the canonical Buy Coins flow.
    expect(walletService.completeCoinPurchase).toHaveBeenCalledWith(
      'user1',
      'order1',
      expect.objectContaining({ mode: 'test', simulateToken: 'tok' })
    );
  });

  it('completePurchase enforces order ownership (a user cannot complete another user order)', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      monetizationService.completePurchase('user1', 'order_other_user', {})
    ).rejects.toThrow('Purchase order not found');
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });
});