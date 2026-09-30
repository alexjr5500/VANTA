import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import { CryptoUtils } from '../security/crypto';
import {
  COIN_PAYMENT_MODE,
  getCoinPaymentMode,
  getTestPaymentDepositAddress,
  getCoinPaymentWebhookSecret,
  getCoinPaymentDepositAddress,
  createCoinPaymentSimulateToken,
  verifyCoinPaymentSimulateToken,
  isValidTransactionHash,
  validateCoinPaymentConfig,
  SUPPORTED_COIN_PAYMENT_NETWORKS,
} from '../config/coin-payments.config';
import { getMinBlockchainConfirmations } from '../config/blockchain-networks.config';
import {
  blockchainTxVerifier,
  BlockchainTxVerificationError,
} from './blockchain-verifier.service';
import {
  VERIFIED_BADGE_PLANS,
  BADGE_PLAN_BY_ID,
  VERIFICATION_PURCHASE_TTL_SECONDS,
  VERIFICATION_PURCHASE_STATUS,
  VERIFICATION_PURCHASE_ACTIVABLE_STATUSES,
  VerifiedBadgePlan,
} from '../config/verification-badge.config';

// ============================================================================
// VANTA VERIFIED BADGE PAYMENT SERVICE
// ============================================================================
// Authoritative payment orchestration for the paid Verified Badge system.
//
//   USER -> PLAN -> BACKEND ORDER -> PAYMENT -> SERVER-SIDE VERIFICATION
//        -> IDEMPOTENCY CHECK -> DB TRANSACTION -> BADGE ACTIVATION
//
// The server alone decides: plan, badgeType, duration, price, currency, payment
// mode and whether a payment is verified. The client can only ever reference a
// plan id + network; it never submits a price, a duration, a badge type or a
// user id (the authenticated user owns the entitlement).
//
// Security mirrors the trusted Buy-Coins flow:
//   - Test mode  -> HMAC simulate token issued & signed by the backend at
//                   order-init time (bound to order+user+amount).
//   - Live mode  -> ONLY a provider webhook authenticated with the shared
//                   webhook secret (constant-time HMAC compare) can activate an
//                   entitlement; a client-submitted tx hash is never proof.
//   - Replay safe / idempotent -> WebhookEvent.eventId uniqueness + conditional
//                   status claim + unique providerOrderId (live:<txHash>).
// ============================================================================

export class VerificationPaymentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationPaymentUnavailableError';
  }
}

export class VerificationPaymentWebhookError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'VerificationPaymentWebhookError';
    this.statusCode = statusCode;
  }
}

function isP2002(error: any): boolean {
  return Boolean(error) && (error.code === 'P2002' || error.code === 2002);
}

/**
 * WebhookEvent statuses that are FINAL and must never be reprocessed.
 * FAILED / RECEIVED events stay retryable on provider re-delivery so a
 * transient blockchain-RPC outage never permanently swallows a payment event.
 */
const BLOCKCHAIN_WEBHOOK_FINAL_STATUSES: readonly string[] = Object.freeze([
  'PROCESSED',
  'IGNORED',
  'INVALID',
  'PROCESSING',
  'DUPLICATE',
]);

/** Add calendar months to a date (JS Date handles year rollover natively). */
function addMonths(start: Date, months: number): Date {
  const date = new Date(start.getTime());
  date.setMonth(date.getMonth() + Math.max(0, Math.trunc(months)));
  return date;
}

function resolveProviderOrderId(mode: string, orderId: string, providerReference: string): string {
  return mode === COIN_PAYMENT_MODE.TEST
    ? `test:${orderId}`
    : `live:${providerReference || orderId}`;
}

function networkToAsset(network: string): string | null {
  switch (network) {
    case 'usdt-bep20':
      return 'USDT';
    case 'usdc-base':
      return 'USDC';
    default:
      return null;
  }
}
export class VerificationPaymentService {
  // ============================================================
  // ORDER INITIALIZATION (server-authoritative pricing)
  // ============================================================

