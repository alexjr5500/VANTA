import { prisma } from '../prisma';
import { walletService } from './wallet.service';
import { PurchasePackageNotFoundError } from '../errors/purchase.errors';
import {
  COIN_PAYMENT_MODE,
  COIN_PAYMENT_STATUS,
  getCoinPaymentMode,
} from '../config/coin-payments.config';

// Subscription revenue split. Gift cash earnings use the separate explicit
// 2-cent-per-3-eligible-coins rule in wallet.config.ts.
const REVENUE_SPLIT = Object.freeze({ CREATOR: 0.7, PLATFORM: 0.3 });

// Loyalty levels
const LOYALTY_LEVELS = [
  { level: 1, title: 'Bronze', minCoins: 0 },
  { level: 2, title: 'Silver', minCoins: 10000 },
  { level: 3, title: 'Gold', minCoins: 50000 },
  { level: 4, title: 'Platinum', minCoins: 250000 },
  { level: 5, title: 'Diamond', minCoins: 1000000 },
  { level: 6, title: 'Legend', minCoins: 5000000 },
];

export class MonetizationService {
  // ==========================================
  // VANTA COINS
  // ==========================================

  async getPackages() {
    return prisma.sparkCoinPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createPurchaseOrder(userId: string, packageId: string) {
    // The DATABASE package row is authoritative. A client-supplied id is only
    // ever a lookup key; price/coins are taken from this row, so the order can
    // never carry a manipulated amount and `packageId` always satisfies the
    // `PurchaseOrder_packageId_fkey` foreign key.
    const pkg = await prisma.sparkCoinPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) {
      throw new PurchasePackageNotFoundError();
    }

    const order = await prisma.purchaseOrder.create({
      data: {
        userId,
        packageId: pkg.id,
        packageName: pkg.name,
        // Coins credited are EXACTLY the package amount — ZERO bonus coins.
        coins: pkg.coins,
        amount: pkg.price,
        currency: 'USD',
        status: 'PENDING',
      },
    });

    return order;
  }

  /**
   * Complete a purchase order created through POST /api/monetization/purchase.
   *
   * Completion is guarded the same way as the verified Buy Coins flow:
   *   - ownership: the authenticated user must own the order;
   *   - test mode: only the backend-issued HMAC simulate token can complete the
   *     simulated payment (verified again inside walletService.completeCoinPurchase);
   *   - live mode: a client request can NEVER credit coins — only the trusted
   *     payment-provider webhook path is allowed to complete a live purchase.
   * The underlying credit is atomic and idempotent (conditional status claim),
   * so a retry can never credit the same order twice.
   */
  async completePurchase(
    userId: string,
    orderId: string,
    options: {
      providerOrderId?: string;
      paymentMethod?: string;
      simulateToken?: string;
      ipAddress?: string;
    } = {}
  ) {
    const order = await prisma.purchaseOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new Error('Purchase order not found');
    if (order.status === COIN_PAYMENT_STATUS.COMPLETED) {
      return { order, alreadyCompleted: true };
    }

    const mode = getCoinPaymentMode();
    if (mode === COIN_PAYMENT_MODE.TEST) {
      // Simulated gateway — same rule as POST /api/wallets/verify-payment.
      return walletService.completeCoinPurchase(userId, orderId, {
        mode: COIN_PAYMENT_MODE.TEST,
        simulateToken: options.simulateToken,
        ipAddress: options.ipAddress,
      });
    }

    // LIVE mode: coins are credited exclusively by the trusted provider
    // webhook after server-side verification. A client-submitted reference is
    // never proof of payment (prevents fabricated/unverified self-credits).
    throw new Error(
      'This payment must be verified by the payment provider before coins are credited.'
    );
  }

  async createCustomPurchaseOrder(userId: string, coins: number, amount: number) {
    return prisma.purchaseOrder.create({
      data: { userId, coins, amount, status: 'PENDING' },
    });
  }

  // ==========================================
  // GIFTS
  // ==========================================

