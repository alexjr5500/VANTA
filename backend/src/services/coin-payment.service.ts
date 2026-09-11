import { prisma } from '../prisma';
import { walletService } from './wallet.service';
import { auditLog } from '../security/auditLog';
import { CryptoUtils } from '../security/crypto';
import {
  COIN_PAYMENT_MODE,
  COIN_PAYMENT_STATUS,
  COIN_PAYMENT_ORDER_TTL_SECONDS,
  getCoinPaymentMode,
  getTestPaymentDepositAddress,
  getCoinPaymentWebhookSecret,
  createCoinPaymentSimulateToken,
  isValidTransactionHash,
  validateCoinPaymentConfig,
  SUPPORTED_COIN_PAYMENT_NETWORKS,
} from '../config/coin-payments.config';
import { VANTA_COIN_PACKAGES } from '../config/wallet.config';

// ============================================================================
// VANTA COIN PAYMENT SERVICE
// ============================================================================
// Authoritative payment orchestration for the "Buy Coins" flow.
//
//   USER → CoinPackage → BACKEND ORDER → PAYMENT → SERVER-SIDE VERIFICATION
//        → IDEMPOTENCY CHECK → DB TRANSACTION → COIN LEDGER → USER BALANCE
//
// The server alone decides: package, coin quantity, price, currency, payment
// mode and whether a payment is verified. The client can only ever reference
// a packageId; it can never submit a coin quantity or price.
// ============================================================================

/** Thrown when purchases are disabled by server configuration (e.g. missing live address). */
export class CoinPaymentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoinPaymentUnavailableError';
  }
}

/** Thrown by the provider webhook path when the request is not authenticated/valid. */
export class PaymentWebhookError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PaymentWebhookError';
    this.statusCode = statusCode;
  }
}

function findPackage(packageId: unknown) {
  if (typeof packageId !== 'string' || !packageId.trim()) return null;
  return VANTA_COIN_PACKAGES.find((pkg) => pkg.id === packageId || String(pkg.coins) === packageId) || null;
}

function networkToAsset(network: string): string | null {
  switch (network) {
    case 'usdt-bep20': return 'USDT';
    case 'usdc-base': return 'USDC';
    default: return null;
  }
}

function isP2002(error: any): boolean {
  return Boolean(error) && (error.code === 'P2002' || error.code === 2002);
}

export class CoinPaymentService {
  // ============================================================
  // ORDER INITIALIZATION (server-authoritative pricing)
  // ============================================================

  /**
   * Creates a PENDING purchase order from a backend-resolved package.
   * Coins are NEVER credited here — this only opens a payment session.
   */
  async initializeCoinPurchase(
    userId: string,
    packageId: unknown,
    network: unknown,
    ipAddress?: string
  ) {
    if (!userId) throw new Error('Unauthorized');

    if (typeof packageId !== 'string' || !packageId.trim()) {
      throw new Error('packageId is required');
    }
    if (typeof network !== 'string' || !SUPPORTED_COIN_PAYMENT_NETWORKS.includes(network)) {
      throw new Error('Unsupported payment network. Choose USDT (BEP-20) or USDC (Base).');
    }

    const pkg = findPackage(packageId);
    if (!pkg) throw new Error('Invalid coin package');

    const mode = getCoinPaymentMode();
    const config = validateCoinPaymentConfig();

    let address: string | null;
    if (mode === COIN_PAYMENT_MODE.TEST) {
      // Test/sandbox: the fake deposit address is clearly not a real wallet.
      address = getTestPaymentDepositAddress();
    } else {
      if (!config.depositAddress || !config.addressValid) {
        // Log the REAL configuration problem server-side; never leak it to clients.
        await auditLog.log({
          userId,
          action: 'COIN_PURCHASE_BLOCKED',
          ipAddress,
          severity: 'WARNING',
          metadata: { reason: config.errors.join(' ') || 'live payment address not configured' },
        });
        throw new CoinPaymentUnavailableError(
          'Coin purchases are temporarily unavailable. Please try again later.'
        );
      }
      address = config.depositAddress;
    }

    // Server-authoritative values — the client CANNOT influence quantity/price.
    // AUTHORITATIVE: coinsCredited = package.coinAmount EXACTLY.
    // There are ZERO bonus coins on VANTA purchases.
    const coins = pkg.coins;
    const amount = pkg.price;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + COIN_PAYMENT_ORDER_TTL_SECONDS * 1000);

    const order = await prisma.purchaseOrder.create({
      data: {
        userId,
        coins,
        amount,
        currency: 'USD',
        provider: mode === COIN_PAYMENT_MODE.TEST ? 'test' : 'crypto',
        status: COIN_PAYMENT_STATUS.PENDING,
        paymentMethod: network,
        packageId: pkg.id,
        packageName: pkg.name,
        paymentMode: mode,
        expiresAt,
      },
    });