  /**
   * Create a PENDING purchase for a Verified Badge plan.
   * Pricing/duration come from the server-side SubscriptionPlan row (checked
   * against the canonical catalog); the client only sends planId + network.
   */
  async initializeVerificationPurchase(
    userId: string,
    planId: unknown,
    network: unknown,
    ipAddress?: string
  ): Promise<Record<string, unknown>> {
    if (!userId) throw new Error('Unauthorized');
    if (typeof planId !== 'string' || !planId.trim()) {
      throw new Error('planId is required');
    }
    if (typeof network !== 'string' || !SUPPORTED_COIN_PAYMENT_NETWORKS.includes(network)) {
      throw new Error('Unsupported payment network. Choose USDT (BEP-20) or USDC (Base).');
    }

    const catalogPlan = BADGE_PLAN_BY_ID.get(planId);
    if (!catalogPlan) throw new Error('Invalid verification plan');

    const dbPlan = await prisma.subscriptionPlan.findUnique({ where: { id: catalogPlan.id } });
    if (!dbPlan || !dbPlan.isActive) {
      throw new VerificationPaymentUnavailableError(
        'This verification plan is temporarily unavailable. Please try again later.'
      );
    }
    if (Math.abs(dbPlan.price - catalogPlan.priceUSD) > 0.001 || dbPlan.badgeType !== catalogPlan.badgeType) {
      await auditLog.log({
        userId,
        action: 'VERIFICATION_PLAN_MISCONFIGURED',
        ipAddress,
        severity: 'CRITICAL',
        metadata: {
          planId: catalogPlan.id,
          dbPrice: dbPlan.price,
          catalogPrice: catalogPlan.priceUSD,
          dbBadgeType: dbPlan.badgeType,
          catalogBadgeType: catalogPlan.badgeType,
        },
      });
      throw new VerificationPaymentUnavailableError(
        'This verification plan is temporarily unavailable. Please try again later.'
      );
    }

    const mode = getCoinPaymentMode();
    const config = validateCoinPaymentConfig();

    let address: string | null;
    if (mode === COIN_PAYMENT_MODE.TEST) {
      address = getTestPaymentDepositAddress();
    } else {
      if (!config.depositAddress || !config.addressValid) {
        await auditLog.log({
          userId,
          action: 'VERIFICATION_PURCHASE_BLOCKED',
          ipAddress,
          severity: 'WARNING',
          metadata: { reason: config.errors.join(' ') || 'live payment address not configured' },
        });
        throw new VerificationPaymentUnavailableError(
          'Verification purchases are temporarily unavailable. Please try again later.'
        );
      }
      address = config.depositAddress;
    }

    const amount = catalogPlan.priceUSD;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VERIFICATION_PURCHASE_TTL_SECONDS * 1000);

    const order = await prisma.verificationPurchase.create({
      data: {
        userId,
        planId: catalogPlan.id,
        amount,
        currency: 'USD',
        network,
        status: VERIFICATION_PURCHASE_STATUS.PENDING,
        paymentMode: mode,
        expiresAt,
      },
    });

    const payload: Record<string, unknown> = {
      address,
      orderId: order.id,
      network,
      amount,
      currency: 'USD',
      planId: catalogPlan.id,
      planName: catalogPlan.name,
      badgeType: catalogPlan.badgeType,
      durationMonths: catalogPlan.durationMonths,
      expiresIn: VERIFICATION_PURCHASE_TTL_SECONDS,
      expiresAt,
      mode,
    };

    if (mode === COIN_PAYMENT_MODE.TEST) {
      // Test gateway: the client must present this one-time HMAC token to
      // complete the *simulated* payment. Bound to order + user + amount.
      payload.simulateToken = createCoinPaymentSimulateToken(order);
    }

    await auditLog.log({
      userId,
      action: 'VERIFICATION_PURCHASE_ORDER_CREATED',
      ipAddress,
      metadata: { orderId: order.id, planId: catalogPlan.id, badgeType: catalogPlan.badgeType, amount, mode },
    });

    return payload;
  }

  /**
   * Test/sandbox completion: verifies the backend-issued HMAC simulate token
   * and then activates the entitlement atomically. Never usable in production.
   */
  async completeTestPurchase(
    userId: string,
    orderId: string,
    options: { simulateToken?: unknown; ipAddress?: string }
  ): Promise<any> {
    const mode = getCoinPaymentMode();
    if (mode !== COIN_PAYMENT_MODE.TEST) {
      throw new VerificationPaymentUnavailableError('Simulated payments are only available in test mode.');
    }
    const order = await prisma.verificationPurchase.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new Error('Purchase order not found.');
    if (order.paymentMode === COIN_PAYMENT_MODE.LIVE) {
      throw new Error('This purchase was created in live mode and cannot be confirmed as a simulation.');
    }
    if (!verifyCoinPaymentSimulateToken(order, typeof options.simulateToken === 'string' ? options.simulateToken : undefined)) {
      throw new Error('Invalid test payment confirmation. Please start a new purchase.');
    }
    return this.activateEntitlementFromOrder(userId, order, { mode, ipAddress: options.ipAddress });
  }
