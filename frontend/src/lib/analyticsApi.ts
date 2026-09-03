import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';

export interface AnalyticsOverview {
  totalUsers: number;
  dailyActiveUsers: number;
  onlineUsers: number;
  activeStreams: number;
  newUsersToday: number;
  revenueToday: number;
  revenueThisMonth: number;
  totalPosts: number;
  totalVideos: number;
  totalStreams: number;
  totalMessages: number;
  totalGifts: number;
}

export interface UserMetrics {
  date: string;
  value: number;
  previousValue?: number;
  changePercent?: number;
}

export interface RetentionRate {
  day: number;
  rate: number;
  total: number;
  returned: number;
}

export interface RevenueAnalytics {
  totalRevenue: number;
  purchaseRevenue: number;
  subscriptionRevenue: number;
  giftRevenue: number;
  totalPurchases: number;
  totalGifts: number;
  totalSubscriptions: number;
  revenueByDate: { date: string; value: number }[];
  dailyAverage: number;
}

export interface CreatorAnalytics {
  daily: any[];
  totals: {
    totalProfileViews: number;
    totalFollowersGained: number;
    totalFollowersLost: number;
    totalWatchTime: number;
    totalStreamDuration: number;
    totalEarnings: number;
    giftRevenue: number;
    subscriptionRevenue: number;
    totalStreams: number;
    totalVideos: number;
    totalPosts: number;
    totalStories: number;
  };
  followerCount: number;
  avgDailyEngagement: number;
}

export interface SearchAnalytics {
  totalSearches: number;
  zeroResultSearches: number;
  zeroResultRate: number;
  topQueries: { query: string; count: number }[];
}

export interface NotificationAnalytics {
  totalSent: number;
  totalDelivered: number;
  deliveryRate: number;
  totalOpened: number;
  openRate: number;
  totalClicked: number;
  clickRate: number;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  metricType: string;
  condition: string;
  threshold: number;
  severity: string;
  channels: string[];
  enabled: boolean;
  createdAt: string;
}

export interface MarketingCampaign {
  id: string;
  name: string;
  source: string;
  campaignType: string;
  budget?: number;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Prediction {
  id: string;
  predictionType: string;
  predictedValue: number;
  confidence: number;
  forecastDate: string;
  metadata?: any;
}

class AnalyticsAPI {
  private baseUrl = '/api/analytics';

  // ============================================================
  // Realtime Metrics
  // ============================================================