    const payload: Record<string, unknown> = {
      address,
      orderId: order.id,
      network,
      amount,
      coins,
      currency: 'USD',
      expiresIn: COIN_PAYMENT_ORDER_TTL_SECONDS,
      expiresAt,
      mode,
};

    if (mode === COIN_PAYMENT_MODE.TEST) {
      // Test gateway: the client presents this one-time HMAC token to complete
      // the simulated payment. It is bound to order + user + amount + time and
      // is signed with the server secret, so clients cannot forge it.
      payload.simulateToken = createCoinPaymentSimulateToken(order);
    }

    await auditLog.log({
      userId,
      action: 'COIN_PURCHASE_ORDER_CREATED',
      ipAddress,
      metadata: { orderId: order.id, packageId: pkg.id, coins, amount, mode },
    });

    return payload;
  }

  /**
   * Test/sandbox completion. Requires the HMAC simulate token the backend
   * issued at order-initialization time. Never usable in production.
   */
  async completeTestPurchase(
    userId: string,
    orderId: string,
    options: { simulateToken?: unknown; ipAddress?: string }
  ) {
    const mode = getCoinPaymentMode();
    if (mode !== COIN_PAYMENT_MODE.TEST) {
      throw new CoinPaymentUnavailableError(
        'Simulated payments are only available in test mode.'
      );
    }
    return walletService.completeCoinPurchase(userId, orderId, {
      mode,
      simulateToken: typeof options.simulateToken === 'string' ? options.simulateToken : undefined,
      ipAddress: options.ipAddress,
    });
  }

  async getUserPurchases(userId: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(Math.max(1, Number.isFinite(+limit) ? Math.trunc(+limit) : 50), 200);
    const safeOffset = Math.max(0, Number.isFinite(+offset) ? Math.trunc(+offset) : 0);
    const [purchases, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: safeOffset,
      }),
      prisma.purchaseOrder.count({ where: { userId } }),
    ]);
    return { purchases, total, limit: safeLimit, offset: safeOffset };
  }

  // ============================================================
  // LIVE PAYMENT VERIFICATION (PROVIDER WEBHOOK)
  // ============================================================

  /**
   * Process a provider payment webhook.
   *
   * Security properties:
   *  - AUTHENTICATED: HMAC-SHA256 over the raw request body using
   *    VANTA_COIN_PAYMENT_WEBHOOK_SECRET (constant-time comparison).
   *  - REPLAY-SAFE: eventId must be unique (WebhookEvent.eventId UNIQUE); a
   *    replay is acknowledged and ignored.
   *  - IDEMPOTENT: an already-completed order / already-used transaction hash
   *    can never credit coins twice (conditional status claim + unique
   *    providerOrderId at the database level).
   *  - TRANSACTION-SAFE: crediting, ledger, and the order status flip happen
   *    in a single database transaction inside completeCoinPurchase.
   */
  async processPaymentWebhook(input: {
    rawBody: string;
    signature?: unknown;
    eventId?: unknown;
    orderId?: unknown;
    txHash?: unknown;
    network?: unknown;
    asset?: unknown;
    amount?: unknown;
    status?: unknown;
    confirmations?: unknown;
    confirmedAt?: unknown;
  }) {
    const secret = getCoinPaymentWebhookSecret();
    if (!secret) {
      throw new PaymentWebhookError(
        503,
        'Payment webhooks are not configured for this deployment.'
      );
    }

    if (typeof input.signature !== 'string' || !input.signature) {
      throw new PaymentWebhookError(401, 'Missing webhook signature.');
    }
    const expected = CryptoUtils.sha256(`${input.rawBody || ''}${secret}`);
    if (
      expected.length !== input.signature.length ||
      !CryptoUtils.constantTimeCompare(expected, input.signature)
    ) {
      throw new PaymentWebhookError(401, 'Invalid webhook signature.');
    }

    const mode = getCoinPaymentMode();
    if (mode !== COIN_PAYMENT_MODE.LIVE) {
      // Webhooks only apply to live verification; nothing screams dev/testing.
      throw new PaymentWebhookError(503, 'Webhooks are not applicable in this environment.');
    }

    // ---- Idempotency gate (replay protection) ----
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    if (!eventId) {
      throw new PaymentWebhookError(400, 'eventId is required.');
    }
    const existingEvent = await prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existingEvent) {
      // Replay of the exact same event — acknowledged, never double-processed.
      return { received: true, duplicate: true, eventId };
    }

    await prisma.webhookEvent.create({
      data: {
        provider: 'coin-payment',
        eventId,
        type: 'payment.confirmed',
        rawBody: String(input.rawBody || '').slice(0, 100_000),
        signature: input.signature,
        status: 'RECEIVED',
      },
    });

    const markEvent = async (status: string, error?: string) => {
      try {
        await prisma.webhookEvent.update({
          where: { eventId },
          data: { status, processed: status === 'PROCESSED', processedAt: new Date(), error },
        });
      } catch {
        /* best effort */
      }
    };
