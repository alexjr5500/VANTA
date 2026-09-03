import { prisma } from '../prisma';

type EventType =
  | 'page_view' | 'screen_view'
  | 'signup' | 'login' | 'logout'
  | 'post_create' | 'post_delete'
  | 'story_create' | 'story_view'
  | 'video_upload' | 'video_view' | 'video_complete'
  | 'stream_start' | 'stream_end' | 'stream_view'
  | 'like' | 'unlike'
  | 'comment' | 'comment_delete'
  | 'share' | 'save' | 'unsave'
  | 'follow' | 'unfollow'
  | 'message_send'
  | 'gift_send' | 'gift_receive'
  | 'coin_purchase' | 'subscription_start' | 'subscription_cancel'
  | 'withdrawal_request'
  | 'community_join' | 'community_leave' | 'community_create'
  | 'channel_create' | 'channel_join'
  | 'search_query'
  | 'notification_click'
  | 'report_submit'
  | 'referral_click'
  | 'ad_view' | 'ad_click'
  | 'feature_use'
  | 'error_occurred'
  | 'app_install' | 'app_open' | 'app_background' | 'app_close';

interface TrackEventParams {
  eventType: EventType | string;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  platform?: string;
  country?: string;
  city?: string;
  referrer?: string;
  metadata?: Record<string, any>;
  value?: number;
  duration?: number;
  path?: string;
  elementId?: string;
  targetType?: string;
  targetId?: string;
  source?: string;
  campaign?: string;
}