// ============================================================
  // ENTIRELEMENT ACTIVATION (atomic, idempotent, renewal-aware)
  // ============================================================

  /**
   * Activate a Verified Badge entitlement from a server-verified purchase.
   *
   * Guards:
   *  - conditional status claim (PENDING/PROCESSING/PAID -> COMPLETED) makes the
   *    activation idempotent under concurrency / replay / double-click;
   *  - providerOrderId (= live:<txHash> in live mode) is UNIQUE at the DB
   *    level, so the same transaction can never be replayed on another order;
   *  - badge + membership updates happen in the SAME transaction as the claim.
   *
   * Renewal: when the user already holds an ACTIVE badge it is extended from
   * its current expiry date (never shortened). When there is no active badge
   * the new entitlement starts now.
   */
  async activateEntitlementFromOrder(
    userId: string,
    order: any,
    options: { mode?: string; providerReference?: string; ipAddress?: string; metadata?: Record<string, unknown> | null } = {}
  ): Promise<any> {
    const existingAttempt = await prisma.verificationPurchase.findUnique({ where: { id: order.id } });
    if (!existingAttempt || existingAttempt.userId !== userId) {
      throw new Error('Purchase order not found.');
    }
    if (existingAttempt.status === VERIFICATION_PURCHASE_STATUS.COMPLETED) {
      // Idempotent replay of a verified payment — entitlement already active.
      return { order: existingAttempt, alreadyCompleted: true };
    }
    if (existingAttempt.status === VERIFICATION_PURCHASE_STATUS.REFUNDED) {
      throw new Error('This purchase was refunded and cannot be completed again.');
    }
    if (!VERIFICATION_PURCHASE_ACTIVABLE_STATUSES.includes(existingAttempt.status)) {
      throw new Error(`This purchase cannot be completed (status: ${existingAttempt.status}).`);
    }
    if (new Date(existingAttempt.expiresAt).getTime() < Date.now()) {
      throw new Error('This payment session has expired. Please start a new purchase.');
    }

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: existingAttempt.planId } });
    if (!plan || !plan.isActive) {
      throw new Error('The purchased verification plan is no longer available.');
    }
    const badgeType: 'BLUE' | 'GOLD' = plan.badgeType === 'BLUE' ? 'BLUE' : 'GOLD';

    const mode = options.mode || existingAttempt.paymentMode || COIN_PAYMENT_MODE.LIVE;
    const providerRef = (options.providerReference || existingAttempt.providerReference || '').trim();
    const providerOrderId = resolveProviderOrderId(mode, existingAttempt.id, providerRef);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // ---- atomic idempotency claim ----
      const claimed = await tx.verificationPurchase.updateMany({
        where: {
          id: existingAttempt.id,
          userId,
          status: { in: [...VERIFICATION_PURCHASE_ACTIVABLE_STATUSES] },
        },
        data: {
          status: VERIFICATION_PURCHASE_STATUS.COMPLETED,
          providerOrderId,
          providerReference: providerRef || null,
          paymentMode: mode,
          confirmedAt: now,
          metadata:
            options.metadata?.onChain
              ? JSON.stringify({ onChain: options.metadata.onChain, verifiedAt: new Date().toISOString() })
              : existingAttempt.metadata,
          updatedAt: now,
        },
      });

      if (claimed.count === 0) {
        const current = await tx.verificationPurchase.findUnique({ where: { id: existingAttempt.id } });
        if (current?.status === VERIFICATION_PURCHASE_STATUS.COMPLETED) {
          return { alreadyCompleted: true, order: current };
        }
        throw new Error('This purchase was already processed.');
      }

      // ---- entitlement date computation (renewal-aware, never shortening) ----
      const existingBadge = await tx.verificationBadge.findUnique({ where: { userId } });
      const hasActiveBadge =
        existingBadge?.status === 'ACTIVE' &&
        existingBadge.expiresAt &&
        new Date(existingBadge.expiresAt).getTime() > now.getTime();

      const startDate = hasActiveBadge && existingBadge?.expiresAt ? new Date(existingBadge.expiresAt) : now;
      const endDate = addMonths(startDate, plan.durationMonths);

      let badge;
      if (existingBadge) {
        badge = await tx.verificationBadge.update({
          where: { userId },
          data: {
            badgeType,
            status: 'ACTIVE',
            grantedBy: existingBadge.grantedBy || null,
            grantedAt: startDate,
            expiresAt: endDate,
            sourcePurchaseId: existingAttempt.id,
            planId: plan.id,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
            updatedAt: now,
          },
        });
      } else {
        badge = await tx.verificationBadge.create({
          data: {
            userId,
            badgeType,
            status: 'ACTIVE',
            grantedAt: startDate,
            expiresAt: endDate,
            sourcePurchaseId: existingAttempt.id,
            planId: plan.id,
          },
        });
      }

      // GOLD badges carry the creator membership (creator-studio entitlement).
      // BLUE badges never touch the membership record.
      let membership: any = null;
      if (badgeType === 'GOLD') {
        const existingMembership = await tx.creatorMembership.findUnique({ where: { userId } });
        const membershipActive =
          existingMembership?.status === 'ACTIVE' &&
          existingMembership.endDate &&
          new Date(existingMembership.endDate).getTime() > now.getTime();
        const membershipStart =
          membershipActive && existingMembership?.endDate ? new Date(existingMembership.endDate) : startDate;
        const membershipEnd = addMonths(membershipStart, plan.durationMonths);
        const renewalDate = new Date(membershipEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

        if (existingMembership) {
          membership = await tx.creatorMembership.update({
            where: { userId },
            data: {
              planId: plan.id,
              status: 'ACTIVE',
              startDate: membershipStart,
              endDate: membershipEnd,
              renewalDate,
              autoRenew: false,
              cancelledAt: null,
              paymentMethod: existingAttempt.network || 'crypto',
              paymentTxHash: providerRef || providerOrderId,
              updatedAt: now,
            },
          });
        } else {
          membership = await tx.creatorMembership.create({
            data: {
              userId,
              planId: plan.id,
              status: 'ACTIVE',
              startDate: membershipStart,
              endDate: membershipEnd,
              renewalDate,
              autoRenew: false,
              paymentMethod: existingAttempt.network || 'crypto',
              paymentTxHash: providerRef || providerOrderId,
            },
          });
        }
      }

      await tx.verificationHistory.create({
        data: {
          userId,
          action: 'BADGE_ACTIVATED',
          details: JSON.stringify({
            badgeType,
            planId: plan.id,
            planName: plan.name,
            price: existingAttempt.amount,
            purchaseId: existingAttempt.id,
            providerReference: providerRef || null,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            renewed: hasActiveBadge,
            onChain: options.metadata?.onChain || null,
          }),
        },
      });

      return {
        alreadyCompleted: false,
        order: { ...existingAttempt, status: VERIFICATION_PURCHASE_STATUS.COMPLETED },
        badge,
        membership,
      };
    });

    return result;
  }
