import { prisma } from "../prisma";
import { PaymentProviderFactory } from "./payment-provider.interface";
import { notificationService } from "./notification.service";
import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import { calculateTransferFee, coinsToUsd, VANTA_COINS_PER_USD, WITHDRAWAL_FEE_RATE, MIN_WITHDRAWAL_AMOUNT, PLATFORM_TRANSFER_LIMITS } from "../config/wallet.config";
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
]);

// Types that represent money going OUT (negative)
const OUTGOING_TYPES = new Set([
  TX_TYPES.TRANSFER_SENT,
  TX_TYPES.GIFT_SENT,
  TX_TYPES.WITHDRAWAL,
  TX_TYPES.FEE,
  TX_TYPES.ADMIN_DEBIT,
  TX_TYPES.FOLLOWER_REWARD_RESERVE,
]);

// Follower Reward claims move coins from the creator to the claimant. The
// ledger uses ONE transaction type (FOLLOWER_REWARD_CLAIM) for both sides and
// records which party the row belongs to in `metadata.side`.
const FOLLOWER_REWARD_CLAIM_TYPE = TX_TYPES.FOLLOWER_REWARD_CLAIM;

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
    const pendingBalance = await this.getPendingBalance(userId);
    const lockedBalance = wallet.lockedCoins || 0;
    const usdtBalance = wallet.earningsBalance || 0;
    const usdEstimate = coinsToUsd(wallet.coinBalance || 0);
    const totalPortfolioValue = usdEstimate + (wallet.earningsBalance || 0);

    return {
      ...wallet,
      transferLimit,
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
    const wallet = await this.ensureWallet(userId);

    if (wallet.isFrozen) {
      throw new Error("Wallet is frozen. Contact support.");
    }

    if (amount <= 0) {
      throw new Error("Amount must be positive");
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
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: {
          coinBalance: { decrement: amount },
          totalCoinsSent: { increment: amount },
        },
      });

      // Record transaction - store positive amount, sign derived from type
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: options?.type || "GIFT_SENT",
          amount: Math.abs(amount),
          fee: 0,
          balanceBefore: wallet.coinBalance,
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

  async processDeposit(
    userId: string,
    amount: number,
    coins: number,
    paymentMethod: string,
    providerOrderId: string,
    ipAddress?: string
  ) {
    // Check if wallet is frozen
    const wallet = await this.ensureWallet(userId);
    if (wallet.isFrozen) {
      throw new Error("Wallet is frozen. Contact support.");
    }

    // Check for duplicate provider order ID
    const existingOrder = await prisma.purchaseOrder.findUnique({
      where: { providerOrderId },
    });
    if (existingOrder?.status === "COMPLETED") {
      throw new Error("Duplicate payment detected. This order has already been processed.");
    }

    // Atomic transaction: create order + update wallet + create transaction
    const result = await prisma.$transaction(async (tx) => {
      // Record purchase order
      const orderData = {
          userId,
          coins,
          amount,
          currency: "USD",
          provider: "stripe",
          status: "COMPLETED",
          providerOrderId,
          paymentMethod,
      };
      const purchaseOrder = existingOrder
        ? await tx.purchaseOrder.update({ where: { id: existingOrder.id }, data: { status: "COMPLETED", paymentMethod } })
        : await tx.purchaseOrder.create({ data: orderData });

      // Update wallet balance - 0% platform fee, user gets full coins
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: {
          coinBalance: { increment: coins },
          totalCoinsPurchased: { increment: coins },
        },
      });

      // Create transaction record - positive amount for incoming
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: "DEPOSIT",
          amount: coins,
          fee: 0,
          balance: updatedWallet.coinBalance,
          status: "COMPLETED",
          description: `Purchased ${coins.toLocaleString()} VANTA Coins for $${amount.toFixed(2)}`,
          reference: purchaseOrder.id,
          metadata: JSON.stringify({
            paymentMethod,
            providerOrderId,
            amountUSD: amount,
          }),
        },
      });

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId,
          action: "DEPOSIT",
          details: JSON.stringify({
            amount,
            coins,
            paymentMethod,
            providerOrderId,
            ipAddress,
          }),
          ipAddress,
        },
      });

      return { purchaseOrder, updatedWallet };
    });

    // Send notification (outside transaction)
    await notificationService.createNotification(
      userId,
      "WALLET_DEPOSIT",
      "Deposit Successful",
      `${coins.toLocaleString()} VANTA Coins have been added to your Balance.`,
      { coins, amount }
    );

    return result.updatedWallet;
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
    const providerReference = options.providerOrderId?.trim() || order.providerReference || "";
    const providerOrderId = options.mode === "test"
      ? `test:${orderId}`
      : `live:${providerReference || orderId}`;

    // Conditional status flip makes the completion idempotent under concurrency:
    // a second request finds 0 rows updated and cannot credit twice.
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: orderId, userId, status: { in: [...COIN_PAYMENT_CREDITABLE_STATUSES] } },
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
        where: { userId },
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
          balanceBefore: wallet.coinBalance,
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
   *  - Refund claim is conditional (`status` in [COMPLETED, PAID]), so a
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
    if (order.status !== "COMPLETED" && order.status !== "PAID") {
      throw new Error(
        `Only completed purchases can be refunded (current status: ${order.status}).`
      );
    }

    const wallet = await this.ensureWallet(order.userId);
    if (wallet.coinBalance < order.coins) {
      throw new Error(
        `Refund deferred: the user's spendable balance (${wallet.coinBalance} coins) is below the refunded amount (${order.coins} coins). ` +
          "Reconcile manually per VANTA business rules before issuing this refund."
      );
    }

    const refundReason = (reason || "").trim().slice(0, 500) || null;

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: orderId, status: { in: ["COMPLETED", "PAID"] } },
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

      const updatedWallet = await tx.wallet.update({
        where: { userId: order.userId },
        data: { coinBalance: { decrement: order.coins } },
      });

      // Negative ledger entry: the original PURCHASE entry stays intact.
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: order.userId,
          type: "REFUND",
          amount: -order.coins,
          fee: 0,
          balanceBefore: wallet.coinBalance,
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
    sessionId?: string
  ) {
    if (senderId === receiverId) {
      throw new Error("Cannot send coins to yourself");
    }

    // Validate amount as a whole (integer) number of coins.
    const safeAmount = Math.trunc(Number(amount));
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
      throw new Error("Transfer amount must be a positive whole number");
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

    // Idempotency (Phase 4): a retried/double-submitted request with the same
    // requestId must never debit twice. UNIQUE(senderId, requestId) is the
    // database-level guard; this lookup is the fast path that returns the
    // already-committed transfer.
    if (requestId) {
      const existing = await prisma.coinTransfer.findUnique({
        where: { senderId_requestId: { senderId, requestId } },
      });
      if (existing) {
        return {
          transfer: existing,
          replayed: true,
          message: "This transfer was already processed.",
        };
      }
    }

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
          challengeId: challenge.id,
          expirySeconds: TRANSFER_OTP_CONSTANTS.expiryMs / 1000,
          message: "OTP sent to your email/phone",
        };
      }

      if (!challengeId) {
        throw new Error("An OTP challenge id is required to complete this transfer");
      }
    }

    // Fraud detection - check for duplicate transfers
    const recentTransfer = await prisma.coinTransfer.findFirst({
      where: {
        senderId,
        receiverId,
        amount,
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
        if (challenge.sessionId && sessionId && challenge.sessionId !== sessionId) {
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
        if (!valid) {
          await tx.transferOtpChallenge.update({
            where: { id: challenge.id },
            data: { attempts: { increment: 1 } },
          });
          await tx.walletAuditLog.create({
            data: {
              userId: senderId,
              action: "OTP_FAILED",
              details: JSON.stringify({ challengeId: challenge.id, receiverId, amount: totalDeduction }),
              ipAddress,
            },
          });
          this.logTally("otp_failed");
          throw new Error("Invalid OTP");
        }

        const consumed = await tx.transferOtpChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
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

    // Send notifications (outside transaction)
    await notificationService.createNotification(
      senderId,
      "WALLET_TRANSFER_SENT",
      "Transfer Sent",
      `You sent ${safeAmount.toLocaleString()} coins (fee: ${fee}) to ${receiverLabel}.`,
      { transferId: result.transfer.id, amount: safeAmount, fee, receiverId }
    );

    await notificationService.createNotification(
      receiverId,
      "WALLET_TRANSFER_RECEIVED",
      "Coins Received",
      `You received ${netReceived.toLocaleString()} coins from ${senderLabel}.`,
      { transferId: result.transfer.id, amount: netReceived, senderId }
    );

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

    // Delivery channel only — metadata carries the challenge reference, NOT the
    // OTP, so the code is never written to notification metadata/logs.
    await notificationService.createNotification(
      userId,
      "WALLET_OTP",
      "Transfer OTP",
      `Your OTP for transferring ${amount.toLocaleString()} coins is ${otp}. Valid for ${TRANSFER_OTP_CONSTANTS.expiryMs / 60000} minutes.`,
      {
        challengeId: challenge.id,
        receiverId,
        amount,
        flows: ["transfer"],
      }
    );

    await this.logAudit(userId, "OTP_SENT", {
      challengeId: challenge.id,
      receiverId,
      amount,
    });

    return challenge;
  }

  /**
   * Verify a transfer OTP challenge WITHOUT executing a transfer. Intended for
   * pre-validation UX; the authoritative consumption happens inside the
   * transfer transaction. Never exposes whether the code was correct — callers
   * get a boolean `valid` and a challenge that stays unconsumed on failure.
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
    if (sessionId && challenge.sessionId && challenge.sessionId !== sessionId) {
      return { valid: false, reason: "session" };
    }

    const valid = await bcrypt.compare(otpCode || "", challenge.otpHash);
    if (valid) {
      await prisma.transferOtpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return { valid: true };
    }

    await prisma.transferOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
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

    const valid = await bcrypt.compare(oldPin, pinRecord.pinHash);
    if (!valid) {
      throw new Error("Current PIN is incorrect");
    }

    if (!/^\d{4,6}$/.test(newPin)) {
      throw new Error("PIN must be 4-6 digits");
    }

    const newPinHash = await bcrypt.hash(newPin, 10);
    await prisma.walletPIN.update({
      where: { walletId: wallet.id },
      data: { pinHash: newPinHash, failedAttempts: 0, lockedUntil: null },
    });

    await this.logAudit(userId, "PIN_UPDATE", { walletId: wallet.id });

    return { success: true, message: "PIN updated successfully" };
  }

  async verifyPin(userId: string, pin: string) {
    const wallet = await this.ensureWallet(userId);
    const pinRecord = await prisma.walletPIN.findUnique({
      where: { walletId: wallet.id },
    });

    if (!pinRecord) {
      throw new Error("No PIN set");
    }

    if (pinRecord.lockedUntil && pinRecord.lockedUntil > new Date()) {
      throw new Error(
        `PIN is locked until ${pinRecord.lockedUntil.toISOString()}`
      );
    }

    const valid = await bcrypt.compare(pin, pinRecord.pinHash);
    if (!valid) {
      const newAttempts = pinRecord.failedAttempts + 1;
      const updates: any = { failedAttempts: newAttempts };
      if (newAttempts >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await prisma.walletPIN.update({
        where: { id: pinRecord.id },
        data: updates,
      });

      await this.logAudit(userId, "PIN_FAILED", {
        walletId: wallet.id,
        failedAttempts: newAttempts,
      });

      throw new Error(`Invalid PIN. ${5 - newAttempts} attempts remaining.`);
    }

    // Reset failed attempts
    if (pinRecord.failedAttempts > 0) {
      await prisma.walletPIN.update({
        where: { id: pinRecord.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }

    await this.logAudit(userId, "PIN_VERIFY", { walletId: wallet.id });

    return { success: true, message: "PIN verified" };
  }

  // ============================================================
  // WITHDRAWALS (10% Platform Fee)
  // ============================================================

  async requestWithdrawal(userId: string, amount: number, walletAddress: string) {
    // Validate amount
    if (!amount || amount <= 0) {
      throw new Error("Withdrawal amount must be positive");
    }

    // Validate wallet address
    if (!walletAddress || !walletAddress.trim()) {
      throw new Error("A valid USDT (BEP-20) wallet address is required");
    }

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
        status: "PENDING",
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
      // Re-check single-PENDING invariant inside the transaction: two
      // concurrent requests can both pass the preflight lookup above.
      const existingPending = await tx.withdrawal.count({
        where: { userId, status: "PENDING" },
      });
      if (existingPending > 0) {
        throw new Error("You already have a pending withdrawal request. Please wait for it to be processed.");
      }

      // Re-check balance AND debit in the same conditional mutation.
      const debit = await tx.wallet.updateMany({
        where: { userId, isFrozen: false, earningsBalance: { gte: amount } },
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
          amount,
          fee,
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

    // Send notification (outside transaction)
    await notificationService.createNotification(
      userId,
      "WALLET_WITHDRAWAL",
      "Withdrawal Requested",
      `Your withdrawal of $${amount.toFixed(2)} (net $${netAmount.toFixed(2)}) is being processed.`,
      { withdrawalId: result.withdrawal.id, amount, fee, netAmount }
    );

    return result.withdrawal;
  }

  async processWithdrawal(withdrawalId: string, adminId: string) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }

    if (withdrawal.status !== "PENDING") {
      throw new Error("Only pending withdrawals can be processed");
    }

    // Atomic transaction: conditionally flip PENDING -> COMPLETED. The CAS
    // (where status = PENDING) guarantees two concurrent admin approvals can
    // never both succeed — the loser updates 0 rows and aborts.
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: "PENDING" },
        data: {
          status: "COMPLETED",
          processedBy: adminId,
          processedAt: new Date(),
        },
      });
      if (claim.count !== 1) {
        throw new Error("Withdrawal can only be processed once");
      }
      const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });

      // Update the wallet transaction status
      await tx.walletTransaction.updateMany({
        where: { reference: withdrawalId, type: "WITHDRAWAL" },
        data: { status: "COMPLETED" },
      });

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId: withdrawal.userId,
          action: "WITHDRAWAL_PROCESSED",
          details: JSON.stringify({
            withdrawalId,
            adminId,
            amount: withdrawal.amount,
            netAmount: withdrawal.netAmount,
          }),
        },
      });

      return updated;
    });

    // Send notification
    await notificationService.createNotification(
      withdrawal.userId,
      "WALLET_WITHDRAWAL_COMPLETED",
      "Withdrawal Completed",
      `Your withdrawal of $${withdrawal.netAmount.toFixed(2)} has been processed and sent to your wallet.`,
      { withdrawalId, amount: withdrawal.netAmount }
    );

    return result;
  }

  async rejectWithdrawal(withdrawalId: string, adminId: string, reason: string) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }

    if (withdrawal.status !== "PENDING") {
      throw new Error("Only pending withdrawals can be rejected");
    }

    // Atomic transaction: conditionally flip PENDING -> FAILED + refund once.
    // The CAS prevents a DOUBLE REFUND if two admins reject concurrently (or
    // a process + reject race) — only the first transition wins.
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: "PENDING" },
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

      // Refund earnings to user
      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          earningsBalance: { increment: withdrawal.amount },
          totalWithdrawn: { decrement: withdrawal.netAmount },
        },
      });

      // Update the wallet transaction status
      await tx.walletTransaction.updateMany({
        where: { reference: withdrawalId, type: "WITHDRAWAL" },
        data: { status: "FAILED" },
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

    // Send notification
    await notificationService.createNotification(
      withdrawal.userId,
      "WALLET_WITHDRAWAL_FAILED",
      "Withdrawal Rejected",
      `Your withdrawal of $${withdrawal.amount.toFixed(2)} was rejected. ${reason || "Please contact support."}`,
      { withdrawalId, amount: withdrawal.amount, reason }
    );

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
        where: { id: withdrawalId, userId, status: "PENDING" },
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

      // Refund reserved earnings exactly once.
      await tx.wallet.update({
        where: { userId },
        data: {
          earningsBalance: { increment: withdrawal.amount },
          totalWithdrawn: { decrement: withdrawal.netAmount },
        },
      });

      await tx.walletTransaction.updateMany({
        where: { reference: withdrawalId, type: "WITHDRAWAL" },
        data: { status: "CANCELLED" },
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

    await notificationService.createNotification(
      userId,
      "WALLET_WITHDRAWAL_CANCELLED",
      "Withdrawal Cancelled",
      `Your withdrawal request of $${withdrawal.amount.toFixed(2)} was cancelled and the funds returned to your earnings balance.`,
      { withdrawalId, amount: withdrawal.amount }
    );

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

  async getTransactionHistory(
    userId: string,
    options: {
      type?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
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
    if (options.search) {
      where.OR = [
        { description: { contains: options.search } },
        { type: { contains: options.search } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    if (transaction.status === "REVERSED") {
      throw new Error("Transaction already reversed");
    }

    // Atomic reversal
    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId: transaction.userId },
      });
      if (!wallet) throw new Error("Wallet not found");

      // Determine reversal direction
      const isIncoming = INCOMING_TYPES.has(transaction.type as any);
      const reversalAmount = isIncoming ? -Math.abs(transaction.amount) : Math.abs(transaction.amount);

      const updatedWallet = await tx.wallet.update({
        where: { userId: transaction.userId },
        data: { coinBalance: { increment: reversalAmount } },
      });

      // Mark original as reversed
      await tx.walletTransaction.update({
        where: { id: transactionId },
        data: { status: "REVERSED" },
      });

      // Create reversal record
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: transaction.userId,
          type: "REFUND",
          amount: Math.abs(reversalAmount),
          balance: updatedWallet.coinBalance,
          status: "COMPLETED",
          description: `Reversal: ${reason}`,
          reference: transaction.reference,
          metadata: JSON.stringify({ originalTransactionId: transactionId, reversedBy: adminId, reason }),
        },
      });

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId: transaction.userId,
          action: "REVERSAL",
          details: JSON.stringify({ transactionId, adminId, reason }),
        },
      });

      return updatedWallet;
    });

    return { success: true, message: "Transaction reversed" };
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
    const wallet = await this.ensureWallet(userId);
    return prisma.wallet.update({
      where: { userId },
      data: { usdtWalletAddress: address.trim() },
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
   * Wallet.coinBalance. Every run records exactly one WalletReconciliationLog
   * row (MATCH or DISCREPANCY). Discrepancies are NEVER silently fixed — they
   * are audited and surfaced; a caller can optionally freeze the wallet.
   */
  async reconcileWallet(userId: string): Promise<{
    status: 'MATCH' | 'DISCREPANCY';
    storedBalance: number;
    ledgerBalance: number;
    difference: number;
    logId: string;
  }> {
    const wallet = await this.ensureWallet(userId);
    const txns = await prisma.walletTransaction.findMany({
      where: { userId },
      select: { type: true, amount: true },
    });
    const ledgerBalance = txns.reduce((sum, t) => {
      if (INCOMING_TYPES.has(t.type as any)) return sum + Math.trunc(t.amount);
      if (OUTGOING_TYPES.has(t.type as any)) return sum - Math.trunc(t.amount);
      return sum; // unknown types do not affect the coin ledger
    }, 0);
    const storedBalance = wallet.coinBalance || 0;
    const difference = storedBalance - ledgerBalance;
    const status: 'MATCH' | 'DISCREPANCY' = difference === 0 ? 'MATCH' : 'DISCREPANCY';

    const log = await prisma.walletReconciliationLog.create({
      data: {
        userId,
        walletId: wallet.id,
        storedBalance,
        ledgerBalance,
        difference,
        status,
        details: JSON.stringify({ transactionCount: txns.length, computedAt: new Date().toISOString() }),
      },
    });

    if (status === 'DISCREPANCY') {
      await this.logAudit(userId, 'RECONCILIATION_DISCREPANCY', {
        storedBalance,
        ledgerBalance,
        difference,
        reconciliationLogId: log.id,
      });
      this.logTally('reconciliation_discrepancy', { userId, difference });
    }

    return { status, storedBalance, ledgerBalance, difference, logId: log.id };
  }

  /**
   * Reconcile all wallets (manual or periodic run). When
   * `freezeOnDiscrepancy` is enabled, wallets with a difference are frozen
   * with an auditable reason rather than silently adjusted.
   */
  async reconcileAllWallets(options?: {
    limit?: number;
    freezeOnDiscrepancy?: boolean;
  }): Promise<{ checked: number; discrepancies: number; frozen: number }> {
    const wallets = await prisma.wallet.findMany({
      take: Math.min(Math.max(1, options?.limit || 500), 1000),
      select: { id: true, userId: true, coinBalance: true },
    });
    let discrepancies = 0;
    let frozen = 0;
    for (const wallet of wallets) {
      const result = await this.reconcileWallet(wallet.userId);
      if (result.status === 'DISCREPANCY') {
        discrepancies++;
        if (options?.freezeOnDiscrepancy) {
          const update = await prisma.wallet.updateMany({
            where: { id: wallet.id, isFrozen: false },
            data: {
              isFrozen: true,
              frozenBy: 'system:reconciliation',
              freezeReason: `Reconciliation discrepancy: stored=${result.storedBalance}, ledger=${result.ledgerBalance}`,
            },
          });
          if (update.count === 1) frozen++;
        }
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