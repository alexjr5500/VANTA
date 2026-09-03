// ============================================================================
// VANTA Analytics - REST API Routes
// Provides comprehensive analytics endpoints for dashboards, reports,
// real-time metrics, predictive analytics, and data exports
// ============================================================================

import { Router, Request, Response } from 'express';
import { analyticsEngine } from './analytics.service';
import { authenticate, requireRole } from '../security';
import { rateLimiter } from '../security';
import { METRIC_DEFINITIONS, AnalyticsCategory } from './analytics.types';

const router = Router();

// ============================================================================
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// ============================================================================

const requireAuth = authenticate;
const analyticsRateLimit = rateLimiter.api;

// ============================================================================
// METRIC CATEGORIES & DEFINITIONS
// ============================================================================

/**
 * GET /api/analytics/metrics
 * Returns all available metric definitions with metadata
 * Access: All authenticated users (filtered by role)
 */
router.get('/metrics', requireAuth, analyticsRateLimit, (req: Request, res: Response) => {
  const { category } = req.query;
  const userRole = (req as any).user?.role || 'USER';

  // Filter metrics by role permissions
  const roleAccess: Record<string, AnalyticsCategory[]> = {
    ADMIN: ['user', 'content', 'creator', 'live_stream', 'community', 'revenue', 'marketing', 'notification', 'search', 'ai', 'performance', 'engagement', 'growth', 'moderation'],
    MODERATOR: ['user', 'content', 'live_stream', 'community', 'notification', 'search', 'performance', 'engagement', 'moderation'],
    CREATOR: ['user', 'content', 'creator', 'live_stream', 'revenue', 'engagement', 'growth', 'search'],
    USER: ['content', 'live_stream', 'search'],
  };

  const allowedCategories = roleAccess[userRole] || roleAccess.USER;
  
  let metrics = Object.values(METRIC_DEFINITIONS);
  
  if (category) {
    metrics = metrics.filter(m => m.category === category);
  }

  // Filter by role permissions
  metrics = metrics.filter(m => allowedCategories.includes(m.category));

  res.json({
    count: metrics.length,
    metrics,
  });
});

/**
 * GET /api/analytics/metrics/:metricName
 * Compute a specific metric with query parameters
 */