/**
   * Public confirmation used after a completed payment: activates the
   * entitlement for the authenticated user from one of their COMPLETED
   * purchases (idempotent replay is safe). Never activates an unverified one.
   */
  async confirmCompletedPurchase(userId: string, purchaseId: unknown): Promise<any> {
    if (typeof purchaseId !== 'string' || !purchaseId.trim()) {
      throw new Error('purchaseId is required');
    }
    const order = await prisma.verificationPurchase.findFirst({ where: { id: purchaseId, userId } });
    if (!order) throw new Error('Purchase order not found.');
    if (order.status !== VERIFICATION_PURCHASE_STATUS.COMPLETED) {
      throw new Error('This purchase has not been verified as paid yet.');
    }
    // Re-running activation is idempotent and safe.
    return this.activateEntitlementFromOrder(userId, order, {
      mode: order.paymentMode || COIN_PAYMENT_MODE.LIVE,
      providerReference: order.providerReference || undefined,
    });
  }

  // ============================================================
  // LIVE PAYMENT VERIFICATION (PROVIDER WEBHOOK)
  // ============================================================

  /**
   * Process a provider payment webhook for a Verified Badge purchase.
   *
   * Same security contract as the Buy-Coins webhook:
   *  - AUTHENTICATED via HMAC-SHA256 over the raw body (constant-time compare);
   *  - REPLAY-SAFE via WebhookEvent.eventId uniqueness;
   *  - IDEMPOTENT via conditional status claim + unique providerOrderId;
   *  - only a provider-reported success with an exact amount/network match can
   *    activate an entitlement.
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
    /** Optional provider-reported receiving address — must equal the official wallet. */
    recipient?: unknown;
  }): Promise<any> {
    const secret = getCoinPaymentWebhookSecret();
    if (!secret) {
      throw new VerificationPaymentWebhookError(503, 'Payment webhooks are not configured for this deployment.');
    }
    if (typeof input.signature !== 'string' || !input.signature) {
      throw new VerificationPaymentWebhookError(401, 'Missing webhook signature.');
    }
    const expected = CryptoUtils.sha256(`${input.rawBody || ''}${secret}`);
    if (expected.length !== input.signature.length || !CryptoUtils.constantTimeCompare(expected, input.signature)) {
      throw new VerificationPaymentWebhookError(401, 'Invalid webhook signature.');
    }

    const mode = getCoinPaymentMode();
    if (mode !== COIN_PAYMENT_MODE.LIVE) {
      throw new VerificationPaymentWebhookError(503, 'Webhooks are not applicable in this environment.');
    }

    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    if (!eventId) {
      throw new VerificationPaymentWebhookError(400, 'eventId is required.');
    }
    const existingEvent = await prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existingEvent && BLOCKCHAIN_WEBHOOK_FINAL_STATUSES.includes(existingEvent.status)) {
      // FINAL event — acknowledged as a duplicate, never double-processed.
      // FAILED / RECEIVED events are intentionally NOT final: a transient
      // blockchain-RPC outage must be retryable, so a provider re-delivery
      // reprocesses the SAME event row instead of being swallowed.
      return { received: true, duplicate: true, eventId };
    }
    if (existingEvent && existingEvent.status === 'PROCESSING') {
      return { received: true, duplicate: true, eventId };
    }
    // Retry of a previously FAILED/RECEIVED event reuses the existing row
    // (markEvent below updates it) instead of inserting a duplicate.
    const isRetry = Boolean(existingEvent);
    if (!isRetry) {
      await prisma.webhookEvent.create({
        data: {
          provider: 'verification-badge',
          eventId,
          type: 'payment.confirmed',
          rawBody: String(input.rawBody || '').slice(0, 100_000),
          signature: input.signature,
          status: 'RECEIVED',
        },
      });
    }

    const markEvent = async (status: string, error?: string) => {
      await prisma.webhookEvent.update({
        where: { eventId },
        data: { status, error: error || null, processedAt: status === 'PROCESSED' ? new Date() : null },
      });
    };

    const orderId = typeof input.orderId === 'string' ? input.orderId.trim() : '';
    const txHash = typeof input.txHash === 'string' ? input.txHash.trim() : '';
    const network = typeof input.network === 'string' ? input.network.trim() : '';
    const asset = typeof input.asset === 'string' ? input.asset.trim() : '';
    const amount = typeof input.amount === 'number' ? input.amount : NaN;
    const claimedStatus = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';

    try {
      if (!orderId) {
        await markEvent('FAILED', 'Missing orderId');
        return { received: true, result: 'failed', orderId: null, eventId };
      }
      // Live payments must present a blockchain transaction hash in the
      // canonical shape before they can even be considered for verification.
      if (!isValidTransactionHash(txHash)) {
        await markEvent('FAILED', 'Invalid transaction hash');
        return { received: true, result: 'failed', orderId, eventId };
      }

      const order = await prisma.verificationPurchase.findUnique({ where: { id: orderId } });
      if (!order) {
        await markEvent('IGNORED', 'Unknown order');
        return { received: true, result: 'ignored', orderId, eventId };
      }
      if (new Date(order.expiresAt).getTime() < Date.now()) {
        await markEvent('FAILED', 'Order expired');
        await prisma.verificationPurchase.updateMany({
          where: { id: order.id, status: { in: [...VERIFICATION_PURCHASE_ACTIVABLE_STATUSES] } },
          data: { status: VERIFICATION_PURCHASE_STATUS.EXPIRED },
        });
        return { received: true, result: 'expired', orderId, eventId };
      }
      if (!VERIFICATION_PURCHASE_ACTIVABLE_STATUSES.includes(order.status)) {
        await markEvent('IGNORED', `Order not activable (${order.status})`);
        return { received: true, result: 'ignored', orderId, eventId };
      }

      return this.activateFromValidatedWebhook({ eventId, markEvent, order, claimedStatus, amount, txHash, network, asset, recipient: input.recipient });
    } catch (error) {
      await markEvent('FAILED', error instanceof Error ? error.message.slice(0, 500) : 'unknown error');
      throw error;
    }
  }
