import { prisma } from "../prisma";

export class AdService {
  // ============================================================
  // CAMPAIGN MANAGEMENT
  // ============================================================

  async createCampaign(data: {
    name: string;
    description?: string;
    mediaUrl: string;
    mediaType?: string;
    ctaText?: string;
    ctaUrl?: string;
    ctaInternal?: string;
    targetCountry?: string;
    priority?: number;
    startDate: Date;
    endDate?: Date;
    maxImpressions?: number;
    maxClicks?: number;
    createdBy: string;
  }) {
    const campaign = await prisma.adCampaign.create({
      data: {
        name: data.name,
        description: data.description,
        mediaUrl: data.mediaUrl,
        mediaType: data.mediaType || "IMAGE",
        ctaText: data.ctaText || "Learn More",
        ctaUrl: data.ctaUrl,
        ctaInternal: data.ctaInternal,
        targetCountry: data.targetCountry,
        priority: data.priority || 0,
        status: "ACTIVE",
        startDate: data.startDate,
        endDate: data.endDate,
        maxImpressions: data.maxImpressions,
        maxClicks: data.maxClicks,
        createdBy: data.createdBy,
      },
    });

    return campaign;
  }

  async updateCampaign(
    campaignId: string,
    data: {
      name?: string;
      description?: string;
      mediaUrl?: string;
      mediaType?: string;
      ctaText?: string;
      ctaUrl?: string;
      ctaInternal?: string;
      targetCountry?: string;
      priority?: number;
      startDate?: Date;
      endDate?: Date;
      maxImpressions?: number;
      maxClicks?: number;
      status?: string;
    }
  ) {
    const campaign = await prisma.adCampaign.update({
      where: { id: campaignId },
      data,
    });

    return campaign;
  }

  async deleteCampaign(campaignId: string) {
    // Soft delete - archive instead
    await prisma.adCampaign.update({
      where: { id: campaignId },
      data: { status: "ARCHIVED" },
    });

    return { success: true, message: "Campaign archived" };
  }

  async getCampaign(campaignId: string) {
    const campaign = await prisma.adCampaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: {
          select: { impressions: true, clicks: true },
        },
      },
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    return campaign;
  }

  async getCampaigns(options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: any = {};
    if (options.status) {
      where.status = options.status;
    }

    const [campaigns, total] = await Promise.all([
      prisma.adCampaign.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: options.limit || 50,
        skip: options.offset || 0,
        include: {
          _count: {
            select: { impressions: true, clicks: true },
          },
        },
      }),
      prisma.adCampaign.count({ where }),
    ]);

    return { campaigns, total };
  }

  async pauseCampaign(campaignId: string) {
    return prisma.adCampaign.update({
      where: { id: campaignId },
      data: { status: "PAUSED" },
    });
  }

  async resumeCampaign(campaignId: string) {
    return prisma.adCampaign.update({
      where: { id: campaignId },
      data: { status: "ACTIVE" },
    });
  }

  // ============================================================
  // AD DELIVERY
  // ============================================================

  async getActiveAds(userId?: string, country?: string, limit: number = 3) {
    const now = new Date();

    const where: any = {
      status: "ACTIVE",
      startDate: { lte: now },
      AND: [
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    };

    // Check max impressions/clicks
    // Only show ads that haven't exceeded their limits
    const campaigns = await prisma.adCampaign.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        _count: {
          select: { impressions: true, clicks: true },
        },
      },
    });

    // Filter out campaigns that have exceeded limits
    const validCampaigns = campaigns.filter((c) => {
      if (c.maxImpressions && c._count.impressions >= c.maxImpressions) return false;
      if (c.maxClicks && c._count.clicks >= c.maxClicks) return false;
      return true;
    });

    return validCampaigns;
  }

  // ============================================================
  // TRACKING
  // ============================================================

  async trackImpression(campaignId: string, userId?: string, ipAddress?: string, userAgent?: string) {
    const impression = await prisma.adImpression.create({
      data: {
        campaignId,
        userId,
        ipAddress,
        userAgent,
      },
    });

    return impression;
  }

  async trackClick(campaignId: string, userId?: string, ipAddress?: string, userAgent?: string) {
    const click = await prisma.adClick.create({
      data: {
        campaignId,
        userId,
        ipAddress,
        userAgent,
      },
    });

    return click;
  }

  // ============================================================
  // ANALYTICS
  // ============================================================

  async getCampaignAnalytics(campaignId: string) {
    const campaign = await prisma.adCampaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: {
          select: { impressions: true, clicks: true },
        },
      },
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    // Get daily breakdown
    const dailyStats = await prisma.$queryRaw`
      SELECT 
        DATE(createdAt) as date,
        COUNT(*) as count,
        'impression' as type
      FROM AdImpression
      WHERE campaignId = ${campaignId}
      GROUP BY DATE(createdAt)
      UNION ALL
      SELECT 
        DATE(createdAt) as date,
        COUNT(*) as count,
        'click' as type
      FROM AdClick
      WHERE campaignId = ${campaignId}
      GROUP BY DATE(createdAt)
      ORDER BY date DESC
      LIMIT 30
    `;

    return {
      campaign,
      totalImpressions: campaign._count.impressions,
      totalClicks: campaign._count.clicks,
      clickThroughRate: campaign._count.impressions > 0
        ? (campaign._count.clicks / campaign._count.impressions) * 100
        : 0,
      dailyStats,
    };
  }

  async getAllAdsAnalytics() {
    const [totalCampaigns, activeCampaigns, totalImpressions, totalClicks] =
      await Promise.all([
        prisma.adCampaign.count(),
        prisma.adCampaign.count({ where: { status: "ACTIVE" } }),
        prisma.adImpression.count(),
        prisma.adClick.count(),
      ]);

    // Top campaigns by impressions
    const topCampaigns = await prisma.adCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        _count: {
          select: { impressions: true, clicks: true },
        },
      },
    });

    return {
      totalCampaigns,
      activeCampaigns,
      totalImpressions,
      totalClicks,
      overallCTR: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      topCampaigns,
    };
  }
}

export const adService = new AdService();