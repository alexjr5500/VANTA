import { prisma } from '../prisma';
import { walletService } from '../services/wallet.service';
import { buyBadgeWithCoins } from '../services/shop-coin-badge.service';
import { badgeCoinCost, shopCoinBadgeEnabled } from '../config/shop-coin-badge.config';

jest.mock('../prisma', () => ({ prisma: {
  verificationPurchase: { findUnique: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('../services/wallet.service', () => ({
  walletService: { verifyPin: jest.fn() },
  resolveAvailableCoins: (w: { coinBalance: number; lockedCoins: number }) => Math.max(0, w.coinBalance - w.lockedCoins),
  TX_TYPES: { SUBSCRIPTION: 'SUBSCRIPTION' },
}));
jest.mock('../services/shop-gift.service', () => ({
  resolveShopGiftRecipient: jest.fn(async (_payer: string, target: unknown) => typeof target === 'string' ? target : null),
}));

const request = { planId: 'plan_blue_1month', expectedCoins: 199, requestKey: 'test_request_00001', pin: '1234' };
const wallet = { id: 'wallet1', coinBalance: 400, lockedCoins: 100, isFrozen: false };
const tx = {
  subscriptionPlan: { findUnique: jest.fn() },
  user: { updateMany: jest.fn() },
  verificationBadge: { findUnique: jest.fn(), upsert: jest.fn() },
  creatorMembership: { findUnique: jest.fn(), upsert: jest.fn() },
  wallet: { findUnique: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  verificationPurchase: { create: jest.fn() },
  walletTransaction: { create: jest.fn() },
  walletAuditLog: { create: jest.fn() },
  verificationHistory: { create: jest.fn() },
};
describe('Coin-funded badge checkout', () => {
  const oldEnv = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    process.env.VANTA_SHOP_SANDBOX_ENABLED = 'true';
    process.env.VANTA_SHOP_COIN_BADGE_ENABLED = 'true';
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(async callback => callback(tx));
    (walletService.verifyPin as jest.Mock).mockResolvedValue({ success: true });
    tx.subscriptionPlan.findUnique.mockResolvedValue({ isActive: true, price: 1.99, durationMonths: 1, badgeType: 'BLUE' });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.verificationBadge.findUnique.mockResolvedValue(null);
    tx.creatorMembership.findUnique.mockResolvedValue(null);
    tx.wallet.findUnique.mockResolvedValue(wallet);
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.wallet.findUniqueOrThrow.mockResolvedValue({ ...wallet, coinBalance: 201 });
  });
  afterEach(() => { process.env = { ...oldEnv }; });
  test('uses canonical coin price without bonus', () => {
    expect([1.99, 4.99, 8.99, 14.99].map(badgeCoinCost)).toEqual([199, 499, 899, 1499]);
  });
  test('fails closed in production', async () => {
    process.env.NODE_ENV = 'production';
    expect(shopCoinBadgeEnabled()).toBe(false);
    await expect(buyBadgeWithCoins('payer', request)).rejects.toThrow('not enabled');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('rejects manipulated quote before spending', async () => {
    await expect(buyBadgeWithCoins('payer', { ...request, expectedCoins: 1 })).rejects.toThrow('Price changed');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('rejects incorrect PIN before spending', async () => {
    (walletService.verifyPin as jest.Mock).mockRejectedValue(new Error('Invalid PIN'));
    await expect(buyBadgeWithCoins('payer', request)).rejects.toThrow('Invalid PIN');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('debits payer exactly and activates chosen recipient', async () => {
    const result = await buyBadgeWithCoins('payer', { ...request, recipientId: 'friend' });
    expect(result).toMatchObject({ success: true, coinsSpent: 199, availableCoins: 101 });
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({ where: { id: 'wallet1', isFrozen: false, lockedCoins: 100, coinBalance: { gte: 299 } }, data: { coinBalance: { decrement: 199 } } });
    expect(tx.verificationBadge.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'friend' }, create: expect.objectContaining({ sourcePurchaseId: result.orderId }) }));
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'payer', amount: 199, balanceBefore: 400, balance: 201, type: 'SUBSCRIPTION' }) });
  });
  test('cannot spend reserved or frozen coins', async () => {
    tx.wallet.findUnique.mockResolvedValue({ ...wallet, lockedCoins: 300 });
    await expect(buyBadgeWithCoins('payer', request)).rejects.toThrow('Insufficient');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.verificationBadge.upsert).not.toHaveBeenCalled();
  });
  test('duplicate request returns existing receipt without another debit', async () => {
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue({ userId: 'payer', planId: request.planId, recipientUserId: null, network: 'vanta-coins', amount: 1.99, status: 'COMPLETED' });
    await expect(buyBadgeWithCoins('payer', request)).resolves.toMatchObject({ alreadyCompleted: true, coinsSpent: 199 });
    expect(walletService.verifyPin).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('does not replace a suspended badge', async () => {
    tx.verificationBadge.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(buyBadgeWithCoins('payer', request)).rejects.toThrow('active or suspended badge');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
});