class AnalyticsEventsService {
  /**
   * Track a single event asynchronously (fire-and-forget)
   */
  async track(params: TrackEventParams): Promise<void> {
    try {
      await prisma.analyticsEvent.create({
        data: {
          eventType: params.eventType,
          userId: params.userId,
          sessionId: params.sessionId,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          deviceType: params.deviceType,
          platform: params.platform,
          country: params.country,
          city: params.city,
          referrer: params.referrer,
          metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
          value: params.value,
          duration: params.duration,
          path: params.path,
          elementId: params.elementId,
          targetType: params.targetType,
          targetId: params.targetId,
          source: params.source,
          campaign: params.campaign,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track event:', error);
      // Don't throw - analytics should never break the main app
    }
  }

  /**
   * Track multiple events in a batch
   */
  async trackBatch(events: TrackEventParams[]): Promise<void> {
    try {
      await prisma.analyticsEvent.createMany({
        data: events.map(e => ({
          eventType: e.eventType,
          userId: e.userId,
          sessionId: e.sessionId,
          ipAddress: e.ipAddress,
          userAgent: e.userAgent,
          deviceType: e.deviceType,
          platform: e.platform,
          country: e.country,
          city: e.city,
          referrer: e.referrer,
          metadata: e.metadata ? JSON.stringify(e.metadata) : undefined,
          value: e.value,
          duration: e.duration,
          path: e.path,
          elementId: e.elementId,
          targetType: e.targetType,
          targetId: e.targetId,
          source: e.source,
          campaign: e.campaign,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track batch:', error);
    }
  }

  /**
   * Track a page/screen view
   */
  async trackPageView(params: {
    userId?: string;
    sessionId?: string;
    path: string;
    ipAddress?: string;
    userAgent?: string;
    deviceType?: string;
    platform?: string;
    country?: string;
    referrer?: string;
  }): Promise<void> {
    await this.track({
      eventType: 'page_view',
      ...params,
    });
  }

  /**
   * Start a session
   */
  async startSession(params: {
    userId: string;
    sessionId: string;
    deviceType?: string;
    platform?: string;
    ipAddress?: string;
    country?: string;
    referrer?: string;
  }): Promise<void> {
    try {
      await prisma.analyticsSession.create({
        data: {
          userId: params.userId,
          sessionId: params.sessionId,
          deviceType: params.deviceType,
          platform: params.platform,
          ipAddress: params.ipAddress,
          country: params.country,
          referrer: params.referrer,
          isActive: true,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to start session:', error);
    }
  }

  /**
   * End a session
   */
  async endSession(sessionId: string): Promise<void> {
    try {
      const session = await prisma.analyticsSession.findUnique({
        where: { sessionId },
      });
      if (session) {
        const duration = Math.floor(
          (Date.now() - session.startTime.getTime()) / 1000
        );
        await prisma.analyticsSession.update({
          where: { sessionId },
          data: {
            endTime: new Date(),
            duration,
            isActive: false,
          },
        });
      }
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to end session:', error);
    }
  }

  /**
   * Track retention (call daily for active users)
   */
  async trackRetention(userId: string, signupDate: Date): Promise<void> {
    try {
      const daysSinceSignup = Math.floor(
        (Date.now() - signupDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const retentionDays = [1, 3, 7, 14, 30, 60, 90];
      
      for (const day of retentionDays) {
        if (daysSinceSignup >= day) {
          await prisma.retentionRecord.upsert({
            where: {
              userId_dayX: {
                userId,
                dayX: day,
              },
            },
            update: {
              returned: true,
              activityDate: new Date(),
            },
            create: {
              userId,
              cohortDate: signupDate,
              dayX: day,
              returned: true,
              activityDate: new Date(),
            },
          });
        }
      }
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track retention:', error);
    }
  }

  /**
   * Track feature usage
   */
  async trackFeatureUsage(params: {
    featureName: string;
    userId: string;
    actionType: string;
    duration?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await prisma.featureUsage.create({
        data: {
          featureName: params.featureName,
          userId: params.userId,
          actionType: params.actionType,
          duration: params.duration,
          metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track feature usage:', error);
    }
  }

  /**
   * Track a search query
   */
  async trackSearch(params: {
    query: string;
    userId?: string;
    resultCount: number;
    clicked?: boolean;
    clickTarget?: string;
    clickTargetId?: string;
    clickPosition?: number;
    sessionId?: string;
  }): Promise<void> {
    try {
      await prisma.searchAnalytics.create({
        data: {
          query: params.query.substring(0, 500),
          userId: params.userId,
          resultCount: params.resultCount,
          clicked: params.clicked || false,
          clickTarget: params.clickTarget,
          clickTargetId: params.clickTargetId,
          clickPosition: params.clickPosition,
          zeroResults: params.resultCount === 0,
          sessionId: params.sessionId,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track search:', error);
    }
  }

  /**
   * Track a funnel step
   */
  async trackFunnelStep(params: {
    funnelName: string;
    stepOrder: number;
    userId: string;
    sessionId?: string;
    completed: boolean;
    dropped?: boolean;
    timeSpent?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await prisma.funnelEvent.create({
        data: {
          funnelName: params.funnelName,
          stepOrder: params.stepOrder,
          userId: params.userId,
          sessionId: params.sessionId,
          completed: params.completed,
          dropped: params.dropped || false,
          timeSpent: params.timeSpent,
          metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track funnel step:', error);
    }
  }

  /**
   * Track notification delivery
   */
  async trackNotificationDelivery(params: {
    notificationId: string;
    userId: string;
    channel: string;
    delivered: boolean;
    opened?: boolean;
    clicked?: boolean;
  }): Promise<void> {
    try {
      await prisma.notificationDelivery.create({
        data: {
          notificationId: params.notificationId,
          userId: params.userId,
          channel: params.channel,
          delivered: params.delivered,
          opened: params.opened || false,
          clicked: params.clicked || false,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track notification delivery:', error);
    }
  }

  /**
   * Track marketing attribution
   */
  async trackMarketingAttribution(params: {
    campaignId: string;
    userId: string;
    eventType: string;
    value?: number;
    source: string;
    channel?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceType?: string;
    converted?: boolean;
  }): Promise<void> {
    try {
      await prisma.marketingAttribution.create({
        data: {
          campaignId: params.campaignId,
          userId: params.userId,
          eventType: params.eventType,
          value: params.value,
          source: params.source,
          channel: params.channel,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          deviceType: params.deviceType,
          converted: params.converted || false,
          convertedAt: params.converted ? new Date() : undefined,
        },
      });
    } catch (error) {
      console.error('[AnalyticsEvents] Failed to track attribution:', error);
    }
  }
}

export const analyticsEventsService = new AnalyticsEventsService();
export { AnalyticsEventsService };
export type { EventType, TrackEventParams };