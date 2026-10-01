import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';

// ============================================================================
// Types (mirror the backend analytics payloads)
// ============================================================================

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

/**
 * Every /api/analytics endpoint responds `{ success: boolean, data: <payload> }`.
 * `unwrap` returns the payload so pages consume exactly one access level.
 */
export async function unwrap<T>(path: string): Promise<T> {
  const body = await apiGet<{ success: boolean; data: T }>(path);
  return (body as any).data;
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
    return unwrap<any>(`${this.baseUrl}/realtime`);
  }

  // ============================================================
  // Dashboards
  // ============================================================

  async getDashboardExecutive(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/dashboard/executive`);
  }

  async getDashboardRevenue(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/dashboard/revenue`);
  }

  async getDashboardGrowth(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/dashboard/growth`);
  }

  async getDashboardOperations(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/dashboard/operations`);
  }

  async getDashboardCreator(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/dashboard/creator`);
  }

  async getDashboardProduct(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/dashboard/product`);
  }

  // ============================================================
  // Funnel
  // ============================================================

  async getFunnelSteps(): Promise<FunnelStep[]> {
    return unwrap<FunnelStep[]>(`${this.baseUrl}/funnel`);
  }

  // ============================================================
  // Cohort Analysis
  // ============================================================

  async getCohortAnalysis(): Promise<CohortAnalysis[]> {
    const body = await apiGet<{ data: { cohorts: CohortAnalysis[] } }>(`${this.baseUrl}/cohorts`);
    const payload = body?.data;
    return payload && Array.isArray(payload.cohorts) ? payload.cohorts : [];
  }

  // ============================================================
  // Predictive
  // ============================================================

  async getPredictiveForecast(metric = 'dau'): Promise<PredictiveForecast> {
    return unwrap<PredictiveForecast>(`${this.baseUrl}/predictions/${metric}`);
  }

  // ============================================================
  // Traffic Sources
  // ============================================================

  async getTrafficSources(): Promise<TrafficSources> {
    return unwrap<TrafficSources>(`${this.baseUrl}/traffic-sources`);
  }
