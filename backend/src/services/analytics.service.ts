import { prisma } from '../prisma';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface AnalyticsQuery {
  metricType?: string;
  period?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  creatorId?: string;
  communityId?: string;
  streamId?: string;
  eventType?: string;
  groupBy?: string;
  limit?: number;
  offset?: number;
}

class AnalyticsService {
  // ============================================================
  // USER ANALYTICS
  // ============================================================

  /**
   * Get DAU/WAU/MAU for a date range
   */
  async getUserMetrics(params: {
    metric: 'DAU' | 'WAU' | 'MAU';
    startDate: Date;
    endDate: Date;
  }) {
    const periodMap = { DAU: 'DAILY', WAU: 'WEEKLY', MAU: 'MONTHLY' } as const;
    const period = periodMap[params.metric];

    if (period === 'DAILY') {
      // Get daily active users from events
      return prisma.analyticsAggregation.findMany({
        where: {
          metricType: 'dau',
          period: 'DAILY',
          date: { gte: params.startDate, lte: params.endDate },
        },
        orderBy: { date: 'asc' },
        select: { date: true, value: true, previousValue: true, changePercent: true },
      });
    }

    return prisma.analyticsAggregation.findMany({
      where: {
        metricType: params.metric.toLowerCase(),
        period,
        date: { gte: params.startDate, lte: params.endDate },
      },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Get current DAU count by counting unique users in events today
   */
  async getCurrentDAU(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const result = await prisma.analyticsEvent.findMany({
      where: {
        createdAt: { gte: today },
        userId: { not: null },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    
    return result.length;
  }

  /**
   * Get current online users count
   */
  async getOnlineUsers(): Promise<number> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const result = await prisma.userPresence.count({
      where: {
        isOnline: true,
        lastActive: { gte: fiveMinutesAgo },
      },
    });
    
    return result;
  }

  /**
   * Get new registrations for a date range
   */
  async getNewRegistrations(startDate: Date, endDate: Date): Promise<number> {
    return prisma.user.count({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
    });
  }

  /**
   * Get user retention rates
   */
  async getRetentionRates(params: {
    cohortDate?: Date;
    days?: number[];
  }) {
    const days = params.days || [1, 3, 7, 14, 30];
    const results: { day: number; rate: number; total: number; returned: number }[] = [];

    for (const day of days) {
      const total = await prisma.retentionRecord.count({
        where: {
          dayX: day,
          ...(params.cohortDate ? { cohortDate: params.cohortDate } : {}),
        },
      });

      const returned = await prisma.retentionRecord.count({
        where: {
          dayX: day,
          returned: true,
          ...(params.cohortDate ? { cohortDate: params.cohortDate } : {}),
        },
      });

      results.push({
        day,
        rate: total > 0 ? (returned / total) * 100 : 0,
        total,
        returned,
      });
    }

    return results;
  }

  /**
   * Get user churn rate
   */
  async getChurnRate(period: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Promise<number> {
    const aggregation = await prisma.analyticsAggregation.findFirst({
      where: {
        metricType: 'churn',
        period,
      },
      orderBy: { date: 'desc' },
    });
    
    return aggregation?.value || 0;
  }

  /**
   * Get user growth data
   */
  async getUserGrowth(params: {
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    startDate: Date;
    endDate: Date;
  }) {
    return prisma.analyticsAggregation.findMany({
      where: {
        metricType: 'new_users',
        period: params.period,
        date: { gte: params.startDate, lte: params.endDate },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ============================================================
  // CONTENT ANALYTICS
  // ============================================================

  /**
   * Get content performance metrics
   */
  async getContentMetrics(params: {
    contentType?: 'post' | 'video' | 'story' | 'stream';
    startDate: Date;
    endDate: Date;
    limit?: number;
  }) {
    const where = {
      eventType: params.contentType
        ? `${params.contentType}_view` as any
        : undefined,
      createdAt: { gte: params.startDate, lte: params.endDate },
    } as any;

    if (params.contentType) {
      where.eventType = `${params.contentType}_view`;
    }

    const views = await prisma.analyticsEvent.count({ where });

    const likes = await prisma.analyticsEvent.count({
      where: {
        eventType: 'like',
        targetType: params.contentType,
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    const comments = await prisma.analyticsEvent.count({
      where: {
        eventType: 'comment',
        targetType: params.contentType,
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    const shares = await prisma.analyticsEvent.count({
      where: {
        eventType: 'share',
        targetType: params.contentType,
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    return { views, likes, comments, shares };
  }

  /**
   * Get top content by performance
   */
  async getTopContent(params: {
    contentType: string;
    metric: 'views' | 'likes' | 'shares' | 'engagement';
    limit?: number;
    startDate?: Date;
    endDate?: Date;
  }) {
    const limit = params.limit || 20;
    const where: any = {
      eventType: params.metric === 'views' ? `${params.contentType}_view` : params.metric,
      targetType: params.contentType,
    };

    if (params.startDate) where.createdAt = { gte: params.startDate };
    if (params.endDate) where.createdAt = { ...where.createdAt, lte: params.endDate };

    // Get top target IDs by event count
    const results = await prisma.analyticsEvent.groupBy({
      by: ['targetId'],
      where: {
        ...where,
        targetId: { not: null },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return results.map(r => ({
      targetId: r.targetId,
      count: r._count.id,
    }));
  }

  // ============================================================
  // REVENUE ANALYTICS
  // ============================================================

  /**
   * Get revenue analytics
   */
  async getRevenueAnalytics(params: {
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    startDate: Date;
    endDate: Date;
  }) {
    // Coin purchases
    const purchases = await prisma.purchaseOrder.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
      select: { amount: true, createdAt: true, coins: true },
    });

    // Subscription revenue
    const subscriptions = await prisma.creatorSubscription.findMany({
      where: {
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
      select: { price: true, createdAt: true },
    });

    // Gift revenue
    const gifts = await prisma.giftTransaction.findMany({
      where: {
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
      select: { amount: true, createdAt: true },
    });

    const totalPurchaseRevenue = purchases.reduce((sum, p) => sum + p.amount, 0);
    const totalSubscriptionRevenue = subscriptions.reduce((sum, s) => sum + s.price, 0) / 100;
    const totalGiftRevenue = gifts.reduce((sum, g) => sum + g.amount, 0);

    // Aggregations for chart data
    const revenueByDate = await prisma.analyticsAggregation.findMany({
      where: {
        metricType: 'revenue',
        period: params.period,
        date: { gte: params.startDate, lte: params.endDate },
      },
      orderBy: { date: 'asc' },
    });

    return {
      totalRevenue: totalPurchaseRevenue + totalSubscriptionRevenue + totalGiftRevenue,
      purchaseRevenue: totalPurchaseRevenue,
      subscriptionRevenue: totalSubscriptionRevenue,
      giftRevenue: totalGiftRevenue,
      totalPurchases: purchases.length,
      totalGifts: gifts.length,
      totalSubscriptions: subscriptions.length,
      revenueByDate,
      dailyAverage: purchases.length > 0 ? totalPurchaseRevenue / purchases.length : 0,
    };
  }

  /**
   * Get ARPU
   */
  async getARPU(period: 'DAILY' | 'WEEKLY' | 'MONTHLY') {
    return prisma.aRPUAnalytics.findMany({
      where: { period },
      orderBy: { date: 'desc' },
      take: 30,
    });
  }

  /**
   * Get ad revenue
   */
  async getAdRevenue(startDate: Date, endDate: Date) {
    return prisma.adRevenue.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ============================================================
  // CREATOR ANALYTICS
  // ============================================================

  /**
   * Get creator analytics
   */
  async getCreatorAnalytics(creatorId: string, startDate: Date, endDate: Date) {
    const daily = await prisma.creatorDailyAnalytics.findMany({
      where: {
        creatorId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });

    const totals = {
      totalProfileViews: daily.reduce((sum, d) => sum + d.profileViews, 0),
      totalFollowersGained: daily.reduce((sum, d) => sum + d.followersGained, 0),
      totalFollowersLost: daily.reduce((sum, d) => sum + d.followersLost, 0),
      totalWatchTime: daily.reduce((sum, d) => sum + d.totalWatchTime, 0),
      totalStreamDuration: daily.reduce((sum, d) => sum + d.streamDuration, 0),
      totalEarnings: daily.reduce((sum, d) => sum + d.totalEarnings, 0),
      giftRevenue: daily.reduce((sum, d) => sum + d.giftRevenue, 0),
      subscriptionRevenue: daily.reduce((sum, d) => sum + d.subscriptionRevenue, 0),
      totalStreams: daily.reduce((sum, d) => sum + d.liveStreamCount, 0),
      totalVideos: daily.reduce((sum, d) => sum + d.videoUploadCount, 0),
      totalPosts: daily.reduce((sum, d) => sum + d.postCount, 0),
      totalStories: daily.reduce((sum, d) => sum + d.storyCount, 0),
    };

    // Follower count
    const followerCount = await prisma.follow.count({
      where: { followingId: creatorId },
    });

    // Average engagement
    const avgEngagement = daily.length > 0
      ? daily.reduce((sum, d) => sum + d.reactions + d.comments + d.shares, 0) / daily.length
      : 0;

    return {
      daily,
      totals,
      followerCount,
      avgDailyEngagement: avgEngagement,
    };
  }

  /**
   * Get creator leaderboard
   */
  async getCreatorLeaderboard(params: {
    metric: 'earnings' | 'followers' | 'views' | 'streams';
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';
    limit?: number;
  }) {
    const limit = params.limit || 20;
    const metricMap: Record<string, string> = {
      earnings: 'totalEarnings',
      followers: 'newFollowers',
      views: 'profileViews',
      streams: 'liveStreamCount',
    };

    const orderField = metricMap[params.metric] || 'totalEarnings';

    return prisma.creatorDailyAnalytics.groupBy({
      by: ['creatorId'],
      _sum: { [orderField]: true },
      orderBy: { _sum: { [orderField]: 'desc' } },
      take: limit,
    });
  }

  // ============================================================
  // LIVE STREAM ANALYTICS
  // ============================================================

  /**
   * Get live stream analytics
   */
  async getStreamAnalytics(streamId: string) {
    return prisma.liveStreamAnalytics.findUnique({
      where: { streamId },
    });
  }

  /**
   * Get active streams with real-time stats
   */
  async getActiveStreamsAnalytics() {
    return prisma.liveStream.findMany({
      where: { active: true },
      include: {
        _count: { select: { viewers: true, chatMessages: true, giftEvents: true } },
        host: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { viewerCount: 'desc' },
      take: 100,
    });
  }

  /**
   * Get stream performance over time
   */
  async getStreamPerformance(hostId: string, startDate: Date, endDate: Date) {
    return prisma.liveStreamAnalytics.findMany({
      where: {
        hostId,
        startedAt: { gte: startDate, lte: endDate },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  // ============================================================
  // COMMUNITY ANALYTICS
  // ============================================================

  /**
   * Get community analytics
   */
  async getCommunityAnalytics(communityId: string) {
    return prisma.communityAnalytics.findUnique({
      where: { communityId },
    });
  }

  /**
   * Get communities ranked by health
   */
  async getCommunityHealthRanking(limit: number = 50) {
    return prisma.communityAnalytics.findMany({
      orderBy: { healthScore: 'asc' },
      take: limit,
    });
  }

  // ============================================================
  // SEARCH ANALYTICS
  // ============================================================

  /**
   * Get search analytics
   */
  async getSearchAnalytics(params: {
    startDate: Date;
    endDate: Date;
    limit?: number;
  }) {
    const totalSearches = await prisma.searchAnalytics.count({
      where: {
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    const zeroResultSearches = await prisma.searchAnalytics.count({
      where: {
        zeroResults: true,
        createdAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    // Top search queries
    const topQueries: any[] = await prisma.$queryRaw`
      SELECT query, COUNT(*) as count
      FROM SearchAnalytics
      WHERE createdAt >= ${params.startDate} AND createdAt <= ${params.endDate}
      GROUP BY query
      ORDER BY count DESC
      LIMIT ${params.limit || 20}
    `;

    return {
      totalSearches,
      zeroResultSearches,
      zeroResultRate: totalSearches > 0 ? (zeroResultSearches / totalSearches) * 100 : 0,
      topQueries: await this.getTopSearches(params.startDate, params.endDate, params.limit),
    };
  }

  private async getTopSearches(startDate: Date, endDate: Date, limit: number = 20) {
    try {
      const results = await prisma.searchAnalytics.groupBy({
        by: ['query'],
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit,
      });
      return results.map(r => ({ query: r.query, count: r._count.id }));
    } catch {
      return [];
    }
  }

  // ============================================================
  // TRENDING ANALYTICS
  // ============================================================

  /**
   * Get trending topics
   */
  async getTrendingTopics(type?: string, limit: number = 20) {
    const where: any = {};
    if (type) where.type = type;

    return prisma.trendingTopic.findMany({
      where,
      orderBy: { score: 'desc' },
      take: limit,
    });
  }

  // ============================================================
  // NOTIFICATION ANALYTICS
  // ============================================================

  /**
   * Get notification analytics
   */
  async getNotificationAnalytics(params: {
    startDate: Date;
    endDate: Date;
  }) {
    const totalSent = await prisma.notificationDelivery.count({
      where: {
        sentAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    const totalDelivered = await prisma.notificationDelivery.count({
      where: {
        delivered: true,
        sentAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    const totalOpened = await prisma.notificationDelivery.count({
      where: {
        opened: true,
        sentAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    const totalClicked = await prisma.notificationDelivery.count({
      where: {
        clicked: true,
        sentAt: { gte: params.startDate, lte: params.endDate },
      },
    });

    return {
      totalSent,
      totalDelivered,
      deliveryRate: totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0,
      totalOpened,
      openRate: totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0,
      totalClicked,
      clickRate: totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0,
    };
  }

  // ============================================================
  // AI ANALYTICS
  // ============================================================

  /**
   * Get AI performance metrics
   */
  async getAIAnalytics() {
    const models = await prisma.aIModel.findMany({
      where: { status: 'DEPLOYED' },
      select: {
        name: true,
        version: true,
        modelType: true,
        metrics: true,
        deployedAt: true,
      },
    });

    const moderationStats = {
      total: await prisma.moderationQueue.count(),
      pending: await prisma.moderationQueue.count({ where: { status: 'PENDING' } }),
      approved: await prisma.moderationQueue.count({ where: { status: 'APPROVED' } }),
      rejected: await prisma.moderationQueue.count({ where: { status: 'REJECTED' } }),
      flagged: await prisma.moderationQueue.count({ where: { status: 'FLAGGED' } }),
    };

    const aiSessions = await prisma.aISession.groupBy({
      by: ['featureType'],
      _count: { id: true },
    });

    return {
      models,
      moderationStats,
      aiSessions: aiSessions.map(s => ({
        featureType: s.featureType,
        count: s._count.id,
      })),
    };
  }

  // ============================================================
  // DASHBOARD SNAPSHOTS
  // ============================================================

  /**
   * Get dashboard snapshot or generate one
   */
  async getDashboardSnapshot(params: {
    dashboardType: string;
    period: string;
    date: Date;
  }) {
    let snapshot = await prisma.dashboardSnapshot.findUnique({
      where: {
        dashboardType_period_date: {
          dashboardType: params.dashboardType,
          period: params.period,
          date: params.date,
        },
      },
    });

    if (!snapshot) {
      // Auto-generate if not exists
      const data = await this.generateDashboardData(params.dashboardType, params.period);
      snapshot = await prisma.dashboardSnapshot.create({
        data: {
          dashboardType: params.dashboardType,
          period: params.period,
          date: params.date,
          data: JSON.stringify(data),
          expiresAt: new Date(Date.now() + 3600000), // 1 hour
        },
      });
    }

    return {
      ...snapshot,
      data: snapshot.data ? JSON.parse(snapshot.data) : null,
    };
  }

  private async generateDashboardData(dashboardType: string, period: string) {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'DAILY':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'WEEKLY':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'MONTHLY':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'QUARTERLY':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'YEARLY':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    switch (dashboardType) {
      case 'EXECUTIVE':
        return {
          dau: await this.getCurrentDAU(),
          mau: (await this.getUserMetrics({ metric: 'MAU', startDate, endDate })).reduce((sum, a) => sum + a.value, 0),
          newUsers: await this.getNewRegistrations(startDate, endDate),
          onlineUsers: await this.getOnlineUsers(),
          revenue: await this.getRevenueAnalytics({ period: period as any, startDate, endDate }),
          churn: await this.getChurnRate(period as any),
        };
      case 'REVENUE':
        return this.getRevenueAnalytics({ period: period as any, startDate, endDate });
      case 'USER_GROWTH':
        return {
          dau: await this.getUserMetrics({ metric: 'DAU', startDate, endDate }),
          wau: await this.getUserMetrics({ metric: 'WAU', startDate, endDate }),
          mau: await this.getUserMetrics({ metric: 'MAU', startDate, endDate }),
          retention: await this.getRetentionRates({}),
          newUsers: await this.getNewRegistrations(startDate, endDate),
        };
      default:
        return {};
    }
  }

  // ============================================================
  // OVERVIEW / SUMMARY
  // ============================================================

  /**
   * Get platform overview (for admin dashboard)
   */
  async getPlatformOverview() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      dau,
      onlineUsers,
      activeStreams,
      newUsersToday,
      revenueToday,
      revenueThisMonth,
      totalPosts,
      totalVideos,
      totalStreams,
      totalMessages,
      totalGifts,
    ] = await Promise.all([
      prisma.user.count(),
      this.getCurrentDAU(),
      this.getOnlineUsers(),
      prisma.liveStream.count({ where: { active: true } }),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.purchaseOrder.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: thisMonthStart } },
        _sum: { amount: true },
      }),
      prisma.post.count(),
      prisma.video.count(),
      prisma.liveStream.count(),
      prisma.message.count(),
      prisma.giftTransaction.count(),
    ]);

    return {
      totalUsers,
      dailyActiveUsers: dau,
      onlineUsers,
      activeStreams,
      newUsersToday,
      revenueToday: revenueToday._sum.amount || 0,
      revenueThisMonth: revenueThisMonth._sum.amount || 0,
      totalPosts,
      totalVideos,
      totalStreams,
      totalMessages,
      totalGifts,
    };
  }
}

export const analyticsService = new AnalyticsService();
export { AnalyticsService };