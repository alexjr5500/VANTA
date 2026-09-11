import { coinPaymentService, CoinPaymentUnavailableError, PaymentWebhookError } from '../services/coin-payment.service';
import { COIN_PAYMENT_MODE } from '../config/coin-payments.config';
import { prisma } from '../prisma';
import { CryptoUtils } from '../security/crypto';

jest.mock('../prisma', () => ({
  prisma: {
    wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    purchaseOrder: {
      findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(),
      updateMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn(),
    },
    walletTransaction: { create: jest.fn() },
    walletAuditLog: { create: jest.fn() },
    webhookEvent: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn: any) => fn({ ...prisma })),
  },
}));

jest.mock('../services/wallet.service', () => ({
  walletService: { ensureWallet: jest.fn(), completeCoinPurchase: jest.fn() },
}));

jest.mock('../security/auditLog', () => ({
  auditLog: { log: jest.fn() },
}));

jest.mock('../config/wallet.config', () => ({
  VANTA_COIN_PACKAGES: [
    { id: 'pkg_starter', name: 'Starter', coins: 100, price: 1 },
    { id: 'pkg_popular', name: 'Popular', coins: 500, price: 5 },
    { id: 'pkg_standard', name: 'Standard', coins: 1000, price: 10 },
    { id: 'pkg_premium', name: 'Premium', coins: 5000, price: 50 },
    { id: 'pkg_elite', name: 'Elite', coins: 10000, price: 100 },
  ],
}));

const { walletService } = require('../services/wallet.service');

const PENDING_ORDER: any = {
  id: 'order_live_1',
  userId: 'user1',
  coins: 500,
  amount: 5,
  currency: 'USD',
  provider: 'crypto',
  status: 'PENDING',
  paymentMethod: 'usdt-bep20',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60000),
};

const TX_HASH = '0x' + 'a'.repeat(64);

function sign(payload: object): string {
  const raw = JSON.stringify(payload);
  return CryptoUtils.sha256(`${raw}dev-webhook-secret-do-not-use-in-production`);
}

function eventBody() {
  return {
    eventId: 'evt-1',
    orderId: 'order_live_1',
    txHash: TX_HASH,
    network: 'usdt-bep20',
    asset: 'USDT',
    amount: 5,
    status: 'paid',
    confirmations: 12,
  };
}