router.get('/metrics/:metricName', requireAuth, analyticsRateLimit, async (req: Request, res: Response) => {
  try {
    const { metricName } = req.params;
    const {
      period = 'daily',
      startDate,
      endDate,
      granularity,
      groupBy,
      limit,
      offset,
      ...filters
    } = req.query;

    const result = await analyticsEngine.getMetric(metricName, {
      metric: metricName,
      period: period as any,
      startDate: startDate as string,
      endDate: endDate as string,
      granularity: granularity as any,
      groupBy: groupBy as string,
      filters: filters as Record<string, any>,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// EVENT TRACKING
// ============================================================================

/**
 * POST /api/analytics/track
 * Track a single analytics event
 * Access: Authenticated users
 */
router.post('/track', requireAuth, async (req: Request, res: Response) => {
  try {
    const event = {
      ...req.body,
      userId: (req as any).user?.userId || req.body.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
    };

    await analyticsEngine.track(event);
    res.status(202).json({ status: 'accepted' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/track/batch
 * Track multiple analytics events at once
 * Access: Authenticated users
 */
router.post('/track/batch', requireAuth, async (req: Request, res: Response) => {
  try {
    const events = (req.body.events || []).map((event: any) => ({
      ...event,
      userId: event.userId || (req as any).user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
    }));

    await analyticsEngine.trackBatch(events);
    res.status(202).json({ status: 'accepted', count: events.length });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// REALTIME ANALYTICS
// ============================================================================

/**
 * GET /api/analytics/realtime
 * Get all current real-time metrics
 * Access: Admin, Moderator, Creator
 */
router.get('/realtime', requireAuth, analyticsRateLimit, (req: Request, res: Response) => {
  const metrics = analyticsEngine.getRealtimeMetrics();
  res.json(metrics);
});

/**
 * GET /api/analytics/realtime/:streamId
 * Get real-time metrics for a specific live stream
 * Access: Authenticated users
 */
router.get('/realtime/stream/:streamId', requireAuth, (req: Request, res: Response) => {
  const { streamId } = req.params;
  const metrics = analyticsEngine.getRealtimeMetrics();
  // Filter stream-specific metrics
  res.json({
    ...metrics,
    streamViewers: 0, // Would be populated from realtime store
    streamId,
  });
});

// ============================================================================
// DASHBOARD ENDPOINTS
// ============================================================================

/**
 * GET /api/analytics/dashboard/executive
 * Executive dashboard - high-level KPIs
 * Access: Admin
 */
router.get('/dashboard/executive', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dau, wau, mau, revenue, newUsers, realtime, retention, predictions] = await Promise.all([
      analyticsEngine.getMetric('dau', { metric: 'dau', period: 'daily' }),
      analyticsEngine.getMetric('wau', { metric: 'wau', period: 'weekly' }),
      analyticsEngine.getMetric('mau', { metric: 'mau', period: 'monthly' }),
      analyticsEngine.getMetric('platform_revenue', { metric: 'platform_revenue', period: 'monthly', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('new_registrations', { metric: 'new_registrations', period: 'daily', startDate: dayStart.toISOString(), endDate: now.toISOString() }),
      Promise.resolve(analyticsEngine.getRealtimeMetrics()),
      analyticsEngine.getMetric('user_retention', { metric: 'user_retention', period: 'monthly' }),
      analyticsEngine.getPredictions('dau', 'monthly'),
    ]);

    res.json({
      kpis: {
        dau: dau.total || 0,
        wau: wau.total || 0,
        mau: mau.total || 0,
        revenue: revenue.value || 0,
        newUsers: newUsers.total || 0,
        retention: retention.rate || 0,
      },
      trends: {
        dau: dau.data || [],
        wau: wau.data || [],
        mau: mau.data || [],
        revenue: revenue.data || [],
        newUsers: newUsers.data || [],
      },
      realtime,
      predictions,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard/revenue
 * Revenue dashboard with detailed breakdowns
 * Access: Admin
 */
router.get('/dashboard/revenue', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [totalRevenue, arpu, coinPurchases, paymentSuccess, refundRate, revenueByDay, revenueForecast] = await Promise.all([
      analyticsEngine.getMetric('platform_revenue', { metric: 'platform_revenue', period: 'monthly', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('arpu', { metric: 'arpu', period: 'monthly', startDate: yearStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('coin_purchases', { metric: 'coin_purchases', period: 'monthly', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('payment_success_rate', { metric: 'payment_success_rate', period: 'monthly' }),
      analyticsEngine.getMetric('refund_rate', { metric: 'refund_rate', period: 'monthly' }),
      analyticsEngine.getMetric('platform_revenue', { metric: 'platform_revenue', period: 'monthly', granularity: 'day', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getPredictions('platform_revenue', 'monthly'),
    ]);

    res.json({
      summary: {
        totalRevenue: totalRevenue.value || 0,
        arpu: arpu.value || 0,
        coinPurchases: coinPurchases.total || 0,
        paymentSuccessRate: paymentSuccess.value || 0,
        refundRate: refundRate.rate || 0,
      },
      revenueByDay: revenueByDay.data || [],
      predictions: revenueForecast,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard/growth
 * User growth dashboard
 * Access: Admin
 */
router.get('/dashboard/growth', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dau, wau, mau, newUsers, growthRate, churn, retention, dauForecast, cohorts] = await Promise.all([
      analyticsEngine.getMetric('dau', { metric: 'dau', period: 'daily', granularity: 'day', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('wau', { metric: 'wau', period: 'weekly' }),
      analyticsEngine.getMetric('mau', { metric: 'mau', period: 'monthly' }),
      analyticsEngine.getMetric('new_registrations', { metric: 'new_registrations', period: 'monthly', granularity: 'day', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('user_growth', { metric: 'user_growth', period: 'monthly' }),
      analyticsEngine.getMetric('user_churn', { metric: 'user_churn', period: 'monthly' }),
      analyticsEngine.getMetric('user_retention', { metric: 'user_retention', period: 'monthly' }),
      analyticsEngine.getPredictions('dau', 'monthly'),
      analyticsEngine.getCohortAnalysis('month', 6),
    ]);

    res.json({
      dau: dau.data || [],
      wau: wau.data || [],
      mau: mau.data || [],
      newUsers: newUsers.data || [],
      kpis: {
        growthRate: growthRate.rate || 0,
        churnRate: churn.rate || 0,
        retentionRate: retention.rate || 0,
        totalUsers: mau.total || 0,
      },
      predictions: dauForecast,
      cohorts,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard/operations
 * Operations/performance dashboard
 * Access: Admin
 */
router.get('/dashboard/operations', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const hourStart = new Date(now.getTime() - 3600000);

    const [apiLatency, errorRate, realtime] = await Promise.all([
      analyticsEngine.getMetric('api_latency', { metric: 'api_latency', period: 'realtime', granularity: 'hour', startDate: hourStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('error_rate', { metric: 'error_rate', period: 'realtime' }),
      Promise.resolve(analyticsEngine.getRealtimeMetrics()),
    ]);

    res.json({
      apiLatency: apiLatency.data || [],
      averageLatency: apiLatency.average || 0,
      errorRate: errorRate.value || 0,
      realtime,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard/creator
 * Creator analytics dashboard
 * Access: Creator, Admin
 */
router.get('/dashboard/creator', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [profileViews, followersGained, followersLost, earnings, watchTime, topContent, demographics] = await Promise.all([
      analyticsEngine.getMetric('profile_views', { metric: 'profile_views', period: 'monthly', filters: { userId }, startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('followers_gained', { metric: 'followers_gained', period: 'monthly', filters: { userId }, startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('followers_lost', { metric: 'followers_lost', period: 'monthly', filters: { userId }, startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('total_earnings', { metric: 'total_earnings', period: 'monthly', filters: { userId }, startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getMetric('watch_time', { metric: 'watch_time', period: 'monthly', granularity: 'day', filters: { userId }, startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      analyticsEngine.getTopContent('content.*', weekStart, now, 10),
      analyticsEngine.getAudienceDemographics(weekStart, now),
    ]);

    res.json({
      profileViews: profileViews.total || 0,
      followers: {
        gained: followersGained.total || 0,
        lost: followersLost.total || 0,
        net: (followersGained.total || 0) - (followersLost.total || 0),
      },
      earnings: earnings.value || 0,
      watchTime: watchTime.data || [],
      topContent,
      demographics,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard/product
 * Product analytics dashboard
 * Access: Admin
 */
router.get('/dashboard/product', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [engagement, sessionDuration, contentMetrics, funnel] = await Promise.all([
      analyticsEngine.getMetric('engagement_rate', { metric: 'engagement_rate', period: 'monthly' }),
      analyticsEngine.getMetric('session_duration', { metric: 'session_duration', period: 'monthly', granularity: 'day', startDate: monthStart.toISOString(), endDate: now.toISOString() }),
      Promise.all([
        analyticsEngine.getMetric('posts_created', { metric: 'posts_created', period: 'monthly' }),
        analyticsEngine.getMetric('videos_uploaded', { metric: 'videos_uploaded', period: 'monthly' }),
        analyticsEngine.getMetric('live_streams_started', { metric: 'live_streams_started', period: 'monthly' }),
        analyticsEngine.getMetric('stories_posted', { metric: 'stories_posted', period: 'monthly' }),
      ]),
      analyticsEngine.getFunnel([
        { name: 'Visitors', eventPattern: 'page.visit' },
        { name: 'Registrations', eventPattern: 'user.register' },
        { name: 'First Content', eventPattern: 'content.created' },
        { name: 'Engaged', eventPattern: 'reaction.like' },
      ], monthStart, now),
    ]);

    res.json({
      engagementRate: engagement.rate || 0,
      sessionDuration: sessionDuration.data || [],
      contentBreakdown: {
        posts: contentMetrics[0].total || 0,
        videos: contentMetrics[1].total || 0,
        liveStreams: contentMetrics[2].total || 0,
        stories: contentMetrics[3].total || 0,
      },
      funnel,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// FUNNEL & JOURNEY ANALYSIS
// ============================================================================

/**
 * POST /api/analytics/funnel
 * Perform funnel analysis with custom steps
 * Access: Admin, Creator
 */
router.post('/funnel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { steps, startDate, endDate } = req.body;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();

    const funnel = await analyticsEngine.getFunnel(steps || [], start, end);
    res.json({ funnel, period: { start: start.toISOString(), end: end.toISOString() } });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/journey/:userId
 * Get user journey analysis
 * Access: Admin
 */
router.get('/journey/:userId', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;
    const journey = await analyticsEngine.getUserJourney(
      userId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined,
    );
    res.json(journey);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// COHORT ANALYSIS
// ============================================================================

/**
 * GET /api/analytics/cohorts
 * Get cohort retention analysis
 * Access: Admin
 */
router.get('/cohorts', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { period = 'month', periods = 12 } = req.query;
    const cohorts = await analyticsEngine.getCohortAnalysis(
      period as 'week' | 'month',
      parseInt(periods as string),
    );
    res.json({ cohorts, period, periods });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// CONTENT PERFORMANCE
// ============================================================================

/**
 * GET /api/analytics/content/top
 * Get top performing content
 * Access: Authenticated users
 */
router.get('/content/top', requireAuth, async (req: Request, res: Response) => {
  try {
    const { metric = 'reaction.like', period = 'weekly', limit = 20 } = req.query;
    const { start, end } = getPeriodRange(period as string);
    const topContent = await analyticsEngine.getTopContent(metric as string, start, end, parseInt(limit as string));
    res.json({ topContent, metric, period });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// TRAFFIC SOURCES
// ============================================================================

/**
 * GET /api/analytics/traffic-sources
 * Get traffic source breakdown
 * Access: Admin
 */
router.get('/traffic-sources', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { period = 'weekly' } = req.query;
    const { start, end } = getPeriodRange(period as string);
    const sources = await analyticsEngine.getTrafficSources(start, end);
    res.json({
      sources,
      total: Object.values(sources).reduce((sum, v) => sum + v, 0),
      period,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// DEMOGRAPHICS
// ============================================================================

/**
 * GET /api/analytics/demographics
 * Get audience demographics
 * Access: Admin, Creator
 */
router.get('/demographics', requireAuth, async (req: Request, res: Response) => {
  try {
    const { period = 'weekly' } = req.query;
    const { start, end } = getPeriodRange(period as string);
    const demographics = await analyticsEngine.getAudienceDemographics(start, end);
    res.json({ demographics, period });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// PREDICTIVE ANALYTICS
// ============================================================================

/**
 * GET /api/analytics/predictions/:metric
 * Get predictions for a specific metric
 * Access: Admin
 */
router.get('/predictions/:metric', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { metric } = req.params;
    const { period = 'monthly' } = req.query;
    const predictions = await analyticsEngine.getPredictions(metric, period as any);
    res.json(predictions);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// DATA EXPORTS
// ============================================================================

/**
 * GET /api/analytics/export/:metric
 * Export metric data as JSON (extensible to CSV/Excel)
 * Access: Authenticated users
 */
router.get('/export/:metric', requireAuth, async (req: Request, res: Response) => {
  try {
    const { metric } = req.params;
    const { period = 'daily', format = 'json', startDate, endDate } = req.query;

    const data = await analyticsEngine.getMetric(metric, {
      metric,
      period: period as any,
      startDate: startDate as string,
      endDate: endDate as string,
      granularity: 'day',
    });

    if (format === 'csv') {
      // Convert to CSV
      const csvRows = ['timestamp,value'];
      if (data.data) {
        for (const point of data.data) {
          csvRows.push(`${point.timestamp},${point.value}`);
        }
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${metric}-${period}.csv"`);
      return res.send(csvRows.join('\n'));
    }

    res.json(data);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// SEARCH ANALYTICS
// ============================================================================

/**
 * GET /api/analytics/search/trending
 * Get trending searches
 * Access: Authenticated users
 */
router.get('/search/trending', requireAuth, async (req: Request, res: Response) => {
  try {
    const { limit = 20 } = req.query;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const topSearches = await analyticsEngine.getTopContent('search.query', weekAgo, now, parseInt(limit as string));
    res.json({ trending: topSearches, period: 'weekly' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// HELPERS
// ============================================================================

function getPeriodRange(period: string): { start: Date; end: Date } {
  const end = new Date();
  let start: Date;
  switch (period) {
    case 'daily':
      start = new Date(end.getTime() - 86400000);
      break;
    case 'weekly':
      start = new Date(end.getTime() - 7 * 86400000);
      break;
    case 'monthly':
      start = new Date(end.getFullYear(), end.getMonth(), 1);
      break;
    case 'quarterly':
      start = new Date(end.getTime() - 90 * 86400000);
      break;
    case 'yearly':
      start = new Date(end.getFullYear(), 0, 1);
      break;
    default:
      start = new Date(end.getTime() - 7 * 86400000);
  }
  return { start, end };
}

export { router as analyticsRouter };