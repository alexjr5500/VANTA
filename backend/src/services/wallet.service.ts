import { prisma } from "../prisma";
import type { Prisma } from "@prisma/client";

type WalletPinProof = { id: string; walletId: string; pinHash: string };
type WalletTwoFactorState = { enabled: boolean; secret: string | null };
import { notificationService } from "./notification.service";
import { emailService } from "./email.service";
import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import { calculateTransferFee, coinsToUsd, VANTA_COINS_PER_USD, WITHDRAWAL_FEE_RATE, MIN_WITHDRAWAL_AMOUNT, PLATFORM_TRANSFER_LIMITS } from "../config/wallet.config";
import { validateWithdrawalInput } from "./wallet-input-validation";
import { twoFactorAuth } from "../security/twoFactorAuth";
import { blockchainTxVerifier } from "./blockchain-verifier.service";
import {
  COIN_PAYMENT_ORDER_TTL_SECONDS,
  COIN_PAYMENT_CREDITABLE_STATUSES,
  COIN_PAYMENT_STATUS,
  isCoinPaymentTestMode,
  verifyCoinPaymentSimulateToken,
} from "../config/coin-payments.config";

// ============================================================================
// TRANSACTION TYPE CONSTANTS
// ============================================================================

export const TX_TYPES = {
  DEPOSIT: "DEPOSIT",
  PURCHASE: "PURCHASE",
  TRANSFER_SENT: "TRANSFER_SENT",
  TRANSFER_RECEIVED: "TRANSFER_RECEIVED",
  GIFT_SENT: "GIFT_SENT",
  GIFT_RECEIVED: "GIFT_RECEIVED",
  WITHDRAWAL: "WITHDRAWAL",
  REFUND: "REFUND",
  FEE: "FEE",
  SUBSCRIPTION: "SUBSCRIPTION",
  CREATOR_EARNING: "CREATOR_EARNING",
  ADMIN_CREDIT: "ADMIN_CREDIT",
  ADMIN_DEBIT: "ADMIN_DEBIT",
  SYSTEM_CREDIT: "SYSTEM_CREDIT",
  // Gold Verified Follower Rewards ledger (campaign reservation/distribution).
  // Every financial state change of a Follower Reward campaign is mirrored as
  // exactly one of these WalletTransaction rows so balances are fully auditable.
  FOLLOWER_REWARD_RESERVE: "FOLLOWER_REWARD_RESERVE",
  FOLLOWER_REWARD_CLAIM: "FOLLOWER_REWARD_CLAIM",
  FOLLOWER_REWARD_REFUND: "FOLLOWER_REWARD_REFUND",
  FOLLOWER_REWARD_RELEASE: "FOLLOWER_REWARD_RELEASE",
} as const;

// Types that represent money coming IN (positive)
const INCOMING_TYPES = new Set([
  TX_TYPES.DEPOSIT,
  TX_TYPES.PURCHASE,
  TX_TYPES.TRANSFER_RECEIVED,
  TX_TYPES.GIFT_RECEIVED,
  TX_TYPES.REFUND,
  TX_TYPES.ADMIN_CREDIT,
  TX_TYPES.SYSTEM_CREDIT,
  TX_TYPES.FOLLOWER_REWARD_CLAIM,
  TX_TYPES.FOLLOWER_REWARD_REFUND,
  TX_TYPES.FOLLOWER_REWARD_RELEASE,
  TX_TYPES.CREATOR_EARNING,
]);

// Types that represent money going OUT (negative)
const OUTGOING_TYPES = new Set([
  TX_TYPES.TRANSFER_SENT,
  TX_TYPES.GIFT_SENT,
  TX_TYPES.WITHDRAWAL,
  TX_TYPES.FEE,
  TX_TYPES.SUBSCRIPTION,
  TX_TYPES.ADMIN_DEBIT,
  TX_TYPES.FOLLOWER_REWARD_RESERVE,
]);

// Follower Reward claims move coins from the creator to the claimant. The
// ledger uses ONE transaction type (FOLLOWER_REWARD_CLAIM) for both sides and
// records which party the row belongs to in `metadata.side`.
const FOLLOWER_REWARD_CLAIM_TYPE = TX_TYPES.FOLLOWER_REWARD_CLAIM;

/**
 * Resolve the signed coin movement represented by a wallet ledger row.
 * Follower reward claims use one transaction type for both parties, so their
 * metadata.side field is required to distinguish creator debit from claimant
 * credit. Unknown/missing side data fails closed instead of guessing.
 */
function readWalletTransactionMetadata(metadata?: string | null): Record<string, any> | null {
  if (!metadata) return null;
  try {
    const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The retired monetization gift path stored USD creator earnings in a
 * GIFT_RECEIVED row using the default VANTA currency. The canonical gift path
 * now stores spendable recipient coins in GIFT_RECEIVED and cash earnings in a
 * separate CREATOR_EARNING/USD row. Identify only the legacy shape so old
 * creator balances can still be reconciled without counting the cash amount
 * as coins or double-counting current gifts.
 */
function isLegacyCashGiftCredit(transaction: {
  type: string;
  currency?: string | null;
  metadata?: string | null;
}): boolean {
  if (transaction.type !== TX_TYPES.GIFT_RECEIVED || transaction.currency === 'USD') return false;
  const metadata = readWalletTransactionMetadata(transaction.metadata);
  return metadata?.autoConverted !== true &&
    Number.isFinite(Number(metadata?.creatorEarningsUsd));
}

function resolveWalletTransactionDelta(transaction: {
  type: string;
  amount: number;
  metadata?: string | null;
  currency?: string | null;
}): number | null {
  if (isLegacyCashGiftCredit(transaction)) return null;
  if (transaction.type === FOLLOWER_REWARD_CLAIM_TYPE) {
    let metadata: any = null;
    try {
      metadata = typeof transaction.metadata === 'string'
        ? JSON.parse(transaction.metadata)
        : transaction.metadata;
    } catch {
      metadata = null;
    }
    if (metadata?.side === 'creator') return -Math.abs(transaction.amount);
    if (metadata?.side === 'claimant') return Math.abs(transaction.amount);
    return null;
  }
  // Purchase refunds debit the coin wallet; historical reservation refunds can credit it.
  if (transaction.type === TX_TYPES.REFUND) return transaction.amount;
  if (INCOMING_TYPES.has(transaction.type as any)) return Math.abs(transaction.amount);
  if (OUTGOING_TYPES.has(transaction.type as any)) return -Math.abs(transaction.amount);
  return null;
}

/** Available (spendable) coins = coinBalance - lockedCoins (reserved). */
export function resolveAvailableCoins(wallet: { coinBalance: number; lockedCoins?: number }): number {
  return Math.max(0, (wallet.coinBalance || 0) - (wallet.lockedCoins || 0));
}

/** UTC start of today (used for daily-limit rollover). */
export function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface EffectiveTransferLimits {
  dailyLimit: number;
  singleTxLimit: number;
  otpThreshold: number;
}

/**
 * Effective transfer limits = min(user-configured TransferLimit, platform cap).
 *
 * A user may LOWER their own limits for extra safety, but the server always
 * clamps them against PLATFORM_TRANSFER_LIMITS so a compromised account can
 * never raise its own risk controls (Phase 6). Every transfer enforces these
 * effective values inside the database transaction.
 */
export function resolveEffectiveTransferLimits(
  limit?: { dailyLimit?: number; singleTxLimit?: number; otpThreshold?: number } | null
): EffectiveTransferLimits {
  const cap = PLATFORM_TRANSFER_LIMITS;
  const clamp = (value: number | undefined, fallback: number, max: number): number => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(0, Math.trunc(value)), max);
  };
  return {
    dailyLimit: clamp(limit?.dailyLimit, cap.maxDaily, cap.maxDaily),
    singleTxLimit: clamp(limit?.singleTxLimit, cap.maxSingleTxLimit, cap.maxSingleTxLimit),
    otpThreshold: Math.min(
      Math.max(cap.minOtpThreshold, clamp(limit?.otpThreshold, cap.maxOtpThreshold, cap.maxOtpThreshold)),
      cap.maxOtpThreshold
    ),
  };
}

/** OTP delivery/expiry policy for transfer step-up (matches OTP_EXPIRY_MINUTES). */
export const TRANSFER_OTP_CONSTANTS = Object.freeze({
  length: 6,
  expiryMs: 10 * 60 * 1000, // 10 minutes
  maxAttempts: 3,
} as const);

// ============================================================================
// HELPER: Resolve user display info
// ============================================================================

async function getUserDisplayInfo(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, fullName: true },
  });
  if (!user) return { id: userId, username: "unknown", displayName: "Unknown User" };
  return {
    id: user.id,
    username: user.username,
    displayName: user.fullName || user.username,
  };
}

function formatUserLabel(user: { username: string; displayName: string }): string {
  if (user.displayName && user.displayName !== user.username) {
    return `${user.displayName} (@${user.username})`;
  }
  return `@${user.username}`;
}

export function formatSignedAmount(amount: number, isIncoming: boolean): string {
  const absoluteAmount = Math.abs(amount || 0);
  return `${isIncoming ? '+' : '-'}${absoluteAmount.toLocaleString()}`;
}

export function buildTransactionDescription(type: string, amount: number, counterpartyLabel?: string, note?: string): string {
  const safeAmount = Math.abs(amount || 0).toLocaleString();
  switch (type) {
    case TX_TYPES.TRANSFER_SENT:
      return `Sent ${safeAmount} VANTA Coins to ${counterpartyLabel || 'recipient'}${note ? `: ${note}` : ''}`;
    case TX_TYPES.TRANSFER_RECEIVED:
      return `Received ${safeAmount} VANTA Coins from ${counterpartyLabel || 'sender'}`;
    case TX_TYPES.GIFT_SENT:
      return `Sent gift to ${counterpartyLabel || 'recipient'}`;
    case TX_TYPES.GIFT_RECEIVED:
      return `Received gift from ${counterpartyLabel || 'sender'}`;
    case TX_TYPES.DEPOSIT:
      return `Deposited ${safeAmount} VANTA Coins`;
    case TX_TYPES.PURCHASE:
      return `Purchased ${safeAmount} VANTA Coins`;
    case TX_TYPES.WITHDRAWAL:
      return `Requested withdrawal of ${safeAmount} VANTA Coins`;
    case TX_TYPES.REFUND:
      return `Refunded ${safeAmount} VANTA Coins`;
    case TX_TYPES.SUBSCRIPTION:
      return `Creator subscription ${safeAmount} VANTA Coins`;
    case TX_TYPES.CREATOR_EARNING:
      return `Creator earnings ${safeAmount} USD`;
    case TX_TYPES.FOLLOWER_REWARD_RESERVE:
      return `Reserved ${safeAmount} VANTA Coins for a Follower Reward`;
    case TX_TYPES.FOLLOWER_REWARD_REFUND:
      return `Follower Reward refund: ${safeAmount} VANTA Coins returned`;
    case TX_TYPES.FOLLOWER_REWARD_RELEASE:
      return `Follower Reward release: ${safeAmount} VANTA Coins returned`;
    case TX_TYPES.FOLLOWER_REWARD_CLAIM:
      return `Follower Reward: ${safeAmount} VANTA Coins`;
    default:
      return `${type.replace(/_/g, ' ').toLowerCase()} ${safeAmount} VANTA Coins`;
  }
}

// ============================================================================
// WALLET SERVICE
// ============================================================================

export class WalletService {
  // ============================================================
  // WALLET INITIALIZATION
  // ============================================================