  async getGifts(category?: string) {
    const where: any = { isActive: true, retiredAt: null };
    if (category && category !== 'all') {
      where.category = category;
    }
    return prisma.gift.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getGiftById(giftId: string) {
    return prisma.gift.findFirst({ where: { id: giftId, isActive: true, retiredAt: null } });
  }

  // All gift sends use GiftService, the single authoritative wallet transaction path.

  // ==========================================
  // WALLET
  // ==========================================

  async getWallet(userId: string) {
    let wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId },
        include: { transactions: { take: 0 } },
      });
    }

    return wallet;
  }

  async getTransactions(userId: string, type?: string, limit = 50) {
    const where: any = { userId };
    if (type) where.type = type;

    return prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getGiftHistory(userId: string, limit = 50) {
    return prisma.giftTransaction.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        gift: true,
        sender: { select: { id: true, username: true, avatar: true } },
        receiver: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ==========================================
  // CREATOR EARNINGS
  // ==========================================

  async getCreatorEarnings(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    const [dailyEarnings, weeklyEarnings, monthlyEarnings] = await Promise.all([
      this.getEarningsForPeriod(userId, 'day'),
      this.getEarningsForPeriod(userId, 'week'),
      this.getEarningsForPeriod(userId, 'month'),
    ]);

    const recentGifts = await prisma.giftTransaction.findMany({
      where: { receiverId: userId },
      include: {
        gift: true,
        sender: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const subscriberCount = await prisma.creatorSubscription.count({
      where: { creatorId: userId, status: 'ACTIVE' },
    });

    return {
      wallet,
      dailyEarnings,
      weeklyEarnings,
      monthlyEarnings,
      recentGifts,
      subscriberCount,
      revenueSplit: REVENUE_SPLIT,
    };
  }

  private async getEarningsForPeriod(userId: string, period: 'day' | 'week' | 'month') {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        const dayOfWeek = now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        createdAt: { gte: startDate },
        OR: [
          { type: 'CREATOR_EARNING', currency: 'USD' },
          // Compatibility with the retired gift path, which wrote USD
          // earnings into a default-VANTA GIFT_RECEIVED row.
          { type: 'GIFT_RECEIVED', currency: 'VANTA' },
        ],
      },
      select: { type: true, currency: true, amount: true, metadata: true },
    });

    const eligibleEarnings = transactions.filter((transaction) => {
      if (transaction.type === 'CREATOR_EARNING' && transaction.currency === 'USD') return true;
      if (transaction.type !== 'GIFT_RECEIVED' || transaction.currency === 'USD') return false;
      const metadata = transaction.metadata
        ? (() => { try { return JSON.parse(transaction.metadata); } catch { return null; } })()
        : null;
      // The active gift path also stores creatorEarningsUsd in metadata, but
      // marks autoConverted=true and has a separate USD ledger row.
      return metadata?.autoConverted !== true &&
        Number.isFinite(Number(metadata?.creatorEarningsUsd));
    });
    const earnings = eligibleEarnings.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

    return {
      earnings: Math.round(earnings * 100) / 100,
      count: eligibleEarnings.length,
      period,
    };
  }

  // ==========================================
  // SUBSCRIPTIONS
  // ==========================================

  async subscribe(subscriberId: string, creatorId: string, tier: string) {
    if (subscriberId === creatorId) throw new Error('You cannot subscribe to yourself');
    const tierConfig = await prisma.subscriptionTier.findUnique({
      where: { creatorId_tier: { creatorId, tier } },
    });
    if (!tierConfig || !tierConfig.isActive) throw new Error('Subscription tier is unavailable');

    const price = Number(tierConfig.price);
    if (!Number.isSafeInteger(price) || price < 1) throw new Error('Subscription price is invalid');

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return prisma.$transaction(async (tx) => {
      const existing = await tx.creatorSubscription.findUnique({
        where: { subscriberId_creatorId: { subscriberId, creatorId } },
      });
      if (existing?.status === 'ACTIVE' && existing.currentPeriodEnd > now) {
        throw new Error('Your subscription is already active');
      }

      const currentWallet = await tx.wallet.findUnique({ where: { userId: subscriberId } });
      if (
        !currentWallet ||
        currentWallet.isFrozen ||
        currentWallet.coinBalance - (currentWallet.lockedCoins || 0) < price
      ) {
        throw new Error('Insufficient available coins');
      }

      // Compare both balance and reservation state so a concurrent transfer
      // or follower-reward reservation cannot spend the same coins twice.
      const debit = await tx.wallet.updateMany({
        where: {
          id: currentWallet.id,
          isFrozen: false,
          coinBalance: currentWallet.coinBalance,
          lockedCoins: currentWallet.lockedCoins,
        },
        data: {
          coinBalance: { decrement: price },
          totalCoinsSent: { increment: price },
        },
      });
      if (debit.count !== 1) throw new Error('Balance changed while subscribing. Please try again.');

      const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: subscriberId } });
      const creatorEarningsCents = Math.round(price * REVENUE_SPLIT.CREATOR);
      const platformShare = price - creatorEarningsCents;
      const creatorEarningsUsd = creatorEarningsCents / 100;

      const updatedCreatorWallet = await tx.wallet.update({
        where: { userId: creatorId },
        data: {
          earningsBalance: { increment: creatorEarningsUsd },
          lifetimeEarnings: { increment: creatorEarningsUsd },
        },
      });

      const subscription = await tx.creatorSubscription.upsert({
        where: { subscriberId_creatorId: { subscriberId, creatorId } },
        create: {
          subscriberId,
          creatorId,
          tier,
          price,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        update: {
          tier,
          price,
          status: 'ACTIVE',
          autoRenew: true,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: currentWallet.id,
          userId: subscriberId,
          type: 'SUBSCRIPTION',
          amount: price,
          fee: platformShare,
          balanceBefore: currentWallet.coinBalance,
          balance: updatedWallet.coinBalance,
          status: 'COMPLETED',
          description: `Creator subscription to @${creatorId}`,
          reference: subscription.id,
          metadata: JSON.stringify({ creatorId, tier, price, creatorEarningsCents, creatorEarningsUsd }),
        },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: updatedCreatorWallet.id,
          userId: creatorId,
          type: "CREATOR_EARNING",
          currency: "USD",
          amount: creatorEarningsUsd,
          fee: 0,
          balanceBefore: updatedCreatorWallet.earningsBalance - creatorEarningsUsd,
          balance: updatedCreatorWallet.earningsBalance,
          status: "COMPLETED",
          description: "Creator subscription earnings",
          reference: subscription.id,
          metadata: JSON.stringify({
            source: "SUBSCRIPTION",
            subscriberId,
            tier,
            grossCoins: price,
            creatorSharePercent: REVENUE_SPLIT.CREATOR * 100,
          }),
        },
      });

      await tx.walletAuditLog.create({
        data: {
          userId: creatorId,
          action: 'SUBSCRIPTION_EARNING',
          details: JSON.stringify({ subscriberId, tier, subscriptionId: subscription.id, amountUsd: creatorEarningsUsd }),
        },
      });

      return subscription;
    });
  }

  async cancelSubscription(subscriberId: string, creatorId: string) {
    return prisma.creatorSubscription.update({
      where: { subscriberId_creatorId: { subscriberId, creatorId } },
      data: { status: 'CANCELLED', autoRenew: false, cancelledAt: new Date() },
    });
  }

  async getCreatorSubscribers(creatorId: string) {
    return prisma.creatorSubscription.findMany({
      where: { creatorId, status: 'ACTIVE' },
      include: {
        subscriber: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  // ==========================================
  // PREMIUM MEMBERSHIP
  // ==========================================

  async purchasePremium(userId: string, planSlug: string) {
    const plan = await prisma.premiumPlan.findUnique({ where: { slug: planSlug } });
    if (!plan || !plan.isActive) throw new Error('Plan not found');

    const durationMs = plan.interval === 'YEARLY' 
      ? 365 * 24 * 60 * 60 * 1000 
      : plan.interval === 'LIFETIME'
        ? 100 * 365 * 24 * 60 * 60 * 1000 // 100 years
        : 30 * 24 * 60 * 60 * 1000;

    const now = new Date();
    const [membership] = await prisma.$transaction([
      prisma.premiumMembership.upsert({
        where: { userId },
        create: {
          userId,
          plan: plan.interval,
          price: plan.price,
          startedAt: now,
          expiresAt: new Date(now.getTime() + durationMs),
        },
        update: {
          plan: plan.interval,
          status: 'ACTIVE',
          price: plan.price,
          expiresAt: new Date(now.getTime() + durationMs),
          cancelledAt: null,
        },
      }),
      // Grant bonus coins
      prisma.wallet.upsert({
        where: { userId },
        create: { userId, coinBalance: plan.coins, bonusCoins: plan.coins },
        update: { coinBalance: { increment: plan.coins }, bonusCoins: { increment: plan.coins } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { premium: true },
      }),
    ]);

    return membership;
  }

  async getPremiumStatus(userId: string) {
    const membership = await prisma.premiumMembership.findUnique({ where: { userId } });

    if (!membership) return { active: false };

    const isExpired = membership.expiresAt < new Date();
    if (isExpired && membership.status === 'ACTIVE') {
      await prisma.premiumMembership.update({
        where: { id: membership.id },
        data: { status: 'EXPIRED' },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { premium: false },
      });
      return { active: false };
    }

    return { active: membership.status === 'ACTIVE', membership };
  }

  async getPremiumPlans() {
    return prisma.premiumPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ==========================================
  // LEADERBOARD
  // ==========================================

  async getLeaderboard(period: string, type: string, limit = 20) {
    const now = new Date();
    let periodStart: Date;

    switch (period) {
      case 'DAILY':
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'WEEKLY':
        const dow = now.getDay();
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
        break;
      case 'MONTHLY':
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        periodStart = new Date(0);
    }

    // Try to get cached leaderboard
    const cached = await prisma.leaderboardEntry.findMany({
      where: {
        period,
        type,
        periodStart: { gte: periodStart },
      },
      orderBy: { rank: 'asc' },
      take: limit,
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });

    if (cached.length > 0) return cached;

    // Compute from transactions
    const field = type === 'TOP_SPENDER' ? 'senderId' : 'receiverId';
    const transactions = await prisma.giftTransaction.groupBy({
      by: [field],
      where: {
        createdAt: { gte: periodStart },
      },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    });

    const results = await Promise.all(
      transactions.map(async (t, i) => {
        const user = await prisma.user.findUnique({
          where: { id: t[field] },
          select: { id: true, username: true, avatar: true },
        });
        return {
          rank: i + 1,
          score: t._sum.amount || 0,
          count: t._count,
          user,
        };
      })
    );

    return results;
  }

  async getTopSupporters(creatorId: string, limit = 10) {
    const transactions = await prisma.giftTransaction.groupBy({
      by: ['senderId'],
      where: { receiverId: creatorId },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    });

    return Promise.all(
      transactions.map(async (t, i) => {
        const user = await prisma.user.findUnique({
          where: { id: t.senderId },
          select: { id: true, username: true, avatar: true },
        });
        return {
          rank: i + 1,
          totalCoins: t._sum.amount || 0,
          giftCount: t._count,
          user,
        };
      })
    );
  }

  // DAILY REWARDS removed - replaced by Welcome Reward
  // ==========================================
  // LOYALTY
  // ==========================================

  async getLoyaltyLevel(userId: string) {
    let level = await prisma.loyaltyLevel.findUnique({ where: { userId } });
    if (!level) {
      level = await prisma.loyaltyLevel.create({ data: { userId } });
    }

    const nextLevel = LOYALTY_LEVELS.find(l => l.level === level.level + 1);

    return {
      ...level,
      nextLevelCoins: nextLevel?.minCoins || null,
      coinsToNext: nextLevel ? nextLevel.minCoins - level.xp : 0,
    };
  }

  // ==========================================
  // CREATOR MILESTONES
  // ==========================================

  async checkMilestones(creatorId: string) {
    const giftCount = await prisma.giftTransaction.count({
      where: { receiverId: creatorId },
    });

    const subscriberCount = await prisma.creatorSubscription.count({
      where: { creatorId, status: 'ACTIVE' },
    });

    const milestones = [
      { key: 'FIRST_GIFT', required: 1, coins: 100 },
      { key: '25_GIFTS', required: 25, coins: 250 },
      { key: '100_GIFTS', required: 100, coins: 500 },
      { key: '500_GIFTS', required: 500, coins: 1000 },
      { key: '1000_GIFTS', required: 1000, coins: 2500 },
      { key: 'FIRST_SUBSCRIBER', required: 1, coins: 200 },
      { key: '10_SUBSCRIBERS', required: 10, coins: 500 },
      { key: '50_SUBSCRIBERS', required: 50, coins: 1000 },
      { key: '100_SUBSCRIBERS', required: 100, coins: 2500 },
    ];

    const achieved: any[] = [];

    for (const milestone of milestones) {
      const count = milestone.key.includes('GIFT') ? giftCount : subscriberCount;
      if (count >= milestone.required) {
        const existing = await prisma.creatorMilestone.findUnique({
          where: { creatorId_milestone: { creatorId, milestone: milestone.key } },
        });

        if (!existing) {
          const created = await prisma.creatorMilestone.create({
            data: {
              creatorId,
              milestone: milestone.key,
              rewardCoins: milestone.coins,
            },
          });

          await prisma.wallet.upsert({
            where: { userId: creatorId },
            create: { userId: creatorId, earningsBalance: milestone.coins },
            update: { earningsBalance: { increment: milestone.coins }, bonusCoins: { increment: milestone.coins } },
          });

          achieved.push(created);
        }
      }
    }

    return achieved;
  }
}

export const monetizationService = new MonetizationService();