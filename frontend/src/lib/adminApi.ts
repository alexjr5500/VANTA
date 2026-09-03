// Admin Dashboard API Service
// Connects to backend admin endpoints for real data operations

import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';
import type {
  DashboardStats, UserRecord, CreatorRecord, ContentItem,
  LiveStreamMonitor, FinancialTransaction, GiftDefinition,
  CommunityRecord, NotificationCampaign, AuditLog, AnalyticsReport,
  ServerInfrastructure, AdminUser
} from '@/types/admin';

// ==========================================
// AUTH & ADMIN USERS
// ==========================================

export const getAdminProfile = (token: string): Promise<AdminUser> => {
  return apiGet<AdminUser>('/api/admin/profile', token);
};

export const getAdminUsers = (token: string): Promise<AdminUser[]> => {
  return apiGet<AdminUser[]>('/api/admin/users', token);
};

// ==========================================
// DASHBOARD STATS
// ==========================================

export const getDashboardStats = (token: string): Promise<DashboardStats> => {
  return apiGet<DashboardStats>('/api/admin/stats', token);
};

export const getAnalyticsReport = (token: string, timeframe?: string): Promise<AnalyticsReport> => {
  return apiGet<AnalyticsReport>(`/api/admin/analytics?timeframe=${timeframe || 'monthly'}`, token);
};

// ==========================================
// USER MANAGEMENT
// ==========================================

export const getUsers = (token: string, params?: { search?: string; role?: string; status?: string; page?: number }): Promise<UserRecord[]> => {
  const query = new URLSearchParams(params as any).toString();
  return apiGet<UserRecord[]>(`/api/admin/users?${query}`, token);
};

export const getUserById = (token: string, userId: string): Promise<UserRecord> => {
  return apiGet<UserRecord>(`/api/admin/users/${userId}`, token);
};

export const suspendUser = (token: string, userId: string, reason?: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/suspend`, { reason }, token);
};

export const banUser = (token: string, userId: string, reason?: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/ban`, { reason }, token);
};

export const shadowBanUser = (token: string, userId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/shadow-ban`, {}, token);
};

export const restoreUser = (token: string, userId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/restore`, {}, token);
};

export const deleteUser = (token: string, userId: string): Promise<any> => {
  return apiDelete<any>(`/api/admin/users/${userId}`, token);
};

export const verifyUser = (token: string, userId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/verify`, {}, token);
};

export const resetUserPassword = (token: string, userId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/reset-password`, {}, token);
};

export const forceLogout = (token: string, userId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/users/${userId}/force-logout`, {}, token);
};

// ==========================================
// CREATOR MANAGEMENT
// ==========================================

export const getCreators = (token: string, params?: { search?: string; category?: string; page?: number }): Promise<CreatorRecord[]> => {
  const query = new URLSearchParams(params as any).toString();
  return apiGet<CreatorRecord[]>(`/api/admin/creators?${query}`, token);
};

export const verifyCreator = (token: string, creatorId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/creators/${creatorId}/verify`, {}, token);
};

export const toggleMonetization = (token: string, creatorId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/creators/${creatorId}/monetization`, {}, token);
};

export const approveSubscription = (token: string, creatorId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/creators/${creatorId}/subscription-approve`, {}, token);
};

// ==========================================
// CONTENT MODERATION
// ==========================================

export const getContentItems = (token: string, params?: { type?: string; status?: string; page?: number }): Promise<ContentItem[]> => {
  const query = new URLSearchParams(params as any).toString();
  return apiGet<ContentItem[]>(`/api/admin/content?${query}`, token);
};

export const approveContent = (token: string, contentId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/content/${contentId}/approve`, {}, token);
};

export const removeContent = (token: string, contentId: string, reason?: string): Promise<any> => {
  return apiPost<any>(`/api/admin/content/${contentId}/remove`, { reason }, token);
};

export const restoreContent = (token: string, contentId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/content/${contentId}/restore`, {}, token);
};

export const flagContent = (token: string, contentId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/content/${contentId}/flag`, {}, token);
};

export const runAIReview = (token: string, contentId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/content/${contentId}/ai-review`, {}, token);
};

// ==========================================
// LIVE STREAMS
// ==========================================

export const getLiveStreams = (token: string): Promise<LiveStreamMonitor[]> => {
  return apiGet<LiveStreamMonitor[]>('/api/admin/live', token);
};

