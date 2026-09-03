// Creator Dashboard Type Definitions

export interface CreatorHomeStats {
  todayFollowers: number;
  todayRevenue: number;
  todayGifts: number;
  todaySubscribers: number;
  liveViewers: number;
  videoViews: number;
  watchTime: number;
  watchTimeLabel: string;
  engagementRate: number;
  estimatedEarnings: number;
  recentNotifications: CreatorNotification[];
  growthChart: GrowthDataPoint[];
}

export interface GrowthDataPoint {
  date: string;
  followers: number;
  views: number;
  revenue: number;
}

export interface CreatorNotification {
  id: string;
  type: 'follower' | 'subscriber' | 'comment' | 'mention' | 'message' | 'gift' | 'payout' | 'live' | 'brand_request';
  message: string;
  fromUser?: string;
  fromAvatar?: string;
  isRead: boolean;
  createdAt: string;
}

export interface ContentDraft {
  id: string;
  type: 'post' | 'video' | 'short' | 'story';
  title?: string;
  content?: string;
  mediaUrl?: string;
  thumbnail?: string;
  status: 'draft' | 'scheduled' | 'published';
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiveStreamConfig {
  title: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  isScheduled: boolean;
  scheduledFor?: string;
  streamKey?: string;
  streamUrl?: string;
  webRtcEnabled: boolean;
  guestInviteEnabled: boolean;
  coHostEnabled: boolean;
  moderationEnabled: boolean;
}

export interface LiveStreamAnalytics {
  streamTitle: string;
  startedAt: string;
  duration: string;
  peakViewers: number;
  avgViewers: number;
  totalViewers: number;
  newFollowers: number;
  giftsReceived: number;
  giftRevenue: number;
  chatMessages: number;
  uniqueChatters: number;
  countries: { country: string; viewers: number }[];
}

export interface EarningsBreakdown {
  today: number;
  weekly: number;
  monthly: number;
  lifetime: number;
  giftBreakdown: { name: string; count: number; revenue: number }[];
  subscriptionRevenue: number;
  adRevenue: number;
  pendingPayouts: number;
  withdrawalBalance: number;
  transactions: TransactionRecord[];
}

export interface TransactionRecord {
  id: string;
  type: 'gift' | 'subscription' | 'ad' | 'withdrawal' | 'sponsored' | 'affiliate';
  amount: number;
  status: 'completed' | 'pending' | 'failed';
  description: string;
  fromUser?: string;
  createdAt: string;
}

export interface SubscriptionTier {
  id: string;
  name: string;
  price: number;
  benefits: string[];
  color: string;
  emoji: string;
  isActive: boolean;
  subscriberCount: number;
}

export interface SubscriberAnalytics {
  totalSubscribers: number;
  newSubscribers: number;
  churnedSubscribers: number;
  revenue: number;
  tiers: SubscriptionTier[];
  growth: { date: string; count: number }[];
}

export interface CreatorCommunityStats {
  followers: number;
  subscribers: number;
  communities: number;
  channels: number;
  groups: number;
  moderators: number;
  blockedUsers: number;
  vipMembers: number;
}

export interface CreatorAnalytics {
  followerGrowth: number[];
  views: number[];
  watchTime: number[];
  retention: number[];
  likes: number[];
  comments: number[];
  shares: number[];
  engagement: number[];
  revenue: number[];
  bestPerformingVideos: { title: string; views: number; engagement: number }[];
  topCountries: { country: string; viewers: number; percentage: number }[];
  trafficSources: { source: string; viewers: number; percentage: number }[];
  deviceDistribution: { device: string; users: number; percentage: number }[];
}

export interface CreatorInbox {
  messages: InboxMessage[];
  businessRequests: BusinessRequest[];
  collaborations: CollaborationInvite[];
  brandDeals: BrandDeal[];
  supportTickets: SupportTicket[];
  fanMail: FanMail[];
}

export interface InboxMessage {
  id: string;
  fromUser: string;
  fromAvatar?: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export interface BusinessRequest {
  id: string;
  brandName: string;
  brandLogo?: string;
  offer: string;
  budget: number;
  status: 'pending' | 'accepted' | 'declined' | 'negotiating';
  createdAt: string;
}

export interface CollaborationInvite {
  id: string;
  fromCreator: string;
  fromCreatorAvatar?: string;
  project: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface BrandDeal {
  id: string;
  brandName: string;
  brandLogo?: string;
  campaignTitle: string;
  compensation: number;
  requirements: string;
  status: 'active' | 'completed' | 'cancelled';
  startDate: string;
  endDate: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

export interface FanMail {
  id: string;
  fromUser: string;
  fromAvatar?: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface MonetizationSettings {
  giftsEnabled: boolean;
  subscriptionsEnabled: boolean;
  adsEnabled: boolean;
  sponsoredContentEnabled: boolean;
  affiliateEnabled: boolean;
  vantaCoinBalance: number;
  pendingWithdrawal: number;
  totalWithdrawn: number;
  availableForWithdrawal: number;
  taxDocuments: TaxDocument[];
}

export interface TaxDocument {
  id: string;
  name: string;
  type: 'w9' | 'w8ben' | 'invoice' | 'other';
  status: 'pending' | 'approved' | 'rejected';
  uploadedAt: string;
  url?: string;
}

export interface AIGeneratorResult {
  captions: string[];
  hashtags: string[];
  thumbnailSuggestions: string[];
  optimizationTips: string[];
  moderationSummary: string;
  analyticsSummary: string;
  translations: { language: string; text: string }[];
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  loginHistory: LoginEvent[];
  activeDevices: ActiveDevice[];
  apiKeys: ApiKey[];
  recoveryCodes: string[];
  privacyControls: PrivacyControl;
}

export interface LoginEvent {
  id: string;
  ip: string;
  device: string;
  location: string;
  timestamp: string;
  isCurrent: boolean;
}

export interface ActiveDevice {
  id: string;
  name: string;
  device: string;
  platform: string;
  browser: string;
  lastActive: string;
  isCurrent: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: string[];
  createdAt: string;
  lastUsed?: string;
}

export interface PrivacyControl {
  showOnlineStatus: boolean;
  showActivityStatus: boolean;
  allowMessages: 'everyone' | 'followers' | 'subscribers' | 'none';
  allowBrandDeals: boolean;
  allowCollaborations: boolean;
  dataShareForAnalytics: boolean;
}