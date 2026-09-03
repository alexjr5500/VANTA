// ============================================================================
// VANTA Analytics Engine - Core Service
// Handles event ingestion, metric computation, time-series storage,
// real-time analytics, predictive analytics, and reporting
// ============================================================================

import { prisma } from '../prisma';
import { EventEmitter } from 'events';
import {
  AnalyticsEvent, AnalyticsQuery, AnalyticsMetric, AnalyticsPeriod,
  TimeSeriesPoint, PredictiveForecast, FunnelStep, CohortAnalysis,
  UserJourney, AlertConfig, AnalyticsReport, ReportConfig,
  METRIC_DEFINITIONS, AnalyticsCategory
} from './analytics.types';

// In-memory event buffer for batch processing
const EVENT_BUFFER: AnalyticsEvent[] = [];
const BATCH_SIZE = 100;
const BATCH_INTERVAL = 5000; // 5 seconds

// Real-time metric state (in-memory for speed)
class RealtimeMetricsStore {
  private store = new Map<string, { value: number; timestamp: number; metadata?: Record<string, any> }>();
  private history = new Map<string, { timestamp: number; value: number }[]>();
  private readonly MAX_HISTORY = 1000;

  set(key: string, value: number, metadata?: Record<string, any>): void {
    const now = Date.now();
    this.store.set(key, { value, timestamp: now, metadata });
    
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    const hist = this.history.get(key)!;
    hist.push({ timestamp: now, value });
    if (hist.length > this.MAX_HISTORY) {
      hist.splice(0, hist.length - this.MAX_HISTORY);
    }
  }

  get(key: string): { value: number; timestamp: number; metadata?: Record<string, any> } | undefined {
    return this.store.get(key);
  }

  increment(key: string, amount: number = 1): number {
    const current = this.store.get(key)?.value || 0;
    const newValue = current + amount;
    this.set(key, newValue);
    return newValue;
  }

  getAll(): Record<string, { value: number; timestamp: number }> {
    const result: Record<string, any> = {};
    for (const [key, val] of this.store) {
      result[key] = { value: val.value, timestamp: val.timestamp };
    }
    return result;
  }

  getHistory(key: string, limit: number = 100): { timestamp: number; value: number }[] {
    const hist = this.history.get(key);
    if (!hist) return [];
    return hist.slice(-limit);
  }
}

// Singleton instances
const realtimeMetrics = new RealtimeMetricsStore();
const analyticsEventBus = new EventEmitter();
analyticsEventBus.setMaxListeners(100);

// Cache for computed metrics
const metricsCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 60_000; // 1 minute default

function getCachedOrCompute<T>(key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  const cached = metricsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data as T);
  }
  return compute().then(data => {
    metricsCache.set(key, { data, expiresAt: Date.now() + ttl });
    return data;
  });
}

function clearCache(pattern?: string): void {
  if (pattern) {
    for (const key of metricsCache.keys()) {
      if (key.includes(pattern)) metricsCache.delete(key);
    }
  } else {
    metricsCache.clear();
  }
}

// ============================================================================
// EVENT TRACKING & INGESTION
// ============================================================================

export class AnalyticsEngine {
  private batchTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    
    // Start batch processing
    this.batchTimer = setInterval(() => this.flushEvents(), BATCH_INTERVAL);
    
