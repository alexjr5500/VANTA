import { verificationPaymentService, VerificationPaymentWebhookError } from '../services/verification-payment.service';
import { COIN_PAYMENT_MODE, createCoinPaymentSimulateToken } from '../config/coin-payments.config';
import { prisma } from '../prisma';
import { CryptoUtils } from '../security/crypto';

jest.mock('../prisma', () => ({
  prisma: {
    verificationPurchase: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
    subscriptionPlan: { findUnique: jest.fn() },
    verificationBadge: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    creatorMembership: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    verificationHistory: { create: jest.fn() },
    webhookEvent: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: any) => fn({ ...prisma })),
  },
}));

jest.mock('../security/auditLog', () => ({ auditLog: { log: jest.fn() } }));
jest.mock('../services/notification.service', () => ({ notificationService: { createNotification: jest.fn() } }));

jest.mock('../services/blockchain-verifier.service', () => {
  class MockBlockchainTxVerificationError extends Error {
    code: string;
    transient: boolean;
    constructor(code: string, message: string, transient = false) {
      super(message);
      this.name = 'BlockchainTxVerificationError';
      this.code = code;
      this.transient = transient;
    }
  }
  return {
    blockchainTxVerifier: {
      withRetry: jest.fn((fn: any) => fn()),
      verifyTransaction: jest.fn(),
    },
    BlockchainTxVerificationError: MockBlockchainTxVerificationError,
    BLOCKCHAIN_VERIFICATION_ERROR_CODES: {
      INVALID_TX_HASH: 'INVALID_TX_HASH',
      UNSUPPORTED_NETWORK: 'UNSUPPORTED_NETWORK',
      TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
      TRANSACTION_PENDING: 'TRANSACTION_PENDING',
      TRANSACTION_FAILED: 'TRANSACTION_FAILED',
      WRONG_NETWORK: 'WRONG_NETWORK',
      WRONG_TOKEN: 'WRONG_TOKEN',
      WRONG_RECIPIENT: 'WRONG_RECIPIENT',
      AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
      LOW_CONFIRMATIONS: 'LOW_CONFIRMATIONS',
      RPC_UNAVAILABLE: 'RPC_UNAVAILABLE',
      RPC_ERROR: 'RPC_ERROR',
    },
  };
});

const { blockchainTxVerifier } = require('../services/blockchain-verifier.service');

const ON_CHAIN_VERIFIED: Record<string, unknown> = {
  verified: true,
  txHash: '0x' + 'b'.repeat(64),
  network: 'usdt-bep20',
  chainId: 56,
  chainName: 'BNB Smart Chain (BEP-20)',
  asset: 'USDT',
  tokenContract: '0x55d398326f99059ff775485246999027b3197955',
  recipient: '0x7fa9677c65272d80b06cb0c3a9bbeeba8f95db56',
  sender: '0x' + 'c'.repeat(40),
  amount: 1.99,
  confirmations: 12,
  blockNumber: 100,
  blockHash: '0x' + 'f'.repeat(64),
  verifiedAt: '2026-09-29T00:00:00.000Z',
};

