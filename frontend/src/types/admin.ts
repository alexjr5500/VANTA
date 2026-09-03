// Admin Dashboard Type Definitions

export type AdminRole = 'SUPER_ADMIN' | 'ADMINISTRATOR' | 'MODERATOR' | 'SUPPORT_AGENT' | 'FINANCE_MANAGER' | 'CONTENT_REVIEWER';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  avatar?: string;
  role: AdminRole;
  permissions: string[];
  lastLogin?: string;
  createdAt: string;
  isActive: boolean;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  newRegistrations: number;
  onlineUsers: number;
  liveStreams: number;
  activeCreators: number;
  communities: number;
  posts: number;
  shorts: number;
  stories: number;
  messagesSentToday: number;
  revenueToday: number;
  monthlyRevenue: number;
  coinPurchases: number;
  creatorPayouts: number;
  pendingReports: number;
  serverHealth: 'healthy' | 'degraded' | 'down';
  apiStatus: 'healthy' | 'degraded' | 'down';
  databaseHealth: 'healthy' | 'degraded' | 'down';
  storageUsage: number;
  // New VANTA metrics
  welcomeRewardsIssued: number;
  totalCoinsDistributed: number;
  pendingWithdrawals: number;
  approvedWithdrawals: number;
  rejectedWithdrawals: number;
  giftEconomyVolume: number;
  totalGiftsSent: number;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  resource: string;
  resourceId: string;
  timestamp: string;
  ip: string;
  device: string;
  previousValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
}

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  avatar?: string;
  role: string;
  isVerified: boolean;
  isCreator: boolean;
  isSuspended: boolean;
  isBanned: boolean;
  isShadowBanned: boolean;
  followersCount: number;
  followingCount: number;
  totalEarnings: number;
  createdAt: string;
  lastActive: string;
  reports: number;
  status: 'active' | 'suspended' | 'banned' | 'shadow_banned' | 'inactive';
  devices?: DeviceInfo[];
  loginHistory?: LoginEntry[];
}

export interface DeviceInfo {
  id: string;
  device: string;
  platform: string;
  browser: string;
  lastActive: string;
  isCurrent: boolean;
}

export interface LoginEntry {
  id: string;
  ip: string;
  device: string;
  location?: string;
  timestamp: string;
  success: boolean;
}

export interface CreatorRecord {
  id: string;
  userId: string;
  username: string;
  avatar?: string;
  displayName: string;
  bio?: string;
  followers: number;
  subscribers: number;
  totalViews: number;
  totalEarnings: number;
  monthlyEarnings: number;
  isVerified: boolean;
  isMonetized: boolean;
  subscriptionApproved: boolean;
  liveAccess: boolean;
  ranking: number;
  category: string;
  joinedAt: string;
  lastStream?: string;
  performance: CreatorPerformance;
}

export interface CreatorPerformance {
  viewsGrowth: number;
  followerGrowth: number;
  earningsGrowth: number;
  avgWatchTime: number;
  engagementRate: number;
  topStreams: number;
}

export interface ContentItem {
  id: string;
  type: 'post' | 'short' | 'story' | 'comment' | 'community_post' | 'stream';
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  mediaUrl?: string;
  thumbnail?: string;
  status: 'pending' | 'approved' | 'flagged' | 'removed' | 'restored';
  flags: string[];
  aiReview?: AIReviewResult;
  reportCount: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  createdAt: string;
  updatedAt: string;
}

export interface AIReviewResult {
  nsfwScore: number;
  spamScore: number;
  hateSpeechScore: number;
  violenceScore: number;
  bullyingScore: number;
  requiresReview: boolean;
  summary: string;
}

export interface LiveStreamMonitor {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string;
  title: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  currentViewers: number;
  peakViewers: number;
  totalViews: number;
  duration: string;
  startedAt: string;
  chatActivity: number;
  gifts: number;
  giftRevenue: number;
  moderators: string[];
  reports: number;
  status: 'live' | 'ended' | 'suspended';
  health: 'good' | 'fair' | 'poor';
  streamQuality: string;
  bitrate: number;
  fps: number;
}

export interface FinancialTransaction {
  id: string;
  type: 'coin_purchase' | 'gift_sent' | 'subscription' | 'withdrawal' | 'refund' | 'creator_earnings' | 'ad_revenue';
  userId: string;
  userName: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  paymentMethod?: string;
  description: string;
  createdAt: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface GiftDefinition {
  id: string;
  slug?: string;
  name: string;
  /** @deprecated Retained for compatibility with existing catalog rows. */
  emoji?: string;
  price: number;
  category: 'everyday' | 'premium' | 'legendary' | 'seasonal' | 'limited' | 'featured';
  animation?: string;
  isActive: boolean;
  isLegendary: boolean;
  isLimited: boolean;
  isSeasonal: boolean;
  isFeatured: boolean;
  season?: string;
  sortOrder: number;
  description: string;
  createdAt: string;
}

export interface CommunityRecord {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  banner?: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  postCount: number;
  type: 'public' | 'private' | 'exclusive';
  isFeatured: boolean;
  isArchived: boolean;
  tags: string[];
  createdAt: string;
}

export interface NotificationCampaign {
  id: string;
  title: string;
  body: string;
  type: 'global' | 'creator' | 'maintenance' | 'promotional';
  targetAudience: string[];
  scheduledFor?: string;
  sentAt?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  pushEnabled: boolean;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  stats?: {
    delivered: number;
    opened: number;
    clicked: number;
  };
  createdBy: string;
  createdAt: string;
}

export interface AnalyticsReport {
  dau: number[];
  mau: number;
  retention: number[];
  churn: number;
  revenue: number[];
  topCreators: { id: string; name: string; views: number; earnings: number }[];
  mostViewedStreams: { id: string; title: string; views: number; avgWatchTime: number }[];
  giftStats: { giftId: string; name: string; count: number; revenue: number }[];
  subscriptionGrowth: number[];
  countryDistribution: { country: string; users: number; percentage: number }[];
  deviceAnalytics: { device: string; users: number; percentage: number }[];
  timeFrame: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export interface ServerInfrastructure {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  network: { incoming: number; outgoing: number };
  uptime: string;
  services: { name: string; status: 'healthy' | 'degraded' | 'down'; uptime: string }[];
  regions: { name: string; latency: number; status: 'healthy' | 'degraded' | 'down' }[];
}