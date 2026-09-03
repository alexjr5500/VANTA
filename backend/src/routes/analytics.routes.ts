import { Router } from 'express';
import { analyticsController } from '../controllers/analytics.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// ============================================================
// Platform Overview
// ============================================================
router.get('/overview', authenticateJWT, analyticsController.getPlatformOverview.bind(analyticsController));

// ============================================================
// User Analytics
// ============================================================
router.get('/users/metrics', authenticateJWT, analyticsController.getUserMetrics.bind(analyticsController));
router.get('/users/dau', authenticateJWT, analyticsController.getCurrentDAU.bind(analyticsController));
router.get('/users/online', authenticateJWT, analyticsController.getOnlineUsers.bind(analyticsController));
router.get('/users/retention', authenticateJWT, analyticsController.getRetentionRates.bind(analyticsController));
router.get('/users/growth', authenticateJWT, analyticsController.getUserGrowth.bind(analyticsController));

// ============================================================
// Creator Analytics
// ============================================================
router.get('/creators/analytics', authenticateJWT, analyticsController.getCreatorAnalytics.bind(analyticsController));
router.get('/creators/leaderboard', authenticateJWT, analyticsController.getCreatorLeaderboard.bind(analyticsController));

// ============================================================
// Content Analytics
// ============================================================
router.get('/content/metrics', authenticateJWT, analyticsController.getContentMetrics.bind(analyticsController));
router.get('/content/top', authenticateJWT, analyticsController.getTopContent.bind(analyticsController));

// ============================================================
// Revenue Analytics
// ============================================================
router.get('/revenue/analytics', authenticateJWT, analyticsController.getRevenueAnalytics.bind(analyticsController));
router.get('/revenue/arpu', authenticateJWT, analyticsController.getARPU.bind(analyticsController));
router.get('/revenue/ad', authenticateJWT, analyticsController.getAdRevenue.bind(analyticsController));

// ============================================================
// Live Stream Analytics
// ============================================================
router.get('/streams/active', authenticateJWT, analyticsController.getActiveStreamsAnalytics.bind(analyticsController));
router.get('/streams/:streamId', authenticateJWT, analyticsController.getStreamAnalytics.bind(analyticsController));
router.get('/streams/performance/host', authenticateJWT, analyticsController.getStreamPerformance.bind(analyticsController));

// ============================================================
// Community Analytics
// ============================================================
router.get('/communities/:communityId', authenticateJWT, analyticsController.getCommunityAnalytics.bind(analyticsController));

// ============================================================
// Search & Trending
// ============================================================
router.get('/search', authenticateJWT, analyticsController.getSearchAnalytics.bind(analyticsController));
router.get('/trending', authenticateJWT, analyticsController.getTrendingTopics.bind(analyticsController));

// ============================================================
// Notification Analytics
// ============================================================
router.get('/notifications', authenticateJWT, analyticsController.getNotificationAnalytics.bind(analyticsController));

// ============================================================
// AI Analytics
// ============================================================
router.get('/ai', authenticateJWT, analyticsController.getAIAnalytics.bind(analyticsController));

// ============================================================
// Dashboards
// ============================================================
router.get('/dashboard/snapshot', authenticateJWT, analyticsController.getDashboardSnapshot.bind(analyticsController));

// ============================================================
// Event Tracking (no auth required for basic tracking)
// ============================================================
router.post('/track', analyticsController.trackEvent.bind(analyticsController));
router.post('/track/batch', analyticsController.trackBatchEvents.bind(analyticsController));

// ============================================================
// Alert Rules & History
// ============================================================
router.get('/alerts/rules', authenticateJWT, analyticsController.getAlertRules.bind(analyticsController));
router.post('/alerts/rules', authenticateJWT, analyticsController.createAlertRule.bind(analyticsController));
router.put('/alerts/rules/:id', authenticateJWT, analyticsController.updateAlertRule.bind(analyticsController));
router.delete('/alerts/rules/:id', authenticateJWT, analyticsController.deleteAlertRule.bind(analyticsController));
router.get('/alerts/history', authenticateJWT, analyticsController.getAlertHistory.bind(analyticsController));
router.post('/alerts/:id/acknowledge', authenticateJWT, analyticsController.acknowledgeAlert.bind(analyticsController));
router.post('/alerts/:id/resolve', authenticateJWT, analyticsController.resolveAlert.bind(analyticsController));

// ============================================================
// Marketing Campaigns
// ============================================================
router.get('/marketing/campaigns', authenticateJWT, analyticsController.getMarketingCampaigns.bind(analyticsController));
router.post('/marketing/campaigns', authenticateJWT, analyticsController.createMarketingCampaign.bind(analyticsController));

// ============================================================
// Reports
// ============================================================
router.get('/reports/scheduled', authenticateJWT, analyticsController.getScheduledReports.bind(analyticsController));
router.post('/reports/scheduled', authenticateJWT, analyticsController.createScheduledReport.bind(analyticsController));

// ============================================================
// Predictions
// ============================================================
router.get('/predictions', authenticateJWT, analyticsController.getPredictions.bind(analyticsController));

// ============================================================
// LTV & Screen Analytics
// ============================================================
router.get('/ltv', authenticateJWT, analyticsController.getLTVAnalytics.bind(analyticsController));
router.get('/screens', authenticateJWT, analyticsController.getScreenAnalytics.bind(analyticsController));
router.get('/performance/api', authenticateJWT, analyticsController.getAPIPerformance.bind(analyticsController));

export default router;