/**
   * Continues webhook processing after the order has been validated as
   * activable: checks success/amount/network/asset, then activates.
   */
  private async activateFromValidatedWebhook(args: {
    eventId: string;
    markEvent: (status: string, error?: string) => Promise<void>;
    order: any;
    claimedStatus: string;
    amount: number;
    txHash: string;
    network: string;
    asset: string;
    recipient?: unknown;
  }): Promise<any> {
    const { eventId, markEvent, order, claimedStatus, amount, txHash, network, asset, recipient } = args;

    if (claimedStatus !== 'paid' && claimedStatus !== 'confirmed' && claimedStatus !== 'completed') {
      await markEvent('FAILED', 'Provider reported non-successful payment');
      await prisma.verificationPurchase.updateMany({
        where: { id: order.id, status: { in: [VERIFICATION_PURCHASE_STATUS.PENDING, VERIFICATION_PURCHASE_STATUS.PROCESSING] } },
        data: { status: VERIFICATION_PURCHASE_STATUS.FAILED },
      });
      return { received: true, result: 'failed', orderId: order.id, eventId };
    }
    if (Math.abs(amount - order.amount) > 0.005) {
      await markEvent('FAILED', 'Amount mismatch');
      await auditLog.log({
        action: 'VERIFICATION_PAYMENT_WEBHOOK_AMOUNT_MISMATCH',
        severity: 'CRITICAL',
        metadata: { eventId, orderId: order.id, expected: order.amount, actual: amount },
        ipAddress: '[webhook]',
      });
      return { received: true, result: 'failed', orderId: order.id, eventId };
    }
    if (order.network && order.network !== network) {
      await markEvent('FAILED', 'Network mismatch');
      return { received: true, result: 'failed', orderId: order.id, eventId };
    }
    const expectedAsset = networkToAsset(network);
    if (expectedAsset && asset && asset.toUpperCase() !== expectedAsset) {
      await markEvent('FAILED', 'Asset mismatch');
      return { received: true, result: 'failed', orderId: order.id, eventId };
    }

    // ---- INDEPENDENT ON-CHAIN VERIFICATION (defense in depth) ----
    // An HMAC-authenticated provider webhook authenticates the payment pipeline,
    // but a badge is ONLY activated after the backend independently inspects
    // the real on-chain transaction: the recipient must be the OFFICIAL VANTA
    // receiving wallet, the token contract must match the expected asset, the
    // transferred amount must match the order, and the transaction must have
    // enough confirmations on the expected network. Any failure — or an RPC
    // outage — blocks activation (fail closed).
    const verifyingRecipient = getCoinPaymentDepositAddress();
    if (!verifyingRecipient) {
      await markEvent('FAILED', 'Receiving wallet is not configured');
      return { received: true, result: 'failed', orderId: order.id, eventId };
    }
    if (
      typeof recipient === 'string' &&
      recipient.trim() &&
      recipient.trim().toLowerCase() !== verifyingRecipient.toLowerCase()
    ) {
      await markEvent('FAILED', 'Recipient does not match the official wallet');
      await auditLog.log({
        action: 'VERIFICATION_PAYMENT_WEBHOOK_RECIPIENT_MISMATCH',
        severity: 'CRITICAL',
        metadata: { eventId, orderId: order.id, txHash, expected: verifyingRecipient },
        ipAddress: '[webhook]',
      });
      return { received: true, result: 'failed', orderId: order.id, eventId };
    }
    let onChain: Record<string, unknown> | null = null;
    try {
      const verified = await blockchainTxVerifier.withRetry(() =>
        blockchainTxVerifier.verifyTransaction({
          txHash,
          network,
          expectedAmountUsd: order.amount,
          expectedRecipient: verifyingRecipient,
          minConfirmations: getMinBlockchainConfirmations(),
        })
      );
      onChain = verified;
    } catch (error) {
      if (error instanceof BlockchainTxVerificationError) {
        await markEvent(
          'FAILED',
          error.transient
            ? `On-chain verification retryable: ${error.code}`
            : `On-chain verification rejected: ${error.code}`
        );
        await auditLog.log({
          action: error.transient
            ? 'VERIFICATION_PAYMENT_WEBHOOK_VERIFY_RETRYABLE'
            : 'VERIFICATION_PAYMENT_WEBHOOK_VERIFY_REJECTED',
          severity: error.transient ? 'WARNING' : 'CRITICAL',
          metadata: {
            eventId,
            orderId: order.id,
            txHash,
            network,
            code: error.code,
            reason: error.message.slice(0, 400),
          },
          ipAddress: '[webhook]',
        });
        if (error.transient) {
          // RPC outage: keep the order PENDING/PROCESSING and let the provider
          // retry the webhook (the event row is retryable). No activation occurs.
          throw error;
        }
        return { received: true, result: 'failed', orderId: order.id, eventId };
      }
      throw error;
    }

    let result: any;
    try {
      result = await this.activateEntitlementFromOrder(order.userId, order, {
        mode: COIN_PAYMENT_MODE.LIVE,
        providerReference: txHash,
        ipAddress: '[webhook]',
        metadata: { onChain: onChain || undefined },
      });
    } catch (error) {
      if (isP2002(error)) {
        await markEvent('PROCESSED', 'Transaction hash already used');
        return { received: true, duplicate: true, orderId: order.id, eventId };
      }
      throw error;
    }

    await markEvent('PROCESSED');
    await auditLog.log({
      userId: order.userId,
      action: 'VERIFICATION_PURCHASE_WEBHOOK_COMPLETED',
      ipAddress: '[webhook]',
      metadata: { eventId, orderId: order.id, txHash, amount, planId: order.planId, duplicate: Boolean(result?.alreadyCompleted) },
    });

    return {
      received: true,
      orderId: order.id,
      eventId,
      alreadyCompleted: Boolean(result?.alreadyCompleted),
      status: VERIFICATION_PURCHASE_STATUS.COMPLETED,
    };
  }

  // ============================================================
  // ORDER LIFE-CYCLE MAINTENANCE
  // ============================================================

  /** Flip stale PENDING/PROCESSING/PAID orders to EXPIRED (non-activating). */
  async expireStaleOrders(): Promise<number> {
    const updated = await prisma.verificationPurchase.updateMany({
      where: {
        status: {
          in: [VERIFICATION_PURCHASE_STATUS.PENDING, VERIFICATION_PURCHASE_STATUS.PROCESSING, VERIFICATION_PURCHASE_STATUS.PAID],
        },
        expiresAt: { lt: new Date() },
      },
      data: { status: VERIFICATION_PURCHASE_STATUS.EXPIRED },
    });
    return updated.count;
  }

  /** Server-side expiry of any over-due ACTIVE badge. */
  async expireOverdueBadges(): Promise<number> {
    const now = new Date();
    const overdue = await prisma.verificationBadge.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: { id: true, userId: true, badgeType: true },
    });

    if (overdue.length > 0) {
      await prisma.verificationBadge.updateMany({
        where: { id: { in: overdue.map((b) => b.id) } },
        data: { status: 'EXPIRED', updatedAt: now },
      });
    }

    for (const badge of overdue) {
      // When a GOLD badge expires the creator membership expires too, keeping
      // the two linked entitlements consistent server-side.
      await prisma.creatorMembership.updateMany({
        where: { userId: badge.userId, status: 'ACTIVE' },
        data: { status: 'EXPIRED', updatedAt: now },
      });
      await prisma.verificationHistory.create({
        data: {
          userId: badge.userId,
          action: 'BADGE_EXPIRED',
          details: JSON.stringify({ badgeType: badge.badgeType, expiredAt: now.toISOString() }),
        },
      });
    }
    return overdue.length;
  }

  // ============================================================
  // USER HISTORY
  // ============================================================

  async getUserPurchases(userId: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(Math.max(1, Number.isFinite(+limit) ? Math.trunc(+limit) : 50), 200);
    const safeOffset = Math.max(0, Number.isFinite(+offset) ? Math.trunc(+offset) : 0);
    const [purchases, total] = await Promise.all([
      prisma.verificationPurchase.findMany({
        where: { userId },
        include: { plan: { select: { id: true, name: true, badgeType: true, durationMonths: true, price: true } } },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: safeOffset,
      }),
      prisma.verificationPurchase.count({ where: { userId } }),
    ]);
    return { purchases, total, limit: safeLimit, offset: safeOffset };
  }

  /** Catalog plans (server-authoritative display data for the purchase UI). */
  async getBadgePlans(): Promise<VerifiedBadgePlan[]> {
    return VERIFIED_BADGE_PLANS.map((p) => ({ ...p }));
  }