// ============================================================
  // Platform Overview & User Analytics
  // ============================================================

  async getOverview(): Promise<AnalyticsOverview> {
    return unwrap<AnalyticsOverview>(`${this.baseUrl}/overview`);
  }

  async getUserMetrics(params?: {
    metric?: 'DAU' | 'WAU' | 'MAU';
    startDate?: string;
    endDate?: string;
  }): Promise<UserMetrics[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<UserMetrics[]>(`${this.baseUrl}/users/metrics${query}`);
  }

  async getCurrentDAU(): Promise<number> {
    const body = await apiGet<{ data: { dau: number } }>(`${this.baseUrl}/users/dau`);
    return body?.data?.dau ?? 0;
  }

  async getOnlineUsers(): Promise<number> {
    const body = await apiGet<{ data: { online: number } }>(`${this.baseUrl}/users/online`);
    return body?.data?.online ?? 0;
  }

  async getRetentionRates(cohortDate?: string): Promise<RetentionRate[]> {
    const query = cohortDate ? `?cohortDate=${cohortDate}` : '';
    return unwrap<RetentionRate[]>(`${this.baseUrl}/users/retention${query}`);
  }

  async getUserGrowth(params?: {
    period?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    startDate?: string;
    endDate?: string;
  }): Promise<UserMetrics[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<UserMetrics[]>(`${this.baseUrl}/users/growth${query}`);
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
    return unwrap<CreatorAnalytics>(`${this.baseUrl}/creators/analytics${query}`);
  }

  async getCreatorLeaderboard(params?: {
    metric?: 'earnings' | 'followers' | 'views' | 'streams';
    period?: string;
    limit?: number;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<any[]>(`${this.baseUrl}/creators/leaderboard${query}`);
  }

  // ============================================================
  // Content Analytics
  // ============================================================

  async getContentMetrics(params?: {
    contentType?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<any>(`${this.baseUrl}/content/metrics${query}`);
  }

  async getTopContent(params?: {
    contentType?: string;
    metric?: string;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<TopContentItem[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    const body = await apiGet<{ data: any }>(`${this.baseUrl}/content/top${query}`);
    const payload = body?.data;
    if (Array.isArray(payload)) return payload as TopContentItem[];
    return payload && Array.isArray(payload.topContent) ? payload.topContent : [];
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
    return unwrap<RevenueAnalytics>(`${this.baseUrl}/revenue/analytics${query}`);
  }

  async getARPU(period?: string): Promise<any[]> {
    const query = period ? `?period=${period}` : '';
    return unwrap<any[]>(`${this.baseUrl}/revenue/arpu${query}`);
  }

  // ============================================================
  // Stream Analytics
  // ============================================================

  async getActiveStreams(): Promise<any[]> {
    return unwrap<any[]>(`${this.baseUrl}/streams/active`);
  }

  async getStreamAnalytics(streamId: string): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/streams/${streamId}`);
  }

  async getStreamPerformance(params: {
    hostId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = `?${new URLSearchParams(params as any).toString()}`;
    return unwrap<any[]>(`${this.baseUrl}/streams/performance/host${query}`);
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
    return unwrap<SearchAnalytics>(`${this.baseUrl}/search${query}`);
  }

  async getTrendingTopics(type?: string, limit?: number): Promise<any[]> {
    const params: any = {};
    if (type) params.type = type;
    if (limit) params.limit = limit;
    const query = Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
    return unwrap<any[]>(`${this.baseUrl}/trending${query}`);
  }

  // ============================================================
  // Notification Analytics
  // ============================================================

  async getNotificationAnalytics(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<NotificationAnalytics> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<NotificationAnalytics>(`${this.baseUrl}/notifications${query}`);
  }

  // ============================================================
  // AI Analytics
  // ============================================================

  async getAIAnalytics(): Promise<any> {
    return unwrap<any>(`${this.baseUrl}/ai`);
  }

  // ============================================================
  // Dashboard Snapshot
  // ============================================================

  async getDashboardSnapshot(params?: {
    dashboardType?: string;
    period?: string;
    date?: string;
  }): Promise<any> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<any>(`${this.baseUrl}/dashboard/snapshot${query}`);
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
    return unwrap<AlertRule[]>(`${this.baseUrl}/alerts/rules`);
  }

  async createAlertRule(rule: Partial<AlertRule>): Promise<AlertRule> {
    const body = await apiPost<{ data: AlertRule }>(`${this.baseUrl}/alerts/rules`, rule);
    return (body as any).data;
  }

  async updateAlertRule(id: string, rule: Partial<AlertRule>): Promise<AlertRule> {
    const body = await apiPut<{ data: AlertRule }>(`${this.baseUrl}/alerts/rules/${id}`, rule);
    return (body as any).data;
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
    return unwrap<any[]>(`${this.baseUrl}/alerts/history${query}`);
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
    return unwrap<MarketingCampaign[]>(`${this.baseUrl}/marketing/campaigns`);
  }

  async createMarketingCampaign(campaign: Partial<MarketingCampaign>): Promise<MarketingCampaign> {
    const body = await apiPost<{ data: MarketingCampaign }>(`${this.baseUrl}/marketing/campaigns`, campaign);
    return (body as any).data;
  }

  // ============================================================
  // Predictions
  // ============================================================

  async getPredictions(params?: {
    predictionType?: string;
    period?: string;
  }): Promise<Prediction[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<Prediction[]>(`${this.baseUrl}/predictions${query}`);
  }

  // ============================================================
  // LTV & Screen Analytics
  // ============================================================

  async getLTVAnalytics(params?: { tier?: string; limit?: number }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<any[]>(`${this.baseUrl}/ltv${query}`);
  }

  async getScreenAnalytics(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<any[]>(`${this.baseUrl}/screens${query}`);
  }

  async getAPIPerformance(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return unwrap<any[]>(`${this.baseUrl}/performance/api${query}`);
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