const BLUE_1M_PLAN: any = { id: 'plan_blue_1month', name: 'Blue Verified - 1 Month', badgeType: 'BLUE', durationMonths: 1, price: 1.99, currency: 'USD', isActive: true };
const GOLD_1Y_PLAN: any = { id: 'plan_gold_1year', name: 'Gold Verified - 1 Year', badgeType: 'GOLD', durationMonths: 12, price: 14.99, currency: 'USD', isActive: true };
const PENDING_ORDER: any = { id: 'order_1', userId: 'user1', planId: BLUE_1M_PLAN.id, amount: 1.99, currency: 'USD', network: 'usdt-bep20', status: 'PENDING', paymentMode: 'test', providerReference: null, providerOrderId: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
const SECRET = 'dev-webhook-secret-do-not-use-in-production';

function setMode(mode: string) {
  process.env.NODE_ENV = 'development';
  process.env.VANTA_COIN_PAYMENT_MODE = mode;
  process.env.VANTA_COIN_PAYMENT_WEBHOOK_SECRET = SECRET;
  if (mode === 'live') process.env.VANTA_COIN_PAYMENT_ADDRESS = '0x' + 'a'.repeat(40);
  else delete process.env.VANTA_COIN_PAYMENT_ADDRESS;
}

function sign(payload: object): string {
  return CryptoUtils.sha256(`${JSON.stringify(payload)}${SECRET}`);
}

function eventBody(orderId = 'order_1') {
  return { eventId: 'evt-1', orderId, txHash: '0x' + 'b'.repeat(64), network: 'usdt-bep20', asset: 'USDT', amount: 1.99, status: 'paid', confirmations: 12 };
}
describe('initializeVerificationPurchase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMode('test');
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(BLUE_1M_PLAN);
    (prisma.verificationPurchase.create as jest.Mock).mockResolvedValue({ id: 'order_1', userId: 'user1', planId: BLUE_1M_PLAN.id, amount: 1.99, status: 'PENDING', createdAt: new Date() });
  });

  test('creates a PENDING order with server-resolved pricing (client cannot set a price)', async () => {
    const payload = await verificationPaymentService.initializeVerificationPurchase('user1', 'plan_blue_1month', 'usdt-bep20');
    expect(payload.amount).toBe(1.99);
    expect(payload.badgeType).toBe('BLUE');
    expect(payload.mode).toBe(COIN_PAYMENT_MODE.TEST);
    expect(payload.simulateToken).toBeTruthy();
    const created = (prisma.verificationPurchase.create as jest.Mock).mock.calls[0][0].data;
    expect(created.status).toBe('PENDING');
    expect(created.amount).toBe(1.99);
  });

  test('rejects an invalid plan id', async () => {
    await expect(verificationPaymentService.initializeVerificationPurchase('user1', 'plan_does_not_exist', 'usdt-bep20'))
      .rejects.toThrow('Invalid verification plan');
  });

  test('rejects an unsupported network', async () => {
    await expect(verificationPaymentService.initializeVerificationPurchase('user1', 'plan_blue_1month', 'eth-arbitrum'))
      .rejects.toThrow('Unsupported payment network');
  });

  test('blocks purchases when the server-side plan price is tampered', async () => {
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...BLUE_1M_PLAN, price: 0.01 });
    await expect(verificationPaymentService.initializeVerificationPurchase('user1', 'plan_blue_1month', 'usdt-bep20'))
      .rejects.toThrow('temporarily unavailable');
    expect(prisma.verificationPurchase.create).not.toHaveBeenCalled();
  });

  test('blocks purchases when the plan is inactive', async () => {
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...BLUE_1M_PLAN, isActive: false });
    await expect(verificationPaymentService.initializeVerificationPurchase('user1', 'plan_blue_1month', 'usdt-bep20'))
      .rejects.toThrow('temporarily unavailable');
    expect(prisma.verificationPurchase.create).not.toHaveBeenCalled();
  });

  test('gold 1-year plan resolves to $14.99 (GOLD)', async () => {
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(GOLD_1Y_PLAN);
    const payload = await verificationPaymentService.initializeVerificationPurchase('user1', 'plan_gold_1year', 'usdc-base');
    expect(payload.amount).toBe(14.99);
    expect(payload.badgeType).toBe('GOLD');
    expect(payload.durationMonths).toBe(12);
  });
});
describe('completeTestPurchase (test mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMode('test');
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(BLUE_1M_PLAN);
    (prisma.verificationPurchase.findFirst as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.verificationBadge.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.verificationBadge.create as jest.Mock).mockResolvedValue({ id: 'badge1', badgeType: 'BLUE', status: 'ACTIVE' });
    (prisma.verificationHistory.create as jest.Mock).mockResolvedValue({});
  });

  test('a valid simulate token activates the BLUE badge and never touches a GOLD membership', async () => {
    const result = await verificationPaymentService.completeTestPurchase('user1', 'order_1', {
      simulateToken: createCoinPaymentSimulateToken(PENDING_ORDER),
    });
    expect(result.alreadyCompleted).toBe(false);
    const badgeData = (prisma.verificationBadge.create as jest.Mock).mock.calls[0][0].data;
    expect(badgeData.badgeType).toBe('BLUE');
    expect(badgeData.sourcePurchaseId).toBe('order_1');
    expect(prisma.creatorMembership.create).not.toHaveBeenCalled();
  });

  test('an invalid (forged) simulate token never activates anything', async () => {
    await expect(verificationPaymentService.completeTestPurchase('user1', 'order_1', { simulateToken: 'forged-token' }))
      .rejects.toThrow('Invalid test payment confirmation');
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('a user cannot complete someone else purchase', async () => {
    (prisma.verificationPurchase.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(verificationPaymentService.completeTestPurchase('user2', 'order_1', { simulateToken: createCoinPaymentSimulateToken(PENDING_ORDER) }))
      .rejects.toThrow('Purchase order not found.');
  });

  test('replay / double-click of the same verified purchase is idempotent', async () => {
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, status: 'COMPLETED' });
    const result = await verificationPaymentService.completeTestPurchase('user1', 'order_1', { simulateToken: createCoinPaymentSimulateToken(PENDING_ORDER) });
    expect(result.alreadyCompleted).toBe(true);
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });
});

