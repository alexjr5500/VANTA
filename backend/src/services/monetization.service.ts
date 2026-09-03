import { prisma } from '../prisma';
import { notificationService } from './notification.service';

// Revenue split configuration (configurable via admin)
const REVENUE_SPLIT = {
  CREATOR: 0.7,
  PLATFORM: 0.3,
};

// Gift combo configuration
const COMBO_TIMEOUT_MS = 10000; // 10 seconds to combo
const COMBO_MULTIPLIERS: Record<number, number> = {
  2: 1.1,  // 10% bonus
  3: 1.2,  // 20% bonus
  5: 1.35, // 35% bonus
  10: 1.5, // 50% bonus
};

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
    const pkg = await prisma.sparkCoinPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw new Error('Package not found or inactive');

    const order = await prisma.purchaseOrder.create({
      data: {
        userId,
        packageId: pkg.id,
        coins: pkg.coins + pkg.bonusCoins,
        amount: pkg.price,
        status: 'PENDING',
      },
    });

    return order;
  }

  async completePurchase(orderId: string, providerOrderId: string, paymentMethod?: string) {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING') throw new Error('Order already processed');

    const [updatedOrder] = await prisma.$transaction([
      prisma.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED',
          providerOrderId,
          paymentMethod,
        },
      }),
      prisma.wallet.upsert({
        where: { userId: order.userId },
        create: { userId: order.userId, coinBalance: order.coins },
        update: { coinBalance: { increment: order.coins } },
      }),
      prisma.walletTransaction.create({
        data: {
          userId: order.userId,
          type: 'PURCHASE',
          amount: order.coins,
          fee: 0,
          description: `Purchase ${order.coins} VANTA Coins`,
          reference: orderId,
        },
      }),
    ]);

    return updatedOrder;
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
    const where: any = { isActive: true };
    if (category && category !== 'all') {
      where.category = category;
    }
    return prisma.gift.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getGiftById(giftId: string) {
    return prisma.gift.findUnique({ where: { id: giftId } });
  }

  async sendGift(senderId: string, receiverId: string, giftId: string, options?: {
    streamId?: string;
    isAnon?: boolean;
    isSuper?: boolean;
  }) {
    const gift = await prisma.gift.findUnique({ where: { id: giftId } });
    if (!gift || !gift.isActive) throw new Error('Gift not found or inactive');
    if (gift.expiresAt && gift.expiresAt < new Date()) throw new Error('Gift has expired');

    const senderWallet = await prisma.wallet.findUnique({ where: { userId: senderId } });
    if (!senderWallet || senderWallet.coinBalance < gift.price) {
      throw new Error('Insufficient VANTA Coins');
    }

    // Check for combo
    let combo: any = null;
    if (gift.comboEnabled) {
      combo = await this.checkCombo(senderId, receiverId, options?.streamId);
    }

    const finalAmount = combo ? Math.round(gift.price * combo.multiplier) : gift.price;
    const comboCount = combo ? combo.comboCount : 1;

    // Execute transaction
    const transaction = await prisma.$transaction(async (tx: any) => {
      // Deduct coins from sender
      await tx.wallet.update({
        where: { userId: senderId },
        data: {
          coinBalance: { decrement: finalAmount },
          totalGiftsSent: { increment: 1 },
        },
      });

      // Add earnings to receiver (70% creator share)
      const earnings = Math.round(finalAmount * REVENUE_SPLIT.CREATOR);
      await tx.wallet.update({
        where: { userId: receiverId },
        data: {
          earningsBalance: { increment: earnings },
          lifetimeEarnings: { increment: earnings },
          totalGiftsReceived: { increment: 1 },
        },
      });

      // Record gift transaction
      const txRecord = await tx.giftTransaction.create({
        data: {
          senderId,
          receiverId,
          giftId,
          streamId: options?.streamId || null,
          amount: finalAmount,
          isCombo: !!combo,
          comboCount,
          isAnon: options?.isAnon || false,
          isSuper: options?.isSuper || false,
        },
      });

      // Record wallet transactions
      await tx.walletTransaction.create({
        data: {
          userId: senderId,
          type: 'GIFT_SENT',
          amount: -finalAmount,
          fee: 0,
          description: `Sent ${gift.name} gift`,
          reference: txRecord.id,
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId: receiverId,
          type: 'GIFT_RECEIVED',
          amount: earnings,
          fee: finalAmount - earnings,
          description: `Received ${gift.name} gift`,
          reference: txRecord.id,
        },
      });

      // Record live gift event if in stream
      if (options?.streamId) {
        const sender = await tx.user.findUnique({ where: { id: senderId } });
        await tx.liveGiftEvent.create({
          data: {
            streamId: options.streamId,
            senderId,
            receiverId,
            giftId,
            giftName: gift.name,
            giftEmoji: gift.emoji,
            amount: finalAmount,
            isCombo: !!combo,
            comboCount,
            isLegendary: gift.isLegendary,
            isAnon: options?.isAnon || false,
            senderName: options?.isAnon ? 'Anonymous' : sender?.username || 'Unknown',
          },
        });
      }

      // Update combo
      if (combo && combo.id) {
        await tx.giftCombo.update({
          where: { id: combo.id },
          data: {
            count: combo.comboCount,
            multiplier: combo.multiplier,
          },
        });
      } else if (gift.comboEnabled) {
        await tx.giftCombo.create({
          data: {
            senderId,
            receiverId,
            giftId,
            streamId: options?.streamId || null,
            count: 1,
            multiplier: 1.0,
          },
        });
      }

      // Update loyalty XP
      await this.addLoyaltyXP(senderId, finalAmount, tx);

      return txRecord;
    });

    // Send notifications
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true },
    });

    await notificationService.createNotification(
      receiverId,
      'GIFT',
      `${gift.isLegendary ? '🌟 LEGENDARY GIFT! 🌟' : '🎁 New Gift!'}`,
      `${options?.isAnon ? 'Someone' : sender?.username} sent ${gift.name}${combo ? ` x${comboCount}` : ''}!`,
      {
        giftId: gift.id,
        giftName: gift.name,
        giftEmoji: gift.emoji,
        isLegendary: gift.isLegendary,
        isCombo: !!combo,
        comboCount,
        senderId,
        senderName: options?.isAnon ? 'Anonymous' : sender?.username,
        isAnon: options?.isAnon,
      }
    );

    return { transaction, gift, isLegendary: gift.isLegendary, combo };
  }

  private async checkCombo(senderId: string, receiverId: string, streamId?: string) {
    const recentCombo = await prisma.giftCombo.findFirst({
      where: {
        senderId,
        receiverId,
        OR: streamId ? [{ streamId }] : [{ streamId: null }],
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!recentCombo) return null;

    const timeSinceLastGift = Date.now() - recentCombo.updatedAt.getTime();
    if (timeSinceLastGift > COMBO_TIMEOUT_MS) {
      return null;
    }

    const newCount = recentCombo.count + 1;
    const multiplier = this.getComboMultiplier(newCount);

    return { id: recentCombo.id, comboCount: newCount, multiplier };
  }

  private getComboMultiplier(count: number): number {
    const keys = Object.keys(COMBO_MULTIPLIERS).map(Number).sort((a, b) => b - a);
    for (const key of keys) {
      if (count >= key) return COMBO_MULTIPLIERS[key];
    }
    return 1.0;
  }

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

    const result = await prisma.giftTransaction.aggregate({
      where: {
        receiverId: userId,
        createdAt: { gte: startDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    return {
      earnings: result._sum.amount || 0,
      count: result._count,
      period,
    };
  }

  // ==========================================
  // SUBSCRIPTIONS
  // ==========================================

  async subscribe(subscriberId: string, creatorId: string, tier: string) {
    const tierConfig = await prisma.subscriptionTier.findUnique({
      where: { creatorId_tier: { creatorId, tier } },
    });

    const price = tierConfig?.price || 499;

    // Check balance
    const wallet = await prisma.wallet.findUnique({ where: { userId: subscriberId } });
    if (!wallet || wallet.coinBalance < price) throw new Error('Insufficient coins');

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const [subscription] = await prisma.$transaction([
      prisma.creatorSubscription.upsert({
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
      }),
      prisma.wallet.update({
        where: { userId: subscriberId },
        data: { coinBalance: { decrement: price } },
      }),
      // Creator gets 70%
      prisma.wallet.update({
        where: { userId: creatorId },
        data: { earningsBalance: { increment: Math.round(price * REVENUE_SPLIT.CREATOR) } },
      }),
    ]);

    return subscription;
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

  private async addLoyaltyXP(userId: string, coins: number, tx?: any) {
    const client = tx || prisma;
    const xp = Math.floor(coins / 10);

    const level = await client.loyaltyLevel.findUnique({ where: { userId } });
    if (!level) {
      await client.loyaltyLevel.create({
        data: { userId, xp, level: 1, tier: 'BRONZE' },
      });
      return;
    }

    const newXp = level.xp + xp;
    const newLevel = this.calculateLevel(newXp);

    await client.loyaltyLevel.update({
      where: { userId },
      data: {
        xp: newXp,
        level: newLevel.level,
        tier: newLevel.title.toUpperCase(),
      },
    });
  }

  private calculateLevel(xp: number) {
    for (let i = LOYALTY_LEVELS.length - 1; i >= 0; i--) {
      if (xp >= LOYALTY_LEVELS[i].minCoins) {
        return LOYALTY_LEVELS[i];
      }
    }
    return LOYALTY_LEVELS[0];
  }

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