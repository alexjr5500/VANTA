import { API_BASE_URL, authHeaders } from './api';

const ADS_URL = `${API_BASE_URL}/api/ads`;

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// AD DELIVERY (Public)
// ============================================================================

export async function getActiveAds(limit = 3) {
  const res = await fetch(`${ADS_URL}/active?limit=${limit}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function trackImpression(campaignId: string) {
  const res = await fetch(`${ADS_URL}/impression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ campaignId }),
  });
  return handleResponse(res);
}

export async function trackClick(campaignId: string) {
  const res = await fetch(`${ADS_URL}/click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ campaignId }),
  });
  return handleResponse(res);
}

// ============================================================================
// CAMPAIGN MANAGEMENT (Admin)
// ============================================================================

export async function createCampaign(data: {
  name: string;
  description?: string;
  mediaUrl: string;
  mediaType?: string;
  ctaText?: string;
  ctaUrl?: string;
  ctaInternal?: string;
  targetCountry?: string;
  priority?: number;
  startDate: string;
  endDate?: string;
  maxImpressions?: number;
  maxClicks?: number;
}) {
  const res = await fetch(`${ADS_URL}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateCampaign(campaignId: string, data: any) {
  const res = await fetch(`${ADS_URL}/campaigns/${campaignId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteCampaign(campaignId: string) {
  const res = await fetch(`${ADS_URL}/campaigns/${campaignId}`, {
    method: 'DELETE',
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getCampaign(campaignId: string) {
  const res = await fetch(`${ADS_URL}/campaigns/${campaignId}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getCampaigns(status?: string, limit = 50, offset = 0) {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  query.set('limit', String(limit));
  query.set('offset', String(offset));
  const res = await fetch(`${ADS_URL}/campaigns?${query}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function pauseCampaign(campaignId: string) {
  const res = await fetch(`${ADS_URL}/campaigns/${campaignId}/pause`, {
    method: 'POST',
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function resumeCampaign(campaignId: string) {
  const res = await fetch(`${ADS_URL}/campaigns/${campaignId}/resume`, {
    method: 'POST',
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// ANALYTICS
// ============================================================================

export async function getCampaignAnalytics(campaignId: string) {
  const res = await fetch(`${ADS_URL}/analytics/${campaignId}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getAllAdsAnalytics() {
  const res = await fetch(`${ADS_URL}/analytics`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}