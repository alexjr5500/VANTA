import { prisma } from "../prisma";
import { PaymentProviderFactory } from "./payment-provider.interface";
import { notificationService } from "./notification.service";
import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import { calculateTransferFee, coinsToUsd, VANTA_COINS_PER_USD, WITHDRAWAL_FEE_RATE, MIN_WITHDRAWAL_AMOUNT } from "../config/wallet.config";

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
  FUNDRAISER_DONATION: "FUNDRAISER_DONATION",
  FUNDRAISER_RECEIVED: "FUNDRAISER_RECEIVED",
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
  TX_TYPES.FUNDRAISER_RECEIVED,
]);

// Types that represent money going OUT (negative)
const OUTGOING_TYPES = new Set([
  TX_TYPES.TRANSFER_SENT,
  TX_TYPES.GIFT_SENT,
  TX_TYPES.WITHDRAWAL,
  TX_TYPES.FEE,
  TX_TYPES.ADMIN_DEBIT,
  TX_TYPES.FUNDRAISER_DONATION,
]);

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
    case TX_TYPES.FUNDRAISER_DONATION:
      return `Donated ${safeAmount} VANTA Coins to ${counterpartyLabel || 'a fundraiser'}${note ? `: ${note}` : ''}`;
    case TX_TYPES.FUNDRAISER_RECEIVED:
      return `Received ${safeAmount} VANTA Coins from donations to ${counterpartyLabel || 'your fundraiser'}`;
    case TX_TYPES.DEPOSIT:
      return `Deposited ${safeAmount} VANTA Coins`;
    case TX_TYPES.PURCHASE:
      return `Purchased ${safeAmount} VANTA Coins`;
    case TX_TYPES.WITHDRAWAL:
      return `Requested withdrawal of ${safeAmount} VANTA Coins`;
    case TX_TYPES.REFUND:
      return `Refunded ${safeAmount} VANTA Coins`;
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

    if (wallet.coinBalance < amount) {
      throw new Error(
        `Insufficient coins. You have ${wallet.coinBalance} but need ${amount}.`
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
  // CHAT COIN TRANSFERS (5% Sender Fee)
  // ============================================================

  async transferCoins(
    senderId: string,
    receiverId: string,
    amount: number,
    note?: string,
    otpCode?: string,
    ipAddress?: string,
    deviceFingerprint?: string
  ) {
    if (senderId === receiverId) {
      throw new Error("Cannot send coins to yourself");
    }

    const senderWallet = await this.ensureWallet(senderId);
    const receiverWallet = await this.ensureWallet(receiverId);

    // Check if wallets are frozen
    if (senderWallet.isFrozen) {
      throw new Error("Your wallet is frozen. Contact support.");
    }
    if (receiverWallet.isFrozen) {
      throw new Error("Recipient's wallet is frozen.");
    }

    // Validate amount
    if (amount <= 0) {
      throw new Error("Transfer amount must be positive");
    }

    // Calculate fee (5% sender pays)
    const fee = calculateTransferFee(amount);
    const totalDeduction = amount + fee;
    const netReceived = amount;

    // Check balance
    if (senderWallet.coinBalance < totalDeduction) {
      throw new Error(
        `Insufficient balance. You need ${totalDeduction} coins (${amount} + ${fee} fee) but only have ${senderWallet.coinBalance}`
      );
    }

    // Check if OTP is needed for high-value transfers
    const transferLimit = await prisma.transferLimit.findUnique({
      where: { walletId: senderWallet.id },
    });
    if (transferLimit && totalDeduction >= transferLimit.otpThreshold) {
      if (!otpCode) {
        // Generate and send OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry

        // Store OTP in the transfer record (we'll create a pending transfer)
        await this.logAudit(senderId, "OTP_SENT", {
          amount: totalDeduction,
          ipAddress,
        });

        // Send OTP via notification
        await notificationService.createNotification(
          senderId,
          "WALLET_OTP",
          "Transfer OTP",
          `Your OTP for transferring ${amount} coins is: ${otp}. Valid for 10 minutes.`,
          { amount, otp }
        );

        return { requiresOTP: true, message: "OTP sent to your email/phone" };
      }

      // Verify OTP (in production, verify against stored OTP)
      // For now, we'll accept any 6-digit code as this would connect to email/SMS service
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

    // Execute transfer atomically
    const result = await prisma.$transaction(async (tx) => {
      // Update both wallets
      const updatedSender = await tx.wallet.update({
        where: { userId: senderId },
        data: {
          coinBalance: { decrement: totalDeduction },
          totalCoinsSent: { increment: amount },
        },
      });

      const updatedReceiver = await tx.wallet.update({
        where: { userId: receiverId },
        data: {
          coinBalance: { increment: netReceived },
          totalCoinsReceived: { increment: netReceived },
        },
      });

      // Create coin transfer record
      const transfer = await tx.coinTransfer.create({
        data: {
          senderId,
          receiverId,
          amount,
          fee,
          netAmount: netReceived,
          note,
          status: "COMPLETED",
          otpVerified: !!otpCode,
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
          description: buildTransactionDescription(TX_TYPES.TRANSFER_SENT, amount, receiverLabel, note),
          reference: transfer.id,
          metadata: JSON.stringify({ receiverId, amount, fee, note }),
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

      // Update daily used amount
      if (transferLimit) {
        await tx.transferLimit.update({
          where: { walletId: senderWallet.id },
          data: { dailyUsed: { increment: totalDeduction } },
        });
      }

      // Log audit
      await tx.walletAuditLog.create({
        data: {
          userId: senderId,
          action: "TRANSFER",
          details: JSON.stringify({
            transferId: transfer.id,
            receiverId,
            amount,
            fee,
            netReceived,
            ipAddress,
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
      `You sent ${amount.toLocaleString()} coins (fee: ${fee}) to ${receiverLabel}.`,
      { transferId: result.transfer.id, amount, fee, receiverId }
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
    const limit = await prisma.transferLimit.findUnique({
      where: { walletId: wallet.id },
    });

    if (!limit) {
      return prisma.transferLimit.create({
        data: { walletId: wallet.id, ...updates },
      });
    }

    return prisma.transferLimit.update({
      where: { walletId: wallet.id },
      data: updates,
    });
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

    // Atomic transaction: deduct earnings + create withdrawal record + create transaction
    const result = await prisma.$transaction(async (tx) => {
      // Re-check balance inside transaction to prevent race conditions
      const currentWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (currentWallet.earningsBalance < amount) {
        throw new Error("Insufficient earnings balance");
      }

      // Deduct earnings
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: {
          earningsBalance: { decrement: amount },
          totalWithdrawn: { increment: netAmount },
        },
      });

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

    // Atomic transaction: update withdrawal status + create transaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "COMPLETED",
          processedBy: adminId,
          processedAt: new Date(),
        },
      });

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

    // Atomic transaction: update withdrawal status + refund earnings
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "FAILED",
          processedBy: adminId,
          processedAt: new Date(),
          adminNotes: reason,
        },
      });

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

        const isIncoming = INCOMING_TYPES.has(tx.type as any);
        const isOutgoing = OUTGOING_TYPES.has(tx.type as any);
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