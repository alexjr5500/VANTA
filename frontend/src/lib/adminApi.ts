// Admin Dashboard API Service
// Every call maps to a real, role-protected backend endpoint. There are no
// mocks or fabricated values — all numbers come from the database.

import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';
import type {
  DashboardStats,
  CreatorRecord,
  CommunityRecord,
  FinancialTransaction,
  GiftDefinition,
  CoinPaymentsDashboard,
  CoinPurchaseRecord,
} from '@/types/admin';

// ============================================================================
// DASHBOARD
// ============================================================================

/** Full real-data dashboard snapshot (includes userGrowth/recentUsers/recentReports). */
export const getDashboardStats = (token: string): Promise<DashboardStats & {
  userGrowth: {
    '7d': { date: string; count: number }[];
    '30d': { date: string; count: number }[];
    '90d': { date: string; count: number }[];
    '12m': { month: string; count: number }[];
  };
  recentUsers: any[];
  recentReports: any[];
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  newUsersThisYear: number;
  activeUsersToday: number;
  activeUsersThisWeek: number;
  activeUsersThisMonth: number;
  activeUsersLast30d: number;
  onlineUsers: number;
  inactiveUsers: number;
  suspendedUsers: number;
  bannedUsers: number;
  verifiedUsers: number;
}> => {
  return apiGet<DashboardStats & any>('/api/admin/stats', token);
};

// ============================================================================
// USER MANAGEMENT
// ============================================================================

export interface UserPage {
  users: UserRecord[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export const getUsers = (token: string, params?: {
  search?: string;
  status?: string;
  role?: string;
  verified?: string;
  page?: number;
  limit?: number;
}): Promise<UserPage> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<UserPage>(`/api/admin/users/manage?${query}`, token);
};

export const suspendUser = (token: string, userId: string, reason?: string): Promise<any> => {
  return apiPost<any>('/api/admin/users/suspend', { userId, reason: reason || 'Suspended by admin' }, token);
};

export const banUser = (token: string, userId: string, reason?: string): Promise<any> => {
  return apiPost<any>('/api/admin/users/ban', { userId, reason: reason || 'Banned by admin' }, token);
};

export const restoreUser = (token: string, userId: string): Promise<any> => {
  return apiPost<any>('/api/admin/users/restore', { userId }, token);
};

export const verifyUser = (token: string, userId: string): Promise<any> => {
  return apiPost<any>('/api/admin/users/verify', { userId }, token);
};

export const deleteUser = (token: string, userId: string): Promise<any> => {
  return apiDelete<any>(`/api/admin/users/${userId}`, token);
};

// ============================================================================
// CREATOR MANAGEMENT
// ============================================================================

export const getCreators = async (token: string, params?: {
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<{ creators: CreatorRecord[]; total: number }> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<{ creators: CreatorRecord[]; total: number }>(`/api/admin/creators?${query}`, token);
};

export const verifyCreator = (token: string, creatorId: string, badgeType?: 'BLUE' | 'GOLD'): Promise<any> => {
  return apiPost<any>(`/api/admin/creators/${creatorId}/verify`, { badgeType: badgeType || 'GOLD' }, token);
};

export const toggleMonetization = (token: string, creatorId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/creators/${creatorId}/monetization`, {}, token);
};

export const approveSubscription = (token: string, creatorId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/creators/${creatorId}/subscription-approve`, {}, token);
};

export interface LiveStreamMonitor {
  id: string;
  title: string;
  creatorName: string;
  currentViewers: number;
  peakViewers: number;
  status: string;
  health: string;
  streamQuality: string;
  bitrate: number;
  fps: number;
  duration: string;
  startedAt: string;
  chatActivity: number;
  gifts: number;
  giftRevenue: number;
  reports: number;
  moderators: string[];
  tags: string[];
}
export interface UserRecord {
  id: string;
  username: string;
  email: string;
  fullName?: string;
  avatar?: string;
  role: string;
  status: string;
  verified: boolean;
  premium: boolean;
  coins: number;
  earnings: number;
  lastLoginAt: string | null;
  createdAt: string;
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
export interface ServerInfrastructure {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  network: { incoming: number; outgoing: number };
  uptime: string;
  services: { name: string; status: 'healthy' | 'degraded' | 'down'; uptime: string }[];
  regions: { name: string; latency: number; status: string }[];
  overallHealth?: string;
  nodeVersion?: string;
  platform?: string;
}
// ============================================================================
// CONTENT MODERATION
// ============================================================================

export const getContentItems = (token: string): Promise<any> => {
  return apiGet<any>('/api/admin/content', token);
};

export const reviewContentItem = (token: string, queueId: string, action: 'APPROVED' | 'REMOVED', reason?: string): Promise<any> => {
  return apiPost<any>(`/api/admin/content/${queueId}/review`, { action, reason }, token);
};

export const resolveReport = (token: string, reportId: string, action: 'resolve' | 'dismiss'): Promise<any> => {
  return apiPost<any>(`/api/admin/reports/${reportId}/resolve`, { action }, token);
};

// ============================================================================
// LIVE STREAMS
// ============================================================================

export const getLiveStreams = (token: string, params?: {
  search?: string;
  status?: string;
  limit?: number;
}): Promise<LiveStreamMonitor[]> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<LiveStreamMonitor[]>(`/api/admin/live?${query}`, token);
};

export const endLiveStream = (token: string, streamId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/live/${streamId}/end`, {}, token);
};

export const suspendLiveStream = (token: string, streamId: string, reason?: string): Promise<any> => {
  return apiPost<any>(`/api/admin/live/${streamId}/suspend`, { reason }, token);
};

// ============================================================================
// COMMUNITIES
// ============================================================================

export const getCommunities = (token: string): Promise<CommunityRecord[]> => {
  return apiGet<CommunityRecord[]>('/api/admin/communities', token);
};

// ============================================================================
// WALLET / FINANCE
// ============================================================================

export const getWalletTransactions = (token: string, params?: {
  limit?: number;
  offset?: number;
  type?: string;
  status?: string;
}): Promise<{ transactions: any[]; total: number }> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<any>(`/api/admin/wallet/transactions?${query}`, token);
};

/** Real finance ledger (wallet transactions), newest first. */
export const getTransactions = (token: string, params?: {
  page?: number;
  limit?: number;
  type?: string;
  status?: string;
  search?: string;
}): Promise<{ transactions: FinancialTransaction[]; total: number; summary: any }> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<any>(`/api/admin/finance/transactions?${query}`, token);
};

export const getWithdrawals = (token: string, limit = 50): Promise<any[]> => {
  return apiGet<any[]>(`/api/admin/withdrawals?limit=${limit}`, token);
};

// ============================================================================
// GIFT CATALOG
// ============================================================================

export const getGifts = (token: string): Promise<GiftDefinition[]> => {
  return apiGet<GiftDefinition[]>('/api/admin/gifts', token);
};

export const toggleGiftActive = (token: string, giftId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/gifts/${giftId}/toggle`, {}, token);
};

