/**
 * VANTA Compliance & Privacy API Client
 * Handles all privacy, legal, and compliance API calls
 */

import { API_BASE_URL, ApiError } from './api';

const API_BASE = `${API_BASE_URL}/api/compliance`;

const getAccessToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('vanta_token');
};

async function request(endpoint: string, options: RequestInit = {}) {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || error.message || 'Request failed', error);
  }

  return response.json();
}

// ============================================================================
// PRIVACY SETTINGS
// ============================================================================

export const privacyApi = {
  getSettings: () => request('/privacy-settings'),
  updateSettings: (data: any) => request('/privacy-settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
};

// ============================================================================
// CONSENT MANAGEMENT
// ============================================================================

export const consentApi = {
  getPreferences: () => request('/consent'),
  updatePreferences: (data: any) => request('/consent', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  getHistory: () => request('/consent/history'),
};

// ============================================================================
// DATA EXPORT
// ============================================================================

export const exportApi = {
  requestExport: () => request('/export/request', { method: 'POST' }),
  getExports: () => request('/export/list'),
  download: async (id: string) => {
    const token = getAccessToken();
    const response = await fetch(`${API_BASE}/export/download/${encodeURIComponent(id)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new ApiError(response.status, error.error || error.message || 'Download failed', error);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1] || `vanta-export-${id}.zip`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = decodeURIComponent(filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

// ============================================================================
// ACCOUNT DEACTIVATION / DELETION
// ============================================================================

export const accountApi = {
  deactivate: (reason?: string, reasonDetail?: string) => request('/account/deactivate', {
    method: 'POST',
    body: JSON.stringify({ reason, reasonDetail }),
  }),
  scheduleDeletion: (reason?: string, scheduledDate?: string) => request('/account/schedule-deletion', {
    method: 'POST',
    body: JSON.stringify({ reason, scheduledDate }),
  }),
  cancelDeletion: () => request('/account/cancel-deletion', { method: 'POST' }),
  recover: (recoveryToken: string) => request('/account/recover', {
    method: 'POST',
    body: JSON.stringify({ recoveryToken }),
  }),
  getStatus: () => request('/account/deactivation-status'),
};

// ============================================================================
// REPORTING
// ============================================================================

export const reportApi = {
  create: (data: {
    targetType: string;
    targetId: string;
    category: string;
    description?: string;
    targetUserId?: string;
    evidenceUrls?: string[];
  }) => request('/reports', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getMyReports: (limit = 50, offset = 0) =>
    request(`/reports?limit=${limit}&offset=${offset}`),
};

// ============================================================================
// APPEALS
// ============================================================================

export const appealApi = {
  create: (data: {
    appealType: string;
    reason: string;
    explanation?: string;
    targetId?: string;
    reportId?: string;
    evidenceUrls?: string[];
  }) => request('/appeals', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getMyAppeals: (limit = 50, offset = 0) =>
    request(`/appeals?limit=${limit}&offset=${offset}`),
};

// ============================================================================
// CONNECTED DEVICES & LOGIN HISTORY
// ============================================================================

export const deviceApi = {
  getDevices: () => request('/devices'),
  getLoginHistory: () => request('/login-history'),
};

// ============================================================================
// COMMUNITY STANDARDS
// ============================================================================

export const standardsApi = {
  getStandards: () => request('/community-standards'),
};

// ============================================================================
// POLICIES
// ============================================================================

export const policyApi = {
  getAll: () => request('/policies'),
  getByType: (type: string) => request(`/policies/${type}`),
  accept: (type: string, version: string) => request(`/policies/${type}/accept`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  }),
  getAcceptances: () => request('/policy-acceptances'),
};

// ============================================================================
// TRANSPARENCY CENTER
// ============================================================================

export const transparencyApi = {
  getMetrics: (period = 'MONTHLY') => request(`/transparency?period=${period}`),
};

// ============================================================================
// COMPLIANCE NOTIFICATIONS
// ============================================================================

export const notificationApi = {
  getAll: (unreadOnly = false) => request(`/notifications?unread=${unreadOnly}`),
  markRead: (id: string) => request(`/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => request('/notifications/read-all', { method: 'PUT' }),
};

// ============================================================================
// ADMIN API
// ============================================================================

export const adminComplianceApi = {
  getDashboard: () => request('/admin/dashboard'),

  // Reports
  getReports: (limit = 50, offset = 0) =>
    request(`/admin/reports?limit=${limit}&offset=${offset}`),
  processReport: (id: string, action: string, note?: string) =>
    request(`/admin/reports/${id}/process`, {
      method: 'PUT',
      body: JSON.stringify({ action, note }),
    }),

  // Appeals
  getAppeals: (limit = 50, offset = 0) =>
    request(`/admin/appeals?limit=${limit}&offset=${offset}`),
  processAppeal: (id: string, decision: string, reason?: string) =>
    request(`/admin/appeals/${id}/process`, {
      method: 'PUT',
      body: JSON.stringify({ decision, reason }),
    }),

  // Copyright
  getCopyrightClaims: (limit = 50, offset = 0, status?: string) =>
    request(`/admin/copyright?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ''}`),
  processCopyrightClaim: (id: string, action: string, note?: string) =>
    request(`/admin/copyright/${id}/process`, {
      method: 'PUT',
      body: JSON.stringify({ action, note }),
    }),

  // Child Safety
  processChildSafetyFlag: (id: string, action: string, note?: string) =>
    request(`/admin/child-safety/${id}/process`, {
      method: 'PUT',
      body: JSON.stringify({ action, note }),
    }),

  // Audit Logs
  getAuditLogs: (params?: {
    userId?: string;
    action?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.userId) query.set('userId', params.userId);
    if (params?.action) query.set('action', params.action);
    if (params?.resourceType) query.set('resourceType', params.resourceType);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    return request(`/audit-logs?${query.toString()}`);
  },

  // Transparency
  generateTransparencyReport: () =>
    request('/admin/transparency/generate', { method: 'POST' }),

  // Community Standards Admin
  upsertCommunityStandard: (type: string, title: string, content: string, version: string) =>
    request('/admin/community-standards', {
      method: 'POST',
      body: JSON.stringify({ type, title, content, version }),
    }),

  // Policy Admin
  publishPolicy: (policyType: string, version: string, title: string, content: string) =>
    request('/admin/policies', {
      method: 'POST',
      body: JSON.stringify({ policyType, version, title, content }),
    }),
};