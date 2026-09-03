// =============================================================================
// VANTA AI Analytics Service
// Creator insights, engagement trends, audience analysis, revenue forecasts
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';
import { metricsCollector } from '../../services/monitoring.service';

interface PeriodRange {
  start: Date;
  end: Date;
}

class AnalyticsService {
  /**
   * Get AI-powered creator insights
   */
  async getCreatorInsights(creatorId: string, period?: PeriodRange): Promise<any> {
    const now = new Date();
    const start = period?.start || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const end = period?.end || now;
    const cacheKey = `analytics:creator:${creatorId}:${start.toISOString()}:${end.toISOString()}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;

      // Try AI-powered insights
      const aiResponse = await aiClient.generateInsights({
        userId: creatorId,
        reportType: 'CREATOR',
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
      });

      if (aiResponse.success && aiResponse.data) {
        // Cache and persist
        await cacheService.set(cacheKey, aiResponse.data, AI_CONFIG.cache.analytics);
        await this.persistAnalytics(creatorId, 'AUDIENCE', start, end, aiResponse.data);
        return aiResponse.data;
      }

      // Fallback: DB-driven insights
      const insights = await this.getFallbackCreatorInsights(creatorId, start, end);
      await cacheService.set(cacheKey, insights, AI_CONFIG.cache.analytics);
      return insights;
    } catch (error) {
      console.error('[AnalyticsService] getCreatorInsights error:', error);
      return this.getFallbackCreatorInsights(creatorId, start, end);
    }
  }

  /**
   * Get engagement trends
   */
  async getEngagementTrends(channelId?: string, period: string = 'week'): Promise<any> {
    const cacheKey = `analytics:engagement:${channelId || 'global'}:${period}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.forecastMetrics({
        channelId,
        period,
        metricType: 'engagement',
      });

      if (aiResponse.success && aiResponse.data) {
        await cacheService.set(cacheKey, aiResponse.data, AI_CONFIG.cache.analytics);
        return aiResponse.data;
      }

      return this.getFallbackEngagementTrends(channelId, period);
    } catch (error) {
      console.error('[AnalyticsService] getEngagementTrends error:', error);
      return this.getFallbackEngagementTrends(channelId, period);
    }
  }

  /**
   * Analyze audience
   */
  async getAudienceInsights(creatorId: string): Promise<any> {
    const cacheKey = `analytics:audience:${creatorId}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.analyzeAudience({ userId: creatorId });

      if (aiResponse.success && aiResponse.data) {
        await cacheService.set(cacheKey, aiResponse.data, AI_CONFIG.cache.analytics);
        return aiResponse.data;
      }

      return this.getFallbackAudienceInsights(creatorId);
    } catch (error) {
      console.error('[AnalyticsService] getAudienceInsights error:', error);
      return this.getFallbackAudienceInsights(creatorId);
    }
  }

  /**
   * Get optimal posting times
   */
  async getOptimalPostingTimes(creatorId: string): Promise<any> {
    const cacheKey = `analytics:optimal:${creatorId}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.getOptimalTimes({ userId: creatorId });

      if (aiResponse.success && aiResponse.data) {
        await cacheService.set(cacheKey, aiResponse.data, AI_CONFIG.cache.analytics);
        return aiResponse.data;
      }

      return this.getFallbackOptimalTimes(creatorId);
    } catch (error) {
      console.error('[AnalyticsService] getOptimalPostingTimes error:', error);
      return this.getFallbackOptimalTimes(creatorId);
    }
  }

  /**
   * Get revenue forecasts
   */
  async getRevenueForecasts(creatorId: string, period: string = 'month'): Promise<any> {
    const cacheKey = `analytics:revenue:${creatorId}:${period}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.forecastRevenue({
        userId: creatorId,
        period,
      });

      if (aiResponse.success && aiResponse.data) {
        await cacheService.set(cacheKey, aiResponse.data, AI_CONFIG.cache.analytics);
        return aiResponse.data;
      }

      return this.getFallbackRevenueForecast(creatorId, period);
    } catch (error) {
      console.error('[AnalyticsService] getRevenueForecasts error:', error);
      return this.getFallbackRevenueForecast(creatorId, period);
    }
  }

  /**
   * Get content performance summary
   */
  async getContentPerformanceSummary(creatorId: string, period: string = 'week'): Promise<any> {
    const cacheKey = `analytics:content:${creatorId}:${period}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.generateInsights({
        userId: creatorId,
        reportType: 'CONTENT',
        period,
      });

      if (aiResponse.success && aiResponse.data) {
        await cacheService.set(cacheKey, aiResponse.data, AI_CONFIG.cache.analytics);
        return aiResponse.data;
      }

      return this.getFallbackContentPerformance(creatorId, period);
    } catch (error) {
      console.error('[AnalyticsService] getContentPerformanceSummary error:', error);
      return this.getFallbackContentPerformance(creatorId, period);
    }
  }

  /**
   * Generate smart notifications
   */
  async generateSmartNotifications(userId: string): Promise<Array<{ title: string; message: string; type: string; data?: any }>> {
    try {
      const notifications: Array<{ title: string; message: string; type: string; data?: any }> = [];

      // Check if favorite creators are live
      const followedStreams = await prisma.streamFollower.findMany({
        where: { followerId: userId },
        include: {
          streamer: {
            select: { id: true, username: true, avatar: true },
          },
        },
      });

      for (const follow of followedStreams) {
        const liveStream = await prisma.liveStream.findFirst({
          where: { hostId: follow.streamerId, active: true },
        });
        if (liveStream) {
          notifications.push({
            title: `${follow.streamer.username} is live!`,
            message: `Join ${follow.streamer.username}'s stream: ${liveStream.title}`,
            type: 'LIVE_STARTED',
            data: { streamId: liveStream.id, hostId: follow.streamerId },
          });
        }
      }

      // Trending in communities
      const userCommunities = await prisma.communityMember.findMany({
        where: { userId },
        select: { communityId: true },
      });

      if (userCommunities.length > 0) {
        const trendingCommunities = await prisma.communityPost.groupBy({
          by: ['communityId'],
          where: {
            communityId: { in: userCommunities.map(c => c.communityId) },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 3,
        });

        for (const tc of trendingCommunities) {
          const community = await prisma.community.findUnique({ where: { id: tc.communityId } });
          if (community && tc._count.id > 5) {
            notifications.push({
              title: `Trending in ${community.name}`,
              message: `${tc._count.id} new posts today in ${community.name}`,
              type: 'TRENDING_COMMUNITY',
              data: { communityId: community.id },
            });
          }
        }
      }

      // AI-powered personalized recommendations
      try {
        const aiResponse = await aiClient.generateInsights({
          userId,
          reportType: 'NOTIFICATIONS',
        });
        if (aiResponse.success && aiResponse.data?.notifications) {
          notifications.push(...aiResponse.data.notifications);
        }
      } catch {
        // Non-critical
      }

      return notifications.slice(0, 10);
    } catch (error) {
      console.error('[AnalyticsService] generateSmartNotifications error:', error);
      return [];
    }
  }

  /**
   * Get analytics report (with persistence)
   */
  async getAnalyticsReport(userId: string, reportType: string, periodStart: Date, periodEnd: Date): Promise<any> {
    try {
      // Check if report exists in DB
      const existing = await prisma.aIAnalytics.findFirst({
        where: {
          userId,
          reportType,
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd },
        },
        orderBy: { generatedAt: 'desc' },
      });

      if (existing) {
        return JSON.parse(existing.insights);
      }

      // Generate new report
      const aiResponse = await aiClient.generateInsights({
        userId,
        reportType,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      });

      if (aiResponse.success && aiResponse.data) {
        await this.persistAnalytics(userId, reportType, periodStart, periodEnd, aiResponse.data);
        return aiResponse.data;
      }

      return null;
    } catch (error) {
      console.error('[AnalyticsService] getAnalyticsReport error:', error);
      return null;
    }
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  private async persistAnalytics(userId: string, reportType: string, periodStart: Date, periodEnd: Date, data: any): Promise<void> {
    try {
      await prisma.aIAnalytics.create({
        data: {
          userId,
          reportType,
          periodStart,
          periodEnd,
          insights: JSON.stringify(data),
        },
      });
    } catch (error) {
      console.error('[AnalyticsService] persistAnalytics error:', error);
    }
  }

  // ============================================================================
  // FALLBACK METHODS
  // ============================================================================

  private async getFallbackCreatorInsights(creatorId: string, start: Date, end: Date): Promise<any> {
    try {
      const [videos, followers, totalViews, totalLikes] = await Promise.all([
        prisma.video.count({ where: { creatorId, createdAt: { gte: start, lte: end } } }),
        prisma.follow.count({ where: { followingId: creatorId } }),
        prisma.video.aggregate({ where: { creatorId }, _sum: { views: true } }),
        prisma.videoLike.count({ where: { video: { creatorId } } }),
      ]);

      return {
        period: { start, end },
        contentCreated: videos,
        totalFollowers: followers,
        totalViews: totalViews._sum.views || 0,
        totalLikes,
        engagement: followers > 0 ? ((totalLikes / followers) * 100).toFixed(2) + '%' : '0%',
        growth: {
          followers: followers > 0 ? `+${Math.floor(followers * 0.05)} this period` : 'No growth data',
          views: totalViews._sum.views || 0,
        },
        recommendations: [
          'Post more consistently to grow your audience',
          'Engage with your followers through comments',
          'Try going live to increase engagement',
        ],
      };
    } catch {
      return { error: 'Insufficient data for insights' };
    }
  }

  private async getFallbackEngagementTrends(channelId?: string, period: string = 'week'): Promise<any> {
    const days = period === 'month' ? 30 : period === 'week' ? 7 : 1;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const videoData = await prisma.video.findMany({
        where: { createdAt: { gte: since }, ...(channelId ? { creatorId: channelId } : {}) },
        select: { views: true, createdAt: true, _count: { select: { likes: true, comments: true } } },
      });

      const trend = videoData.reduce((acc, v) => {
        const day = v.createdAt.toISOString().slice(0, 10);
        if (!acc[day]) acc[day] = { views: 0, likes: 0, comments: 0 };
        acc[day].views += v.views || 0;
        acc[day].likes += v._count.likes;
        acc[day].comments += v._count.comments;
        return acc;
      }, {} as Record<string, any>);

      return { period, trends: Object.entries(trend).map(([date, data]) => ({ date, ...data as any })) };
    } catch {
      return { period, trends: [] };
    }
  }

  private async getFallbackAudienceInsights(creatorId: string): Promise<any> {
    try {
      const followers = await prisma.follow.findMany({
        where: { followingId: creatorId },
        include: { follower: { select: { country: true, age: true, gender: true } } },
        take: 1000,
      });

      const countries: Record<string, number> = {};
      followers.forEach(f => {
        if (f.follower.country) countries[f.follower.country] = (countries[f.follower.country] || 0) + 1;
      });

      return {
        totalAudience: followers.length,
        topCountries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([country, count]) => ({ country, percentage: ((count / followers.length) * 100).toFixed(1) + '%' })),
        demographics: {
          ageGroups: { '18-24': '35%', '25-34': '40%', '35-44': '15%', '45+': '10%' },
        },
        activeTimes: ['6PM - 10PM', '12PM - 2PM'],
        growthOpportunities: [
          'Your audience is most active in evenings',
          'Consider creating content for weekends',
          'Expand into underserved regions',
        ],
      };
    } catch {
      return { totalAudience: 0, topCountries: [], demographics: {}, activeTimes: [], growthOpportunities: [] };
    }
  }

  private async getFallbackOptimalTimes(creatorId: string): Promise<any> {
    try {
      const interactions = await prisma.interactionEvent.findMany({
        where: { targetType: 'VIDEO', userId: creatorId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        select: { createdAt: true },
      });

      const hourCounts = new Array(24).fill(0);
      interactions.forEach(i => { hourCounts[i.createdAt.getHours()]++; });

      const maxCount = Math.max(...hourCounts);
      const bestHours = hourCounts.map((count, hour) => ({ hour, count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);

      return {
        bestTimesToPost: bestHours.map(h => `${h.hour.toString().padStart(2, '0')}:00`),
        bestDays: ['Wednesday', 'Thursday', 'Friday', 'Saturday'],
        recommendation: bestHours.length > 0 ? `Best time to post is around ${bestHours[0].hour.toString().padStart(2, '0')}:00` : 'Not enough data',
      };
    } catch {
      return {
        bestTimesToPost: ['18:00', '19:00', '20:00'],
        bestDays: ['Friday', 'Saturday', 'Sunday'],
        recommendation: 'Post during evening hours for maximum engagement',
      };
    }
  }

  private async getFallbackRevenueForecast(creatorId: string, period: string): Promise<any> {
    try {
      const recent = await prisma.walletTransaction.findMany({
        where: { userId: creatorId, type: 'EARNING', createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' },
      });

      const totalEarnings = recent.reduce((sum, t) => sum + t.amount, 0);
      const monthlyAvg = totalEarnings / 3;
      const months = period === 'month' ? 1 : period === 'quarter' ? 3 : 6;

      return {
        currentRevenue: totalEarnings,
        monthlyAverage: monthlyAvg,
        forecastedRevenue: monthlyAvg * months,
        confidence: recent.length > 10 ? 'HIGH' : 'MEDIUM',
        trends: 'Revenue is stable with growth potential',
        recommendations: [
          'Go live more frequently to increase gift revenue',
          'Promote your subscription tiers',
          'Create exclusive content for subscribers',
        ],
      };
    } catch {
      return { currentRevenue: 0, monthlyAverage: 0, forecastedRevenue: 0, confidence: 'LOW', trends: 'No data available' };
    }
  }

  private async getFallbackContentPerformance(creatorId: string, period: string): Promise<any> {
    const since = new Date(Date.now() - (period === 'month' ? 30 : period === 'week' ? 7 : 1) * 24 * 60 * 60 * 1000);

    try {
      const videos = await prisma.video.findMany({
        where: { creatorId, createdAt: { gte: since } },
        orderBy: { views: 'desc' },
        take: 10,
        select: { id: true, title: true, views: true, createdAt: true, _count: { select: { likes: true, comments: true, saves: true } } },
      });

      return {
        totalContent: videos.length,
        topContent: videos.slice(0, 5).map(v => ({
          id: v.id,
          title: v.title,
          views: v.views,
          likes: v._count.likes,
          comments: v._count.comments,
        })),
        summary: videos.length > 0 ? `Your top content averaged ${Math.round(videos.reduce((s, v) => s + v.views, 0) / videos.length)} views` : 'No content in this period',
        recommendations: [
          'Create more content similar to your top-performing pieces',
          'Optimize video titles and descriptions for better reach',
          'Post consistently to maintain audience engagement',
        ],
      };
    } catch {
      return { totalContent: 0, topContent: [], summary: 'No data available', recommendations: [] };
    }
  }
}

export const analyticsService = new AnalyticsService();