// ============================================================
  // ADMIN
  // ============================================================

  async listPurchases(options: { limit?: number; offset?: number; status?: string } = {}) {
    const limit = Math.min(Math.max(1, Math.trunc(options.limit || 50)), 500);
    const offset = Math.max(0, Math.trunc(options.offset || 0));
    const status = typeof options.status === 'string' && options.status.trim() ? options.status.trim().toUpperCase() : null;
    const where = status ? { status } : {};
    const [purchases, total] = await Promise.all([
      prisma.verificationPurchase.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, email: true, fullName: true } },
          plan: { select: { id: true, name: true, badgeType: true, durationMonths: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.verificationPurchase.count({ where }),
    ]);
    return { purchases, total, limit, offset };
  }

  async getDashboard() {
    const statuses = VERIFICATION_PURCHASE_STATUS;
    const [total, completed, pending, failed, expired, refunded, revenue, activeBadges, recent] = await Promise.all([
      prisma.verificationPurchase.count(),
      prisma.verificationPurchase.count({ where: { status: statuses.COMPLETED } }),
      prisma.verificationPurchase.count({ where: { status: statuses.PENDING } }),
      prisma.verificationPurchase.count({ where: { status: statuses.FAILED } }),
      prisma.verificationPurchase.count({ where: { status: statuses.EXPIRED } }),
      prisma.verificationPurchase.count({ where: { status: statuses.REFUNDED } }),
      prisma.verificationPurchase.aggregate({ where: { status: statuses.COMPLETED }, _sum: { amount: true } }),
      prisma.verificationBadge.count({ where: { status: 'ACTIVE' } }),
      prisma.verificationPurchase.findMany({
        include: { user: { select: { id: true, username: true, email: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      stats: {
        totalPurchases: total,
        completed,
        pending,
        failed,
        expired,
        refunded,
        totalRevenueUSD: revenue._sum.amount || 0,
        activeBadges,
      },
      recent,
    };
  }

  /**
   * Refund a completed Verified Badge purchase.
   *
   * The original row is NEVER deleted — it is marked REFUNDED (conditional
   * claim, so a double-refund can never run twice). If the user's currently
   * active badge was activated by this purchase, the entitlement is expired
   * server-side so the badge stops displaying immediately.
   */
  async refundPurchase(adminId: string, purchaseId: string, reason: string, ipAddress?: string): Promise<any> {
    const order = await prisma.verificationPurchase.findUnique({ where: { id: purchaseId } });
    if (!order) throw new Error('Purchase not found');
    if (order.status !== VERIFICATION_PURCHASE_STATUS.COMPLETED) {
      throw new Error('Only completed purchases can be refunded');
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.verificationPurchase.updateMany({
        where: { id: purchaseId, status: VERIFICATION_PURCHASE_STATUS.COMPLETED },
        data: {
          status: VERIFICATION_PURCHASE_STATUS.REFUNDED,
          refundedAt: new Date(),
          refundedBy: adminId,
          refundReason: reason || 'Refunded by admin',
          updatedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        const current = await tx.verificationPurchase.findUnique({ where: { id: purchaseId } });
        if (current?.status === VERIFICATION_PURCHASE_STATUS.REFUNDED) {
          throw new Error('This purchase was already refunded');
        }
        throw new Error('This purchase cannot be refunded');
      }

      // Reverse the entitlement if and only if the current active badge was
      // activated by this exact purchase.
      const activeBadge = await tx.verificationBadge.findUnique({ where: { userId: order.userId } });
      if (activeBadge?.status === 'ACTIVE' && activeBadge.sourcePurchaseId === purchaseId) {
        await tx.verificationBadge.update({
          where: { userId: order.userId },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedBy: adminId,
            revokeReason: reason || 'Purchase refunded',
            updatedAt: new Date(),
          },
        });
        if (activeBadge.badgeType === 'GOLD') {
          await tx.creatorMembership.updateMany({
            where: { userId: order.userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() },
          });
        }
        await tx.verificationHistory.create({
          data: {
            userId: order.userId,
            action: 'BADGE_REVOKED_REFUND',
            performedBy: adminId,
            details: JSON.stringify({ purchaseId, reason: reason || 'Purchase refunded' }),
          },
        });
      }
    });

    await auditLog.log({
      userId: adminId,
      action: 'VERIFICATION_PURCHASE_REFUNDED',
      ipAddress,
      metadata: { purchaseId, amount: order.amount, reason: reason || null },
    });

    return { success: true, purchaseId };
  }
}

export const verificationPaymentService = new VerificationPaymentService();