  async ensureWallet(userId: string) {
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId },
      });
      // Create default transfer limits
      await prisma.transferLimit.create({
        data: { walletId: wallet.id },
      });
    }
    return wallet;
  }

  // ============================================================
  // WALLET & BALANCE
  // ============================================================

  async getWallet(userId: string) {
    const wallet = await this.ensureWallet(userId);
    const transferLimit = await prisma.transferLimit.findUnique({
      where: { walletId: wallet.id },
    });
    const pin = await prisma.walletPIN.findUnique({
      where: { walletId: wallet.id },
    });

    // Compute derived balances
    const [pendingByCurrency, pendingWithdrawals, completedWithdrawals] = await Promise.all([
      prisma.walletTransaction.groupBy({
        by: ["currency"], where: { userId, status: "PENDING" },
        _count: { _all: true }, _sum: { amount: true },
      }),
      prisma.withdrawal.aggregate({
        where: { userId, status: { in: ["PENDING", "PROCESSING", "APPROVED", "PAYOUT_RESERVED"] } },
        _count: { _all: true }, _sum: { amount: true, netAmount: true },
      }),
      prisma.withdrawal.aggregate({
        where: { userId, status: "COMPLETED" },
        _count: { _all: true }, _sum: { netAmount: true },
      }),
    ]);
    // Legacy pendingBalance is retained for compatibility; new UI never mixes currencies.
    const pendingBalance = pendingByCurrency.reduce((sum, row) => sum + (row._sum.amount || 0), 0);
    const limits = resolveEffectiveTransferLimits(transferLimit);
    const dailyUsed = transferLimit && transferLimit.lastResetDate >= startOfUTCDay(new Date()) ? transferLimit.dailyUsed : 0;
    const availableCoins = resolveAvailableCoins(wallet);
    const lockedBalance = wallet.lockedCoins || 0;
    const usdtBalance = wallet.earningsBalance || 0;
    const usdEstimate = coinsToUsd(wallet.coinBalance || 0);
    const totalPortfolioValue = usdEstimate + (wallet.earningsBalance || 0);

    return {
      ...wallet,
      transferLimit,
      availableCoins,
      effectiveTransferLimits: {
        ...limits, dailyUsed, dailyRemaining: Math.max(0, limits.dailyLimit - dailyUsed),
      },
      pendingTransactions: pendingByCurrency.map(row => ({
        currency: row.currency, count: row._count._all, amount: row._sum.amount || 0,
      })),
      pendingWithdrawals: {
        count: pendingWithdrawals._count._all,
        grossUsd: pendingWithdrawals._sum.amount || 0,
        netUsd: pendingWithdrawals._sum.netAmount || 0,
      },
      completedWithdrawals: { count: completedWithdrawals._count._all, netUsd: completedWithdrawals._sum.netAmount || 0 },
      hasPin: !!pin,
      pendingBalance,
      lockedBalance,
      usdtBalance,
      usdEstimate,
      exchangeRate: { coinsPerUsd: VANTA_COINS_PER_USD, currency: "USD" },
      totalPortfolioValue,
    };
  }

  async getBalance(userId: string) {
    const wallet = await this.ensureWallet(userId);
    return {
      coinBalance: wallet.coinBalance,
      availableCoins: resolveAvailableCoins(wallet),
      earningsBalance: wallet.earningsBalance,
      totalCoinsPurchased: wallet.totalCoinsPurchased,
      totalCoinsReceived: wallet.totalCoinsReceived,
      totalCoinsSent: wallet.totalCoinsSent,
      totalGiftsSent: wallet.totalGiftsSent,
      totalGiftsReceived: wallet.totalGiftsReceived,
      totalWithdrawn: wallet.totalWithdrawn,
      lifetimeEarnings: wallet.lifetimeEarnings,
      bonusCoins: wallet.bonusCoins,
      lockedCoins: wallet.lockedCoins,
      isFrozen: wallet.isFrozen,
      usdtWalletAddress: wallet.usdtWalletAddress,
      pendingBalance: await this.getPendingBalance(userId),
      usdEstimate: coinsToUsd(wallet.coinBalance || 0),
      exchangeRate: { coinsPerUsd: VANTA_COINS_PER_USD, currency: "USD" },
      totalPortfolioValue: coinsToUsd(wallet.coinBalance || 0) + (wallet.earningsBalance || 0),
    };
  }

  private async getPendingBalance(userId: string): Promise<number> {
    const pending = await prisma.walletTransaction.aggregate({
      where: {
        userId,
        status: "PENDING",
      },
      _sum: { amount: true },
    });
    return pending._sum.amount || 0;
  }

  // ============================================================
  // COIN DEDUCTION (for gifts, purchases, etc.)
  // ============================================================

  async deductCoins(userId: string, amount: number, options?: {
    type?: string;
    description?: string;
    reference?: string;
    metadata?: any;
  }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Amount must be a positive whole number of coins");
    }
    const wallet = await this.ensureWallet(userId);

    if (wallet.isFrozen) {
      throw new Error("Wallet is frozen. Contact support.");
    }

    // Reserved coins (Follower Rewards, etc.) are never spendable elsewhere:
    // available = coinBalance - lockedCoins. This matches the existing
    // gift/wallet convention (see gift.service validateWallet).
    const availableBalance = resolveAvailableCoins(wallet);
    if (availableBalance < amount) {
      throw new Error(
        `Insufficient coins. You have ${availableBalance} available but need ${amount}.`
      );
    }

    // Atomic transaction: update wallet + create transaction record
    const result = await prisma.$transaction(async (tx) => {
      const currentWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (currentWallet.isFrozen || resolveAvailableCoins(currentWallet) < amount) {
        throw new Error("Insufficient available coins");
      }
      const debit = await tx.wallet.updateMany({
        where: {
          id: currentWallet.id,
          isFrozen: false,
          coinBalance: currentWallet.coinBalance,
          lockedCoins: currentWallet.lockedCoins,
        },
        data: {
          coinBalance: { decrement: amount },
          totalCoinsSent: { increment: amount },
        },
      });
      if (debit.count !== 1) throw new Error("Balance changed while spending. Please try again.");
      const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });

      // Record transaction - store positive amount, sign derived from type
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: options?.type || "GIFT_SENT",
          amount: Math.abs(amount),
          fee: 0,
          balanceBefore: currentWallet.coinBalance,
          balance: updatedWallet.coinBalance,
          status: "COMPLETED",
          description: options?.description || `Spent ${amount.toLocaleString()} VANTA Coins`,
          reference: options?.reference,
          metadata: options?.metadata ? JSON.stringify(options.metadata) : undefined,
        },
      });

      return updatedWallet;
    });

    return result;
  }

  // ============================================================
  // COIN DEPOSITS (0% Platform Fee)
  // ============================================================

  // Retained for older imports only. The legacy controller already returns 410.
  // Never credit an unverified deposit, even from an internal caller.
  async processDeposit(
    _userId: string,
    _amount: number,
    _coins: number,
    _paymentMethod: string,
    _providerOrderId: string,
    _ipAddress?: string
  ): Promise<never> {
    throw new Error("Legacy deposits are disabled; verified purchase fulfillment is required.");
  }

  // ============================================================
  // COIN PURCHASE COMPLETION (atomic, idempotent)
  // ============================================================

  /**
   * Completes a coin purchase order and credits the buyer's wallet exactly once.
   *
   * This is the single path that turns a confirmed payment into coins:
   *  - `mode === 'test'`: the backend's test payment gateway confirms a
   *    *simulated* payment. The caller must present the order's HMAC simulate
   *    token (issued at order-initialization time). Test mode is blocked in
   *    production (see config/coin-payments.config.ts).
   *  - other modes: callers should only invoke this after the payment provider
   *    has independently verified the payment (webhook); the method itself stays
   *    provider-agnostic.
   *
   * The completion is guarded by a conditional UPDATE (`status: 'PENDING'`), so
   * a repeated webhook/callback or a double-tap on "complete payment" can never
   * credit the same order twice.
   */
  async completeCoinPurchase(
    userId: string,
    orderId: string,
    options: {
      mode: string;
      simulateToken?: string;
      /** External provider reference (e.g. blockchain tx hash) for the order. */
      providerOrderId?: string;
      /** Optional verified-provider details stored for auditability. */
      verification?: Record<string, unknown>;
      ipAddress?: string;
    } = { mode: "live" }
  ) {
    if (options.mode !== "live" && options.mode !== "test") {
      throw new Error("Unsupported purchase completion mode.");
    }
    const order = await prisma.purchaseOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new Error("Purchase order not found.");
    if (order.status === COIN_PAYMENT_STATUS.COMPLETED) {
      // Idempotent replay — already credited, return the existing result.
      return { order, coins: order.coins, alreadyCompleted: true };
    }
    if (order.status === COIN_PAYMENT_STATUS.REFUNDED) {
      throw new Error("This purchase was refunded and cannot be completed again.");
    }
    if (!COIN_PAYMENT_CREDITABLE_STATUSES.includes(order.status)) {
      throw new Error(`This purchase order cannot be completed (status: ${order.status}).`);
    }
    if (COIN_PAYMENT_ORDER_TTL_SECONDS > 0) {
      const createdAt = new Date(order.createdAt).getTime();
      if (Date.now() - createdAt > COIN_PAYMENT_ORDER_TTL_SECONDS * 1000) {
        throw new Error("This payment session has expired. Please start a new purchase.");
      }
    }

    if (!Number.isSafeInteger(order.coins) || order.coins <= 0 ||
        !Number.isFinite(order.amount) || order.amount <= 0) {
      throw new Error("Invalid purchase order amount.");
    }
    if (options.mode === "live" && (order.paymentMode !== "live" ||
        typeof options.providerOrderId !== "string" ||
        !/^0x[a-fA-F0-9]{64}$/.test(options.providerOrderId.trim()) ||
        !options.verification || typeof options.verification !== "object")) {
      throw new Error("Verified live payment reference is required.");
    }

    if (options.mode === "test") {
      // A production deployment can never be in test mode, and the client must
      // present the token the backend signed when the order was created.
      if (!isCoinPaymentTestMode()) {
        throw new Error("Test payment mode is disabled in this environment.");
      }
      if (!(options.simulateToken && verifyCoinPaymentSimulateToken(order, options.simulateToken))) {
        throw new Error("Invalid test payment confirmation. Please start a new purchase.");
      }
    }

    const wallet = await this.ensureWallet(userId);
    if (wallet.isFrozen) {
      throw new Error("Wallet is frozen. Contact support.");
    }

    // The providerOrderId is the strongest duplicate guard: in live mode it is
    // the blockchain transaction hash, and PurchaseOrder.providerOrderId has a
    // UNIQUE constraint at the database level.
    const providerReference = options.mode === "live" ? options.providerOrderId!.trim().toLowerCase() : "";
    const providerOrderId = options.mode === "test"
      ? `test:${orderId}`
      : `live:${providerReference}`;

    // Conditional status flip makes the completion idempotent under concurrency:
    // a second request finds 0 rows updated and cannot credit twice.
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: orderId, userId, coins: order.coins, amount: order.amount,
          paymentMode: order.paymentMode, paymentMethod: order.paymentMethod,
          status: { in: [...COIN_PAYMENT_CREDITABLE_STATUSES] } },
        data: {
          status: COIN_PAYMENT_STATUS.COMPLETED,
          providerOrderId,
          providerReference: providerReference || null,
          paymentMethod: order.paymentMethod,
          paymentMode: options.mode || order.paymentMode,
          confirmedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        const current = await tx.purchaseOrder.findUnique({ where: { id: orderId } });
        if (current?.status === "COMPLETED") return null;
        throw new Error("This purchase order was already processed.");
      }

      const updatedWallet = await tx.wallet.update({
        where: { userId, isFrozen: false },
        data: {
          coinBalance: { increment: order.coins },
          totalCoinsPurchased: { increment: order.coins },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TX_TYPES.PURCHASE,
          amount: order.coins,
          fee: 0,
          balanceBefore: updatedWallet.coinBalance - order.coins,
          balance: updatedWallet.coinBalance,
          status: "COMPLETED",
          description: `Purchased ${order.coins.toLocaleString()} VANTA Coins for $${order.amount.toFixed(2)}`,
          reference: orderId,
          metadata: JSON.stringify({
            paymentMethod: order.paymentMethod,
            provider: order.provider,
            mode: options.mode,
            providerOrderId,
            verification: options.verification || undefined,
          }),
        },
      });

      await tx.walletAuditLog.create({
        data: {
          userId,
          action: "COIN_PURCHASE_COMPLETED",
          details: JSON.stringify({
            orderId,
            amount: order.amount,
            coins: order.coins,
            mode: options.mode,
            ipAddress: options.ipAddress,
          }),
          ipAddress: options.ipAddress,
        },
      });

      return { updatedWallet, order: { ...order, status: "COMPLETED" } };
    });

    if (result === null) {
      const existing = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
      return { order: existing || order, coins: order.coins, alreadyCompleted: true };
    }

    // Notification runs outside the transaction — a notification failure must
    // never roll back a successful, idempotently-completed purchase.
    try {
      await notificationService.createNotification(
        userId,
        "WALLET_DEPOSIT",
        "Deposit Successful",
        `${order.coins.toLocaleString()} VANTA Coins have been added to your Balance.`,
        { coins: order.coins, amount: order.amount }
      );
    } catch {
      // Ignore: the purchase itself already succeeded.
    }
    return { order: result.order, coins: order.coins, wallet: result.updatedWallet, alreadyCompleted: false };
  }

  // COIN PURCHASE REFUNDS (auditable, immutable original)
  // ============================================================

  /**
   * Refund a completed coin purchase.
   *
   * Safety:
   *  - The original PurchaseOrder row is NEVER deleted — it is marked REFUNDED
   *    and a separate negative REFUND ledger entry is created.
   *  - Refund claim is conditional (status COMPLETED only), so a
   *    repeated refund request can never run twice.
   *  - The user's spendable balance must cover the refund; otherwise the
   *    refund is rejected so a user cannot end up with unlimited coins by
   *    chaining purchases and refunds.
   */
  async refundCoinPurchase(
    adminUserId: string,
    orderId: string,
    reason?: string,
    ipAddress?: string
  ) {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Purchase order not found.");
    if (order.status === "REFUNDED") {
      return { order, alreadyRefunded: true };
    }
    if (order.status !== "COMPLETED") {
      throw new Error(
        `Only completed purchases can be refunded (current status: ${order.status}).`
      );
    }

    const refundReason = (reason || "").trim().slice(0, 500) || null;

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: orderId, status: "COMPLETED", coins: order.coins, userId: order.userId },
        data: {
          status: "REFUNDED",
          refundedAt: new Date(),
          refundedBy: adminUserId,
          refundReason: refundReason,
        },
      });

      if (claimed.count === 0) {
        const current = await tx.purchaseOrder.findUnique({ where: { id: orderId } });
        if (current?.status === "REFUNDED") return null;
        throw new Error("This purchase cannot be refunded.");
      }

      const walletBefore = await tx.wallet.findUnique({ where: { userId: order.userId } });
      if (!walletBefore) throw new Error("Wallet not found");

      // Claim the refund only if the current spendable balance still covers
      // the debit. This is checked atomically with the balance update so a
      // concurrent purchase/gift/transfer cannot make the wallet negative.
      const balanceClaim = await tx.wallet.updateMany({
        where: { userId: order.userId, coinBalance: { gte: order.coins } },
        data: { coinBalance: { decrement: order.coins } },
      });
      if (balanceClaim.count !== 1) {
        throw new Error("Refund deferred: the current wallet balance is below the refundable coin amount");
      }
      const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.userId } });

      // Negative ledger entry: the original PURCHASE entry stays intact.
      await tx.walletTransaction.create({
        data: {
          walletId: walletBefore.id,
          userId: order.userId,
          type: "REFUND",
          amount: -order.coins,
          fee: 0,
          balanceBefore: updatedWallet.coinBalance + order.coins,
          balance: updatedWallet.coinBalance,
          status: "COMPLETED",
          description: `Refund of ${order.coins.toLocaleString()} VANTA Coins for purchase ${orderId}`,
          reference: orderId,
          metadata: JSON.stringify({
            adminId: adminUserId,
            reason: refundReason,
            orderId,
            paymentMode: order.paymentMode,
          }),
        },
      });

      await tx.walletAuditLog.create({
        data: {
          userId: order.userId,
          action: "COIN_PURCHASE_REFUNDED",
          details: JSON.stringify({
            orderId,
            adminId: adminUserId,
            reason: refundReason,
            coins: order.coins,
          }),
          ipAddress,
        },
      });

      return { order: { ...order, status: "REFUNDED" }, updatedWallet };
    });

    if (result === null) {
      const current = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
      return { order: current || order, alreadyRefunded: true };
    }

    try {
      await notificationService.createNotification(
        order.userId,
        "WALLET_REFUND",
        "Refund Processed",
        `${order.coins.toLocaleString()} VANTA Coins were returned to your Balance.${refundReason ? ` Reason: ${refundReason}` : ""}`
      );
    } catch {
      // Notification failure must not roll back a completed refund.
    }

    return { order: result.order, alreadyRefunded: false, wallet: result.updatedWallet };
  }

  // ============================================================
  // CHAT COIN TRANSFERS (5% Sender Fee)
  // ============================================================

  private async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
    return user?.twoFactorEnabled === true;
  }

  private async readWalletTwoFactorState(userId: string): Promise<WalletTwoFactorState> {
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user) throw new Error("Wallet authentication state unavailable");
    return { enabled: user.twoFactorEnabled === true, secret: user.twoFactorSecret ?? null };
  }

  // Hold the verified credential rows until the financial transaction commits.
  // NO KEY UPDATE serializes credential changes without conflicting with
  // ordinary foreign-key key-share locks. Never return proof material to clients.
  private async fenceWalletAuthorization(
    tx: Prisma.TransactionClient, userId: string, pin: WalletPinProof,
    factor?: WalletTwoFactorState,
  ): Promise<void> {
    if (factor) {
      const users = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${userId}
          AND "twoFactorEnabled" = ${factor.enabled}
          AND "twoFactorSecret" IS NOT DISTINCT FROM ${factor.secret}::text
        FOR NO KEY UPDATE
      `;
      if (users.length !== 1) throw new Error("Authenticator security state changed. Please try again.");
    }
    const pins = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "WalletPIN" WHERE "id" = ${pin.id}
        AND "walletId" = ${pin.walletId} AND "pinHash" = ${pin.pinHash}
        AND "failedAttempts" = 0 AND "lockedUntil" IS NULL
      FOR NO KEY UPDATE
    `;
    if (pins.length !== 1) throw new Error("PIN security state changed. Please try again.");
  }

  private async verifyWalletTwoFactor(userId: string, token: string | undefined, action: string, state: WalletTwoFactorState): Promise<void> {
    if (!state.enabled) return;
    if (typeof token !== 'string' || !token.trim()) throw new Error('Authenticator 2FA code is required for this wallet action');
    const result = await twoFactorAuth.verifyLogin(userId, token.trim(), true, state.secret);
    if (!result.valid) throw new Error('Invalid authenticator 2FA code');
    await this.logAudit(userId, 'WALLET_2FA_VERIFIED', { action, isBackupCode: result.isBackupCode });
  }

  async transferCoins(
    senderId: string,
    receiverId: string,
    amount: number,
    note?: string,
    otpCode?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
    requestId?: string,
    challengeId?: string,
    sessionId?: string,
    pinCode?: string,
    twoFactorCode?: string
  ) {
    if (senderId === receiverId) {
      throw new Error("Cannot send coins to yourself");
    }

    // Never silently truncate a fractional coin transfer.
    const safeAmount = Number(amount);
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
      throw new Error("Transfer amount must be a positive whole number");
    }
    if (typeof pinCode !== 'string' || !/^\d{4,6}$/.test(pinCode)) throw new Error("A valid 4-6 digit wallet PIN is required");
    const pinProof = await this.verifyPinProof(senderId, pinCode);

    // Every transfer must carry a stable idempotency key. This is enforced
    // in the service as well as the HTTP controller so non-HTTP callers and
    // older clients cannot create unprotected transfers.
    if (
      typeof requestId !== 'string' ||
      requestId.length < 8 ||
      requestId.length > 100 ||
      !/^[A-Za-z0-9._-]+$/.test(requestId)
    ) {
      throw new Error("A valid requestId (8-100 letters, numbers, . _ -) is required for every transfer");
    }

    // Calculate fee (5% sender pays)
    const fee = calculateTransferFee(safeAmount);
    const totalDeduction = safeAmount + fee;
    const netReceived = safeAmount;

    const senderWallet = await this.ensureWallet(senderId);
    const receiverWallet = await this.ensureWallet(receiverId);

    // Check if wallets are frozen
    if (senderWallet.isFrozen) {
      throw new Error("Your wallet is frozen. Contact support.");
    }
    if (receiverWallet.isFrozen) {
      throw new Error("Recipient's wallet is frozen.");
    }

    // Phase 6 — effective limits (user config clamped to platform maximums).
    const transferLimit = await prisma.transferLimit.findUnique({
      where: { walletId: senderWallet.id },
    });
    const limits = resolveEffectiveTransferLimits(transferLimit);

    // Platform per-transfer cap and the user's (clamped) per-transaction limit.
    if (totalDeduction > PLATFORM_TRANSFER_LIMITS.maxPerTransfer) {
      throw new Error(
        `Transfer exceeds the platform maximum of ${PLATFORM_TRANSFER_LIMITS.maxPerTransfer.toLocaleString()} coins`
      );
    }
    if (totalDeduction > limits.singleTxLimit) {
      throw new Error(
        `Transfer exceeds your per-transaction limit of ${limits.singleTxLimit.toLocaleString()} coins`
      );
    }

    // Preflight balance check (UX only — the authoritative check + CAS happen
    // inside the database transaction so concurrent transfers can never race it).
    const senderAvailable = resolveAvailableCoins(senderWallet);
    if (senderAvailable < totalDeduction) {
      throw new Error(
        `Insufficient balance. You need ${totalDeduction} coins (${safeAmount} + ${fee} fee) but only have ${senderAvailable} available`
      );
    }

    // Idempotency: a retried/double-submitted request with the same required
    // requestId must never debit twice. UNIQUE(senderId, requestId) is the
    // database-level guard; this lookup is the fast path that returns the
    // already-committed transfer.
    const existing = await prisma.coinTransfer.findUnique({
      where: { senderId_requestId: { senderId, requestId } },
    });
    if (existing) {
      // An idempotency key is bound to the original transfer intent. Reusing
      // it with a different recipient, amount or note must not silently
      // return an unrelated transfer as though the new request succeeded.
      if (
        existing.receiverId !== receiverId ||
        existing.amount !== safeAmount ||
        (existing.note || undefined) !== (note || undefined)
      ) {
        throw new Error("This requestId is already used for a different transfer");
      }
      return {
        transfer: existing,
        replayed: true,
        message: "This transfer was already processed.",
      };
    }

    let authenticatorState: WalletTwoFactorState | undefined;
    let authenticatorChallengeHash: string | undefined;
    // Step-up OTP for high-value transfers (Phase 5).
    // The effective threshold is min(user setting, platform cap) computed by
    // resolveEffectiveTransferLimits — a user can never raise the threshold
    // past the platform-defined ceiling.
    if (totalDeduction >= limits.otpThreshold) {
      if (!otpCode) {
        // First leg: issue a server-side challenge and deliver the OTP.
        const challenge = await this.issueTransferOtp({
          userId: senderId,
          sessionId,
          receiverId,
          amount: totalDeduction,
          ipAddress,
          deviceFingerprint,
        });
        return {
          requiresOTP: true,
          requiresTwoFactor: await this.isTwoFactorEnabled(senderId),
          challengeId: challenge.id,
          expirySeconds: TRANSFER_OTP_CONSTANTS.expiryMs / 1000,
          message: "OTP sent to your email/phone",
        };
      }

      if (!challengeId) {
        throw new Error("An OTP challenge id is required to complete this transfer");
      }

      authenticatorState = await this.readWalletTwoFactorState(senderId);
      if (authenticatorState.enabled) {
        const challenge = await prisma.transferOtpChallenge.findUnique({ where: { id: challengeId } });
        const challengeMatches = challenge && challenge.userId === senderId &&
          challenge.receiverId === receiverId && challenge.amount === totalDeduction &&
          (!challenge.sessionId || challenge.sessionId === sessionId) &&
          !challenge.consumedAt && challenge.expiresAt >= new Date() &&
          challenge.attempts < challenge.maxAttempts;
        if (challengeMatches && await bcrypt.compare(otpCode || "", challenge.otpHash)) {
          await this.verifyWalletTwoFactor(senderId, twoFactorCode, 'high_value_transfer', authenticatorState);
          authenticatorChallengeHash = challenge.otpHash;
        }
      }
    }

    // Fraud detection - check for duplicate transfers
    const recentTransfer = await prisma.coinTransfer.findFirst({
      where: {
        senderId,
        receiverId,
        amount: safeAmount,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // 5 min window
        status: "COMPLETED",
      },
    });
    if (recentTransfer) {
      throw new Error(
        "Duplicate transfer detected. Please wait before sending the same amount to the same user."
      );
    }

    // Check for suspicious activity - rapid transfers
    const recentTransfers = await prisma.coinTransfer.count({
      where: {
        senderId,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) }, // 1 min window
      },
    });
    if (recentTransfers >= 5) {
      throw new Error(
        "Suspicious activity detected. Too many transfers in a short period. Please try again later."
      );
    }

    // Resolve user display info for descriptions
    const [senderInfo, receiverInfo] = await Promise.all([
      getUserDisplayInfo(senderId),
      getUserDisplayInfo(receiverId),
    ]);
    const senderLabel = formatUserLabel(senderInfo);
    const receiverLabel = formatUserLabel(receiverInfo);

    // Execute transfer atomically.
    // The balance check (`coinBalance >= totalDeduction`) is enforced INSIDE the
    // mutation itself via compare-and-swap updateMany, never by a read-then-write
    // sequence, so concurrent transfers / retries / double-submits can never
    // overspend or drive a balance negative.
    const result = await prisma.$transaction(async (tx) => {
      await this.fenceWalletAuthorization(tx, senderId, pinProof, authenticatorState);
      // Re-read the sender inside the transaction for authoritative checks.
      const senderCurrent = await tx.wallet.findUniqueOrThrow({ where: { userId: senderId } });
      if (senderCurrent.isFrozen || resolveAvailableCoins(senderCurrent) < totalDeduction) {
        throw new Error("Insufficient available coins");
      }

      // If step-up OTP applies, verify the challenge and consume it exactly once
      // INSIDE this transaction — a failed/expired/reused challenge aborts the
      // whole transfer (no ledger entry, no event).
      if (totalDeduction >= limits.otpThreshold) {
        const challenge = await tx.transferOtpChallenge.findUnique({ where: { id: challengeId! } });
        if (
          !challenge ||
          challenge.userId !== senderId ||
          challenge.receiverId !== receiverId ||
          challenge.amount !== totalDeduction
        ) {
          throw new Error("Invalid OTP challenge");
        }
        if (challenge.sessionId && challenge.sessionId !== sessionId) {
          throw new Error("OTP challenge is bound to another session");
        }
        if (challenge.consumedAt) {
          throw new Error("OTP challenge has already been used");
        }
        if (challenge.expiresAt < new Date()) {
          throw new Error("OTP challenge has expired");
        }
        if (challenge.attempts >= challenge.maxAttempts) {
          throw new Error("Too many OTP attempts. Please request a new code.");
        }

        const valid = await bcrypt.compare(otpCode || "", challenge.otpHash);
        // Bind either outcome to the exact observed challenge and attempt
        // counter. A parallel failure, consumption, replacement or expiry
        // cannot authorize against a stale snapshot.
        const challengeFence = {
          id: challenge.id, userId: senderId, receiverId, amount: totalDeduction,
          sessionId: challenge.sessionId, otpHash: challenge.otpHash,
          attempts: challenge.attempts, maxAttempts: challenge.maxAttempts,
          consumedAt: null, expiresAt: { gte: new Date() },
        };
        if (!valid) {
          const failed = await tx.transferOtpChallenge.updateMany({
            where: challengeFence,
            data: { attempts: { increment: 1 } },
          });
          if (failed.count !== 1) throw new Error("OTP challenge state changed. Please try again.");
          await tx.walletAuditLog.create({
            data: {
              userId: senderId,
              action: "OTP_FAILED",
              details: JSON.stringify({ challengeId: challenge.id, receiverId, amount: totalDeduction }),
              ipAddress,
            },
          });
          this.logTally("otp_failed");
          // Return from the interactive transaction instead of throwing here.
          // Throwing would roll back the failed-attempt increment and audit row,
          // allowing unlimited guesses against the same OTP challenge.
          return { otpInvalid: true as const };
        }

        if (authenticatorState?.enabled && authenticatorChallengeHash !== challenge.otpHash) {
          throw new Error("Authenticator 2FA verification is required for this OTP challenge");
        }
        const consumed = await tx.transferOtpChallenge.updateMany({
          where: challengeFence,
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new Error("OTP challenge has already been used");
        }
        await tx.walletAuditLog.create({
          data: {
            userId: senderId,
            action: "OTP_VERIFIED",
            details: JSON.stringify({ challengeId: challenge.id, receiverId, amount: totalDeduction }),
            ipAddress,
          },
        });
      }

      // Compare-and-swap debit: only succeeds while the exact conditions hold.
      const debit = await tx.wallet.updateMany({
        where: {
          userId: senderId,
          isFrozen: false,
          coinBalance: { gte: totalDeduction },
          // Include the reservation counter in the CAS so a concurrent
          // reservation cannot make previously available coins unspendable.
          lockedCoins: senderCurrent.lockedCoins,
        },
        data: {
          coinBalance: { decrement: totalDeduction },
          totalCoinsSent: { increment: safeAmount },
        },
      });
      if (debit.count !== 1) {
        throw new Error("Insufficient coins");
      }
      const updatedSender = await tx.wallet.findUniqueOrThrow({ where: { userId: senderId } });

      // Credit the receiver (revalidated inside the tx).
      const receiverCurrent = await tx.wallet.findUniqueOrThrow({ where: { userId: receiverId } });
      if (receiverCurrent.isFrozen) {
        throw new Error("Recipient's wallet is frozen.");
      }
      const updatedReceiver = await tx.wallet.update({
        where: { userId: receiverId },
        data: {
          coinBalance: { increment: netReceived },
          totalCoinsReceived: { increment: netReceived },
        },
      });

      // Create coin transfer record (idempotency key included).
      const transfer = await tx.coinTransfer.create({
        data: {
          senderId,
          receiverId,
          amount: safeAmount,
          fee,
          netAmount: netReceived,
          note,
          status: "COMPLETED",
          otpVerified: !!otpCode,
          requestId: requestId || null,
          ipAddress,
          deviceFingerprint,
        },
      });

      // Create transaction records for both users
      // Sender: outgoing (negative sign derived from type)
      await tx.walletTransaction.create({
        data: {
          walletId: senderWallet.id,
          userId: senderId,
          type: "TRANSFER_SENT",
          amount: totalDeduction,
          fee,
          balanceBefore: senderCurrent.coinBalance,
          balance: updatedSender.coinBalance,
          status: "COMPLETED",
          description: buildTransactionDescription(TX_TYPES.TRANSFER_SENT, safeAmount, receiverLabel, note),
          reference: transfer.id,
          metadata: JSON.stringify({ receiverId, amount: safeAmount, fee, note }),
        },
      });

      // Receiver: incoming (positive sign derived from type)
      await tx.walletTransaction.create({
        data: {
          walletId: receiverWallet.id,
          userId: receiverId,
          type: "TRANSFER_RECEIVED",
          amount: netReceived,
          fee: 0,
          balanceBefore: receiverCurrent.coinBalance,
          balance: updatedReceiver.coinBalance,
          status: "COMPLETED",
          description: buildTransactionDescription(TX_TYPES.TRANSFER_RECEIVED, netReceived, senderLabel),
          reference: transfer.id,
          metadata: JSON.stringify({ senderId, amount, netReceived }),
        },
      });

      // Update daily used amount — CAS on the read snapshot so two concurrent
      // transfers cannot both pass the daily-limit check.
      if (transferLimit) {
        const today = startOfUTCDay(new Date());
        const needsReset = !transferLimit.lastResetDate || transferLimit.lastResetDate < today;
        const baseUsed = needsReset ? 0 : transferLimit.dailyUsed || 0;
        if (baseUsed + totalDeduction > limits.dailyLimit) {
          throw new Error(
            `Daily transfer limit of ${limits.dailyLimit.toLocaleString()} coins exceeded`
          );
        }
        if (needsReset) {
          const reset = await tx.transferLimit.updateMany({
            where: { id: transferLimit.id, lastResetDate: { lt: today } },
            data: { dailyUsed: totalDeduction, lastResetDate: today },
          });
          if (reset.count !== 1) {
            throw new Error("Daily transfer limit changed concurrently; please retry");
          }
        } else {
          const advanced = await tx.transferLimit.updateMany({
            where: {
              id: transferLimit.id,
              lastResetDate: { equals: transferLimit.lastResetDate },
              dailyUsed: { equals: transferLimit.dailyUsed },
            },
            data: { dailyUsed: baseUsed + totalDeduction, lastResetDate: today },
          });
          if (advanced.count !== 1) {
            throw new Error("Daily transfer limit changed concurrently; please retry");
          }
        }
      }

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId: senderId,
          action: "TRANSFER",
          details: JSON.stringify({
            transferId: transfer.id,
            receiverId,
            amount: safeAmount,
            fee,
            netReceived,
            ipAddress,
            requestId: requestId || null,
          }),
          ipAddress,
        },
      });

      return { transfer, updatedSender, updatedReceiver };
    });

    // The invalid-attempt counter and audit entry have committed. Raise the
    // API error only after the transaction completes so those security records
    // are not rolled back with the rejected transfer.
    if ('otpInvalid' in result) {
      throw new Error("Invalid OTP");
    }

    // The transfer is already committed. Notification delivery must not
    // make the API report a failed transfer and encourage an unsafe retry.
    await Promise.allSettled([
      notificationService.createNotification(
        senderId,
        "WALLET_TRANSFER_SENT",
        "Transfer Sent",
        `You sent ${safeAmount.toLocaleString()} coins (fee: ${fee}) to ${receiverLabel}.`,
        { transferId: result.transfer.id, amount: safeAmount, fee, receiverId }
      ),
      notificationService.createNotification(
        receiverId,
        "WALLET_TRANSFER_RECEIVED",
        "Coins Received",
        `You received ${netReceived.toLocaleString()} coins from ${senderLabel}.`,
        { transferId: result.transfer.id, amount: netReceived, senderId }
      ),
    ]);

    return { transfer: result.transfer, updatedBalance: result.updatedSender.coinBalance };
  }

  // ============================================================
  // TRANSFER LIMITS (configurable, no arbitrary per-transfer cap)
  // ============================================================

  async updateTransferLimit(
    userId: string,
    updates: {
      dailyLimit?: number;
      singleTxLimit?: number;
      otpThreshold?: number;
    }
  ) {
    const wallet = await this.ensureWallet(userId);

    // Phase 6 — server-side clamping. Users may LOWER their own limits for
    // extra safety but can never set them ABOVE the platform maximums, so a
    // compromised account cannot self-exempt from step-up OTP or velocity
    // controls. The effective limits are additionally re-enforced inside every
    // transfer mutation.
    const cap = PLATFORM_TRANSFER_LIMITS;
    const clampInt = (value: number | undefined, fallback: number, max: number, label: string): number => {
      if (value === undefined) return fallback;
      const n = Math.trunc(Number(value));
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error(`${label} must be a non-negative whole number`);
      }
      return Math.min(n, max);
    };

    const data: {
      dailyLimit?: number;
      singleTxLimit?: number;
      otpThreshold?: number;
    } = {};

    if (updates.dailyLimit !== undefined) {
      data.dailyLimit = clampInt(updates.dailyLimit, cap.maxDaily, cap.maxDaily, 'dailyLimit');
    }
    if (updates.singleTxLimit !== undefined) {
      data.singleTxLimit = clampInt(updates.singleTxLimit, cap.maxSingleTxLimit, cap.maxSingleTxLimit, 'singleTxLimit');
    }
    if (updates.otpThreshold !== undefined) {
      // Never allow raising the OTP threshold above the platform cap (that
      // would reduce which transfers require step-up verification).
      const n = Math.trunc(Number(updates.otpThreshold));
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error('otpThreshold must be a non-negative whole number');
      }
      data.otpThreshold = Math.min(Math.max(cap.minOtpThreshold, n), cap.maxOtpThreshold);
    }

    const limit = await prisma.transferLimit.findUnique({
      where: { walletId: wallet.id },
    });

    if (!limit) {
      const created = await prisma.transferLimit.create({
        data: { walletId: wallet.id, ...data },
      });
      return { ...created, effective: resolveEffectiveTransferLimits(created), clamped: true };
    }

    const updated = await prisma.transferLimit.update({
      where: { walletId: wallet.id },
      data,
    });

    await this.logAudit(userId, 'LIMIT_CHANGE', {
      walletId: wallet.id,
      applied: data,
      clampedToPlatformCaps: true,
    });

    return { ...updated, effective: resolveEffectiveTransferLimits(updated), clamped: true };
  }

  // ============================================================
  // TRANSFER STEP-UP OTP (Phase 5)
  // ============================================================

  /**
   * Issue a transfer OTP challenge.
   *
   * SECURITY PROPERTIES
   *  - OTP is generated with crypto.randomInt (CSPRNG), never Math.random.
   *  - Only a one-way bcrypt hash is stored — never the plaintext OTP.
   *  - The challenge is bound to user + session + recipient + amount, expires,
   *    is attempt-limited and single-use (consumed inside the transfer tx).
   *  - The plaintext OTP is ONLY delivered through the notification channel
   *    (the delivery medium); it is never persisted, logged or returned.
   */
  async issueTransferOtp(input: {
    userId: string;
    sessionId?: string;
    receiverId: string;
    amount: number;
    ipAddress?: string;
    deviceFingerprint?: string;
  }) {
    const { userId, sessionId, receiverId, amount, ipAddress, deviceFingerprint } = input;
    // OTPs are sent only to the account's verified email. Notification text is
    // API-visible and must never be used as a secret-delivery channel.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true, username: true },
    });
    if (!user?.email || !user.emailVerified) {
      throw new Error("A verified email address is required to authorize this transfer");
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + TRANSFER_OTP_CONSTANTS.expiryMs);

    const challenge = await prisma.transferOtpChallenge.create({
      data: {
        userId,
        sessionId: sessionId || null,
        receiverId,
        amount,
        otpHash,
        expiresAt,
        maxAttempts: TRANSFER_OTP_CONSTANTS.maxAttempts,
        ipAddress: ipAddress || null,
        deviceFingerprint: deviceFingerprint || null,
      },
    });

    const delivery = await emailService.sendTransferOtpEmail({
      to: user.email,
      otp,
      amount,
      recipient: user.username,
      expiresInMinutes: TRANSFER_OTP_CONSTANTS.expiryMs / 60000,
    });
    if (!delivery.delivered) {
      await prisma.transferOtpChallenge.deleteMany({ where: { id: challenge.id, consumedAt: null } });
      throw new Error("Transfer verification is temporarily unavailable. Please try again later.");
    }

    await notificationService.createNotification(
      userId,
      "WALLET_OTP",
      "Transfer verification requested",
      "A transfer verification code was sent to your verified email address. The code is not available in notifications.",
      { challengeId: challenge.id, receiverId, amount, flows: ["transfer"] }
    );

    await this.logAudit(userId, "OTP_SENT", {
      challengeId: challenge.id,
      receiverId,
      amount,
    });

    return challenge;
  }

  /**
   * Verify and consume a transfer OTP challenge WITHOUT executing a transfer.
   * This is not a pre-validation step for transferCoins: a consumed challenge
   * cannot subsequently authorize a transfer. Both paths share attempt and
   * session fencing.
   */
  async verifyTransferOtp(input: {
    userId: string;
    challengeId: string;
    otpCode: string;
    sessionId?: string;
  }): Promise<{ valid: boolean; reason?: string }> {
    const { userId, challengeId, otpCode, sessionId } = input;
    const challenge = await prisma.transferOtpChallenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge || challenge.userId !== userId) {
      return { valid: false, reason: "invalid" };
    }
    if (challenge.consumedAt) return { valid: false, reason: "used" };
    if (challenge.expiresAt < new Date()) return { valid: false, reason: "expired" };
    if (challenge.attempts >= challenge.maxAttempts) return { valid: false, reason: "attempts" };
    if (challenge.sessionId && challenge.sessionId !== sessionId) {
      return { valid: false, reason: "session" };
    }

    const valid = await bcrypt.compare(otpCode || "", challenge.otpHash);
    const challengeFence = {
      id: challenge.id, userId, sessionId: challenge.sessionId,
      otpHash: challenge.otpHash, attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts, consumedAt: null,
      expiresAt: { gte: new Date() },
    };
    const changed = await prisma.transferOtpChallenge.updateMany({
      where: challengeFence,
      data: valid ? { consumedAt: new Date() } : { attempts: { increment: 1 } },
    });
    if (changed.count !== 1) return { valid: false, reason: "changed" };
    if (valid) return { valid: true };
    await this.logAudit(userId, "OTP_FAILED", {
      challengeId: challenge.id,
      attemptsRemaining: challenge.maxAttempts - challenge.attempts - 1,
    });
    return { valid: false, reason: "invalid" };
  }

  // ============================================================
  // WALLET PIN MANAGEMENT
  // ============================================================

  async setupPin(userId: string, pin: string) {
    const wallet = await this.ensureWallet(userId);

    // Validate PIN format (4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      throw new Error("PIN must be 4-6 digits");
    }

    const existingPin = await prisma.walletPIN.findUnique({
      where: { walletId: wallet.id },
    });

    if (existingPin) {
      throw new Error("PIN already set. Use update PIN instead.");
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const pinRecord = await prisma.walletPIN.create({
      data: {
        walletId: wallet.id,
        pinHash,
      },
    });

    await this.logAudit(userId, "PIN_SETUP", { walletId: wallet.id });

    return { success: true, message: "Wallet PIN set successfully" };
  }

  async updatePin(userId: string, oldPin: string, newPin: string) {
    const wallet = await this.ensureWallet(userId);
    const pinRecord = await prisma.walletPIN.findUnique({
      where: { walletId: wallet.id },
    });

    if (!pinRecord) {
      throw new Error("No PIN set. Use setup PIN first.");
    }

    if (!/^\d{4,6}$/.test(newPin)) {
      throw new Error("PIN must be 4-6 digits");
    }

    // Reuse the canonical verifier so PIN changes obey the same lockout,
    // failed-attempt accounting and audit policy as transfers/withdrawals.
    await this.verifyPin(userId, oldPin);

    const newPinHash = await bcrypt.hash(newPin, 10);
    const updated = await prisma.walletPIN.updateMany({
      // Compare-and-swap prevents two concurrent PIN changes from both
      // succeeding against the same previously verified PIN.
      where: { id: pinRecord.id, pinHash: pinRecord.pinHash, failedAttempts: 0, lockedUntil: null },
      data: { pinHash: newPinHash, failedAttempts: 0, lockedUntil: null },
    });
    if (updated.count !== 1) {
      throw new Error("PIN changed during this update. Please try again.");
    }

    await this.logAudit(userId, "PIN_UPDATE", { walletId: wallet.id });

    return { success: true, message: "PIN updated successfully" };
  }

  async verifyPin(userId: string, pin: string) {
    await this.verifyPinProof(userId, pin);
    return { success: true, message: "PIN verified" };
  }

  private async verifyPinProof(userId: string, pin: string): Promise<WalletPinProof> {
    if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) throw new Error('Invalid PIN format');
    const wallet = await this.ensureWallet(userId);
    const pinRecord = await prisma.walletPIN.findUnique({ where: { walletId: wallet.id } });
    if (!pinRecord) throw new Error("No PIN set");
    const now = new Date();
    if (pinRecord.lockedUntil && pinRecord.lockedUntil > now) throw new Error("PIN is locked. Please try again after the lockout period.");
    const valid = await bcrypt.compare(pin, pinRecord.pinHash);
    if (!valid) {
      const attempts = await prisma.$queryRaw<Array<{ failedAttempts: number; lockedUntil: Date | null }>>`
        UPDATE "WalletPIN"
        SET "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= NOW() THEN 1 ELSE "failedAttempts" + 1 END,
            "lockedUntil" = CASE WHEN (CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= NOW() THEN 0 ELSE "failedAttempts" END) + 1 >= 5
              THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
        WHERE "id" = ${pinRecord.id} AND "pinHash" = ${pinRecord.pinHash} AND ("lockedUntil" IS NULL OR "lockedUntil" <= NOW())
        RETURNING "failedAttempts", "lockedUntil"
      `;
      const attempt = attempts[0];
      if (!attempt) throw new Error("PIN is locked. Please try again after the lockout period.");
      await this.logAudit(userId, "PIN_FAILED", { walletId: wallet.id, failedAttempts: attempt.failedAttempts });
      if (attempt.lockedUntil) throw new Error("PIN locked after 5 failed attempts. Please try again in 15 minutes.");
      throw new Error(`Invalid PIN. ${5 - attempt.failedAttempts} attempts remaining.`);
    }
    // Always compare-and-swap the verified hash and lockout snapshot,
    // including a clean initial counter. A concurrent reset/lock/change
    // must invalidate this authentication attempt rather than succeed stale.
    const verified = await prisma.walletPIN.updateMany({
      where: { id: pinRecord.id, pinHash: pinRecord.pinHash, failedAttempts: pinRecord.failedAttempts, lockedUntil: pinRecord.lockedUntil },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    if (verified.count !== 1) throw new Error("PIN security state changed. Please try again.");
    await this.logAudit(userId, "PIN_VERIFY", { walletId: wallet.id });
    return { id: pinRecord.id, walletId: wallet.id, pinHash: pinRecord.pinHash };
  }

  // ============================================================
  // WITHDRAWALS (10% Platform Fee)
  // ============================================================

  async requestWithdrawal(userId: string, amount: number, walletAddress: string, pinCode: string, twoFactorCode?: string) {
    // Validate untrusted request values before any database access or balance mutation.
    // This remains a request-only/manual settlement flow; it does not initiate a payout.
    const validated = validateWithdrawalInput(amount, walletAddress);
    amount = validated.amount;
    walletAddress = validated.walletAddress;
    if (typeof pinCode !== 'string' || !/^\d{4,6}$/.test(pinCode)) throw new Error('A valid 4-6 digit wallet PIN is required');
    const pinProof = await this.verifyPinProof(userId, pinCode);
    const authenticatorState = await this.readWalletTwoFactorState(userId);
    await this.verifyWalletTwoFactor(userId, twoFactorCode, 'withdrawal', authenticatorState);

    const wallet = await this.ensureWallet(userId);

    // Check if wallet is frozen
    if (wallet.isFrozen) {
      throw new Error("Your wallet is frozen. Contact support.");
    }

    // Check earnings balance
    if (wallet.earningsBalance < amount) {
      throw new Error(
        `Insufficient earnings balance. You have $${wallet.earningsBalance.toFixed(2)} but need $${amount.toFixed(2)}.`
      );
    }

    // Calculate 10% platform fee
    const fee = Math.round(amount * WITHDRAWAL_FEE_RATE * 100) / 100;
    const netAmount = Math.round((amount - fee) * 100) / 100;

    // Check minimum withdrawal (configurable)
    if (amount < MIN_WITHDRAWAL_AMOUNT) {
      throw new Error(`Minimum withdrawal amount is $${MIN_WITHDRAWAL_AMOUNT.toFixed(2)}`);
    }

    // Check for duplicate pending withdrawal
    const pendingWithdrawal = await prisma.withdrawal.findFirst({
      where: {
        userId,
        status: { in: ["PENDING", "PROCESSING", "APPROVED", "PAYOUT_RESERVED"] },
      },
    });
    if (pendingWithdrawal) {
      throw new Error("You already have a pending withdrawal request. Please wait for it to be processed.");
    }

    // Atomic transaction: deduct earnings + create withdrawal record + create transaction.
    // Both the single-PENDING invariant and the balance check are enforced
    // INSIDE the transaction (serialized), and the earnings debit is a
    // compare-and-swap so two concurrent requests can never both succeed.
    const result = await prisma.$transaction(async (tx) => {
      await this.fenceWalletAuthorization(tx, userId, pinProof, authenticatorState);
      // Re-check single-PENDING invariant inside the transaction: two
      // concurrent requests can both pass the preflight lookup above.
      // Serialize withdrawal creation per wallet before checking the
      // single-pending invariant; otherwise concurrent requests can both see
      // zero pending rows and both reserve earnings.
      await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
      const existingPending = await tx.withdrawal.count({
        where: { userId, status: { in: ["PENDING", "PROCESSING", "APPROVED", "PAYOUT_RESERVED"] } },
      });
      if (existingPending > 0) {
        throw new Error("You already have a pending withdrawal request. Please wait for it to be processed.");
      }

      // Read the balance after taking the wallet row lock, then compare-and-swap
      // that exact snapshot so the USD ledger's before/after values are accurate.
      const currentWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (currentWallet.isFrozen || currentWallet.earningsBalance < amount) {
        throw new Error("Insufficient earnings balance");
      }
      const debit = await tx.wallet.updateMany({
        where: { userId, isFrozen: false, earningsBalance: currentWallet.earningsBalance },
        data: {
          earningsBalance: { decrement: amount },
          totalWithdrawn: { increment: netAmount },
        },
      });
      if (debit.count !== 1) {
        throw new Error("Insufficient earnings balance");
      }
      const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });

      // Create withdrawal record
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amount,
          fee,
          netAmount,
          method: "USDT_BEP20",
          currency: "USDT",
          status: "PENDING",
          walletAddress: walletAddress.trim(),
          cryptoNetwork: "BNB_SMART_CHAIN",
        },
      });

      // Create wallet transaction record
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: "WITHDRAWAL",
          currency: "USD",
          amount,
          fee,
          balanceBefore: currentWallet.earningsBalance,
          balance: updatedWallet.earningsBalance,
          status: "PENDING",
          description: `Withdrawal request of $${amount.toFixed(2)} (fee: $${fee.toFixed(2)}, net: $${netAmount.toFixed(2)})`,
          reference: withdrawal.id,
          metadata: JSON.stringify({
            withdrawalId: withdrawal.id,
            amount,
            fee,
            netAmount,
            walletAddress: walletAddress.trim(),
            method: "USDT_BEP20",
          }),
        },
      });

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId,
          action: "WITHDRAWAL",
          details: JSON.stringify({
            withdrawalId: withdrawal.id,
            amount,
            fee,
            netAmount,
            walletAddress: walletAddress.trim(),
          }),
        },
      });

      return { withdrawal, updatedWallet };
    });

    // The withdrawal and ledger are already committed. Notification delivery is
    // best-effort and must not make a successful reservation look like a failed
    // request (which could prompt the client to retry).
    try {
      await notificationService.createNotification(
        userId,
        "WALLET_WITHDRAWAL",
        "Withdrawal Requested",
        `Your withdrawal of $${amount.toFixed(2)} (net $${netAmount.toFixed(2)}) is being processed.`,
        { withdrawalId: result.withdrawal.id, amount, fee, netAmount }
      );
    } catch (notificationError) {
      console.error("[WALLET] withdrawal request committed; notification failed:", notificationError);
    }

    return result.withdrawal;
  }

  /**
   * Reserve an explicitly reviewed, unsent withdrawal BEFORE any external
   * payout. This only changes local state; it never sends money. An ambiguous
   * or abandoned reservation stays fenced for reconciliation, not auto-refund.
   */
  async reserveWithdrawalPayout(withdrawalId: string, adminId: string, reconciledUnsent: boolean) {
    if (reconciledUnsent !== true) throw new Error('Confirm reconciliation found no prior payout before reserving');
    const payoutSender = (process.env.VANTA_USDT_WITHDRAWAL_SENDER_ADDRESS || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(payoutSender)) throw new Error('Authorized payout wallet must be configured');
    return prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal || withdrawal.status !== 'PENDING' || withdrawal.transactionHash !== null) {
        throw new Error('Only an unreserved pending withdrawal can be reserved');
      }
      if (withdrawal.method !== 'USDT_BEP20' || withdrawal.currency !== 'USDT' ||
          withdrawal.cryptoNetwork !== 'BNB_SMART_CHAIN' || !withdrawal.walletAddress ||
          !/^0x[a-fA-F0-9]{40}$/.test(withdrawal.walletAddress) ||
          !Number.isFinite(withdrawal.netAmount) || withdrawal.netAmount <= 0) {
        throw new Error('Withdrawal settlement details are invalid');
      }
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'PENDING', transactionHash: null,
          userId: withdrawal.userId, amount: withdrawal.amount, fee: withdrawal.fee,
          netAmount: withdrawal.netAmount, walletAddress: withdrawal.walletAddress,
          method: withdrawal.method, currency: withdrawal.currency, cryptoNetwork: withdrawal.cryptoNetwork },
        data: { status: 'PAYOUT_RESERVED', processedBy: adminId },
      });
      if (claimed.count !== 1) throw new Error('Withdrawal reservation already changed');
      const ledgerCount = await tx.walletTransaction.count({
        where: { reference: withdrawalId, userId: withdrawal.userId, type: 'WITHDRAWAL', status: 'PENDING',
          currency: 'USD', amount: withdrawal.amount, fee: withdrawal.fee },
      });
      if (ledgerCount !== 1) throw new Error('Exact pending withdrawal ledger entry is missing');
      await tx.walletAuditLog.create({ data: {
        userId: withdrawal.userId, action: 'WITHDRAWAL_PAYOUT_RESERVED',
        details: JSON.stringify({ withdrawalId, adminId, reconciledUnsent: true }),
      } });
      return tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    });
  }

  /**
   * Recovery evidence is operator-reported, never authorization to pay/refund.
   * Keep a reserved or legacy unresolved payout fenced until independent
   * settlement or a separately approved recovery policy exists.
   */
  async recordWithdrawalRecovery(withdrawalId: string, adminId: string, input: {
    expectedStatus: unknown; outcome: unknown; caseReference: unknown; notes: unknown;
    candidateHash?: unknown;
  }) {
    const outcomes = ['UNKNOWN', 'PAYOUT_PENDING', 'PAYOUT_FAILED_REPORTED', 'PAYOUT_FOUND', 'NO_PAYOUT_FOUND'];
    const active = ['PAYOUT_RESERVED', 'PROCESSING', 'APPROVED'];
    if (typeof input.expectedStatus !== 'string' || !active.includes(input.expectedStatus) ||
        typeof input.outcome !== 'string' || !outcomes.includes(input.outcome)) {
      throw new Error('Invalid recovery status or reported outcome');
    }
    const caseReference = typeof input.caseReference === 'string' ? input.caseReference.trim() : '';
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    const candidateHash = typeof input.candidateHash === 'string' ? input.candidateHash.trim().toLowerCase() : '';
    if (!/^[A-Za-z0-9._-]{5,80}$/.test(caseReference) || notes.length < 20 || notes.length > 1000 ||
        (input.candidateHash !== undefined && typeof input.candidateHash !== 'string') ||
        (candidateHash && !/^0x[a-f0-9]{64}$/.test(candidateHash)) ||
        (input.outcome === 'PAYOUT_FOUND' && !candidateHash)) {
      throw new Error('Valid case reference, reconciliation notes and applicable candidate hash required');
    }
    return prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Withdrawal" WHERE "id" = ${withdrawalId}
          AND status = ${input.expectedStatus} FOR NO KEY UPDATE
      `;
      if (lock.length !== 1) throw new Error('Withdrawal recovery state changed; refresh before reviewing');
      const row = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      const ledgerCount = await tx.walletTransaction.count({
        where: { reference: withdrawalId, userId: row.userId, type: 'WITHDRAWAL',
          status: 'PENDING', currency: 'USD', amount: row.amount, fee: row.fee },
      });
      const evidence = {
        withdrawalId, adminId, observedStatus: row.status, outcome: input.outcome,
        caseReference, notes, candidateHash: candidateHash || null,
        recordedHash: row.transactionHash, exactPendingLedgerCount: ledgerCount,
        independentlyVerified: false, financialActionAuthorized: false,
      };
      const entry = await tx.walletAuditLog.create({ data: {
        userId: row.userId, action: 'WITHDRAWAL_RECOVERY_REVIEW', details: JSON.stringify(evidence),
      } });
      return { id: entry.id, createdAt: entry.createdAt, ...evidence };
    });
  }

  async getWithdrawalRecoveryHistory(withdrawalId: string) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!row) throw new Error('Withdrawal not found');
      // Only this event type and exact serialized first property; no broad
      // user-history disclosure. Return recent reviews, not payment proof.
      const prefix = '{"withdrawalId":' + JSON.stringify(withdrawalId) + ',';
      const logs = await tx.walletAuditLog.findMany({
        where: { userId: row.userId, action: 'WITHDRAWAL_RECOVERY_REVIEW', details: { startsWith: prefix } },
        select: { id: true, createdAt: true, details: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
      });
      const entries = logs.slice(0, 20).map(log => {
        const details = JSON.parse(log.details || '{}');
        if (details.withdrawalId !== withdrawalId || details.financialActionAuthorized !== false ||
            details.independentlyVerified !== false) throw new Error('Recovery history requires manual audit review');
        return { id: log.id, createdAt: log.createdAt, ...details };
      });
      return { status: row.status, entries, more: logs.length > 20, financialActionAuthorized: false };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async processWithdrawal(withdrawalId: string, adminId: string, transactionHash: string) {
    const normalizedHash = typeof transactionHash === 'string' ? transactionHash.trim().toLowerCase() : '';
    if (!/^0x[a-f0-9]{64}$/.test(normalizedHash)) throw new Error('A valid BNB Smart Chain transaction hash is required');

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new Error('Withdrawal not found');
    if (withdrawal.status !== 'PAYOUT_RESERVED' || !withdrawal.processedBy) throw new Error('Withdrawal must be reserved before settlement');
    if (!withdrawal.walletAddress) throw new Error('Withdrawal destination address is missing');

    // A manual admin click or client-supplied hash is not proof of payment.
    // Independently verify the mined USDT BEP-20 transfer, exact source
    // treasury, destination, net amount and confirmation count. Any mismatch
    // or missing treasury configuration fails closed.
    const payoutSender = (process.env.VANTA_USDT_WITHDRAWAL_SENDER_ADDRESS || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(payoutSender)) {
      throw new Error('VANTA_USDT_WITHDRAWAL_SENDER_ADDRESS must be configured with the authorized payout wallet');
    }
    const chainProof = await blockchainTxVerifier.verifyTransaction({
      txHash: normalizedHash,
      network: 'usdt-bep20',
      expectedAmountUsd: withdrawal.netAmount,
      expectedRecipient: withdrawal.walletAddress,
      expectedSender: payoutSender,
    });
    if (!chainProof.verified) throw new Error('On-chain withdrawal verification failed');

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'PAYOUT_RESERVED', transactionHash: null, processedBy: withdrawal.processedBy,
          userId: withdrawal.userId, amount: withdrawal.amount, fee: withdrawal.fee,
          netAmount: withdrawal.netAmount, walletAddress: withdrawal.walletAddress,
          method: withdrawal.method, currency: withdrawal.currency, cryptoNetwork: withdrawal.cryptoNetwork },
        data: {
          status: 'COMPLETED',
          transactionHash: normalizedHash,
          processedBy: adminId,
          processedAt: new Date(),
        },
      });
      if (claim.count !== 1) throw new Error('Withdrawal can only be completed once');

      const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      const ledgerUpdate = await tx.walletTransaction.updateMany({
        where: { reference: withdrawalId, userId: withdrawal.userId, type: 'WITHDRAWAL', status: 'PENDING', currency: 'USD', amount: withdrawal.amount, fee: withdrawal.fee },
        data: {
          status: 'COMPLETED',
          metadata: JSON.stringify({
            withdrawalId,
            amount: withdrawal.amount,
            fee: withdrawal.fee,
            netAmount: withdrawal.netAmount,
            walletAddress: withdrawal.walletAddress,
            method: withdrawal.method,
            transactionHash: normalizedHash,
            network: 'usdt-bep20',
            confirmations: chainProof.confirmations,
            blockNumber: chainProof.blockNumber,
          }),
        },
      });
      if (ledgerUpdate.count !== 1) throw new Error('Pending withdrawal ledger entry is missing or already processed');

      await tx.walletAuditLog.create({
        data: {
          userId: withdrawal.userId,
          action: 'WITHDRAWAL_PROCESSED',
          details: JSON.stringify({
            withdrawalId,
            adminId,
            amount: withdrawal.amount,
            netAmount: withdrawal.netAmount,
            transactionHash: normalizedHash,
            network: 'usdt-bep20',
            confirmations: chainProof.confirmations,
            blockNumber: chainProof.blockNumber,
          }),
        },
      });
      return updated;
    });

    try {
      await notificationService.createNotification(
        withdrawal.userId,
        'WALLET_WITHDRAWAL_COMPLETED',
        'Withdrawal Completed',
        `Your withdrawal of ${withdrawal.netAmount.toFixed(2)} USDT has been confirmed on BNB Smart Chain.`,
        { withdrawalId, amount: withdrawal.netAmount, transactionHash: normalizedHash, network: 'usdt-bep20' }
      );
    } catch (notificationError) {
      console.error("[WALLET] withdrawal completion committed; notification failed:", notificationError);
    }
    return result;
  }

  async rejectWithdrawal(withdrawalId: string, adminId: string, reason: string) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }

    if (withdrawal.status !== "PENDING" || withdrawal.transactionHash !== null) {
      throw new Error("Only pending withdrawals without settlement evidence can be rejected");
    }

    // Atomic transaction: conditionally flip PENDING -> FAILED + refund once.
    // The CAS prevents a DOUBLE REFUND if two admins reject concurrently (or
    // a process + reject race) — only the first transition wins.
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: "PENDING", transactionHash: null,
          userId: withdrawal.userId, amount: withdrawal.amount, fee: withdrawal.fee, netAmount: withdrawal.netAmount },
        data: {
          status: "FAILED",
          processedBy: adminId,
          processedAt: new Date(),
          adminNotes: reason,
        },
      });
      if (claim.count !== 1) {
        throw new Error("Withdrawal can only be rejected once");
      }
      const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });

      // Require and transition exactly one reservation ledger row before
      // refunding earnings. This keeps even the transaction's operation order
      // fail-closed when the ledger row is missing.
      const ledgerUpdate = await tx.walletTransaction.updateMany({
        where: { reference: withdrawalId, userId: withdrawal.userId, type: "WITHDRAWAL", status: "PENDING", currency: "USD", amount: withdrawal.amount, fee: withdrawal.fee },
        data: { status: "FAILED" },
      });
      if (ledgerUpdate.count !== 1) {
        throw new Error("Pending withdrawal ledger entry is missing or already processed");
      }

      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          earningsBalance: { increment: withdrawal.amount },
          totalWithdrawn: { decrement: withdrawal.netAmount },
        },
      });

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId: withdrawal.userId,
          action: "WITHDRAWAL_REJECTED",
          details: JSON.stringify({
            withdrawalId,
            adminId,
            reason,
            amount: withdrawal.amount,
          }),
        },
      });

      return updated;
    });

    // Financial state is committed; notification delivery must not make a
    // successful rejection/refund appear to have failed.
    try {
      await notificationService.createNotification(
        withdrawal.userId,
        "WALLET_WITHDRAWAL_FAILED",
        "Withdrawal Rejected",
        `Your withdrawal of ${withdrawal.amount.toFixed(2)} was rejected. ${reason || "Please contact support."}`,
        { withdrawalId, amount: withdrawal.amount, reason }
      );
    } catch (notificationError) {
      console.error("[WALLET] withdrawal rejection committed; notification failed:", notificationError);
    }

    return result;
  }

  /**
   * User-initiated cancellation of a PENDING withdrawal. Atomically refunds
   * the reserved earnings exactly once (CAS-guarded status transition).
   */
  async cancelWithdrawal(withdrawalId: string, userId: string) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }
    if (withdrawal.userId !== userId) {
      throw new Error("You can only cancel your own withdrawals");
    }

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, userId, status: "PENDING", transactionHash: null,
          amount: withdrawal.amount, fee: withdrawal.fee, netAmount: withdrawal.netAmount },
        data: {
          status: "CANCELLED",
          processedBy: userId,
          processedAt: new Date(),
          adminNotes: "Cancelled by user",
        },
      });
      if (claim.count !== 1) {
        throw new Error("This withdrawal can no longer be cancelled");
      }
      const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });

      // Transition the reservation ledger before refunding the balance.
      const ledgerUpdate = await tx.walletTransaction.updateMany({
        where: { reference: withdrawalId, userId: withdrawal.userId, type: "WITHDRAWAL", status: "PENDING", currency: "USD", amount: withdrawal.amount, fee: withdrawal.fee },
        data: { status: "CANCELLED" },
      });
      if (ledgerUpdate.count !== 1) {
        throw new Error("Pending withdrawal ledger entry is missing or already processed");
      }

      await tx.wallet.update({
        where: { userId },
        data: {
          earningsBalance: { increment: withdrawal.amount },
          totalWithdrawn: { decrement: withdrawal.netAmount },
        },
      });

      await tx.walletAuditLog.create({
        data: {
          userId,
          action: "WITHDRAWAL_CANCELLED",
          details: JSON.stringify({ withdrawalId, amount: withdrawal.amount }),
        },
      });

      return updated;
    });

    try {
      await notificationService.createNotification(
        userId,
        "WALLET_WITHDRAWAL_CANCELLED",
        "Withdrawal Cancelled",
        `Your withdrawal request of ${withdrawal.amount.toFixed(2)} was cancelled and the funds returned to your earnings balance.`,
        { withdrawalId, amount: withdrawal.amount }
      );
    } catch (notificationError) {
      console.error("[WALLET] withdrawal cancellation committed; notification failed:", notificationError);
    }

    return result;
  }

  async getWithdrawals(userId: string, limit: number = 20) {
    return prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  // ============================================================
  // TRANSACTION HISTORY
  // ============================================================

  /** Completed VANTA ledger activity, excluding USD earnings and reservations.
   * Never infer historical balances from a partial page of transactions. */
  async getCoinActivity(userId: string, days: 7 | 30 | 90) {
    const today = startOfUTCDay(new Date());
    const start = new Date(today.getTime() - (days - 1) * 86400000);
    const end = new Date(today.getTime() + 86400000);
    const rows = await prisma.walletTransaction.findMany({
      where: { userId, currency: "VANTA", status: "COMPLETED", createdAt: { gte: start, lt: end } },
      select: { type: true, amount: true, fee: true, currency: true, metadata: true, createdAt: true, balanceBefore: true, balance: true },
      take: 20001,
    });
    if (rows.length > 20000) throw new Error("Activity volume exceeds the current report limit. Choose a shorter period.");
    const buckets = Array.from({ length: days }, (_, i) => ({
      date: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10),
      incoming: 0, outgoing: 0, purchases: 0, giftsSent: 0, giftsReceived: 0, transferFees: 0, net: 0,
    }));
    let excluded = 0;
    for (const row of rows) {
      if (row.type === TX_TYPES.FOLLOWER_REWARD_RESERVE || row.type === TX_TYPES.FOLLOWER_REWARD_RELEASE || row.type === TX_TYPES.FOLLOWER_REWARD_REFUND) continue;
      const delta = resolveWalletTransactionDelta(row);
      if (delta === null || !Number.isFinite(delta)) { excluded++; continue; }
      const day = Math.floor((row.createdAt.getTime() - start.getTime()) / 86400000);
      const bucket = buckets[day];
      if (!bucket) continue;
      if (delta > 0) bucket.incoming += delta;
      else bucket.outgoing += Math.abs(delta);
      bucket.net += delta;
      if (row.type === TX_TYPES.PURCHASE || row.type === TX_TYPES.DEPOSIT) bucket.purchases += Math.abs(delta);
      if (row.type === TX_TYPES.GIFT_SENT) bucket.giftsSent += Math.abs(delta);
      if (row.type === TX_TYPES.GIFT_RECEIVED) bucket.giftsReceived += Math.abs(delta);
      if (row.type === TX_TYPES.TRANSFER_SENT) bucket.transferFees += Math.max(0, row.fee || 0);
    }
    return { currency: "VANTA", days, buckets, excluded, asOf: new Date().toISOString() };
  }

  async getTransactionHistory(
    userId: string,
    options: {
      type?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      direction?: 'incoming' | 'outgoing';
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where: any = { userId };

    // Map filter categories to actual transaction types
    if (options.type) {
      const typeMap: Record<string, string[]> = {
        deposits: ["DEPOSIT", "PURCHASE"],
        transfers: ["TRANSFER_SENT", "TRANSFER_RECEIVED"],
        gifts: ["GIFT_SENT", "GIFT_RECEIVED"],
        earnings: ["CREATOR_EARNING"],
        purchases: ["PURCHASE", "DEPOSIT"],
        withdrawals: ["WITHDRAWAL"],
        refunds: ["REFUND"],
      };
      const mappedTypes = typeMap[options.type.toLowerCase()];
      if (mappedTypes) {
        where.type = { in: mappedTypes };
      } else {
        where.type = options.type;
      }
    }
    if (options.status) {
      where.status = options.status;
    }
    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) where.createdAt.gte = options.startDate;
      if (options.endDate) where.createdAt.lte = options.endDate;
    }
    const conditions: any[] = [];
    if (options.search) {
      const term = options.search.trim().replace(/^@/, '');
      if (term) conditions.push({ OR: [
        { description: { contains: term, mode: "insensitive" } },
        { type: { contains: term.replace(/\s+/g, "_"), mode: "insensitive" } },
        { reference: { contains: term, mode: "insensitive" } },
        { id: { equals: term } },
      ] });
    }
    if (options.direction) {
      const types = options.direction === "incoming" ? Array.from(INCOMING_TYPES).filter(type => type !== FOLLOWER_REWARD_CLAIM_TYPE) : Array.from(OUTGOING_TYPES);
      conditions.push({ OR: [
        { type: { in: types } },
        { type: FOLLOWER_REWARD_CLAIM_TYPE, metadata: { contains: options.direction === "incoming" ? '"side":"claimant"' : '"side":"creator"' } },
      ] });
    }
    if (conditions.length) where.AND = conditions;

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: options.limit || 50,
        skip: options.offset || 0,
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    // Enrich transactions with user display info from metadata
    const enriched = await Promise.all(
      transactions.map(async (tx) => {
        let metadata: any = {};
        try {
          metadata = tx.metadata ? JSON.parse(tx.metadata) : {};
        } catch { /* ignore */ }

        // Resolve counterparty display info
        let counterparty: { id: string; username: string; displayName: string } | null = null;
        const counterpartyId = metadata.receiverId || metadata.senderId;
        if (counterpartyId) {
          counterparty = await getUserDisplayInfo(counterpartyId);
        }

        const isIncomingBase = INCOMING_TYPES.has(tx.type as any);
        // Follower Reward CLAIM rows exist on BOTH sides of a payout: the
        // follower's credit (incoming) and the creator's spend (outgoing). The
        // party is recorded in `metadata.side` so the ledger signs are correct.
        const isIncoming: boolean =
          tx.type === FOLLOWER_REWARD_CLAIM_TYPE && metadata.side === 'creator'
            ? false
            : isIncomingBase;
        const isOutgoing = OUTGOING_TYPES.has(tx.type as any) || (!isIncoming && tx.type === FOLLOWER_REWARD_CLAIM_TYPE);
        return {
          ...tx,
          amount: Math.abs(tx.amount),
          displayAmount: isIncoming ? tx.amount : -Math.abs(tx.amount),
          sign: isIncoming ? '+' : '-',
          isIncoming,
          isOutgoing,
          counterparty,
          metadata,
        };
      })
    );

    return { transactions: enriched, total, limit: options.limit || 50, offset: options.offset || 0 };
  }

  async getTransfersSent(userId: string, limit: number = 50, offset: number = 0) {
    const [transfers, total] = await Promise.all([
      prisma.coinTransfer.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          receiver: { select: { id: true, username: true, fullName: true, avatar: true } },
        },
      }),
      prisma.coinTransfer.count({ where: { senderId: userId } }),
    ]);
    return { transfers, total };
  }

  async getTransfersReceived(userId: string, limit: number = 50, offset: number = 0) {
    const [transfers, total] = await Promise.all([
      prisma.coinTransfer.findMany({
        where: { receiverId: userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          sender: { select: { id: true, username: true, fullName: true, avatar: true } },
        },
      }),
      prisma.coinTransfer.count({ where: { receiverId: userId } }),
    ]);
    return { transfers, total };
  }

  async getGiftHistory(userId: string, limit: number = 50) {
    const [sentGifts, receivedGifts] = await Promise.all([
      prisma.giftTransaction.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          gift: true,
          receiver: { select: { id: true, username: true, fullName: true, avatar: true } },
        },
      }),
      prisma.giftTransaction.findMany({
        where: { receiverId: userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          gift: true,
          sender: { select: { id: true, username: true, fullName: true, avatar: true } },
        },
      }),
    ]);

    return { sentGifts, receivedGifts };
  }

  async getDeposits(userId: string, limit: number = 50, offset: number = 0) {
    const [deposits, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.purchaseOrder.count({ where: { userId } }),
    ]);
    return { deposits, total };
  }

  async getWithdrawalHistory(userId: string, limit: number = 50, offset: number = 0) {
    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.withdrawal.count({ where: { userId } }),
    ]);
    return { withdrawals, total };
  }

  // ============================================================
  // WALLET ADMINISTRATION
  // ============================================================

  async freezeWallet(userId: string, adminId: string, reason: string) {
    const wallet = await this.ensureWallet(userId);
    if (wallet.isFrozen) {
      throw new Error("Wallet is already frozen");
    }

    const updated = await prisma.wallet.update({
      where: { userId },
      data: {
        isFrozen: true,
        frozenAt: new Date(),
        frozenBy: adminId,
        freezeReason: reason,
      },
    });

    await this.logAudit(userId, "FROZEN", {
      walletId: wallet.id,
      adminId,
      reason,
    });

    return updated;
  }

  async unfreezeWallet(userId: string, adminId: string) {
    const wallet = await this.ensureWallet(userId);
    if (!wallet.isFrozen) {
      throw new Error("Wallet is not frozen");
    }

    const updated = await prisma.wallet.update({
      where: { userId },
      data: {
        isFrozen: false,
        frozenAt: null,
        frozenBy: null,
        freezeReason: null,
      },
    });

    await this.logAudit(userId, "UNFROZEN", {
      walletId: wallet.id,
      adminId,
    });

    return updated;
  }

  async reverseTransaction(transactionId: string, adminId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }
      if (transaction.status !== "COMPLETED") {
        throw new Error("Only completed transactions can be reversed");
      }

      if (transaction.currency !== "VANTA") {
        throw new Error("Only VANTA Coin transactions can be reversed");
      }

      // Validate direction before claiming the source row. Follower reward rows
      // require metadata.side to distinguish creator debit from claimant credit.
      const originalDelta = resolveWalletTransactionDelta(transaction);
      if (originalDelta === null || !Number.isFinite(originalDelta) || originalDelta === 0) {
        throw new Error("Transaction type, amount or direction cannot be safely reversed");
      }
      const reversalDelta = -originalDelta;

      // Compare-and-swap the source transaction only after it is known to be
      // reversible. Exactly one concurrent admin request can claim it.
      const claim = await tx.walletTransaction.updateMany({
        where: { id: transactionId, status: "COMPLETED" },
        data: { status: "REVERSED" },
      });
      if (claim.count !== 1) {
        throw new Error("Transaction already reversed or no longer eligible");
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId: transaction.userId },
      });
      if (!wallet) throw new Error("Wallet not found");

      const debitAmount = Math.max(0, -reversalDelta);
      if (debitAmount > 0 && resolveAvailableCoins(wallet) < debitAmount) {
        throw new Error("Insufficient available coins to reverse this transaction without consuming locked funds");
      }

      // Compare-and-swap both balances so the ledger snapshot and balance
      // update describe the same state. Concurrent wallet changes cause a
      // safe retry instead of a stale before/after record.
      const balanceClaim = await tx.wallet.updateMany({
        where: {
          userId: transaction.userId,
          coinBalance: wallet.coinBalance,
          lockedCoins: wallet.lockedCoins,
        },
        data: { coinBalance: { increment: reversalDelta } },
      });
      if (balanceClaim.count !== 1) {
        throw new Error("Wallet changed during reversal; retry the operation");
      }
      const updatedWallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: transaction.userId },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: transaction.userId,
          type: reversalDelta > 0 ? TX_TYPES.ADMIN_CREDIT : TX_TYPES.ADMIN_DEBIT,
          currency: "VANTA",
          amount: Math.abs(reversalDelta),
          balanceBefore: wallet.coinBalance,
          balance: updatedWallet.coinBalance,
          status: "COMPLETED",
          description: `Reversal: ${reason}`,
          reference: transaction.reference,
          metadata: JSON.stringify({ originalTransactionId: transactionId, reversedBy: adminId, reason }),
        },
      });

      await tx.walletAuditLog.create({
        data: {
          userId: transaction.userId,
          action: "REVERSAL",
          details: JSON.stringify({ transactionId, adminId, reason }),
        },
      });

      return { success: true, message: "Transaction reversed" };
    });
  }

  async flagSuspiciousAccount(userId: string, adminId: string, reason: string) {
    await prisma.fraudAlert.create({
      data: {
        userId,
        alertType: "MANUAL_FLAG",
        severity: "HIGH",
        description: reason,
        evidence: JSON.stringify({ flaggedBy: adminId }),
      },
    });

    await this.logAudit(userId, "FLAGGED", {
      adminId,
      reason,
    });

    return { success: true, message: "Account flagged for review" };
  }

  // ============================================================
  // USDT WALLET ADDRESS
  // ============================================================

  async saveUsdtWalletAddress(userId: string, address: string) {
    const normalized = String(address || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalized) || /^0x0{40}$/i.test(normalized)) {
      throw new Error('Enter a valid non-zero BNB Smart Chain (BEP-20) address');
    }
    await this.ensureWallet(userId);
    return prisma.wallet.update({
      where: { userId },
      data: { usdtWalletAddress: normalized },
    });
  }

  // ============================================================
  // AUDIT LOGGING
  // ============================================================

  // ============================================================
  // RECONCILIATION (Phase 10)
  // ============================================================

  /**
   * Reconcile a single wallet: compute the authoritative balance from the
   * Wallet ledger (WalletTransaction rows) and compare it against the stored
   * Wallet.coinBalance. One repeatable-read transaction records coin and USD
   * reconciliation evidence and discrepancy audits. Historical balances are
   * never silently rewritten; automated freezing is disabled.
   */
  async reconcileWallet(userId: string): Promise<{
    status: 'MATCH' | 'DISCREPANCY';
    storedBalance: number;
    ledgerBalance: number;
    difference: number;
    logId: string;
    earningsStatus: 'MATCH' | 'DISCREPANCY';
    storedEarningsBalance: number;
    ledgerEarningsBalance: number;
    earningsDifference: number;
    earningsLogId: string;
  }> {
    return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error('Wallet not found');
    const txns = await tx.walletTransaction.findMany({
      where: { userId, currency: { in: ["VANTA", "USD"] } },
      select: { type: true, amount: true, currency: true, metadata: true, status: true },
    });

    const ledgerBalance = txns.reduce((sum, t) => {
      // Reversed/failed rows are historical evidence, not current balance
      // movements. Legacy rows without a status are retained for compatibility.
      if (t.status && t.status !== "COMPLETED") return sum;
      // USD-denominated earnings and legacy cash gift rows must never be
      // applied to the VANTA Coin balance.
      if (t.currency === "USD" || isLegacyCashGiftCredit(t)) return sum;
      const delta = resolveWalletTransactionDelta(t);
      return delta === null ? sum : sum + Math.trunc(delta);
    }, 0);
    const storedBalance = wallet.coinBalance || 0;
    const difference = storedBalance - ledgerBalance;
    const status: 'MATCH' | 'DISCREPANCY' = difference === 0 ? 'MATCH' : 'DISCREPANCY';

    // Earnings are stored as decimal USD, while the reconciliation log uses
    // integer fields. Convert to cents to avoid floating-point drift.
    const ledgerEarningsCents = txns.reduce((sum, t) => {
      const legacyGiftCredit = isLegacyCashGiftCredit(t);
      if (t.currency !== "USD" && !legacyGiftCredit) return sum;
      // Pending withdrawals have already been reserved from earningsBalance;
      // completed withdrawals remain spent. Failed/cancelled/reversed rows do
      // not affect the current balance because their reservation was refunded.
      if (t.status && !["PENDING", "COMPLETED"].includes(t.status)) return sum;
      const cents = Math.round(Math.abs(t.amount) * 100);
      if (legacyGiftCredit || t.type === TX_TYPES.CREATOR_EARNING || t.type === TX_TYPES.ADMIN_CREDIT) return sum + cents;
      if (t.type === TX_TYPES.WITHDRAWAL || t.type === TX_TYPES.ADMIN_DEBIT) return sum - cents;
      return sum;
    }, 0);
    const storedEarningsCents = Math.round((wallet.earningsBalance || 0) * 100);
    const earningsDifferenceCents = storedEarningsCents - ledgerEarningsCents;
    const earningsStatus: 'MATCH' | 'DISCREPANCY' = earningsDifferenceCents === 0 ? 'MATCH' : 'DISCREPANCY';

    const log = await tx.walletReconciliationLog.create({
      data: {
        userId,
        walletId: wallet.id,
        currency: "VANTA_COIN",
        storedBalance,
        ledgerBalance,
        difference,
        status,
        details: JSON.stringify({ currency: "VANTA", transactionCount: txns.filter(t => t.currency !== "USD").length, computedAt: new Date().toISOString() }),
      },
    });
    const earningsLog = await tx.walletReconciliationLog.create({
      data: {
        userId,
        walletId: wallet.id,
        currency: "USD_CENTS",
        storedBalance: storedEarningsCents,
        ledgerBalance: ledgerEarningsCents,
        difference: earningsDifferenceCents,
        status: earningsStatus,
        details: JSON.stringify({ currency: "USD", unit: "cents", transactionCount: txns.filter(t => t.currency === "USD").length, computedAt: new Date().toISOString() }),
      },
    });

    if (status === 'DISCREPANCY') {
      await tx.walletAuditLog.create({ data: { userId, action: 'RECONCILIATION_DISCREPANCY', details: JSON.stringify({
        currency: "VANTA", storedBalance, ledgerBalance, difference, reconciliationLogId: log.id,
      }) } });
    }
    if (earningsStatus === 'DISCREPANCY') {
      await tx.walletAuditLog.create({ data: { userId, action: 'RECONCILIATION_DISCREPANCY', details: JSON.stringify({
        currency: "USD", storedBalance: storedEarningsCents / 100, ledgerBalance: ledgerEarningsCents / 100,
        difference: earningsDifferenceCents / 100, reconciliationLogId: earningsLog.id,
      }) } });
    }

    return {
      status,
      storedBalance,
      ledgerBalance,
      difference,
      logId: log.id,
      earningsStatus,
      storedEarningsBalance: storedEarningsCents / 100,
      ledgerEarningsBalance: ledgerEarningsCents / 100,
      earningsDifference: earningsDifferenceCents / 100,
      earningsLogId: earningsLog.id,
    };
    }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 });
  }

  /**
   * Reconcile a bounded page of wallets. Snapshot evidence is not a current
   * authorization decision. Automatic freezing remains disabled until an
   * independently reviewed fencing and ledger completeness protocol exists.
   */
  async reconcileAllWallets(options?: {
    limit?: number;
    freezeOnDiscrepancy?: boolean;
  }): Promise<{ checked: number; discrepancies: number; frozen: number }> {
    if (options?.freezeOnDiscrepancy) throw new Error('Automatic reconciliation freeze is disabled; manual review required');
    const wallets = await prisma.wallet.findMany({
      take: Math.min(Math.max(1, options?.limit || 500), 1000),
      select: { id: true, userId: true, coinBalance: true },
    });
    let discrepancies = 0;
    const frozen = 0;
    for (const wallet of wallets) {
      const result = await this.reconcileWallet(wallet.userId);
      const hasDiscrepancy = result.status === 'DISCREPANCY' || result.earningsStatus === 'DISCREPANCY';
      if (hasDiscrepancy) {
        discrepancies++;

      }
    }
    return { checked: wallets.length, discrepancies, frozen };
  }

  // ============================================================
  // OBSERVABILITY (Phase 18)
  // ============================================================

  /**
   * Lightweight structured metric hook for financial operations. In production
   * this is the plug point for a real metrics emitter (Prometheus / DataDog /
   * StatsD); the call sites already carry the stable counter names.
   */
  private logTally(counter: string, metadata?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'production') {
      // Replace with a real metrics client in production. Kept as a structured
      // console line today so no financial failure is ever silent.
      console.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          metric: `wallet.${counter}`,
          ...(metadata || {}),
        })
      );
    }
  }

  private async logAudit(userId: string, action: string, details?: any) {
    await prisma.walletAuditLog.create({
      data: {
        userId,
        action,
        details: details ? JSON.stringify(details) : undefined,
      },
    });
  }

  // ============================================================
  // ANALYTICS
  // ============================================================

  async getWalletAnalytics() {
    const [
      totalWallets,
      totalCoinsPurchased,
      totalCoinsTransferred,
      totalGiftsSent,
      totalCreatorEarnings,
      transferFeeRevenue,
      activeWallets,
      dailyTransactions,
    ] = await Promise.all([
      prisma.wallet.count(),
      prisma.wallet.aggregate({ _sum: { totalCoinsPurchased: true } }),
      prisma.wallet.aggregate({ _sum: { totalCoinsSent: true } }),
      prisma.wallet.aggregate({ _sum: { totalGiftsSent: true } }),
      prisma.wallet.aggregate({ _sum: { lifetimeEarnings: true } }),
      prisma.coinTransfer.aggregate({ _sum: { fee: true } }),
      prisma.wallet.count({ where: { updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
      prisma.walletTransaction.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    // Top spenders
    const topSpenders = await prisma.wallet.findMany({
      orderBy: { totalCoinsPurchased: "desc" },
      take: 10,
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });

    // Top creators
    const topCreators = await prisma.wallet.findMany({
      orderBy: { lifetimeEarnings: "desc" },
      take: 10,
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });

    return {
      totalWallets,
      totalCoinsPurchased: totalCoinsPurchased._sum.totalCoinsPurchased || 0,
      totalCoinsTransferred: totalCoinsTransferred._sum.totalCoinsSent || 0,
      totalGiftsSent: totalGiftsSent._sum.totalGiftsSent || 0,
      totalCreatorEarnings: totalCreatorEarnings._sum.lifetimeEarnings || 0,
      transferFeeRevenue: transferFeeRevenue._sum.fee || 0,
      activeWallets,
      dailyTransactions,
      topSpenders,
      topCreators,
    };
  }
}

export const walletService = new WalletService();