export const endStream = (token: string, streamId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/live/${streamId}/end`, {}, token);
};

export const suspendStream = (token: string, streamId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/live/${streamId}/suspend`, {}, token);
};

export const warnStreamCreator = (token: string, streamId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/live/${streamId}/warn`, {}, token);
};

// ==========================================
// FINANCE
// ==========================================

export const getTransactions = (token: string, params?: { type?: string; status?: string; page?: number }): Promise<FinancialTransaction[]> => {
  const query = new URLSearchParams(params as any).toString();
  return apiGet<FinancialTransaction[]>(`/api/admin/finance/transactions?${query}`, token);
};

export const approvePayout = (token: string, transactionId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/finance/transactions/${transactionId}/approve`, {}, token);
};

export const generateFinancialReport = (token: string, type: 'pdf' | 'csv' | 'excel', dateFrom?: string, dateTo?: string): Promise<Blob> => {
  return apiGet<any>(`/api/admin/finance/report?type=${type}&from=${dateFrom || ''}&to=${dateTo || ''}`, token);
};

// ==========================================
// GIFTS
// ==========================================

export const getGifts = (token: string): Promise<GiftDefinition[]> => {
  return apiGet<GiftDefinition[]>('/api/admin/gifts', token);
};

export const updateGift = (token: string, giftId: string, data: Partial<GiftDefinition>): Promise<any> => {
  return apiPut<any>(`/api/admin/gifts/${giftId}`, data, token);
};

export const createGift = (token: string, data: Omit<GiftDefinition, 'id' | 'createdAt'>): Promise<GiftDefinition> => {
  return apiPost<GiftDefinition>('/api/admin/gifts', data, token);
};

export const toggleGiftActive = (token: string, giftId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/gifts/${giftId}/toggle`, {}, token);
};

// ==========================================
// COMMUNITIES
// ==========================================

export const getCommunities = (token: string): Promise<CommunityRecord[]> => {
  return apiGet<CommunityRecord[]>('/api/admin/communities', token);
};

export const archiveCommunity = (token: string, communityId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/communities/${communityId}/archive`, {}, token);
};

export const restoreCommunity = (token: string, communityId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/communities/${communityId}/restore`, {}, token);
};

export const featureCommunity = (token: string, communityId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/communities/${communityId}/feature`, {}, token);
};

// ==========================================
// NOTIFICATIONS
// ==========================================

export const getNotificationCampaigns = (token: string): Promise<NotificationCampaign[]> => {
  return apiGet<NotificationCampaign[]>('/api/admin/notifications', token);
};

export const createNotificationCampaign = (token: string, data: Omit<NotificationCampaign, 'id' | 'createdAt'>): Promise<NotificationCampaign> => {
  return apiPost<NotificationCampaign>('/api/admin/notifications', data, token);
};

export const sendNotification = (token: string, campaignId: string): Promise<any> => {
  return apiPost<any>(`/api/admin/notifications/${campaignId}/send`, {}, token);
};

// ==========================================
// AUDIT LOGS
// ==========================================

export const getAuditLogs = (token: string, params?: { action?: string; admin?: string; page?: number }): Promise<AuditLog[]> => {
  const query = new URLSearchParams(params as any).toString();
  return apiGet<AuditLog[]>(`/api/admin/audit?${query}`, token);
};

export const exportAuditLogs = (token: string, format: 'csv' | 'json'): Promise<Blob> => {
  return apiGet<any>(`/api/admin/audit/export?format=${format}`, token);
};

// ==========================================
// INFRASTRUCTURE
// ==========================================

export const getInfrastructure = (token: string): Promise<ServerInfrastructure> => {
  return apiGet<ServerInfrastructure>('/api/admin/infrastructure', token);
};

export const getInfrastructureRealtime = (token: string): Promise<ServerInfrastructure> => {
  return apiGet<ServerInfrastructure>('/api/admin/infrastructure/realtime', token);
};

// ==========================================
// ANALYTICS EXPORT
// ==========================================

export const exportAnalytics = (token: string, format: 'pdf' | 'csv' | 'excel', type: string, timeframe?: string): Promise<Blob> => {
  return apiGet<any>(`/api/admin/analytics/export?format=${format}&type=${type}&timeframe=${timeframe || 'monthly'}`, token);
};