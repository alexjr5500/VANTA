// ============================================================================
// VANTA Analytics - Type Definitions
// ============================================================================

export type AnalyticsPeriod = 'realtime' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type AnalyticsMetricType = 'counter' | 'gauge' | 'duration' | 'rate' | 'percentage' | 'revenue' | 'count';

export interface AnalyticsEvent {
  id?: string;
  eventType: string;
  userId?: string;
  sessionId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, any>;
  value?: number;
  timestamp?: Date | string;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
  source?: string; // 'web', 'mobile', 'electron', 'api'
}

export interface AnalyticsQuery {
  metric: string;
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  granularity?: 'hour' | 'day' | 'week' | 'month';
  groupBy?: string;
  filters?: Record<string, any>;
  limit?: number;
  offset?: number;
}

export interface AnalyticsMetric {
  name: string;
  displayName: string;
  description: string;
  type: AnalyticsMetricType;
  category: AnalyticsCategory;
  unit?: string;
  aggregation?: 'sum' | 'avg' | 'count' | 'distinct' | 'max' | 'min';
}

export type AnalyticsCategory =
  | 'user'
  | 'content'
  | 'creator'
  | 'live_stream'
  | 'community'
  | 'revenue'
  | 'marketing'
  | 'notification'
  | 'search'
  | 'ai'
  | 'performance'
  | 'engagement'
  | 'growth'
  | 'moderation';

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  label?: string;
  group?: string;
}

export interface AnalyticsReport {
  id: string;
  name: string;
  type: 'pdf' | 'csv' | 'excel';
  category: AnalyticsCategory;
  period: AnalyticsPeriod;
  startDate: string;
  endDate: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  fileUrl?: string;
  fileSize?: number;
  createdAt: string;
  completedAt?: string;
  config: ReportConfig;
}

export interface ReportConfig {
  metrics: string[];
  charts?: boolean;
  summary?: boolean;
  comparisons?: boolean;
  includeRawData?: boolean;
  sections: ReportSection[];
}

export interface ReportSection {
  title: string;
  metrics: string[];
  visualization?: 'line' | 'bar' | 'pie' | 'table' | 'area';
}