  async getRealtimeMetrics(): Promise<{
    onlineUsers: number;
    activeStreams: number;
    messagesPerMinute: number;
    giftsPerMinute: number;
  }> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/realtime`);
    return data.data.data;
  }

  // ============================================================
  // Dashboard
  // ============================================================

  async getDashboardExecutive(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/executive`);
    return data.data.data;
  }

  async getDashboardRevenue(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/revenue`);
    return data.data.data;
  }

  async getDashboardGrowth(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/growth`);
    return data.data.data;
  }

  async getDashboardOperations(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/operations`);
    return data.data.data;
  }

  async getDashboardCreator(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/creator`);
    return data.data.data;
  }

  async getDashboardProduct(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/product`);
    return data.data.data;
  }

  // ============================================================
  // Funnel
  // ============================================================

  async getFunnelSteps(): Promise<FunnelStep[]> {
    const data = await apiGet<{ data: { data: FunnelStep[] } }>(`${this.baseUrl}/funnel`);
    return data.data.data;
  }

  // ============================================================
  // Cohort
  // ============================================================

  async getCohortAnalysis(): Promise<CohortAnalysis[]> {
    const data = await apiGet<{ data: { data: CohortAnalysis[] } }>(`${this.baseUrl}/cohort`);
    return data.data.data;
  }

  // ============================================================
  // Predictive
  // ============================================================

  async getPredictiveForecast(): Promise<PredictiveForecast> {
    const data = await apiGet<{ data: { data: PredictiveForecast } }>(`${this.baseUrl}/predictive`);
    return data.data.data;
  }

  // ============================================================
  // Traffic Sources
  // ============================================================

  async getTrafficSources(): Promise<TrafficSources> {
    const data = await apiGet<{ data: { data: TrafficSources } }>(`${this.baseUrl}/traffic`);
    return data.data.data;
  }

  // ============================================================
  // Platform Overview
  // ============================================================

  async getOverview(): Promise<AnalyticsOverview> {
    const data = await apiGet<{ data: { data: AnalyticsOverview } }>(`${this.baseUrl}/overview`);
    return data.data.data;
  }

  // ============================================================
  // User Analytics
  // ============================================================

  async getUserMetrics(params?: {
    metric?: 'DAU' | 'WAU' | 'MAU';
    startDate?: string;
    endDate?: string;
  }): Promise<UserMetrics[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: UserMetrics[] } }>(`${this.baseUrl}/users/metrics${query}`);
    return data.data.data;
  }

  async getCurrentDAU(): Promise<number> {
    const data = await apiGet<{ data: { data: { dau: number } } }>(`${this.baseUrl}/users/dau`);
    return data.data.data.dau;
  }

  async getOnlineUsers(): Promise<number> {
    const data = await apiGet<{ data: { data: { online: number } } }>(`${this.baseUrl}/users/online`);
    return data.data.data.online;
  }

  async getRetentionRates(cohortDate?: string): Promise<RetentionRate[]> {
    const query = cohortDate ? `?cohortDate=${cohortDate}` : '';
    const data = await apiGet<{ data: { data: RetentionRate[] } }>(`${this.baseUrl}/users/retention${query}`);
    return data.data.data;
  }

  async getUserGrowth(params?: {
    period?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    startDate?: string;
    endDate?: string;
  }): Promise<UserMetrics[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: UserMetrics[] } }>(`${this.baseUrl}/users/growth${query}`);
    return data.data.data;
  }

  // ============================================================
  // Creator Analytics
  // ============================================================

  async getCreatorAnalytics(params: {
    creatorId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<CreatorAnalytics> {
    const query = `?${new URLSearchParams(params as any).toString()}`;
    const data = await apiGet<{ data: { data: CreatorAnalytics } }>(`${this.baseUrl}/creators/analytics${query}`);
    return data.data.data;
  }

  async getCreatorLeaderboard(params?: {
    metric?: 'earnings' | 'followers' | 'views' | 'streams';
    period?: string;
    limit?: number;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/creators/leaderboard${query}`);
    return data.data.data;
  }

  // ============================================================
  // Content Analytics
  // ============================================================

  async getContentMetrics(params?: {
    contentType?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ views: number; likes: number; comments: number; shares: number }> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/content/metrics${query}`);
    return data.data.data;
  }

  async getTopContent(params?: {
    contentType?: string;
    metric?: string;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/content/top${query}`);
    return data.data.data;
  }

  // ============================================================
  // Revenue Analytics
  // ============================================================

  async getRevenueAnalytics(params?: {
    period?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<RevenueAnalytics> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: RevenueAnalytics } }>(`${this.baseUrl}/revenue/analytics${query}`);
    return data.data.data;
  }

  async getARPU(period?: string): Promise<any[]> {
    const query = period ? `?period=${period}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/revenue/arpu${query}`);
    return data.data.data;
  }

  // ============================================================
  // Stream Analytics
  // ============================================================

  async getActiveStreams(): Promise<any[]> {
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/streams/active`);
    return data.data.data;
  }

  async getStreamAnalytics(streamId: string): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/streams/${streamId}`);
    return data.data.data;
  }

  async getStreamPerformance(params: {
    hostId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = `?${new URLSearchParams(params as any).toString()}`;
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/streams/performance/host${query}`);
    return data.data.data;
  }

  // ============================================================
  // Search & Trending
  // ============================================================

  async getSearchAnalytics(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<SearchAnalytics> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: SearchAnalytics } }>(`${this.baseUrl}/search${query}`);
    return data.data.data;
  }

  async getTrendingTopics(type?: string, limit?: number): Promise<any[]> {
    const params: any = {};
    if (type) params.type = type;
    if (limit) params.limit = limit;
    const query = Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/trending${query}`);
    return data.data.data;
  }

  // ============================================================
  // Notification Analytics
  // ============================================================

  async getNotificationAnalytics(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<NotificationAnalytics> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: NotificationAnalytics } }>(`${this.baseUrl}/notifications${query}`);
    return data.data.data;
  }

  // ============================================================
  // AI Analytics
  // ============================================================

  async getAIAnalytics(): Promise<any> {
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/ai`);
    return data.data.data;
  }

  // ============================================================
  // Dashboard Snapshots
  // ============================================================

  async getDashboardSnapshot(params?: {
    dashboardType?: string;
    period?: string;
    date?: string;
  }): Promise<any> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any } }>(`${this.baseUrl}/dashboard/snapshot${query}`);
    return data.data.data;
  }

  // ============================================================
  // Event Tracking
  // ============================================================

  async trackEvent(event: {
    eventType: string;
    userId?: string;
    sessionId?: string;
    metadata?: any;
    value?: number;
    duration?: number;
    path?: string;
    targetType?: string;
    targetId?: string;
    source?: string;
  }): Promise<void> {
    await apiPost(`${this.baseUrl}/track`, event);
  }

  async trackBatch(events: any[]): Promise<void> {
    await apiPost(`${this.baseUrl}/track/batch`, { events });
  }

  // ============================================================
  // Alert Rules
  // ============================================================

  async getAlertRules(): Promise<AlertRule[]> {
    const data = await apiGet<{ data: { data: AlertRule[] } }>(`${this.baseUrl}/alerts/rules`);
    return data.data.data;
  }

  async createAlertRule(rule: Partial<AlertRule>): Promise<AlertRule> {
    const data = await apiPost<{ data: { data: AlertRule } }>(`${this.baseUrl}/alerts/rules`, rule);
    return data.data.data;
  }

  async updateAlertRule(id: string, rule: Partial<AlertRule>): Promise<AlertRule> {
    const data = await apiPut<{ data: { data: AlertRule } }>(`${this.baseUrl}/alerts/rules/${id}`, rule);
    return data.data.data;
  }

  async deleteAlertRule(id: string): Promise<void> {
    await apiDelete(`${this.baseUrl}/alerts/rules/${id}`);
  }

  async getAlertHistory(params?: {
    status?: string;
    severity?: string;
    limit?: number;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/alerts/history${query}`);
    return data.data.data;
  }

  async acknowledgeAlert(id: string): Promise<void> {
    await apiPost(`${this.baseUrl}/alerts/${id}/acknowledge`, {});
  }

  async resolveAlert(id: string): Promise<void> {
    await apiPost(`${this.baseUrl}/alerts/${id}/resolve`, {});
  }

  // ============================================================
  // Marketing Campaigns
  // ============================================================

  async getMarketingCampaigns(): Promise<MarketingCampaign[]> {
    const data = await apiGet<{ data: { data: MarketingCampaign[] } }>(`${this.baseUrl}/marketing/campaigns`);
    return data.data.data;
  }

  async createMarketingCampaign(campaign: Partial<MarketingCampaign>): Promise<MarketingCampaign> {
    const data = await apiPost<{ data: { data: MarketingCampaign } }>(`${this.baseUrl}/marketing/campaigns`, campaign);
    return data.data.data;
  }

  // ============================================================
  // Predictions
  // ============================================================

  async getPredictions(params?: {
    predictionType?: string;
    period?: string;
  }): Promise<Prediction[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: Prediction[] } }>(`${this.baseUrl}/predictions${query}`);
    return data.data.data;
  }

  // ============================================================
  // LTV & Screen Analytics
  // ============================================================

  async getLTVAnalytics(params?: { tier?: string; limit?: number }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/ltv${query}`);
    return data.data.data;
  }

  async getScreenAnalytics(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/screens${query}`);
    return data.data.data;
  }

  async getAPIPerformance(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const data = await apiGet<{ data: { data: any[] } }>(`${this.baseUrl}/performance/api${query}`);
    return data.data.data;
  }
}

export const analyticsApi = new AnalyticsAPI();
export default AnalyticsAPI;

// Type exports for useAnalytics hook
export type FunnelStep = { step: string; count: number; conversion: number; name?: string; percentage?: number; dropOff?: number };
export type CohortAnalysis = { cohort: string; periods: Record<string, number>; retention?: number[]; size?: number };
export type PredictiveForecast = { 
  metric: string; 
  forecast: { date: string; value: number }[];
  predictions?: { date: string; value: number }[];
  confidence?: number;
  metadata?: { trend: string };
};
export type TopContentItem = { id: string; title: string; views: number; engagement: number; targetType?: string; count?: number; value?: number };
export type TrafficSources = { source: string; visitors: number; percentage: number; sources?: Record<string, number>; total?: number };
