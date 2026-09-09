import { WalletService, TX_TYPES } from '../services/wallet.service';
import { prisma } from '../prisma';
import { verifyCoinPaymentSimulateToken, COIN_PAYMENT_MODE } from '../config/coin-payments.config';

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
    transferLimit: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    walletPIN: {
      findUnique: jest.fn(),
    },
    withdrawal: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    fraudAlert: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn({ ...prisma })),
  },
}));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    notifyWithdrawalStatus: jest.fn(),
    createNotification: jest.fn(),
  },
}));

const walletService = new WalletService();

const PENDING_ORDER: any = {
  id: 'order_test_1',
  userId: 'user1',
  coins: 525,
  amount: 5,
  currency: 'USD',
  provider: 'test',
  status: 'PENDING',
  paymentMethod: 'usdt-bep20',
  createdAt: new Date(),
};

describe('WalletService.completeCoinPurchase (test payment mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
  });

  test('credits coins once and marks the order COMPLETED (test mode)', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
    });
    (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.wallet.update as jest.Mock).mockResolvedValue({
      id: 'wallet1', coinBalance: 625, totalCoinsPurchased: 525,
    });
    (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });
    (prisma.walletAuditLog.create as jest.Mock).mockResolvedValue({ id: 'audit1' });

    const token = require('../config/coin-payments.config').createCoinPaymentSimulateToken(PENDING_ORDER);
    const result = await walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: token,
    });

    expect(result.alreadyCompleted).toBe(false);
    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order_test_1', userId: 'user1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      data: { coinBalance: { increment: 525 }, totalCoinsPurchased: { increment: 525 } },
    });
    expect(prisma.walletTransaction.create).toHaveBeenCalledTimes(1);
  });

  test('rejects a forged (non-HMAC) simulate token', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);

    await expect(walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: 'forged-token',
    })).rejects.toThrow('Invalid test payment confirmation');
  });

  test('is idempotent: an already COMPLETED order is never credited twice', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, status: 'COMPLETED' });

    const result = await walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: 'anything',
    });

    expect(result.alreadyCompleted).toBe(true);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });

  test('does not credit when the conditional claim wins nothing (concurrent replay)', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
    });
    (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, status: 'COMPLETED' });

    const token = require('../config/coin-payments.config').createCoinPaymentSimulateToken(PENDING_ORDER);
    const result = await walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: token,
    });

    expect(result.alreadyCompleted).toBe(true);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });
});

describe('coin-payments config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('simulate token verifies and is order-bound', () => {
    const { createCoinPaymentSimulateToken } = require('../config/coin-payments.config');
    const token = createCoinPaymentSimulateToken(PENDING_ORDER);
    expect(verifyCoinPaymentSimulateToken(PENDING_ORDER, token)).toBe(true);
    expect(verifyCoinPaymentSimulateToken({ ...PENDING_ORDER, amount: 99 }, token)).toBe(false);
    expect(verifyCoinPaymentSimulateToken(PENDING_ORDER, 'nope')).toBe(false);
  });

  test('test mode is never honored in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    const { getCoinPaymentMode } = require('../config/coin-payments.config');
    expect(getCoinPaymentMode()).toBe('live');
  });
});