describe('activation & renewal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMode('test');
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(BLUE_1M_PLAN);
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.verificationHistory.create as jest.Mock).mockResolvedValue({});
  });

  test('renewing while an ACTIVE badge exists extends from its expiry (never shortens)', async () => {
    const existingExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    (prisma.verificationBadge.findUnique as jest.Mock).mockResolvedValue({ id: 'badge1', userId: 'user1', badgeType: 'BLUE', status: 'ACTIVE', expiresAt: existingExpiry });
    (prisma.verificationBadge.update as jest.Mock).mockResolvedValue({ id: 'badge1', badgeType: 'BLUE', status: 'ACTIVE' });

    await verificationPaymentService.activateEntitlementFromOrder('user1', PENDING_ORDER, { mode: 'test' });
    const updateData = (prisma.verificationBadge.update as jest.Mock).mock.calls[0][0].data;
    expect(new Date(updateData.expiresAt).getTime()).toBeGreaterThan(existingExpiry.getTime());
  });

  test('GOLD purchase activates GOLD badge AND upserts the creator membership', async () => {
    const goldOrder: any = { ...PENDING_ORDER, planId: GOLD_1Y_PLAN.id, amount: 14.99 };
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(GOLD_1Y_PLAN);
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue(goldOrder);
    (prisma.verificationBadge.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.verificationBadge.create as jest.Mock).mockResolvedValue({ id: 'badge1', badgeType: 'GOLD', status: 'ACTIVE' });
    (prisma.creatorMembership.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.creatorMembership.create as jest.Mock).mockResolvedValue({ id: 'm1' });

    await verificationPaymentService.activateEntitlementFromOrder('user1', goldOrder, { mode: 'test' });
    expect((prisma.verificationBadge.create as jest.Mock).mock.calls[0][0].data.badgeType).toBe('GOLD');
    const membershipData = (prisma.creatorMembership.create as jest.Mock).mock.calls[0][0].data;
    expect(membershipData.planId).toBe(GOLD_1Y_PLAN.id);
    expect(membershipData.endDate).toBeTruthy();
  });
});
describe('processPaymentWebhook (LIVE payments)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMode('live');
    (prisma.webhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.webhookEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.webhookEvent.update as jest.Mock).mockResolvedValue({});
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, paymentMode: 'live', status: 'PENDING' });
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(BLUE_1M_PLAN);
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.verificationBadge.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.verificationBadge.create as jest.Mock).mockResolvedValue({ id: 'badge1', badgeType: 'BLUE', status: 'ACTIVE' });
    (prisma.verificationHistory.create as jest.Mock).mockResolvedValue({});
    (blockchainTxVerifier.verifyTransaction as jest.Mock).mockResolvedValue(ON_CHAIN_VERIFIED);
  });

  test('rejects a webhook with a missing signature', async () => {
    const body = eventBody();
    await expect(verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: '', eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(VerificationPaymentWebhookError);
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('rejects a webhook with an invalid signature', async () => {
    const body = eventBody();
    await expect(verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: '0'.repeat(64), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(VerificationPaymentWebhookError);
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('a non-successful payment status never activates', async () => {
    const body = { ...eventBody(), eventId: 'evt-fail', status: 'canceled' };
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    });
    expect(result.result).toBe('failed');
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('an amount mismatch never activates', async () => {
    const body = { ...eventBody(), eventId: 'evt-amt', amount: 0.01 };
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    });
    expect(result.result).toBe('failed');
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('a valid signed webhook activates the entitlement', async () => {
    const body = eventBody();
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    });
    expect(result.status).toBe('COMPLETED');
    expect(blockchainTxVerifier.verifyTransaction).toHaveBeenCalledTimes(1);
    const verifyArgs = (blockchainTxVerifier.verifyTransaction as jest.Mock).mock.calls[0][0];
    expect(verifyArgs.txHash).toBe('0x' + 'b'.repeat(64));
    expect(verifyArgs.expectedRecipient.toLowerCase()).toBe('0x7fa9677c65272d80b06cb0c3a9bbeeba8f95db56');
    expect(prisma.verificationBadge.create).toHaveBeenCalled();
  });

  test('an on-chain rejection blocks badge activation', async () => {
    const body = { ...eventBody(), eventId: 'evt-onchain-reject' };
    const { BlockchainTxVerificationError, BLOCKCHAIN_VERIFICATION_ERROR_CODES } = require('../services/blockchain-verifier.service');
    (blockchainTxVerifier.verifyTransaction as jest.Mock).mockRejectedValue(
      new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK, 'chain mismatch')
    );
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    });
    expect(result.result).toBe('failed');
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('a transient on-chain RPC failure is retryable and never activates', async () => {
    const body = { ...eventBody(), eventId: 'evt-rpc-out' };
    const { BlockchainTxVerificationError, BLOCKCHAIN_VERIFICATION_ERROR_CODES } = require('../services/blockchain-verifier.service');
    (blockchainTxVerifier.verifyTransaction as jest.Mock).mockRejectedValue(
      new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE, 'rpc down', true)
    );
    await expect(verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(BlockchainTxVerificationError);
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('a recipient that is not the official wallet blocks activation', async () => {
    const body = { ...eventBody(), eventId: 'evt-recipient' };
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
      recipient: '0x' + 'e'.repeat(40),
    });
    expect(result.result).toBe('failed');
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
    expect(blockchainTxVerifier.verifyTransaction).not.toHaveBeenCalled();
  });

  test('duplicate webhook event is idempotent — never activates twice', async () => {
    (prisma.webhookEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'evt', eventId: 'evt-1', status: 'PROCESSED' });
    const body = eventBody();
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    });
    expect(result.duplicate).toBe(true);
    expect(prisma.verificationBadge.create).not.toHaveBeenCalled();
  });

  test('a re-played transaction hash is never double-activated (P2002)', async () => {
    const body = { ...eventBody(), orderId: 'order_2', eventId: 'evt-replay' };
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, id: 'order_2', status: 'PENDING' });
    (prisma.verificationPurchase.updateMany as jest.Mock).mockImplementation(() => {
      const err: any = new Error('Unique constraint failed');
      err.code = 'P2002';
      throw err;
    });
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body), signature: sign(body), eventId: body.eventId, orderId: body.orderId,
      txHash: body.txHash, network: body.network, asset: body.asset, amount: body.amount, status: body.status,
    });
    expect(result.duplicate).toBe(true);
  });
});
describe('confirmCompletedPurchase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMode('test');
  });

  test('rejects activation from a purchase that is NOT server-verified as paid', async () => {
    (prisma.verificationPurchase.findFirst as jest.Mock).mockResolvedValue({ ...PENDING_ORDER, status: 'PENDING' });
    await expect(verificationPaymentService.confirmCompletedPurchase('user1', 'order_1'))
      .rejects.toThrow('has not been verified as paid');
  });

  test('re-activating from a COMPLETED purchase is safe and idempotent', async () => {
    const completed = { ...PENDING_ORDER, status: 'COMPLETED', paymentMode: 'test', providerReference: 'x' };
    (prisma.verificationPurchase.findFirst as jest.Mock).mockResolvedValue(completed);
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue(completed);
    (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(BLUE_1M_PLAN);
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const result = await verificationPaymentService.confirmCompletedPurchase('user1', 'order_1');
    expect(result.alreadyCompleted).toBe(true);
  });
});

