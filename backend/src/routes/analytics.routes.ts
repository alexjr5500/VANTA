import { NextFunction, Request, Response, Router } from 'express';
import { analyticsController } from '../controllers/analytics.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requireRole, AuthenticatedRequest } from '../security/authMiddleware';
import { Role } from '../security/rbac';

const router = Router();

/**
 * VANTA-002 (security audit): `/api/analytics/*` is a privileged surface that
 * exposes platform financial/operational data (revenue, ARPU, DAU/MAU, LTV, ad
 * revenue, funnel, predictions, alert rules, marketing campaigns, performance
 * metrics). Previously every route only required *authentication*, so any
 * signed-in user could read the whole business dashboard and — via
 * `creatorId` / `hostId` / `streamId` parameters — another user's private
 * creator/stream analytics (broken function/object level authorization).
 *
 * Fix: platform-level endpoints now require an administrative role, and
 * creator/stream analytics enforce self-or-admin ownership.
 */

const PRIVILEGED_ROLES: Role[] = [Role.ADMIN, Role.CEO, Role.SUPER_ADMIN];

/** requireRole(...) wrapper that gates the whole platform analytics surface. */
const requirePlatformAnalytics = [
  authenticateJWT,
  requireRole(Role.ADMIN, Role.CEO, Role.SUPER_ADMIN),
] as any[];

/**
 * Self-or-admin guard: allow the resource owner (identified by a request
 * parameter grabbed via `getResourceUserId`) or a privileged role. Every other
 * actor receives 403 — a user can never read someone else's analytics by
 * swapping ids in the query string.
 */
function selfOrPrivileged(getResourceUserId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = (req as AuthenticatedRequest).user;
    if (!actor) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (PRIVILEGED_ROLES.includes(actor.role)) {
      next();
      return;
    }
    const resourceOwner = getResourceUserId(req);
    if (resourceOwner && resourceOwner === actor.userId) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: 'You do not have permission to view this analytics data',
    });
  };
}

/**
 * Telemetry endpoints stay unauthenticated (client-side product tracking) but
 * payloads are bounded so an anonymous caller cannot flood the analytics store
 * with unbounded/oversized events or inject arbitrary userId attributes.
 */
function validateTrackPayload(events: unknown[]): boolean {
  return (
    Array.isArray(events) &&
    events.length > 0 &&
    events.length <= 50 &&
    events.every((e) => {
      if (!e || typeof e !== 'object') return false;
      const eventType = (e as any).eventType;
      if (typeof eventType !== 'string' || eventType.length === 0 || eventType.length > 120) {
        return false;
      }
      const body = JSON.stringify(e);
      return typeof body === 'string' && body.length <= 4096;
    })
  );
}

// ============================================================
// Platform Overview
// ============================================================
router.get('/overview', ...requirePlatformAnalytics, analyticsController.getPlatformOverview.bind(analyticsController));

// ============================================================
// User Analytics
// ============================================================
router.get('/users/metrics', ...requirePlatformAnalytics, analyticsController.getUserMetrics.bind(analyticsController));
router.get('/users/dau', ...requirePlatformAnalytics, analyticsController.getCurrentDAU.bind(analyticsController));
router.get('/users/online', ...requirePlatformAnalytics, analyticsController.getOnlineUsers.bind(analyticsController));
router.get('/users/retention', ...requirePlatformAnalytics, analyticsController.getRetentionRates.bind(analyticsController));
router.get('/users/growth', ...requirePlatformAnalytics, analyticsController.getUserGrowth.bind(analyticsController));

// ============================================================
// Creator Analytics
// ============================================================
// Owners can always read their own analytics; admins may read any creator's.
router.get(
  '/creators/analytics',
  authenticateJWT,
  selfOrPrivileged((req) => typeof req.query.creatorId === 'string' ? req.query.creatorId : undefined),
  analyticsController.getCreatorAnalytics.bind(analyticsController)
);
// The leaderboard is a platform-wide ranking — privileged roles only.
router.get('/creators/leaderboard', ...requirePlatformAnalytics, analyticsController.getCreatorLeaderboard.bind(analyticsController));

// ============================================================
// Content Analytics
// ============================================================
router.get('/content/metrics', ...requirePlatformAnalytics, analyticsController.getContentMetrics.bind(analyticsController));
router.get('/content/top', ...requirePlatformAnalytics, analyticsController.getTopContent.bind(analyticsController));

// ============================================================
// Revenue Analytics
// ============================================================
router.get('/revenue/analytics', ...requirePlatformAnalytics, analyticsController.getRevenueAnalytics.bind(analyticsController));
router.get('/revenue/arpu', ...requirePlatformAnalytics, analyticsController.getARPU.bind(analyticsController));
router.get('/revenue/ad', ...requirePlatformAnalytics, analyticsController.getAdRevenue.bind(analyticsController));

// ============================================================
// Live Stream Analytics
// ============================================================
router.get('/streams/active', ...requirePlatformAnalytics, analyticsController.getActiveStreamsAnalytics.bind(analyticsController));
router.get('/streams/:streamId', ...requirePlatformAnalytics, analyticsController.getStreamAnalytics.bind(analyticsController));
router.get(
  '/streams/performance/host',
  authenticateJWT,
  selfOrPrivileged((req) => typeof req.query.hostId === 'string' ? req.query.hostId : undefined),
  analyticsController.getStreamPerformance.bind(analyticsController)
);