describe('CoinPaymentService.initializeCoinPurchase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    delete process.env.VANTA_COIN_PAYMENT_ADDRESS;
    (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue({
      id: 'order_1', userId: 'user1', coins: 500, amount: 5, status: 'PENDING', createdAt: new Date(),
    });
  });

  test('creates a PENDING order with server-authoritative values in test mode', async () => {
    const payload = await coinPaymentService.initializeCoinPurchase(
      'user1', 'pkg_popular', 'usdt-bep20', '127.0.0.1'
    );
    expect(payload.orderId).toBe('order_1');
    expect(payload.amount).toBe(5);
    // EXACTLY the package amount — ZERO bonus coins.
    expect(payload.coins).toBe(500);
    expect(payload.mode).toBe(COIN_PAYMENT_MODE.TEST);
    expect(payload.simulateToken).toBeTruthy();
    const created = (prisma.purchaseOrder.create as jest.Mock).mock.calls[0][0].data;
    expect(created.status).toBe('PENDING');
    expect(created.coins).toBe(500);
    expect(created.amount).toBe(5);
    expect(created.paymentMode).toBe('test');
    expect(created.expiresAt).toBeTruthy();
  });

  test('a client cannot submit an arbitrary coin amount', async () => {
    // initializeCoinPurchase only accepts a packageId + network. There is no
    // "coins"/"amount"/"bonus" parameter a client could tamper with.
    const payload = await coinPaymentService.initializeCoinPurchase('user1', 'pkg_popular', 'usdt-bep20');
    expect(payload.coins).toBe(500);
    expect(payload.amount).toBe(5);
  });

  test('rejects an invalid package ID', async () => {
    await expect(coinPaymentService.initializeCoinPurchase('user1', 'pkg_nonexistent', 'usdt-bep20'))
      .rejects.toThrow('Invalid coin package');
  });

  test('rejects an unsupported network', async () => {
    await expect(coinPaymentService.initializeCoinPurchase('user1', 'pkg_popular', 'eth-arbitrum'))
      .rejects.toThrow('Unsupported payment network');
  });

  test('rejects unauthenticated requests (no user id)', async () => {
    await expect(coinPaymentService.initializeCoinPurchase('', 'pkg_popular', 'usdt-bep20'))
      .rejects.toThrow('Unauthorized');
  });

  test('test mode does NOT require a live deposit address', async () => {
    const payload = await coinPaymentService.initializeCoinPurchase('user1', 'pkg_popular', 'usdt-bep20');
    expect(payload.address).toBeTruthy(); // clearly-fake test address
  });

  test('live mode without a configured address stays disabled and never falls back to test', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    delete process.env.VANTA_COIN_PAYMENT_ADDRESS;

    await expect(coinPaymentService.initializeCoinPurchase('user1', 'pkg_popular', 'usdt-bep20'))
      .rejects.toBeInstanceOf(CoinPaymentUnavailableError);
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  test('live mode with a valid address creates a live PENDING order (no simulate token)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    process.env.VANTA_COIN_PAYMENT_ADDRESS = '0x' + 'b'.repeat(40);
    process.env.VANTA_COIN_PAYMENT_WEBHOOK_SECRET = 'live-secret';

    const payload = await coinPaymentService.initializeCoinPurchase('user1', 'pkg_popular', 'usdt-bep20');
    expect(payload.mode).toBe(COIN_PAYMENT_MODE.LIVE);
    expect(payload.simulateToken).toBeUndefined();
    expect(payload.address).toBe('0x' + 'b'.repeat(40));
  });
});
describe('CoinPaymentService.processPaymentWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    process.env.VANTA_COIN_PAYMENT_ADDRESS = '0x' + 'b'.repeat(40);
    process.env.VANTA_COIN_PAYMENT_WEBHOOK_SECRET = 'dev-webhook-secret-do-not-use-in-production';
    (prisma.webhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.webhookEvent.create as jest.Mock).mockResolvedValue({ id: 'evt1' });
    (prisma.webhookEvent.update as jest.Mock).mockResolvedValue({});
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(PENDING_ORDER);
    (walletService.completeCoinPurchase as jest.Mock).mockResolvedValue({
      alreadyCompleted: false,
      coins: 500,
      order: PENDING_ORDER,
      wallet: { coinBalance: 600 },
    });
  });

  test('rejects a webhook with a missing signature', async () => {
    const body = eventBody();
    await expect(coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: '',
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(PaymentWebhookError);
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('rejects a webhook with an invalid signature', async () => {
    const body = eventBody();
    await expect(coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: '0'.repeat(64),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(PaymentWebhookError);
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('a valid webhook completes the purchase and credits exactly once', async () => {
    const body = eventBody();
    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status, confirmations: 12,
    });

    expect(result.received).toBe(true);
    expect(result.alreadyCompleted).toBe(false);
    expect(walletService.completeCoinPurchase).toHaveBeenCalledTimes(1);
    const call = (walletService.completeCoinPurchase as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('user1');
    expect(call[1]).toBe('order_live_1');
    expect(call[2].mode).toBe(COIN_PAYMENT_MODE.LIVE);
    expect(call[2].providerOrderId).toBe(TX_HASH);
  });
test('duplicate webhook event is idempotent — never credits twice', async () => {
    const body = eventBody();
    (prisma.webhookEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'evt1', eventId: body.eventId });

    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    });

    expect(result.duplicate).toBe(true);
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('a replayed transaction hash (P2002) can never credit a second order', async () => {
    const body = eventBody();
    (walletService.completeCoinPurchase as jest.Mock).mockRejectedValue({ code: 'P2002' });

    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    });

    // The DB unique constraint (providerOrderId) blocks the second credit and
    // the webhook is acknowledged as a duplicate.
    expect(result.duplicate).toBe(true);
    expect(walletService.completeCoinPurchase).toHaveBeenCalledTimes(1);
  });

  test('an incomplete webhook payload is ignored WITHOUT crediting', async () => {
    const body = eventBody();
    body.txHash = '';

    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    });

    expect(result.result).toBe('ignored');
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });
test('an amount mismatch fails the payment WITHOUT crediting', async () => {
    const body = eventBody();
    body.amount = 999; // the client/attacker cannot influence the credited amount

    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    });

    expect(result.result).toBe('failed');
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('a non-successful provider status fails the payment WITHOUT crediting', async () => {
    const body = eventBody();
    body.status = 'failed';

    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    });

    expect(result.result).toBe('failed');
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('an asset/network mismatch is ignored WITHOUT crediting', async () => {
    const body = eventBody();
    body.asset = 'DOGE';

    const result = await coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    });

    expect(result.result).toBe('ignored');
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('webhooks are rejected when the runtime is in test mode (never a vector)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    const body = eventBody();

    await expect(coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: sign(body),
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(PaymentWebhookError);
    expect(walletService.completeCoinPurchase).not.toHaveBeenCalled();
  });

  test('webhooks require a configured secret (nothing is creditable without it)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    process.env.VANTA_COIN_PAYMENT_ADDRESS = '0x' + 'b'.repeat(40);
    delete process.env.VANTA_COIN_PAYMENT_WEBHOOK_SECRET;
    const body = eventBody();

    await expect(coinPaymentService.processPaymentWebhook({
      rawBody: JSON.stringify(body),
      signature: 'x',
      eventId: body.eventId, orderId: body.orderId, txHash: body.txHash, network: body.network,
      asset: body.asset, amount: body.amount, status: body.status,
    })).rejects.toBeInstanceOf(PaymentWebhookError);
  });
});