export const updateGift = (token: string, giftId: string, patch: Partial<GiftDefinition>): Promise<any> => {
  return apiPut<any>(`/api/admin/gifts/${giftId}`, patch, token);
};

// ============================================================================
// COIN PAYMENTS (VANTA Coin purchase dashboard)
// ============================================================================

export const getCoinPaymentsDashboard = (token: string): Promise<CoinPaymentsDashboard> => {
  return apiGet<CoinPaymentsDashboard>('/api/admin/coin-payments', token);
};

export const listCoinPurchases = (token: string, params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ purchases: CoinPurchaseRecord[]; total: number }> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<any>(`/api/admin/coin-payments/list?${query}`, token);
};

export const refundCoinPurchase = (token: string, orderId: string, reason: string): Promise<any> => {
  return apiPost<any>(`/api/admin/coin-payments/${orderId}/refund`, { reason }, token);
};

// ============================================================================
// AUDIT LOGS
// ============================================================================

export const getAuditLogs = (token: string, params?: {
  action?: string;
  admin?: string;
  page?: number;
  limit?: number;
}): Promise<{ logs: AuditLog[]; total: number }> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<any>(`/api/admin/audit?${query}`, token);
};

// ============================================================================
// INFRASTRUCTURE
// ============================================================================

export const getInfrastructure = (token: string): Promise<ServerInfrastructure> => {
  return apiGet<ServerInfrastructure>('/api/admin/infrastructure', token);
};

// ============================================================================
// NOTIFICATIONS (Notification Center)
// ============================================================================

export const getNotificationCenter = (token: string, params?: {
  page?: number;
  limit?: number;
}): Promise<any> => {
  const query = new URLSearchParams((params || {}) as any).toString();
  return apiGet<any>(`/api/admin/notifications?${query}`, token);
};