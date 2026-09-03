// VANTA Give API service
// Connects the frontend to the /api/fundraisers backend routes.

import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';
import type {
  AdminFundraiserDetail,
  Fundraiser,
  FundraiserAuditLogRow,
  FundraiserCategory,
  FundraiserDonationResult,
  FundraiserDraftSubmission,
  FundraiserEvidenceMeta,
  FundraiserListItem,
  FundraiserReport,
  FundraiserSupporter,
  FundraiserUpdate,
} from '@/types/fundraiser';

const base = '/api/fundraisers';

// ============================================================================
// PUBLIC DISCOVERY
// ============================================================================

export const getFundraiserCategories = (token?: string): Promise<FundraiserCategory[]> =>
  apiGet<FundraiserCategory[]>(`${base}/categories`, token, { skipCache: true });

export const listFundraisers = (
  params: { category?: string; sort?: string; search?: string; status?: string; cursor?: string } = {},
  token?: string
): Promise<{ items: FundraiserListItem[]; nextCursor?: string }> => {
  const query = new URLSearchParams();
  if (params.category && params.category !== 'all') query.set('category', params.category);
  if (params.sort) query.set('sort', params.sort);
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiGet<{ items: FundraiserListItem[]; nextCursor?: string }>(`${base}/${suffix}`, token, { skipCache: true });
};

export const getPublicFundraiser = (
  slug: string,
  token?: string
): Promise<{ fundraiser: Fundraiser; isOwner: boolean; supporters: FundraiserSupporter[]; deadlinePassed: boolean }> =>
  apiGet<{ fundraiser: Fundraiser; isOwner: boolean; supporters: FundraiserSupporter[]; deadlinePassed: boolean }>(
    `${base}/${encodeURIComponent(slug)}`,
    token,
    { skipCache: true }
  );

export const getPublicFundraiserUpdates = (slug: string, token?: string): Promise<FundraiserUpdate[]> =>
  apiGet<FundraiserUpdate[]>(`${base}/${encodeURIComponent(slug)}/updates`, token);
// ============================================================================
// OWNER DRAFTS & LIFECYCLE
// ============================================================================

export const createFundraiserDraft = (input: FundraiserDraftSubmission, token: string): Promise<Fundraiser> =>
  apiPost<Fundraiser>(`${base}/drafts`, input, token);

export const listMyFundraisers = (token: string): Promise<Fundraiser[]> =>
  apiGet<Fundraiser[]>(`${base}/my`, token, { skipCache: true });

export const getMyFundraiser = (id: string, token: string): Promise<Fundraiser & { evidence: FundraiserEvidenceMeta[] }> =>
  apiGet<Fundraiser & { evidence: FundraiserEvidenceMeta[] }>(`${base}/my/${id}`, token);

export const updateFundraiserDraft = (id: string, input: FundraiserDraftSubmission, token: string): Promise<Fundraiser> =>
  apiPut<Fundraiser>(`${base}/my/${id}`, input, token);

export const submitFundraiserForReview = (id: string, token: string): Promise<{ message: string; fundraiser: Fundraiser }> =>
  apiPost<{ message: string; fundraiser: Fundraiser }>(`${base}/my/${id}/submit`, {}, token);

export const cancelFundraiser = (id: string, token: string): Promise<{ message: string; fundraiser: Fundraiser }> =>
  apiPost<{ message: string; fundraiser: Fundraiser }>(`${base}/my/${id}/cancel`, {}, token);

export const deleteFundraiser = (id: string, token: string): Promise<{ message: string }> =>
  apiDelete<{ message: string }>(`${base}/my/${id}`, token);

export const getMyFundraiserAudit = (id: string, token: string): Promise<FundraiserAuditLogRow[]> =>
  apiGet<FundraiserAuditLogRow[]>(`${base}/my/${id}/audit`, token);

// ============================================================================
// UPDATES
// ============================================================================

export const postFundraiserUpdate = (
  id: string,
  input: { title?: string; body: string; media?: Array<{ type: string; url: string; thumbnailUrl?: string }> },
  token: string
): Promise<FundraiserUpdate> => apiPost<FundraiserUpdate>(`${base}/my/${id}/updates`, input, token);

// ============================================================================
// EVIDENCE
// ============================================================================

export const listMyEvidence = (id: string, token: string): Promise<FundraiserEvidenceMeta[]> =>
  apiGet<FundraiserEvidenceMeta[]>(`${base}/${id}/evidence`, token);

/** Authorized stream URL for a private evidence file (organizer or admin only). */
export const evidenceFileUrl = (fundraiserId: string, evidenceId: string): string =>
  `${base}/${fundraiserId}/evidence/${evidenceId}/file`;

// ============================================================================
// DONATIONS & REPORTS
// ============================================================================

export const donateToFundraiser = (
  id: string,
  input: { amount: number; message?: string; anonymous?: boolean },
  token: string
): Promise<FundraiserDonationResult> => apiPost<FundraiserDonationResult>(`${base}/${id}/donate`, input, token);

export const reportFundraiser = (id: string, input: { reason: string; details?: string }, token: string): Promise<FundraiserReport> =>
  apiPost<FundraiserReport>(`${base}/${id}/report`, input, token);
// ============================================================================
// ADMIN
// ============================================================================

export const adminListFundraisers = (
  params: { status?: string; search?: string; cursor?: string } = {},
  token: string
): Promise<{ items: FundraiserListItem[]; nextCursor?: string }> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiGet<{ items: FundraiserListItem[]; nextCursor?: string }>(`${base}/admin/list${suffix}`, token, { skipCache: true });
};

export const adminGetFundraiser = (id: string, token: string): Promise<AdminFundraiserDetail> =>
  apiGet<AdminFundraiserDetail>(`${base}/admin/${id}`, token, { skipCache: true });

export const adminApproveFundraiser = (
  id: string,
  input: { publish?: boolean; note?: string; verified?: boolean },
  token: string
): Promise<any> => apiPost<any>(`${base}/admin/${id}/approve`, input, token);

export const adminRequestFundraiserInfo = (id: string, message: string, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/request-info`, { message }, token);

export const adminRejectFundraiser = (id: string, reason: string, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/reject`, { reason }, token);

export const adminSuspendFundraiser = (id: string, reason: string, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/suspend`, { reason }, token);

export const adminUnsuspendFundraiser = (id: string, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/unsuspend`, {}, token);

export const adminCompleteFundraiser = (id: string, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/complete`, {}, token);

export const adminSetFundraiserVerified = (id: string, verified: boolean, token: string, note?: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/verify`, { verified, note }, token);

export const adminToggleFundraiserFeatured = (id: string, featured: boolean, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/${id}/feature`, { featured }, token);

export const adminListFundraiserReports = (token: string): Promise<FundraiserReport[]> =>
  apiGet<FundraiserReport[]>(`${base}/admin/reports`, token, { skipCache: true });

export const adminResolveFundraiserReport = (reportId: string, input: { status: string; note?: string }, token: string): Promise<any> =>
  apiPost<any>(`${base}/admin/reports/${reportId}/resolve`, input, token);