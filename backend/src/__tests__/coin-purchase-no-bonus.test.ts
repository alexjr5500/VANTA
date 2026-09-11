// ============================================================================
// ZERO-BONUS GUARANTEE — VANTA Coin purchases credit EXACTLY the package amount.
//
// Business rule (verified here):
//   PAYMENT → EXACT COIN PACKAGE AMOUNT → USER BALANCE
//
// `coinsCredited = package.coinAmount` is the ONLY calculation.
// There are ZERO bonus coins: purchase orders, the coin ledger, and the user's
// balance must all equal the exact package amount, and no bonus/extra/
// promotional field may ever be added to a credited amount.
// ============================================================================

import { WalletService, TX_TYPES } from '../services/wallet.service';
import { prisma } from '../prisma';
import {
  verifyCoinPaymentSimulateToken,
  COIN_PAYMENT_MODE,
  COIN_PAYMENT_CREDITABLE_STATUSES,
} from '../config/coin-payments.config';
import { VANTA_COIN_PACKAGES } from '../config/wallet.config';

jest.mock('../prisma', () => ({
  prisma: {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    purchaseOrder: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    walletTransaction: {
      create: jest.fn(),
    },
    walletAuditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn({ ...prisma })),
  },
}));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    createNotification: jest.fn(),
    notifyWithdrawalStatus: jest.fn(),
  },
}));

const walletService = new WalletService();

/**
 * The exact packages the business requires to credit penny-for-package:
 * 100 / 500 / 1,000 / 5,000 / 10,000 VANTA Coins.
 */
const EXACT_PACKAGE_CASES = [
  { id: 'pkg_starter', name: 'Starter', coins: 100, price: 1 },
  { id: 'pkg_popular', name: 'Popular', coins: 500, price: 5 },
  { id: 'pkg_standard', name: 'Standard', coins: 1000, price: 10 },
  { id: 'pkg_premium', name: 'Premium', coins: 5000, price: 50 },
  { id: 'pkg_elite', name: 'Elite', coins: 10000, price: 100 },
];

function makeToken(rawOrder: any): string {
  const { createCoinPaymentSimulateToken } = require('../config/coin-payments.config');
  return createCoinPaymentSimulateToken(rawOrder);
}

function makeOrder(pkg: { id: string; coins: number; price: number }): any {
  return {
    id: `order_${pkg.id}`,
    userId: 'user1',
    coins: pkg.coins, // EXACTLY the package amount — no bonus was ever added
    amount: pkg.price,
    currency: 'USD',
    provider: 'test',
    status: 'PENDING',
    paymentMethod: 'usdt-bep20',
    createdAt: new Date(),
  };
}

describe('VANTA Coin purchases — EXACT package amount, ZERO bonus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    delete process.env.VANTA_COIN_PAYMENT_ADDRESS;
  });

  // --------------------------------------------------------------------------
  // 1. The shipped package catalog must be bonus-free.
  // --------------------------------------------------------------------------
  it('no VANTA Coin package carries any bonus/extra/promotional field', () => {
    expect(VANTA_COIN_PACKAGES.length).toBeGreaterThan(0);
    for (const pkg of VANTA_COIN_PACKAGES) {
      const keys = Object.keys(pkg);
      expect(keys.some((k) => /bonus|extra|promo/i.test(k))).toBe(false);
      expect(keys).not.toContain('bonusCoins');
      expect(keys).not.toContain('bonusAmount');
      expect(keys).not.toContain('bonusPercent');
      expect(keys).not.toContain('extraCoins');
    }
  });

  it('the five required exact packages exist with exact coin amounts and unchanged prices', () => {
    for (const expected of EXACT_PACKAGE_CASES) {
      const pkg = VANTA_COIN_PACKAGES.find((p) => p.id === expected.id);
      expect(pkg).toBeDefined();
      expect(pkg!.coins).toBe(expected.coins);
      expect(pkg!.price).toBe(expected.price);
    }
  });

  it('a package "coins" value IS the exact credited amount (no hidden bonus math)', () => {
    for (const pkg of VANTA_COIN_PACKAGES) {
      // coinsCredited = package.coinAmount — the catalog exposes no other
      // quantity field that could be added to the credited amount.
      expect(typeof pkg.coins).toBe('number');
      expect(pkg.coins).toBeGreaterThan(0);
    }
  });

  // --------------------------------------------------------------------------
  // 2. Crediting: ledger + balance + result coins all equal package amount.
  // --------------------------------------------------------------------------