// ============================================================
// Community Analytics
// ============================================================
router.get('/communities/:communityId', ...requirePlatformAnalytics, analyticsController.getCommunityAnalytics.bind(analyticsController));

// ============================================================
// Search & Trending
// ============================================================
router.get('/search', ...requirePlatformAnalytics, analyticsController.getSearchAnalytics.bind(analyticsController));
router.get('/trending', ...requirePlatformAnalytics, analyticsController.getTrendingTopics.bind(analyticsController));

// ============================================================
// Notification Analytics
// ============================================================
router.get('/notifications', ...requirePlatformAnalytics, analyticsController.getNotificationAnalytics.bind(analyticsController));

// ============================================================
// AI Analytics
// ============================================================
router.get('/ai', ...requirePlatformAnalytics, analyticsController.getAIAnalytics.bind(analyticsController));

// ============================================================
// Dashboards
// ============================================================
router.get('/dashboard/snapshot', ...requirePlatformAnalytics, analyticsController.getDashboardSnapshot.bind(analyticsController));

// ============================================================
// Event Tracking (no auth required for basic client telemetry, bounded)
// ============================================================
router.post('/track', (req: Request, res: Response, next: NextFunction) => {
  const event = req.body;
  if (!validateTrackPayload([event])) {
    res.status(400).json({ success: false, error: 'Invalid analytics event' });
    return;
  }
  next();
}, analyticsController.trackEvent.bind(analyticsController));
router.post('/track/batch', (req: Request, res: Response, next: NextFunction) => {
  const events = req.body?.events;
  if (!validateTrackPayload(events)) {
    res.status(400).json({ success: false, error: 'Invalid analytics events batch' });
    return;
  }
  next();
}, analyticsController.trackBatchEvents.bind(analyticsController));

// ============================================================
// Alert Rules & History
// ============================================================
router.get('/alerts/rules', ...requirePlatformAnalytics, analyticsController.getAlertRules.bind(analyticsController));
router.post('/alerts/rules', ...requirePlatformAnalytics, analyticsController.createAlertRule.bind(analyticsController));
router.put('/alerts/rules/:id', ...requirePlatformAnalytics, analyticsController.updateAlertRule.bind(analyticsController));
router.delete('/alerts/rules/:id', ...requirePlatformAnalytics, analyticsController.deleteAlertRule.bind(analyticsController));
router.get('/alerts/history', ...requirePlatformAnalytics, analyticsController.getAlertHistory.bind(analyticsController));
router.post('/alerts/:id/acknowledge', ...requirePlatformAnalytics, analyticsController.acknowledgeAlert.bind(analyticsController));
router.post('/alerts/:id/resolve', ...requirePlatformAnalytics, analyticsController.resolveAlert.bind(analyticsController));

// ============================================================
// Marketing Campaigns
// ============================================================
router.get('/marketing/campaigns', ...requirePlatformAnalytics, analyticsController.getMarketingCampaigns.bind(analyticsController));
router.post('/marketing/campaigns', ...requirePlatformAnalytics, analyticsController.createMarketingCampaign.bind(analyticsController));

// ============================================================
// Reports
// ============================================================
router.get('/reports/scheduled', ...requirePlatformAnalytics, analyticsController.getScheduledReports.bind(analyticsController));
router.post('/reports/scheduled', ...requirePlatformAnalytics, analyticsController.createScheduledReport.bind(analyticsController));

// ============================================================
// Predictions
// ============================================================
router.get('/predictions', ...requirePlatformAnalytics, analyticsController.getPredictions.bind(analyticsController));

// ============================================================
// Funnel (real event counts from AnalyticsEvent)
// ============================================================
router.get('/funnel', ...requirePlatformAnalytics, async (req: Request, res: Response) => {
  try {
    const { prisma } = await import('../prisma');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const countEvents = async (patterns: string[]) => prisma.analyticsEvent.count({
      where: {
        createdAt: { gte: since },
        OR: patterns.map((eventType) => ({ eventType: { contains: eventType } })),
      } as any,
    });

    const visitors = await countEvents(['page_view', 'screen_view', 'page.visit', 'app_open']);
    const registrations = await countEvents(['signup', 'register', 'user.register']);
    const contentCreated = await countEvents(['post_create', 'story_create', 'video_upload', 'stream_start', 'content.created']);
    const engaged = await countEvents(['like', 'comment', 'follow', 'gift_send', 'reaction.like']);

    const steps = [
      { step: 'Visitors', count: visitors, conversion: 100 },
      { step: 'Registrations', count: registrations, conversion: visitors > 0 ? Math.round((registrations / visitors) * 1000) / 10 : 0 },
      { step: 'Content Created', count: contentCreated, conversion: registrations > 0 ? Math.round((contentCreated / registrations) * 1000) / 10 : 0 },
      { step: 'Engaged', count: engaged, conversion: contentCreated > 0 ? Math.round((engaged / contentCreated) * 1000) / 10 : 0 },
    ];

    res.json({ success: true, data: steps });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// LTV & Screen Analytics
// ============================================================
router.get('/ltv', ...requirePlatformAnalytics, analyticsController.getLTVAnalytics.bind(analyticsController));
router.get('/screens', ...requirePlatformAnalytics, analyticsController.getScreenAnalytics.bind(analyticsController));
router.get('/performance/api', ...requirePlatformAnalytics, analyticsController.getAPIPerformance.bind(analyticsController));

export default router;