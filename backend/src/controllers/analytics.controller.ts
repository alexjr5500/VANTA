import { Request, Response } from 'express';
import { analyticsService } from '../services/analytics.service';
import { analyticsEventsService } from '../services/analytics-events.service';
import { prisma } from '../prisma';

export class AnalyticsController {
  // ============================================================
  // Platform Overview
  // ============================================================

  async getPlatformOverview(req: Request, res: Response) {
    try {
      const overview = await analyticsService.getPlatformOverview();
      res.json({ success: true, data: overview });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // User Analytics
  // ============================================================

  async getUserMetrics(req: Request, res: Response) {
    try {
      const { metric, startDate, endDate } = req.query;
      const data = await analyticsService.getUserMetrics({
        metric: (metric as any) || 'DAU',
        startDate: new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date((endDate as string) || Date.now()),
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getCurrentDAU(req: Request, res: Response) {
    try {
      const dau = await analyticsService.getCurrentDAU();
      res.json({ success: true, data: { dau } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getOnlineUsers(req: Request, res: Response) {
    try {
      const online = await analyticsService.getOnlineUsers();
      res.json({ success: true, data: { online } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getRetentionRates(req: Request, res: Response) {
    try {
      const { cohortDate } = req.query;
      const data = await analyticsService.getRetentionRates({
        cohortDate: cohortDate ? new Date(cohortDate as string) : undefined,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getUserGrowth(req: Request, res: Response) {
    try {
      const { period, startDate, endDate } = req.query;
      const data = await analyticsService.getUserGrowth({
        period: (period as any) || 'DAILY',
        startDate: new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date((endDate as string) || Date.now()),
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Creator Analytics
  // ============================================================

  async getCreatorAnalytics(req: Request, res: Response) {
    try {
      const { creatorId, startDate, endDate } = req.query;
      if (!creatorId) return res.status(400).json({ success: false, error: 'creatorId required' });
      
      const data = await analyticsService.getCreatorAnalytics(
        creatorId as string,
        new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date((endDate as string) || Date.now())
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getCreatorLeaderboard(req: Request, res: Response) {
    try {
      const { metric, period, limit } = req.query;
      const data = await analyticsService.getCreatorLeaderboard({
        metric: (metric as any) || 'earnings',
        period: (period as any) || 'ALL_TIME',
        limit: limit ? parseInt(limit as string) : 20,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Content Analytics
  // ============================================================

  async getContentMetrics(req: Request, res: Response) {
    try {
      const { contentType, startDate, endDate } = req.query;
      const data = await analyticsService.getContentMetrics({
        contentType: contentType as any || undefined,
        startDate: new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date((endDate as string) || Date.now()),
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getTopContent(req: Request, res: Response) {
    try {
      const { contentType, metric, limit, startDate, endDate } = req.query;
      const data = await analyticsService.getTopContent({
        contentType: (contentType as string) || 'video',
        metric: (metric as any) || 'views',
        limit: limit ? parseInt(limit as string) : 20,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Revenue Analytics
  // ============================================================

  async getRevenueAnalytics(req: Request, res: Response) {
    try {
      const { period, startDate, endDate } = req.query;
      const data = await analyticsService.getRevenueAnalytics({
        period: (period as any) || 'MONTHLY',
        startDate: new Date((startDate as string) || Date.now() - 365 * 24 * 60 * 60 * 1000),
        endDate: new Date((endDate as string) || Date.now()),
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getARPU(req: Request, res: Response) {
    try {
      const { period } = req.query;
      const data = await analyticsService.getARPU((period as any) || 'MONTHLY');
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getAdRevenue(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      const data = await analyticsService.getAdRevenue(
        new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date((endDate as string) || Date.now())
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Live Stream Analytics
  // ============================================================

  async getStreamAnalytics(req: Request, res: Response) {
    try {
      const { streamId } = req.params;
      const data = await analyticsService.getStreamAnalytics(streamId);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getActiveStreamsAnalytics(req: Request, res: Response) {
    try {
      const data = await analyticsService.getActiveStreamsAnalytics();
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getStreamPerformance(req: Request, res: Response) {
    try {
      const { hostId, startDate, endDate } = req.query;
      if (!hostId) return res.status(400).json({ success: false, error: 'hostId required' });
      
      const data = await analyticsService.getStreamPerformance(
        hostId as string,
        new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date((endDate as string) || Date.now())
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Community Analytics
  // ============================================================

  async getCommunityAnalytics(req: Request, res: Response) {
    try {
      const { communityId } = req.params;
      const data = await analyticsService.getCommunityAnalytics(communityId);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Search Analytics
  // ============================================================

  async getSearchAnalytics(req: Request, res: Response) {
    try {
      const { startDate, endDate, limit } = req.query;
      const data = await analyticsService.getSearchAnalytics({
        startDate: new Date((startDate as string) || Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date((endDate as string) || Date.now()),
        limit: limit ? parseInt(limit as string) : 20,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Trending Topics
  // ============================================================

  async getTrendingTopics(req: Request, res: Response) {
    try {
      const { type, limit } = req.query;
      const data = await analyticsService.getTrendingTopics(
        type as string || undefined,
        limit ? parseInt(limit as string) : 20
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Notification Analytics
  // ============================================================

  async getNotificationAnalytics(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      const data = await analyticsService.getNotificationAnalytics({
        startDate: new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date((endDate as string) || Date.now()),
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // AI Analytics
  // ============================================================

  async getAIAnalytics(req: Request, res: Response) {
    try {
      const data = await analyticsService.getAIAnalytics();
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Dashboard Snapshots
  // ============================================================

  async getDashboardSnapshot(req: Request, res: Response) {
    try {
      const { dashboardType, period, date } = req.query;
      const data = await analyticsService.getDashboardSnapshot({
        dashboardType: (dashboardType as string) || 'EXECUTIVE',
        period: (period as string) || 'DAILY',
        date: new Date((date as string) || Date.now()),
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Event Tracking (Client-side)
  // ============================================================

  async trackEvent(req: Request, res: Response) {
    try {
      const event = req.body;
      await analyticsEventsService.track({
        ...event,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async trackBatchEvents(req: Request, res: Response) {
    try {
      const { events } = req.body;
      if (!Array.isArray(events)) {
        return res.status(400).json({ success: false, error: 'events must be an array' });
      }
      await analyticsEventsService.trackBatch(
        events.map((e: any) => ({
          ...e,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }))
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Alert Rules
  // ============================================================

  async getAlertRules(req: Request, res: Response) {
    try {
      const rules = await prisma.alertRule.findMany({
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: rules.map(r => ({ ...r, channels: JSON.parse(r.channels), recipients: r.recipients ? JSON.parse(r.recipients) : null })) });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createAlertRule(req: Request, res: Response) {
    try {
      const rule = await prisma.alertRule.create({
        data: {
          ...req.body,
          channels: JSON.stringify(req.body.channels),
          recipients: req.body.recipients ? JSON.stringify(req.body.recipients) : undefined,
          createdBy: (req as any).user?.id || 'system',
        },
      });
      res.json({ success: true, data: rule });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateAlertRule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data: any = { ...req.body };
      if (data.channels) data.channels = JSON.stringify(data.channels);
      if (data.recipients) data.recipients = JSON.stringify(data.recipients);
      
      const rule = await prisma.alertRule.update({
        where: { id },
        data,
      });
      res.json({ success: true, data: rule });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async deleteAlertRule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await prisma.alertRule.delete({ where: { id } });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getAlertHistory(req: Request, res: Response) {
    try {
      const { status, severity, limit } = req.query;
      const where: any = {};
      if (status) where.status = status;
      if (severity) where.severity = severity;

      const alerts = await prisma.alertEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit ? parseInt(limit as string) : 50,
      });
      res.json({ success: true, data: alerts });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async acknowledgeAlert(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const alert = await prisma.alertEvent.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedBy: (req as any).user?.id || 'system',
          acknowledgedAt: new Date(),
        },
      });
      res.json({ success: true, data: alert });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async resolveAlert(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const alert = await prisma.alertEvent.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
        },
      });
      res.json({ success: true, data: alert });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Marketing Campaigns
  // ============================================================

  async getMarketingCampaigns(req: Request, res: Response) {
    try {
      const campaigns = await prisma.marketingCampaign.findMany({
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: campaigns });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createMarketingCampaign(req: Request, res: Response) {
    try {
      const campaign = await prisma.marketingCampaign.create({
        data: {
          ...req.body,
          createdBy: (req as any).user?.id || 'system',
        },
      });
      res.json({ success: true, data: campaign });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Scheduled Reports
  // ============================================================

  async getScheduledReports(req: Request, res: Response) {
    try {
      const reports = await prisma.scheduledReport.findMany({
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: reports });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createScheduledReport(req: Request, res: Response) {
    try {
      const report = await prisma.scheduledReport.create({
        data: {
          ...req.body,
          recipients: JSON.stringify(req.body.recipients),
          filters: req.body.filters ? JSON.stringify(req.body.filters) : undefined,
          createdBy: (req as any).user?.id || 'system',
        },
      });
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Predictions
  // ============================================================

  async getPredictions(req: Request, res: Response) {
    try {
      const { predictionType, period } = req.query;
      const where: any = {};
      if (predictionType) where.predictionType = predictionType;
      if (period) where.period = period;

      const predictions = await prisma.prediction.findMany({
        where,
        orderBy: { forecastDate: 'asc' },
        take: 30,
      });
      res.json({ success: true, data: predictions });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // LTV Analytics
  // ============================================================

  async getLTVAnalytics(req: Request, res: Response) {
    try {
      const { tier, limit } = req.query;
      const where: any = {};
      if (tier) where.tier = tier;

      const data = await prisma.userLTV.findMany({
        where,
        orderBy: { totalRevenue: 'desc' },
        take: limit ? parseInt(limit as string) : 100,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Screen Analytics
  // ============================================================

  async getScreenAnalytics(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      const data = await prisma.screenAnalytics.findMany({
        where: {
          date: {
            gte: new Date((startDate as string) || Date.now() - 30 * 24 * 60 * 60 * 1000),
            lte: new Date((endDate as string) || Date.now()),
          },
        },
        orderBy: { views: 'desc' },
        take: 50,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ============================================================
  // Performance Analytics
  // ============================================================

  async getAPIPerformance(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      const data = await prisma.aPIPerformance.groupBy({
        by: ['endpoint'],
        where: {
          timestamp: {
            gte: new Date((startDate as string) || Date.now() - 24 * 60 * 60 * 1000),
            lte: new Date((endDate as string) || Date.now()),
          },
        },
        _avg: { responseTime: true },
        _count: { id: true },
        orderBy: { _avg: { responseTime: 'desc' } },
        take: 50,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

export const analyticsController = new AnalyticsController();