describe('maintenance & refunds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('expireStaleOrders flips stale PENDING purchases to EXPIRED', async () => {
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
    const count = await verificationPaymentService.expireStaleOrders();
    expect(count).toBe(2);
  });

  test('expireOverdueBadges expires ACTIVE badges past their expiry and their gold membership', async () => {
    (prisma.verificationBadge.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', userId: 'u1', badgeType: 'GOLD' }]);
    (prisma.verificationBadge.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.creatorMembership.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.verificationHistory.create as jest.Mock).mockResolvedValue({});
    const count = await verificationPaymentService.expireOverdueBadges();
    expect(count).toBe(1);
    expect(prisma.creatorMembership.updateMany).toHaveBeenCalled();
  });

  test('a refund reverses the entitlement only when it sourced the active badge', async () => {
    (prisma.verificationPurchase.findUnique as jest.Mock).mockResolvedValue({ id: 'order_1', userId: 'u1', amount: 14.99, status: 'COMPLETED' });
    (prisma.verificationPurchase.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.verificationBadge.findUnique as jest.Mock).mockResolvedValue({ id: 'badge1', userId: 'u1', badgeType: 'GOLD', status: 'ACTIVE', sourcePurchaseId: 'order_1' });
    (prisma.verificationBadge.update as jest.Mock).mockResolvedValue({});
    (prisma.creatorMembership.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.verificationHistory.create as jest.Mock).mockResolvedValue({});

    const result = await verificationPaymentService.refundPurchase('admin1', 'order_1', 'double charge');
    expect(result.success).toBe(true);
    expect(prisma.verificationBadge.update).toHaveBeenCalled();
  });
});