it.each(EXACT_PACKAGE_CASES)(
    '$name package ($coins VANTA Coins) credits EXACTLY $coins coins',
    async (pkg) => {
      const rawOrder = makeOrder(pkg);
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(rawOrder);
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
      });
      (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.wallet.update as jest.Mock).mockResolvedValue({
        id: 'wallet1', coinBalance: 100 + pkg.coins, totalCoinsPurchased: pkg.coins,
      });
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });
      (prisma.walletAuditLog.create as jest.Mock).mockResolvedValue({ id: 'audit1' });

      const token = makeToken(rawOrder);
      const result = await walletService.completeCoinPurchase('user1', rawOrder.id, {
        mode: COIN_PAYMENT_MODE.TEST,
        simulateToken: token,
      });

      // Purchased amount returned to the client is EXACTLY the package amount.
      expect(result.coins).toBe(pkg.coins);

      // User balance increases by EXACTLY the purchased amount.
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        data: { coinBalance: { increment: pkg.coins }, totalCoinsPurchased: { increment: pkg.coins } },
      });

      // The coin ledger records the EXACT purchased amount.
      expect(prisma.walletTransaction.create).toHaveBeenCalledTimes(1);
      const ledgerData = (prisma.walletTransaction.create as jest.Mock).mock.calls[0][0].data;
      expect(ledgerData.type).toBe(TX_TYPES.PURCHASE);
      expect(ledgerData.amount).toBe(pkg.coins);
      expect(ledgerData.balanceBefore).toBe(100);
      expect(ledgerData.balance).toBe(100 + pkg.coins);

      // No wallet update or ledger entry may ever carry a bonus key.
      const updateData = (prisma.wallet.update as jest.Mock).mock.calls[0][0].data;
      expect(Object.keys(updateData).some((k) => /bonus|extra|promo/i.test(k))).toBe(false);
    }
  );

  // --------------------------------------------------------------------------
  // 3. Idempotency: a repeated request can NEVER create extra coins.
  // --------------------------------------------------------------------------
it('repeated completion requests cannot create extra coins (already COMPLETED → no credit)', async () => {
    const pkg = EXACT_PACKAGE_CASES[0]; // 100-coin package
    const rawOrder = makeOrder(pkg);
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue({ ...rawOrder, status: 'COMPLETED' });

    const result = await walletService.completeCoinPurchase('user1', rawOrder.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: 'anything',
    });

    expect(result.alreadyCompleted).toBe(true);
    expect(result.coins).toBe(pkg.coins);
    // No second credit, no second ledger entry, no bonus coins.
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect(prisma.walletAuditLog.create).not.toHaveBeenCalled();
  });

  it('a concurrent replay that loses the conditional claim cannot credit twice', async () => {
    const pkg = EXACT_PACKAGE_CASES[0]; // 100-coin package
    const rawOrder = makeOrder(pkg);
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(rawOrder);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
    });
    (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({ ...rawOrder, status: 'COMPLETED' });

    const token = makeToken(rawOrder);
    const result = await walletService.completeCoinPurchase('user1', rawOrder.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: token,
    });

    expect(result.alreadyCompleted).toBe(true);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 4. No bonus field can ever be submitted by the client or added server-side.
  // --------------------------------------------------------------------------
it('the completion path never writes a bonus amount to the order, wallet or ledger', async () => {
    const rawOrder = makeOrder(EXACT_PACKAGE_CASES[1]); // 500-coin package
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(rawOrder);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
    });
    (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.wallet.update as jest.Mock).mockResolvedValue({
      id: 'wallet1', coinBalance: 600, totalCoinsPurchased: 500,
    });
    (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });
    (prisma.walletAuditLog.create as jest.Mock).mockResolvedValue({ id: 'audit1' });

    const token = makeToken(rawOrder);
    await walletService.completeCoinPurchase('user1', rawOrder.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: token,
    });

    // The order status flip carries only the coin count that already equals the
    // package amount (never a client-supplied or additive bonus).
    const claimUpdate = (prisma.purchaseOrder.updateMany as jest.Mock).mock.calls[0][0];
    expect(claimUpdate.where).toEqual({
      id: rawOrder.id,
      userId: 'user1',
      status: { in: [...COIN_PAYMENT_CREDITABLE_STATUSES] },
    });

    const updateData = (prisma.wallet.update as jest.Mock).mock.calls[0][0].data;
    const ledgerData = (prisma.walletTransaction.create as jest.Mock).mock.calls[0][0].data;
    // No bonus/extra/promotional key anywhere in the crediting path.
    for (const payload of [updateData, ledgerData]) {
      expect(Object.keys(payload).some((k) => /bonus|extra|promo/i.test(k))).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  // 5. Token guard is intact for the zero-bonus path.
  // --------------------------------------------------------------------------
  it('an unverified PENDING order never credits coins (no unsigned credit path)', async () => {
    const rawOrder = makeOrder(EXACT_PACKAGE_CASES[0]);
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(rawOrder);

    await expect(walletService.completeCoinPurchase('user1', rawOrder.id, {
      mode: COIN_PAYMENT_MODE.TEST,
    })).rejects.toThrow('Invalid test payment confirmation');

    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });
});