export interface DashboardConfig {
  id: string;
  userId: string;
  name: string;
  type: 'executive' | 'revenue' | 'growth' | 'operations' | 'creator' | 'product' | 'custom';
  widgets: WidgetConfig[];
  layout: Record<string, any>;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetConfig {
  id: string;
  type: 'chart' | 'metric' | 'table' | 'list' | 'map' | 'funnel' | 'heatmap';
  title: string;
  metric: string;
  visualization: 'line' | 'bar' | 'pie' | 'area' | 'doughnut' | 'radar' | 'polar' | 'table' | 'number';
  period: AnalyticsPeriod;
  size: 'small' | 'medium' | 'large' | 'full';
  position: { x: number; y: number; w: number; h: number };
  filters?: Record<string, any>;
  comparison?: { enabled: boolean; period: AnalyticsPeriod };
  refreshInterval?: number; // ms
}

export interface AlertConfig {
  id: string;
  name: string;
  metric: string;
  condition: 'gt' | 'lt' | 'gte' | 'lte' | 'change_gt' | 'change_lt';
  threshold: number;
  duration: number; // ms
  cooldown: number; // ms
  severity: 'info' | 'warning' | 'critical';
  channels: ('email' | 'push' | 'webhook' | 'sms')[];
  enabled: boolean;
  notifyRoles: string[];
  metadata?: Record<string, any>;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PredictiveForecast {
  metric: string;
  period: AnalyticsPeriod;
  predictions: TimeSeriesPoint[];
  confidence: number;
  modelVersion: string;
  generatedAt: string;
  metadata: {
    trend: 'up' | 'down' | 'stable';
    seasonality?: number;
    accuracy?: number;
    factors: string[];
  };
}

export interface FunnelStep {
  name: string;
  metric: string;
  count: number;
  percentage: number;
  dropOff: number;
}

export interface CohortAnalysis {
  cohort: string;
  period: string;
  retention: number[];
  size: number;
}

export interface UserJourney {
  userId: string;
  steps: { action: string; timestamp: string; page: string; duration: number }[];
  totalDuration: number;
  path: string[];
}

// Metric definitions registry
export const METRIC_DEFINITIONS: Record<string, AnalyticsMetric> = {
  // User Analytics
  'dau': { name: 'dau', displayName: 'Daily Active Users', description: 'Unique active users per day', type: 'counter', category: 'user', unit: 'users', aggregation: 'distinct' },
  'wau': { name: 'wau', displayName: 'Weekly Active Users', description: 'Unique active users per week', type: 'counter', category: 'user', unit: 'users', aggregation: 'distinct' },
  'mau': { name: 'mau', displayName: 'Monthly Active Users', description: 'Unique active users per month', type: 'counter', category: 'user', unit: 'users', aggregation: 'distinct' },
  'new_registrations': { name: 'new_registrations', displayName: 'New Registrations', description: 'New user registrations', type: 'counter', category: 'user', unit: 'users', aggregation: 'count' },
  'returning_users': { name: 'returning_users', displayName: 'Returning Users', description: 'Users who returned after registration', type: 'counter', category: 'user', unit: 'users', aggregation: 'distinct' },
  'user_retention': { name: 'user_retention', displayName: 'User Retention', description: 'Percentage of users retained', type: 'percentage', category: 'user', unit: '%', aggregation: 'avg' },
  'user_churn': { name: 'user_churn', displayName: 'User Churn', description: 'Percentage of users churned', type: 'percentage', category: 'user', unit: '%', aggregation: 'avg' },
  'session_duration': { name: 'session_duration', displayName: 'Session Duration', description: 'Average session duration', type: 'duration', category: 'user', unit: 'minutes', aggregation: 'avg' },
  'screen_time': { name: 'screen_time', displayName: 'Screen Time', description: 'Total screen time', type: 'duration', category: 'user', unit: 'minutes', aggregation: 'sum' },
  'user_growth': { name: 'user_growth', displayName: 'User Growth', description: 'Net user growth rate', type: 'percentage', category: 'user', unit: '%', aggregation: 'avg' },
  'ltv': { name: 'ltv', displayName: 'Lifetime Value', description: 'Average user lifetime value', type: 'revenue', category: 'user', unit: 'USD', aggregation: 'avg' },

  // Content Analytics
  'posts_created': { name: 'posts_created', displayName: 'Posts Created', description: 'Number of posts created', type: 'counter', category: 'content', unit: 'posts', aggregation: 'count' },
  'stories_posted': { name: 'stories_posted', displayName: 'Stories Posted', description: 'Number of stories posted', type: 'counter', category: 'content', unit: 'stories', aggregation: 'count' },
  'videos_uploaded': { name: 'videos_uploaded', displayName: 'Videos Uploaded', description: 'Number of videos uploaded', type: 'counter', category: 'content', unit: 'videos', aggregation: 'count' },
  'live_streams_started': { name: 'live_streams_started', displayName: 'Live Streams Started', description: 'Number of live streams started', type: 'counter', category: 'content', unit: 'streams', aggregation: 'count' },
  'total_likes': { name: 'total_likes', displayName: 'Total Likes', description: 'Total likes across all content', type: 'counter', category: 'content', unit: 'likes', aggregation: 'count' },
  'total_comments': { name: 'total_comments', displayName: 'Total Comments', description: 'Total comments across all content', type: 'counter', category: 'content', unit: 'comments', aggregation: 'count' },
  'total_shares': { name: 'total_shares', displayName: 'Total Shares', description: 'Total shares across all content', type: 'counter', category: 'content', unit: 'shares', aggregation: 'count' },
  'total_saves': { name: 'total_saves', displayName: 'Total Saves', description: 'Total saves/bookmarks', type: 'counter', category: 'content', unit: 'saves', aggregation: 'count' },
  'engagement_rate': { name: 'engagement_rate', displayName: 'Engagement Rate', description: 'Average engagement rate', type: 'percentage', category: 'content', unit: '%', aggregation: 'avg' },

  // Creator Analytics
  'profile_views': { name: 'profile_views', displayName: 'Profile Views', description: 'Profile view count', type: 'counter', category: 'creator', unit: 'views', aggregation: 'count' },
  'followers_gained': { name: 'followers_gained', displayName: 'Followers Gained', description: 'New followers', type: 'counter', category: 'creator', unit: 'followers', aggregation: 'count' },
  'followers_lost': { name: 'followers_lost', displayName: 'Followers Lost', description: 'Lost followers', type: 'counter', category: 'creator', unit: 'followers', aggregation: 'count' },
  'subscriber_growth': { name: 'subscriber_growth', displayName: 'Subscriber Growth', description: 'Subscription growth rate', type: 'percentage', category: 'creator', unit: '%', aggregation: 'avg' },
  'watch_time': { name: 'watch_time', displayName: 'Watch Time', description: 'Total watch time', type: 'duration', category: 'creator', unit: 'minutes', aggregation: 'sum' },
  'video_completion_rate': { name: 'video_completion_rate', displayName: 'Video Completion Rate', description: 'Average video completion rate', type: 'percentage', category: 'creator', unit: '%', aggregation: 'avg' },
  'gift_revenue': { name: 'gift_revenue', displayName: 'Gift Revenue', description: 'Revenue from gifts', type: 'revenue', category: 'creator', unit: 'USD', aggregation: 'sum' },
  'subscription_revenue': { name: 'subscription_revenue', displayName: 'Subscription Revenue', description: 'Revenue from subscriptions', type: 'revenue', category: 'creator', unit: 'USD', aggregation: 'sum' },
  'ad_revenue': { name: 'ad_revenue', displayName: 'Ad Revenue', description: 'Revenue from ads', type: 'revenue', category: 'creator', unit: 'USD', aggregation: 'sum' },
  'total_earnings': { name: 'total_earnings', displayName: 'Total Earnings', description: 'Total creator earnings', type: 'revenue', category: 'creator', unit: 'USD', aggregation: 'sum' },

  // Live Stream Analytics
  'concurrent_viewers': { name: 'concurrent_viewers', displayName: 'Concurrent Viewers', description: 'Current concurrent viewers', type: 'gauge', category: 'live_stream', unit: 'viewers', aggregation: 'max' },
  'peak_viewers': { name: 'peak_viewers', displayName: 'Peak Viewers', description: 'Peak concurrent viewers', type: 'gauge', category: 'live_stream', unit: 'viewers', aggregation: 'max' },
  'stream_watch_time': { name: 'stream_watch_time', displayName: 'Stream Watch Time', description: 'Total watch time for streams', type: 'duration', category: 'live_stream', unit: 'minutes', aggregation: 'sum' },
  'new_followers_during_stream': { name: 'new_followers_during_stream', displayName: 'New Followers', description: 'New followers during stream', type: 'counter', category: 'live_stream', unit: 'followers', aggregation: 'count' },
  'gift_volume': { name: 'gift_volume', displayName: 'Gift Volume', description: 'Number of gifts sent during stream', type: 'counter', category: 'live_stream', unit: 'gifts', aggregation: 'count' },
  'chat_messages': { name: 'chat_messages', displayName: 'Chat Messages', description: 'Chat messages during stream', type: 'counter', category: 'live_stream', unit: 'messages', aggregation: 'count' },
  'stream_reactions': { name: 'stream_reactions', displayName: 'Reactions', description: 'Reactions during stream', type: 'counter', category: 'live_stream', unit: 'reactions', aggregation: 'count' },

  // Revenue Analytics
  'coin_purchases': { name: 'coin_purchases', displayName: 'Coin Purchases', description: 'VANTA Coin purchase count', type: 'counter', category: 'revenue', unit: 'purchases', aggregation: 'count' },
  'platform_revenue': { name: 'platform_revenue', displayName: 'Platform Revenue', description: 'Total platform revenue', type: 'revenue', category: 'revenue', unit: 'USD', aggregation: 'sum' },
  'arpu': { name: 'arpu', displayName: 'ARPU', description: 'Average revenue per user', type: 'revenue', category: 'revenue', unit: 'USD', aggregation: 'avg' },
  'payment_success_rate': { name: 'payment_success_rate', displayName: 'Payment Success Rate', description: 'Payment success percentage', type: 'percentage', category: 'revenue', unit: '%', aggregation: 'avg' },
  'refund_rate': { name: 'refund_rate', displayName: 'Refund Rate', description: 'Refund percentage', type: 'percentage', category: 'revenue', unit: '%', aggregation: 'avg' },

  // Marketing Analytics
  'conversion_rate': { name: 'conversion_rate', displayName: 'Conversion Rate', description: 'Visitor to user conversion', type: 'percentage', category: 'marketing', unit: '%', aggregation: 'avg' },
  'cac': { name: 'cac', displayName: 'CAC', description: 'Customer acquisition cost', type: 'revenue', category: 'marketing', unit: 'USD', aggregation: 'avg' },
  'roas': { name: 'roas', displayName: 'ROAS', description: 'Return on ad spend', type: 'percentage', category: 'marketing', unit: '%', aggregation: 'avg' },
  'viral_coefficient': { name: 'viral_coefficient', displayName: 'Viral Coefficient', description: 'Viral growth coefficient', type: 'percentage', category: 'marketing', unit: '', aggregation: 'avg' },

  // Notification Analytics
  'push_delivery_rate': { name: 'push_delivery_rate', displayName: 'Delivery Rate', description: 'Push notification delivery rate', type: 'percentage', category: 'notification', unit: '%', aggregation: 'avg' },
  'push_open_rate': { name: 'push_open_rate', displayName: 'Open Rate', description: 'Push notification open rate', type: 'percentage', category: 'notification', unit: '%', aggregation: 'avg' },
  'push_click_rate': { name: 'push_click_rate', displayName: 'Click Rate', description: 'Push notification click rate', type: 'percentage', category: 'notification', unit: '%', aggregation: 'avg' },

  // AI Analytics
  'recommendation_accuracy': { name: 'recommendation_accuracy', displayName: 'Recommendation Accuracy', description: 'AI recommendation accuracy', type: 'percentage', category: 'ai', unit: '%', aggregation: 'avg' },
  'moderation_accuracy': { name: 'moderation_accuracy', displayName: 'Moderation Accuracy', description: 'AI moderation accuracy', type: 'percentage', category: 'ai', unit: '%', aggregation: 'avg' },
  'spam_detection_rate': { name: 'spam_detection_rate', displayName: 'Spam Detection', description: 'Spam detection rate', type: 'percentage', category: 'ai', unit: '%', aggregation: 'avg' },
  'ai_response_time': { name: 'ai_response_time', displayName: 'AI Response Time', description: 'Average AI response time', type: 'duration', category: 'ai', unit: 'ms', aggregation: 'avg' },

  // Performance Analytics
  'api_latency': { name: 'api_latency', displayName: 'API Latency', description: 'Average API response time', type: 'duration', category: 'performance', unit: 'ms', aggregation: 'avg' },
  'db_query_time': { name: 'db_query_time', displayName: 'DB Query Time', description: 'Average database query time', type: 'duration', category: 'performance', unit: 'ms', aggregation: 'avg' },
  'cache_hit_rate': { name: 'cache_hit_rate', displayName: 'Cache Hit Rate', description: 'Cache hit percentage', type: 'percentage', category: 'performance', unit: '%', aggregation: 'avg' },
  'websocket_connections': { name: 'websocket_connections', displayName: 'WebSocket Connections', description: 'Active WebSocket connections', type: 'gauge', category: 'performance', unit: 'connections', aggregation: 'max' },
  'error_rate': { name: 'error_rate', displayName: 'Error Rate', description: 'API error rate', type: 'percentage', category: 'performance', unit: '%', aggregation: 'avg' },
};