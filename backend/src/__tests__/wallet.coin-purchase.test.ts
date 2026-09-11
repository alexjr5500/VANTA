import { WalletService, TX_TYPES } from '../services/wallet.service';
import { prisma } from '../prisma';
import { verifyCoinPaymentSimulateToken, COIN_PAYMENT_MODE, COIN_PAYMENT_CREDITABLE_STATUSES } from '../config/coin-payments.config';

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
  coins: 500,
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

  test('credits coins exactly once and marks the order COMPLETED (test mode)', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
    });
    (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.wallet.update as jest.Mock).mockResolvedValue({
      id: 'wallet1', coinBalance: 600, totalCoinsPurchased: 500,
    });
    (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });
    (prisma.walletAuditLog.create as jest.Mock).mockResolvedValue({ id: 'audit1' });

    const token = require('../config/coin-payments.config').createCoinPaymentSimulateToken(PENDING_ORDER);
    const result = await walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: token,
    });

    expect(result.alreadyCompleted).toBe(false);
    expect(result.coins).toBe(500);
    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order_test_1', userId: 'user1', status: { in: [...COIN_PAYMENT_CREDITABLE_STATUSES] } },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      data: { coinBalance: { increment: 500 }, totalCoinsPurchased: { increment: 500 } },
    });
    // Ledger entry created exactly once, with the auditable balanceBefore.
    expect(prisma.walletTransaction.create).toHaveBeenCalledTimes(1);
    const ledgerData = (prisma.walletTransaction.create as jest.Mock).mock.calls[0][0].data;
    expect(ledgerData.type).toBe(TX_TYPES.PURCHASE);
    expect(ledgerData.amount).toBe(500);
    expect(ledgerData.balanceBefore).toBe(100);
    expect(ledgerData.balance).toBe(600);
    expect(ledgerData.reference).toBe('order_test_1');
    const metadata = JSON.parse(ledgerData.metadata);
    expect(metadata.mode).toBe('test');
    expect(metadata.providerOrderId).toBe('test:order_test_1');
    // Audit trail record written.
    expect(prisma.walletAuditLog.create).toHaveBeenCalledTimes(1);
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

  test('a PENDING order (never verified) does NOT credit coins', async () => {
    // Without the signed simulate token the backend refuses to treat the order
    // as paid, so no coins are ever created from a mere PENDING row.
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);

    await expect(walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
    })).rejects.toThrow('Invalid test payment confirmation');
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });

  test('an EXPIRED/FAILED order is never completed', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, status: 'FAILED' });

    await expect(walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: 'anything',
    })).rejects.toThrow('cannot be completed');
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });

  test('database-transaction failure rolls back and never credits', async () => {
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      id: 'wallet1', userId: 'user1', coinBalance: 100, isFrozen: false,
    });
    const token = require('../config/coin-payments.config').createCoinPaymentSimulateToken(PENDING_ORDER);
    // Simulate a mid-transaction DB failure: $transaction throws and nothing
    // after it (wallet credit, ledger, audit) may run.
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB locked'));

    await expect(walletService.completeCoinPurchase('user1', PENDING_ORDER.id, {
      mode: COIN_PAYMENT_MODE.TEST,
      simulateToken: token,
    })).rejects.toThrow('DB locked');

    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect(prisma.walletAuditLog.create).not.toHaveBeenCalled();
  });
});
describe('coin-payments config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
  });

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

  test('test mode does not require a live payment address', () => {
    const { validateCoinPaymentConfig } = require('../config/coin-payments.config');
    delete process.env.VANTA_COIN_PAYMENT_ADDRESS;
    const config = validateCoinPaymentConfig();
    expect(config.isTestMode).toBe(true);
    expect(config.errors).toEqual([]);
  });

  test('live mode requires a valid payment address', () => {
    const { validateCoinPaymentConfig } = require('../config/coin-payments.config');
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    delete process.env.VANTA_COIN_PAYMENT_ADDRESS;
    const config = validateCoinPaymentConfig();
    expect(config.mode).toBe('live');
    expect(config.errors.length).toBeGreaterThan(0);
  });

  test('live mode with a malformed address is a hard configuration error', () => {
    const { validateCoinPaymentConfig, isValidCoinPaymentDepositAddress } = require('../config/coin-payments.config');
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    expect(isValidCoinPaymentDepositAddress('not-an-address')).toBe(false);
    expect(isValidCoinPaymentDepositAddress('0x1234')).toBe(false);
    expect(isValidCoinPaymentDepositAddress('0x' + 'a'.repeat(40))).toBe(true);
    process.env.VANTA_COIN_PAYMENT_ADDRESS = '0x1234';
    const config = validateCoinPaymentConfig();
    expect(config.errors.length).toBeGreaterThan(0);
  });

  test('valid EVM address passes live validation', () => {
    const { validateCoinPaymentConfig } = require('../config/coin-payments.config');
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    process.env.VANTA_COIN_PAYMENT_ADDRESS = '0x' + 'b'.repeat(40);
    const config = validateCoinPaymentConfig();
    expect(config.errors).toEqual([]);
  });
});