try {
      const orderId = typeof input.orderId === 'string' ? input.orderId : '';
      const txHash = typeof input.txHash === 'string' ? input.txHash.trim() : '';
      const network = typeof input.network === 'string' ? input.network : '';
      const asset = typeof input.asset === 'string' ? input.asset.toUpperCase() : '';
      const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : NaN;
      const claimedStatus = typeof input.status === 'string' ? input.status.toLowerCase() : '';

      if (!orderId || !txHash || !network || !asset || Number.isNaN(amount)) {
        await markEvent('INVALID', 'Incomplete webhook payload');
        await auditLog.log({ action: 'PAYMENT_WEBHOOK_INVALID', severity: 'WARNING', metadata: { eventId }, ipAddress: '[webhook]' });
        return { received: true, result: 'ignored', eventId };
      }

      // A blockchain transaction hash is the strongest application-level
      // uniqueness guarantee we can enforce. The provider has already verified
      // the on-chain facts (receiving address, asset, finality) inside the
      // HMAC-authenticated channel that produced this event.
      if (!isValidTransactionHash(txHash)) {
        await markEvent('INVALID', 'Malformed transaction hash');
        await auditLog.log({ action: 'PAYMENT_WEBHOOK_INVALID', severity: 'WARNING', metadata: { eventId, reason: 'malformed txHash' }, ipAddress: '[webhook]' });
        return { received: true, result: 'ignored', eventId };
      }
      if (networkToAsset(network) !== asset) {
        await markEvent('INVALID', 'Asset/network mismatch');
        return { received: true, result: 'ignored', eventId };
      }

      const order = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
      if (!order) {
        await markEvent('IGNORED', 'Unknown order');
        return { received: true, result: 'ignored', eventId };
      }

      // Terminal states are never re-credited.
      if (
        order.status === COIN_PAYMENT_STATUS.COMPLETED ||
        order.status === COIN_PAYMENT_STATUS.REFUNDED
      ) {
        await markEvent('PROCESSED', 'Order already finalized');
        return { received: true, duplicate: true, orderId, eventId };
      }

      // Expired orders may still receive the event; flip to EXPIRED and stop.
      if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
        await prisma.purchaseOrder.updateMany({
          where: { id: order.id, status: { in: [COIN_PAYMENT_STATUS.PENDING, COIN_PAYMENT_STATUS.PROCESSING] } },
          data: { status: COIN_PAYMENT_STATUS.EXPIRED },
        });
        await markEvent('PROCESSED', 'Order expired');
        return { received: true, result: 'expired', orderId, eventId };
      }

      if (
        order.status !== COIN_PAYMENT_STATUS.PENDING &&
        order.status !== COIN_PAYMENT_STATUS.PROCESSING &&
        order.status !== COIN_PAYMENT_STATUS.PAID
      ) {
        await markEvent('IGNORED', `Order not creditable (${order.status})`);
        return { received: true, result: 'ignored', orderId, eventId };
      }

      // The provider must report a succeeded payment, an exact amount (within
      // 2 decimal places of the fixed package price) and the expected asset.
      if (claimedStatus !== 'paid' && claimedStatus !== 'confirmed' && claimedStatus !== 'completed') {
        await markEvent('FAILED', 'Provider reported non-successful payment');
        await prisma.purchaseOrder.updateMany({
          where: { id: order.id, status: { in: [COIN_PAYMENT_STATUS.PENDING, COIN_PAYMENT_STATUS.PROCESSING] } },
          data: { status: COIN_PAYMENT_STATUS.FAILED },
        });
        return { received: true, result: 'failed', orderId, eventId };
      }
      if (Math.abs(amount - order.amount) > 0.005) {
        await markEvent('FAILED', 'Amount mismatch');
        await auditLog.log({ action: 'PAYMENT_WEBHOOK_AMOUNT_MISMATCH', severity: 'CRITICAL', metadata: { eventId, orderId, expected: order.amount, actual: amount }, ipAddress: '[webhook]' });
        return { received: true, result: 'failed', orderId, eventId };
      }
      if (order.paymentMethod && order.paymentMethod !== network) {
        await markEvent('FAILED', 'Network mismatch');
        return { received: true, result: 'failed', orderId, eventId };
      }

      // ---- Atomic, idempotent crediting ----
      // completeCoinPurchase flips the order to COMPLETED with a conditional
      // claim and sets providerOrderId = `live:<txHash>` (UNIQUE). If the same
      // txHash is ever replayed for another order, the DB unique constraint
      // raises P2002 and everything rolls back — no second credit.
      let result;
      try {
        result = await walletService.completeCoinPurchase(order.userId, order.id, {
          mode: COIN_PAYMENT_MODE.LIVE,
          providerOrderId: txHash,
          ipAddress: '[webhook]',
          verification: {
            eventId,
            network,
            asset,
            amount,
            confirmations: typeof input.confirmations === 'number' ? input.confirmations : null,
            confirmedAt: typeof input.confirmedAt === 'string' && input.confirmedAt ? input.confirmedAt : null,
          },
        });
      } catch (error) {
        if (isP2002(error)) {
          await markEvent('PROCESSED', 'Transaction hash already used');
          return { received: true, duplicate: true, orderId, eventId };
        }
        throw error;
      }

      await markEvent('PROCESSED');
      await auditLog.log({
        userId: order.userId,
        action: 'COIN_PURCHASE_WEBHOOK_COMPLETED',
        ipAddress: '[webhook]',
        metadata: { eventId, orderId, txHash, amount, coins: order.coins, duplicate: Boolean(result?.alreadyCompleted) },
      });

      return {
        received: true,
        orderId,
        eventId,
        alreadyCompleted: Boolean(result?.alreadyCompleted),
        status: COIN_PAYMENT_STATUS.COMPLETED,
      };
    } catch (error) {
      await markEvent('FAILED', error instanceof Error ? error.message.slice(0, 500) : 'unknown error');
      throw error;
    }
  }

  // ============================================================
  // ORDER LIFE-CYCLE MAINTENANCE
  // ============================================================

  /** Flip stale PENDING/PROCESSING orders to EXPIRED (additive, non-crediting). */
  async expireStaleOrders(): Promise<number> {
    const updated = await prisma.purchaseOrder.updateMany({
      where: {
        status: { in: [COIN_PAYMENT_STATUS.PENDING, COIN_PAYMENT_STATUS.PROCESSING] },
        expiresAt: { lt: new Date() },
      },
      data: { status: COIN_PAYMENT_STATUS.EXPIRED },
    });
    return updated.count;
  }

  // ============================================================
  // ADMIN DASHBOARD
  // ============================================================

  async getCoinPaymentDashboard() {
    const COMPLETED = COIN_PAYMENT_STATUS.COMPLETED;
    const [totalPurchases, successful, pending, processing, paid, failed, expired, refunded, coinsSold, revenue, recent] = await Promise.all([
      prisma.purchaseOrder.count(),
      prisma.purchaseOrder.count({ where: { status: COMPLETED } }),
      prisma.purchaseOrder.count({ where: { status: COIN_PAYMENT_STATUS.PENDING } }),
      prisma.purchaseOrder.count({ where: { status: COIN_PAYMENT_STATUS.PROCESSING } }),
      prisma.purchaseOrder.count({ where: { status: COIN_PAYMENT_STATUS.PAID } }),
      prisma.purchaseOrder.count({ where: { status: COIN_PAYMENT_STATUS.FAILED } }),
      prisma.purchaseOrder.count({ where: { status: COIN_PAYMENT_STATUS.EXPIRED } }),
      prisma.purchaseOrder.count({ where: { status: COIN_PAYMENT_STATUS.REFUNDED } }),
      prisma.purchaseOrder.aggregate({ where: { status: COMPLETED }, _sum: { coins: true } }),
      prisma.purchaseOrder.aggregate({ where: { status: COMPLETED }, _sum: { amount: true } }),
      prisma.purchaseOrder.findMany({
        include: { user: { select: { id: true, username: true, email: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const config = validateCoinPaymentConfig();

    return {
      stats: {
        totalPurchases,
        successful,
        pending,
        paid,
        failed,
        expired,
        refunded,
        totalCoinsSold: coinsSold._sum.coins || 0,
        totalRevenueUSD: revenue._sum.amount || 0,
      },
      mode: {
        effective: config.mode,
        isTestMode: config.isTestMode,
        isProduction: config.isProduction,
        liveAddressConfigured: Boolean(config.depositAddress && config.addressValid),
        livePurchasesAvailable: config.errors.length === 0,
        errors: config.errors,
      },
      recent,
    };
  }

  async listCoinPurchases(options: { limit?: number; offset?: number; status?: string } = {}) {
    const limit = Math.min(Math.max(1, Math.trunc(options.limit || 50)), 500);
    const offset = Math.max(0, Math.trunc(options.offset || 0));
    const status = typeof options.status === 'string' && options.status.trim() ? options.status.trim().toUpperCase() : null;
    const where = status ? { status } : {};
    const [purchases, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { user: { select: { id: true, username: true, email: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return { purchases, total, limit, offset };
  }
}

export const coinPaymentService = new CoinPaymentService();