    console.log('[AnalyticsEngine] Initialized - event tracking enabled');
  }

  // Track a single analytics event
  async track(event: AnalyticsEvent): Promise<void> {
    // Add to buffer for batch processing
    EVENT_BUFFER.push({
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    });

    // Update real-time metrics
    this.updateRealtimeMetrics(event);

    // Emit for real-time subscribers
    analyticsEventBus.emit('event', event);

    // Flush if buffer is full
    if (EVENT_BUFFER.length >= BATCH_SIZE) {
      await this.flushEvents();
    }
  }

  // Track multiple events at once
  async trackBatch(events: AnalyticsEvent[]): Promise<void> {
    for (const event of events) {
      EVENT_BUFFER.push({
        ...event,
        timestamp: event.timestamp || new Date().toISOString(),
      });
      this.updateRealtimeMetrics(event);
      analyticsEventBus.emit('event', event);
    }

    if (EVENT_BUFFER.length >= BATCH_SIZE) {
      await this.flushEvents();
    }
  }

  // Flush buffered events to database
  private async flushEvents(): Promise<void> {
    const events = EVENT_BUFFER.splice(0, EVENT_BUFFER.length);
    if (events.length === 0) return;

    try {
      // Store events in AnalyticsEvent table
      await prisma.analyticsEvent.createMany({
        data: events.map(e => ({
          eventType: e.eventType,
          userId: e.userId || null,
          sessionId: e.sessionId || null,
          targetType: e.targetType || null,
          targetId: e.targetId || null,
          metadata: e.metadata ? JSON.stringify(e.metadata) : null,
          value: e.value || null,
          ipAddress: e.ipAddress || null,
          userAgent: e.userAgent || null,
          deviceInfo: e.deviceInfo || null,
          source: e.source || null,
          timestamp: new Date(e.timestamp as string),
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      console.error('[AnalyticsEngine] Error flushing events:', error);
    }
  }

  // Update in-memory realtime metrics
  private updateRealtimeMetrics(event: AnalyticsEvent): void {
    const now = Date.now();

    switch (event.eventType) {
      case 'user.active':
        realtimeMetrics.set('realtime:active_users', event.value || 1);
        realtimeMetrics.increment(`realtime:daily:${new Date().toISOString().slice(0, 10)}:active_users`);
        break;
      case 'user.register':
        realtimeMetrics.increment('realtime:new_registrations_today');
        break;
      case 'user.login':
        realtimeMetrics.set('realtime:active_users', realtimeMetrics.get('realtime:active_users')?.value || 0 + 1);
        break;
      case 'stream.start':
        realtimeMetrics.increment('realtime:active_streams');
        break;
      case 'stream.end':
        const current = realtimeMetrics.get('realtime:active_streams')?.value || 0;
        realtimeMetrics.set('realtime:active_streams', Math.max(0, current - 1));
        break;
      case 'stream.viewer_join':
        realtimeMetrics.increment(`realtime:stream:${event.targetId}:viewers`);
        realtimeMetrics.set('realtime:total_concurrent_viewers', 
          Array.from(realtimeMetrics.getAll()).filter(([k]) => k.startsWith('realtime:stream:')).reduce((sum, [, v]) => sum + v.value, 0));
        break;
      case 'stream.viewer_leave':
        const streamViewers = realtimeMetrics.get(`realtime:stream:${event.targetId}:viewers`)?.value || 0;
        realtimeMetrics.set(`realtime:stream:${event.targetId}:viewers`, Math.max(0, streamViewers - 1));
        break;
      case 'gift.sent':
        realtimeMetrics.increment('realtime:gifts_today');
        if (event.value) realtimeMetrics.increment('realtime:gift_revenue_today', event.value);
        break;
      case 'coin.purchase':
        realtimeMetrics.increment('realtime:coin_purchases_today');
        if (event.value) realtimeMetrics.increment('realtime:revenue_today', event.value);
        break;
      case 'message.sent':
        realtimeMetrics.increment('realtime:messages_per_second');
        break;
      case 'notification.sent':
        realtimeMetrics.increment('realtime:notifications_sent_today');
        break;
      case 'reaction.added':
        realtimeMetrics.increment('realtime:reactions_today');
        break;
      case 'follow.added':
        realtimeMetrics.increment('realtime:new_followers_today');
        break;
      case 'content.created':
        realtimeMetrics.increment('realtime:content_created_today');
        if (event.targetType) realtimeMetrics.increment(`realtime:${event.targetType}_created_today`);
        break;
      case 'session.start':
        realtimeMetrics.set('realtime:active_sessions', (realtimeMetrics.get('realtime:active_sessions')?.value || 0) + 1);
        break;
      case 'session.end':
        const sessions = realtimeMetrics.get('realtime:active_sessions')?.value || 0;
        realtimeMetrics.set('realtime:active_sessions', Math.max(0, sessions - 1));
        if (event.value) {
          realtimeMetrics.set(`realtime:session_duration:${event.sessionId}`, event.value);
        }
        break;
    }
  }

  // Get real-time metrics
  getRealtimeMetrics(): Record<string, any> {
    const metrics = realtimeMetrics.getAll();
    
    // Calculate derived metrics
    const activeStreams = metrics['realtime:active_streams']?.value || 0;
    const activeUsers = metrics['realtime:active_users']?.value || 0;
    
    return {
      activeUsers,
      activeStreams,
      activeSessions: metrics['realtime:active_sessions']?.value || 0,
      totalConcurrentViewers: metrics['realtime:total_concurrent_viewers']?.value || 0,
      newRegistrationsToday: metrics['realtime:new_registrations_today']?.value || 0,
      giftsToday: metrics['realtime:gifts_today']?.value || 0,
      giftRevenueToday: metrics['realtime:gift_revenue_today']?.value || 0,
      coinPurchasesToday: metrics['realtime:coin_purchases_today']?.value || 0,
      revenueToday: metrics['realtime:revenue_today']?.value || 0,
      messagesPerSecond: metrics['realtime:messages_per_second']?.value || 0,
      notificationsSentToday: metrics['realtime:notifications_sent_today']?.value || 0,
      reactionsToday: metrics['realtime:reactions_today']?.value || 0,
      newFollowersToday: metrics['realtime:new_followers_today']?.value || 0,
      contentCreatedToday: metrics['realtime:content_created_today']?.value || 0,
      timestamp: new Date().toISOString(),
    };
  }

  // Subscribe to real-time events
  onEvent(callback: (event: AnalyticsEvent) => void): () => void {
    analyticsEventBus.on('event', callback);
    return () => analyticsEventBus.off('event', callback);
  }

  // ============================================================================
  // METRIC COMPUTATION
  // ============================================================================

  async getMetric(metricName: string, query: AnalyticsQuery): Promise<any> {
    const metricDef = METRIC_DEFINITIONS[metricName];
    if (!metricDef) throw new Error(`Unknown metric: ${metricName}`);

    const cacheKey = `${metricName}:${JSON.stringify(query)}`;
    const ttl = query.period === 'realtime' ? 5000 : CACHE_TTL;

    return getCachedOrCompute(cacheKey, ttl, () => this.computeMetric(metricDef, query));
  }

  private async computeMetric(metric: AnalyticsMetric, query: AnalyticsQuery): Promise<any> {
    const { period, startDate, endDate, granularity, groupBy, filters, limit } = query;
    
    // Determine time range
    const { start, end } = this.getTimeRange(period, startDate, endDate);

    switch (metric.name) {
      // User Metrics
      case 'dau':
        return this.computeDistinctCount('user', start, end, 'day', granularity, groupBy);
      case 'wau':
        return this.computeDistinctCount('user', start, end, 'week', granularity, groupBy);
      case 'mau':
        return this.computeDistinctCount('user', start, end, 'month', granularity, groupBy);
      case 'new_registrations':
        return this.computeCount('user.registration', start, end, granularity, groupBy, filters, limit);
      case 'user_retention':
        return this.computeRetention(start, end);
      case 'user_churn':
        return this.computeChurn(start, end);
      case 'session_duration':
        return this.computeAverage('session.duration', start, end, granularity, groupBy);
      case 'user_growth':
        return this.computeGrowthRate('user', start, end);
      case 'ltv':
        return this.computeLTV(start, end);

      // Content Metrics
      case 'posts_created':
        return this.computeCount('content.post', start, end, granularity, groupBy, filters, limit);
      case 'stories_posted':
        return this.computeCount('content.story', start, end, granularity, groupBy, filters, limit);
      case 'videos_uploaded':
        return this.computeCount('content.video', start, end, granularity, groupBy, filters, limit);
      case 'live_streams_started':
        return this.computeCount('stream.start', start, end, granularity, groupBy, filters, limit);
      case 'total_likes':
        return this.computeCount('reaction.like', start, end, granularity, groupBy, filters, limit);
      case 'total_comments':
        return this.computeCount('comment.created', start, end, granularity, groupBy, filters, limit);
      case 'total_shares':
        return this.computeCount('content.share', start, end, granularity, groupBy, filters, limit);
      case 'total_saves':
        return this.computeCount('content.save', start, end, granularity, groupBy, filters, limit);
      case 'engagement_rate':
        return this.computeEngagementRate(start, end);

      // Creator Metrics
      case 'profile_views':
        return this.computeCount('profile.view', start, end, granularity, groupBy, filters, limit);
      case 'followers_gained':
        return this.computeCount('follow.added', start, end, granularity, groupBy, filters, limit);
      case 'followers_lost':
        return this.computeCount('follow.removed', start, end, granularity, groupBy, filters, limit);
      case 'watch_time':
        return this.computeSum('content.watch', start, end, granularity, groupBy, filters, limit);
      case 'video_completion_rate':
        return this.computePercentage('content.watch.complete', 'content.watch', start, end);
      case 'gift_revenue':
        return this.computeSum('gift.sent', start, end, granularity, groupBy, filters, limit);
      case 'subscription_revenue':
        return this.computeSum('subscription.created', start, end, granularity, groupBy, filters, limit);
      case 'ad_revenue':
        return this.computeSum('ad.impression', start, end, granularity, groupBy, filters, limit);
      case 'total_earnings':
        return this.computeTotalEarnings(start, end, filters);

      // Live Stream Metrics
      case 'concurrent_viewers':
        return this.computeGauge(`stream:${filters?.streamId || '*'}:viewers`, start, end);
      case 'peak_viewers':
        return this.computePeak('stream.viewer_join', start, end, filters);
      case 'stream_watch_time':
        return this.computeSum('stream.watch', start, end, granularity, groupBy, filters, limit);
      case 'new_followers_during_stream':
        return this.computeCount('follow.added', start, end, granularity, groupBy, { ...filters, source: 'stream' }, limit);
      case 'gift_volume':
        return this.computeCount('gift.sent', start, end, granularity, groupBy, { ...filters, targetType: 'stream' }, limit);
      case 'chat_messages':
        return this.computeCount('message.sent', start, end, granularity, groupBy, { ...filters, targetType: 'stream' }, limit);
      case 'stream_reactions':
        return this.computeCount('reaction.added', start, end, granularity, groupBy, { ...filters, targetType: 'stream' }, limit);

      // Revenue Metrics
      case 'coin_purchases':
        return this.computeCount('coin.purchase', start, end, granularity, groupBy, filters, limit);
      case 'platform_revenue':
        return this.computeTotalRevenue(start, end, filters);
      case 'arpu':
        return this.computeARPU(start, end);
      case 'payment_success_rate':
        return this.computePercentage('payment.success', 'payment.*', start, end);
      case 'refund_rate':
        return this.computeRefundRate(start, end);

      // Marketing Metrics
      case 'conversion_rate':
        return this.computeConversionRate(start, end);
      case 'cac':
        return this.computeCAC(start, end);
      case 'roas':
        return this.computeROAS(start, end);
      case 'viral_coefficient':
        return this.computeViralCoefficient(start, end);

      // Notification Metrics
      case 'push_delivery_rate':
        return this.computePercentage('notification.delivered', 'notification.sent', start, end);
      case 'push_open_rate':
        return this.computePercentage('notification.opened', 'notification.delivered', start, end);
      case 'push_click_rate':
        return this.computePercentage('notification.clicked', 'notification.delivered', start, end);

      // AI Metrics
      case 'recommendation_accuracy':
        return this.computeAIAccuracy('recommendation', start, end);
      case 'moderation_accuracy':
        return this.computeAIAccuracy('moderation', start, end);
      case 'spam_detection_rate':
        return this.computeAIDetectionRate('spam', start, end);
      case 'ai_response_time':
        return this.computeAIResponseTime(start, end);

      // Performance Metrics
      case 'api_latency':
        return this.computeAverage('performance.api_latency', start, end, granularity, groupBy);
      case 'db_query_time':
        return this.computeAverage('performance.db_query', start, end, granularity, groupBy);
      case 'cache_hit_rate':
        return this.computePercentage('cache.hit', 'cache.*', start, end);
      case 'websocket_connections':
        return this.computeGauge('websocket.connections', start, end);
      case 'error_rate':
        return this.computePercentage('error.*', 'request.*', start, end);

      default:
        throw new Error(`Metric computation not implemented: ${metric.name}`);
    }
  }

  // ============================================================================
  // PRIVATE COMPUTATION HELPERS
  // ============================================================================

  private getTimeRange(period: AnalyticsPeriod, startDate?: string, endDate?: string): { start: Date; end: Date } {
    const end = endDate ? new Date(endDate) : new Date();
    let start: Date;

    if (startDate) {
      start = new Date(startDate);
    } else {
      switch (period) {
        case 'realtime':
          start = new Date(Date.now() - 3600000); // Last hour
          break;
        case 'daily':
          start = new Date(end);
          start.setDate(start.getDate() - 1);
          break;
        case 'weekly':
          start = new Date(end);
          start.setDate(start.getDate() - 7);
          break;
        case 'monthly':
          start = new Date(end);
          start.setMonth(start.getMonth() - 1);
          break;
        case 'quarterly':
          start = new Date(end);
          start.setMonth(start.getMonth() - 3);
          break;
        case 'yearly':
          start = new Date(end);
          start.setFullYear(start.getFullYear() - 1);
          break;
        default:
          start = new Date(end);
          start.setDate(start.getDate() - 7);
      }
    }

    return { start, end };
  }

  private getGranularity(start: Date, end: Date, preferred?: string): 'hour' | 'day' | 'week' | 'month' {
    if (preferred) return preferred as any;
    const diffHours = (end.getTime() - start.getTime()) / 3600000;
    if (diffHours <= 24) return 'hour';
    if (diffHours <= 168) return 'day'; // 7 days
    if (diffHours <= 720) return 'week'; // 30 days
    return 'month';
  }

  private async computeCount(
    eventPattern: string, start: Date, end: Date,
    granularity?: string, groupBy?: string, filters?: Record<string, any>, limit?: number
  ): Promise<any> {
    const grain = this.getGranularity(start, end, granularity);
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { contains: eventPattern.replace('*', '%') },
        timestamp: { gte: start, lte: end },
        ...(filters?.userId ? { userId: filters.userId } : {}),
        ...(filters?.targetType ? { targetType: filters.targetType } : {}),
        ...(filters?.targetId ? { targetId: filters.targetId } : {}),
        ...(filters?.source ? { source: filters.source } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    return this.aggregateTimeSeries(events, grain, 'count', groupBy, limit);
  }

  private async computeDistinctCount(
    entityType: string, start: Date, end: Date,
    periodType: 'day' | 'week' | 'month', granularity?: string, groupBy?: string
  ): Promise<any> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { in: ['user.active', 'user.login', 'session.start'] },
        timestamp: { gte: start, lte: end },
      },
      select: { userId: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    const grain = granularity || periodType;
    const bucketed = this.bucketByTime(events, grain);
    
    const result: TimeSeriesPoint[] = [];
    for (const [bucket, items] of Object.entries(bucketed)) {
      const uniqueUsers = new Set(items.map(e => e.userId).filter(Boolean));
      result.push({
        timestamp: bucket,
        value: uniqueUsers.size,
        label: `${entityType}_${grain}`,
      });
    }

    return {
      metric: `${entityType}.${periodType === 'day' ? 'dau' : periodType === 'week' ? 'wau' : 'mau'}`,
      period: grain,
      data: result,
      total: result.reduce((sum, p) => sum + p.value, 0),
      average: result.length > 0 ? result.reduce((sum, p) => sum + p.value, 0) / result.length : 0,
    };
  }

  private async computeSum(
    eventPattern: string, start: Date, end: Date,
    granularity?: string, groupBy?: string, filters?: Record<string, any>, limit?: number
  ): Promise<any> {
    const grain = this.getGranularity(start, end, granularity);
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { contains: eventPattern.replace('*', '%') },
        timestamp: { gte: start, lte: end },
        ...(filters?.userId ? { userId: filters.userId } : {}),
        ...(filters?.targetType ? { targetType: filters.targetType } : {}),
        ...(filters?.targetId ? { targetId: filters.targetId } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    const bucketed = this.bucketByTime(events, grain);
    const result: TimeSeriesPoint[] = [];
    for (const [bucket, items] of Object.entries(bucketed)) {
      result.push({
        timestamp: bucket,
        value: items.reduce((sum, e) => sum + (e.value || 0), 0),
      });
    }

    return {
      metric: eventPattern,
      period: grain,
      data: result,
      total: result.reduce((sum, p) => sum + p.value, 0),
    };
  }

  private async computeAverage(
    eventPattern: string, start: Date, end: Date,
    granularity?: string, groupBy?: string
  ): Promise<any> {
    const grain = this.getGranularity(start, end, granularity);
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { contains: eventPattern.replace('*', '%') },
        timestamp: { gte: start, lte: end },
        value: { not: null },
      },
      orderBy: { timestamp: 'asc' },
    });

    const bucketed = this.bucketByTime(events, grain);
    const result: TimeSeriesPoint[] = [];
    for (const [bucket, items] of Object.entries(bucketed)) {
      const values = items.map(e => e.value || 0);
      result.push({
        timestamp: bucket,
        value: values.reduce((s, v) => s + v, 0) / values.length,
      });
    }

    const allValues = events.map(e => e.value || 0);
    return {
      metric: eventPattern,
      period: grain,
      data: result,
      average: allValues.length > 0 ? allValues.reduce((s, v) => s + v, 0) / allValues.length : 0,
      min: allValues.length > 0 ? Math.min(...allValues) : 0,
      max: allValues.length > 0 ? Math.max(...allValues) : 0,
    };
  }

  private async computePercentage(numerator: string, denominator: string, start: Date, end: Date): Promise<any> {
    const numEvents = await prisma.analyticsEvent.count({
      where: { eventType: { contains: numerator.replace('*', '%') }, timestamp: { gte: start, lte: end } },
    });
    const denEvents = await prisma.analyticsEvent.count({
      where: { eventType: { contains: denominator.replace('*', '%') }, timestamp: { gte: start, lte: end } },
    });

    return {
      metric: `${numerator}/${denominator}`,
      value: denEvents > 0 ? (numEvents / denEvents) * 100 : 0,
      numerator: numEvents,
      denominator: denEvents,
    };
  }

  private async computeRetention(start: Date, end: Date): Promise<any> {
    // Retention = users active in both periods / users active in first period
    const midpoint = new Date((start.getTime() + end.getTime()) / 2);
    
    const firstPeriod = await prisma.analyticsEvent.findMany({
      where: { eventType: { in: ['user.active', 'user.login'] }, timestamp: { gte: start, lte: midpoint } },
      select: { userId: true },
      distinct: ['userId'],
    });
    
    const secondPeriod = await prisma.analyticsEvent.findMany({
      where: { eventType: { in: ['user.active', 'user.login'] }, timestamp: { gte: midpoint, lte: end } },
      select: { userId: true },
      distinct: ['userId'],
    });

    const firstUsers = new Set(firstPeriod.map(u => u.userId).filter(Boolean));
    const secondUsers = new Set(secondPeriod.map(u => u.userId).filter(Boolean));
    
    if (firstUsers.size === 0) return { rate: 0, retained: 0, total: 0 };
    
    const retained = [...firstUsers].filter(u => secondUsers.has(u)).length;
    return {
      rate: (retained / firstUsers.size) * 100,
      retained,
      total: firstUsers.size,
      period: `${start.toISOString()} - ${end.toISOString()}`,
    };
  }

  private async computeChurn(start: Date, end: Date): Promise<any> {
    // Churn = users lost / total users at start
    const retention = await this.computeRetention(start, end);
    return {
      rate: 100 - retention.rate,
      churned: retention.total - retention.retained,
      total: retention.total,
    };
  }

  private async computeGrowthRate(entityType: string, start: Date, end: Date): Promise<any> {
    const midpoint = new Date((start.getTime() + end.getTime()) / 2);
    
    const startCount = await prisma.analyticsEvent.count({
      where: {
        eventType: 'user.register',
        timestamp: { gte: start, lte: midpoint },
      },
    });
    
    const endCount = await prisma.analyticsEvent.count({
      where: {
        eventType: 'user.register',
        timestamp: { gte: midpoint, lte: end },
      },
    });

    return {
      rate: startCount > 0 ? ((endCount - startCount) / startCount) * 100 : 0,
      startCount,
      endCount,
      netGrowth: endCount - startCount,
    };
  }

  private async computeLTV(start: Date, end: Date): Promise<any> {
    // LTV = total revenue / total users
    const revenue = await prisma.analyticsEvent.aggregate({
      where: {
        eventType: { in: ['coin.purchase', 'subscription.created', 'gift.sent'] },
        timestamp: { gte: start, lte: end },
        value: { not: null },
      },
      _sum: { value: true },
    });

    const users = await prisma.analyticsEvent.findMany({
      where: { eventType: 'user.register', timestamp: { gte: start, lte: end } },
      select: { userId: true },
      distinct: ['userId'],
    });

    const totalRevenue = revenue._sum.value || 0;
    const totalUsers = users.length || 1;

    return {
      value: totalRevenue / totalUsers,
      totalRevenue,
      totalUsers,
    };
  }

  private async computeEngagementRate(start: Date, end: Date): Promise<any> {
    // Engagement = (likes + comments + shares + saves) / total content views
    const interactions = await prisma.analyticsEvent.count({
      where: {
        eventType: { in: ['reaction.like', 'comment.created', 'content.share', 'content.save'] },
        timestamp: { gte: start, lte: end },
      },
    });

    const views = await prisma.analyticsEvent.count({
      where: {
        eventType: { in: ['content.view', 'video.view', 'story.view'] },
        timestamp: { gte: start, lte: end },
      },
    });

    return {
      rate: views > 0 ? (interactions / views) * 100 : 0,
      interactions,
      views,
    };
  }

  private async computeTotalEarnings(start: Date, end: Date, filters?: Record<string, any>): Promise<any> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { in: ['gift.sent', 'subscription.created', 'ad.impression'] },
        timestamp: { gte: start, lte: end },
        ...(filters?.userId ? { userId: filters.userId } : {}),
        ...(filters?.targetId ? { targetId: filters.targetId } : {}),
        value: { not: null },
      },
    });

    const total = events.reduce((sum, e) => sum + (e.value || 0), 0);
    return { value: total, count: events.length };
  }

  private async computeTotalRevenue(start: Date, end: Date, filters?: Record<string, any>): Promise<any> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { in: ['coin.purchase', 'subscription.created'] },
        timestamp: { gte: start, lte: end },
        ...(filters?.userId ? { userId: filters.userId } : {}),
        value: { not: null },
      },
    });

    const total = events.reduce((sum, e) => sum + (e.value || 0), 0);
    return { value: total, count: events.length };
  }

  private async computeARPU(start: Date, end: Date): Promise<any> {
    const revenue = await this.computeTotalRevenue(start, end);
    const users = await prisma.analyticsEvent.findMany({
      where: { eventType: 'user.register' },
      select: { userId: true },
      distinct: ['userId'],
    });

    return {
      value: users.length > 0 ? revenue.value / users.length : 0,
      totalRevenue: revenue.value,
      totalUsers: users.length,
    };
  }

  private async computeRefundRate(start: Date, end: Date): Promise<any> {
    const refunds = await prisma.analyticsEvent.count({
      where: { eventType: 'payment.refund', timestamp: { gte: start, lte: end } },
    });
    const payments = await prisma.analyticsEvent.count({
      where: { eventType: 'payment.success', timestamp: { gte: start, lte: end } },
    });

    return {
      rate: payments > 0 ? (refunds / payments) * 100 : 0,
      refunds,
      payments,
    };
  }

  private async computeConversionRate(start: Date, end: Date): Promise<any> {
    const registrations = await prisma.analyticsEvent.count({
      where: { eventType: 'user.register', timestamp: { gte: start, lte: end } },
    });
    const visits = await prisma.analyticsEvent.count({
      where: { eventType: 'page.visit', timestamp: { gte: start, lte: end } },
    });

    return {
      rate: visits > 0 ? (registrations / visits) * 100 : 0,
      registrations,
      visits,
    };
  }

  private async computeCAC(start: Date, end: Date): Promise<any> {
    // CAC = total marketing spend / new customers
    const marketingSpend = await prisma.analyticsEvent.aggregate({
      where: { eventType: 'marketing.spend', timestamp: { gte: start, lte: end }, value: { not: null } },
      _sum: { value: true },
    });

    const newUsers = await prisma.analyticsEvent.count({
      where: { eventType: 'user.register', timestamp: { gte: start, lte: end } },
    });

    const spend = marketingSpend._sum.value || 0;
    return {
      value: newUsers > 0 ? spend / newUsers : 0,
      totalSpend: spend,
      newUsers,
    };
  }

  private async computeROAS(start: Date, end: Date): Promise<any> {
    // ROAS = revenue from marketing / marketing spend
    const marketingRevenue = await prisma.analyticsEvent.aggregate({
      where: { eventType: { in: ['coin.purchase', 'subscription.created'] }, source: { in: ['ad', 'campaign', 'referral'] }, timestamp: { gte: start, lte: end }, value: { not: null } },
      _sum: { value: true },
    });

    const marketingSpend = await prisma.analyticsEvent.aggregate({
      where: { eventType: 'marketing.spend', timestamp: { gte: start, lte: end }, value: { not: null } },
      _sum: { value: true },
    });

    const revenue = marketingRevenue._sum.value || 0;
    const spend = marketingSpend._sum.value || 1;
    return {
      value: revenue / spend,
      revenue,
      spend,
    };
  }

  private async computeViralCoefficient(start: Date, end: Date): Promise<any> {
    // Viral coefficient = invites sent * conversion rate / total users
    const invites = await prisma.analyticsEvent.count({
      where: { eventType: 'referral.invite_sent', timestamp: { gte: start, lte: end } },
    });

    const referrals = await prisma.analyticsEvent.count({
      where: { eventType: 'referral.signup', timestamp: { gte: start, lte: end } },
    });

    const conversionRate = invites > 0 ? referrals / invites : 0;
    return {
      coefficient: conversionRate,
      invites,
      referrals,
      conversionRate,
    };
  }

  private async computeGauge(key: string, start: Date, end: Date): Promise<any> {
    const gauge = realtimeMetrics.get(key);
    return {
      value: gauge?.value || 0,
      timestamp: gauge?.timestamp ? new Date(gauge.timestamp).toISOString() : new Date().toISOString(),
    };
  }

  private async computePeak(eventType: string, start: Date, end: Date, filters?: Record<string, any>): Promise<any> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType,
        timestamp: { gte: start, lte: end },
        ...(filters?.streamId ? { targetId: filters.streamId } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    // Group by minute and find max
    const bucketed: Record<string, number> = {};
    for (const event of events) {
      const key = new Date(event.timestamp).toISOString().slice(0, 16);
      bucketed[key] = (bucketed[key] || 0) + 1;
    }

    const values = Object.values(bucketed);
    return {
      peak: values.length > 0 ? Math.max(...values) : 0,
      at: values.length > 0 ? Object.entries(bucketed).find(([, v]) => v === Math.max(...values))?.[0] : null,
      total: events.length,
    };
  }

  private async computeAIAccuracy(aiType: string, start: Date, end: Date): Promise<any> {
    const correct = await prisma.analyticsEvent.count({
      where: { eventType: `ai.${aiType}.correct`, timestamp: { gte: start, lte: end } },
    });
    const total = await prisma.analyticsEvent.count({
      where: { eventType: { contains: `ai.${aiType}` }, timestamp: { gte: start, lte: end } },
    });

    return {
      accuracy: total > 0 ? (correct / total) * 100 : 0,
      correct,
      total,
    };
  }

  private async computeAIDetectionRate(detectionType: string, start: Date, end: Date): Promise<any> {
    const detected = await prisma.analyticsEvent.count({
      where: { eventType: `ai.detected.${detectionType}`, timestamp: { gte: start, lte: end } },
    });
    const actual = await prisma.analyticsEvent.count({
      where: { eventType: { in: [`report.${detectionType}`, `moderation.${detectionType}`] }, timestamp: { gte: start, lte: end } },
    });

    return {
      rate: actual > 0 ? (detected / actual) * 100 : 0,
      detected,
      actual,
    };
  }

  private async computeAIResponseTime(start: Date, end: Date): Promise<any> {
    const result = await prisma.analyticsEvent.aggregate({
      where: { eventType: { contains: 'ai.response' }, timestamp: { gte: start, lte: end }, value: { not: null } },
      _avg: { value: true },
      _max: { value: true },
      _min: { value: true },
    });

    return {
      average: result._avg.value || 0,
      max: result._max.value || 0,
      min: result._min.value || 0,
    };
  }

  // ============================================================================
  // FUNNEL ANALYSIS
  // ============================================================================

  async getFunnel(steps: { name: string; eventPattern: string }[], start: Date, end: Date): Promise<FunnelStep[]> {
    const funnel: FunnelStep[] = [];
    let previousCount = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const count = await prisma.analyticsEvent.count({
        where: {
          eventType: { contains: step.eventPattern.replace('*', '%') },
          timestamp: { gte: start, lte: end },
        },
      });

      const percentage = i === 0 ? 100 : previousCount > 0 ? (count / previousCount) * 100 : 0;
      const dropOff = i === 0 ? 0 : 100 - percentage;

      funnel.push({
        name: step.name,
        metric: step.eventPattern,
        count,
        percentage,
        dropOff,
      });

      previousCount = count;
    }

    return funnel;
  }

  // ============================================================================
  // COHORT ANALYSIS
  // ============================================================================

  async getCohortAnalysis(cohortPeriod: 'week' | 'month', periods: number = 12): Promise<CohortAnalysis[]> {
    const registrations = await prisma.analyticsEvent.findMany({
      where: { eventType: 'user.register' },
      select: { userId: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    // Group users by registration cohort
    const cohorts: Map<string, string[]> = new Map();
    for (const reg of registrations) {
      if (!reg.userId) continue;
      const key = cohortPeriod === 'week' 
        ? this.getWeekKey(reg.timestamp)
        : this.getMonthKey(reg.timestamp);
      
      if (!cohorts.has(key)) cohorts.set(key, []);
      cohorts.get(key)!.push(reg.userId);
    }

    // For each cohort, track retention over subsequent periods
    const result: CohortAnalysis[] = [];
    const sortedCohorts = [...cohorts.entries()].slice(-periods);

    for (const [cohortKey, cohortUsers] of sortedCohorts) {
      const userSet = new Set(cohortUsers);
      const retention: number[] = [];

      for (let p = 0; p < Math.min(periods, 8); p++) {
        const periodStart = this.addPeriod(new Date(cohortKey), cohortPeriod, p);
        const periodEnd = this.addPeriod(periodStart, cohortPeriod, 1);

        const activeInPeriod = await prisma.analyticsEvent.findMany({
          where: {
            userId: { in: cohortUsers },
            eventType: { in: ['user.active', 'user.login'] },
            timestamp: { gte: periodStart, lte: periodEnd },
          },
          select: { userId: true },
          distinct: ['userId'],
        });

        const activeSet = new Set(activeInPeriod.map(a => a.userId).filter(Boolean));
        const retained = [...userSet].filter(u => activeSet.has(u)).length;
        retention.push(userSet.size > 0 ? (retained / userSet.size) * 100 : 0);
      }

      result.push({
        cohort: cohortKey,
        period: cohortPeriod,
        retention,
        size: cohortUsers.length,
      });
    }

    return result;
  }

  // ============================================================================
  // USER JOURNEY ANALYSIS
  // ============================================================================

  async getUserJourney(userId: string, start?: Date, end?: Date): Promise<UserJourney> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        userId,
        timestamp: {
          gte: start || new Date(Date.now() - 86400000),
          lte: end || new Date(),
        },
      },
      orderBy: { timestamp: 'asc' },
      take: 100,
    });

    const steps = events.map(e => ({
      action: e.eventType,
      timestamp: e.timestamp.toISOString(),
      page: e.targetType || 'unknown',
      duration: 0, // Would need session context
    }));

    const uniquePages = [...new Set(steps.map(s => s.page))];

    return {
      userId,
      steps,
      totalDuration: steps.length > 0 
        ? new Date(steps[steps.length - 1].timestamp).getTime() - new Date(steps[0].timestamp).getTime()
        : 0,
      path: uniquePages,
    };
  }

  // ============================================================================
  // PREDICTIVE ANALYTICS
  // ============================================================================

  async getPredictions(metric: string, period: AnalyticsPeriod): Promise<PredictiveForecast> {
    // Simple time-series forecasting using moving average and trend analysis
    const { start, end } = this.getTimeRange(period);
    const historicalData = await this.getMetric(metric, {
      metric,
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      granularity: 'day',
    });

    if (!historicalData?.data || historicalData.data.length < 7) {
      return {
        metric,
        period,
        predictions: [],
        confidence: 0,
        modelVersion: 'simple-moving-average-v1',
        generatedAt: new Date().toISOString(),
        metadata: { trend: 'stable', factors: ['insufficient_data'] },
      };
    }

    const values = historicalData.data.map((p: TimeSeriesPoint) => p.value);
    const recentValues = values.slice(-14);

    // Simple linear regression for trend
    const n = recentValues.length;
    const xMean = (n - 1) / 2;
    const yMean = recentValues.reduce((s: number, v: number) => s + v, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (recentValues[i] - yMean);
      denominator += (i - xMean) ** 2;
    }

    const slope = denominator > 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Generate predictions
    const predictions: TimeSeriesPoint[] = [];
    const lastTimestamp = historicalData.data[historicalData.data.length - 1].timestamp;
    const lastDate = new Date(lastTimestamp);

    for (let i = 1; i <= 30; i++) {
      const predDate = new Date(lastDate);
      predDate.setDate(predDate.getDate() + i);
      
      const predictedValue = Math.max(0, intercept + slope * (n - 1 + i));
      
      // Add some randomness based on historical variance
      const variance = recentValues.reduce((s: number, v: number) => s + (v - yMean) ** 2, 0) / n;
      const noise = (Math.random() - 0.5) * Math.sqrt(variance) * 0.3;
      
      predictions.push({
        timestamp: predDate.toISOString(),
        value: Math.max(0, predictedValue + noise),
        label: 'predicted',
      });
    }

    // Calculate confidence based on data consistency
    const stdDev = Math.sqrt(recentValues.reduce((s: number, v: number) => s + (v - yMean) ** 2, 0) / n);
    const cv = yMean > 0 ? stdDev / yMean : 1; // Coefficient of variation
    const confidence = Math.max(0, Math.min(100, (1 - cv) * 100));

    return {
      metric,
      period,
      predictions,
      confidence: Math.round(confidence),
      modelVersion: 'simple-moving-average-v1',
      generatedAt: new Date().toISOString(),
      metadata: {
        trend: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable',
        accuracy: Math.round(confidence),
        factors: ['historical_trend', 'seasonal_pattern'],
      },
    };
  }

  // ============================================================================
  // CONTENT PERFORMANCE RANKING
  // ============================================================================

  async getTopContent(metric: string, start: Date, end: Date, limit: number = 20): Promise<any[]> {
    const events = await prisma.analyticsEvent.groupBy({
      by: ['targetId', 'targetType'],
      where: {
        eventType: { contains: metric.replace('*', '%') },
        timestamp: { gte: start, lte: end },
        targetId: { not: null },
      },
      _count: { id: true },
      _sum: { value: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return events.map(e => ({
      targetId: e.targetId,
      targetType: e.targetType,
      count: e._count.id,
      value: e._sum.value || 0,
    }));
  }

  // ============================================================================
  // TRAFFIC SOURCE ANALYSIS
  // ============================================================================

  async getTrafficSources(start: Date, end: Date): Promise<Record<string, number>> {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: { in: ['page.visit', 'user.register'] },
        timestamp: { gte: start, lte: end },
        source: { not: null },
      },
      select: { source: true },
    });

    const sources: Record<string, number> = {};
    for (const event of events) {
      if (event.source) {
        sources[event.source] = (sources[event.source] || 0) + 1;
      }
    }

    return sources;
  }

  // ============================================================================
  // DEMOGRAPHICS
  // ============================================================================

  async getAudienceDemographics(start: Date, end: Date): Promise<Record<string, any>> {
    const activeUserIds = await prisma.analyticsEvent.findMany({
      where: { eventType: 'user.active', timestamp: { gte: start, lte: end } },
      select: { userId: true },
      distinct: ['userId'],
    });

    // Fall back to event metadata analysis
    const eventMetadata = await prisma.analyticsEvent.findMany({
      where: { eventType: 'user.active', timestamp: { gte: start, lte: end }, metadata: { not: null } },
      select: { metadata: true },
      take: 1000,
    });

    const countries: Record<string, number> = {};
    const devices: Record<string, number> = {};
    
    for (const event of eventMetadata) {
      if (event.metadata) {
        try {
          const meta = JSON.parse(event.metadata);
          if (meta.country) countries[meta.country] = (countries[meta.country] || 0) + 1;
          if (meta.device) devices[meta.device] = (devices[meta.device] || 0) + 1;
        } catch {}
      }
    }

    return {
      totalActiveUsers: activeUserIds.length,
      countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 20),
      devices: Object.entries(devices).sort((a, b) => b[1] - a[1]),
    };
  }

  // ============================================================================
  // UTILITY HELPERS
  // ============================================================================

  private bucketByTime(events: any[], granularity: string): Record<string, any[]> {
    const buckets: Record<string, any[]> = {};

    for (const event of events) {
      const key = this.getTimeBucketKey(event.timestamp, granularity);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(event);
    }

    return buckets;
  }

  private getTimeBucketKey(timestamp: Date, granularity: string): string {
    const d = new Date(timestamp);
    switch (granularity) {
      case 'hour':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
      case 'day':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      case 'week':
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return `${weekStart.getFullYear()}-W${String(this.getWeekNumber(weekStart)).padStart(2, '0')}`;
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      default:
        return d.toISOString().slice(0, 10);
    }
  }

  private getWeekNumber(d: Date): number {
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const diff = d.getTime() - startOfYear.getTime();
    return Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
  }

  private getWeekKey(d: Date): string {
    const start = new Date(d);
    start.setDate(start.getDate() - start.getDay());
    return start.toISOString().slice(0, 10);
  }

  private getMonthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private addPeriod(date: Date, period: string, count: number): Date {
    const result = new Date(date);
    switch (period) {
      case 'week': result.setDate(result.getDate() + count * 7); break;
      case 'month': result.setMonth(result.getMonth() + count); break;
      default: result.setDate(result.getDate() + count);
    }
    return result;
  }

  private aggregateTimeSeries(
    events: any[], granularity: string,
    aggregation: 'count' | 'sum' | 'avg', groupBy?: string, limit?: number
  ): any {
    const bucketed = this.bucketByTime(events, granularity);
    const result: TimeSeriesPoint[] = [];

    for (const [bucket, items] of Object.entries(bucketed)) {
      let value: number;
      switch (aggregation) {
        case 'count':
          value = items.length;
          break;
        case 'sum':
          value = items.reduce((s, e) => s + (e.value || 0), 0);
          break;
        case 'avg':
          const vals = items.map(e => e.value || 0);
          value = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
          break;
      }

      result.push({ timestamp: bucket, value });
    }

    // Apply sorting and limit
    result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (limit) {
      result.splice(limit);
    }

    return {
      period: granularity,
      data: result,
      total: result.reduce((sum, p) => sum + p.value, 0),
      average: result.length > 0 ? result.reduce((sum, p) => sum + p.value, 0) / result.length : 0,
    };
  }

  // Cleanup
  destroy(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    this.flushEvents();
  }
}

// Singleton
export const analyticsEngine = new AnalyticsEngine();