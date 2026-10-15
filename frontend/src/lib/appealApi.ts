import { apiPost, apiGet } from './apiClient';
import type { ApiResponse } from './api';

// ============================================================================
// ACCOUNT APPEALS (suspended + banned accounts)
// ----------------------------------------------------------------------------
// Suspended users call these endpoints with their restricted session.
// Banned users have no session: the banned screen carries the short-lived
// appeal token issued at login (`appealToken`) and passes it as the bearer
// token — the backend only honors it on these endpoints while the account is
// still BANNED.
// ============================================================================

export type AppealToken = string;

export interface AppealOverviewAccount {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  status: string;
  suspendedAt?: string | null;
  suspendedReason?: string | null;
  suspendedUntil?: string | null;
  bannedAt?: string | null;
  bannedReason?: string | null;
}

export interface AppealOverview {
  account: AppealOverviewAccount;
  appeal: import('./adminApi').AppealRecord | null;
}

export const submitAppeal = (
  credential: string,
  payload: { category?: string; explanation: string; supportingInfo?: string },
): Promise<{ appeal: import('./adminApi').AppealRecord; message?: string }> => {
  return apiPost<{ appeal: import('./adminApi').AppealRecord; message?: string }>(
    '/api/appeals',
    payload,
    credential,
  );
};

export const getAccountAppealOverview = (credential: string): Promise<AppealOverview> => {
  return apiGet<AppealOverview>('/api/appeals/account', credential);
};

export const getOwnAppeals = (
  credential: string,
): Promise<{ appeals: import('./adminApi').AppealRecord[] }> => {
  return apiGet<{ appeals: import('./adminApi').AppealRecord[] }>('/api/appeals/mine', credential);
};

/** Appeal token storage — session-only so a banned appeal context never persists. */
const APPEAL_TOKEN_KEY = 'vanta_appeal_token';
const APPEAL_USERNAME_KEY = 'vanta_appeal_username';

export const storeAppealContext = (appealToken: string, username?: string): void => {
  try {
    sessionStorage.setItem(APPEAL_TOKEN_KEY, appealToken);
    if (username) sessionStorage.setItem(APPEAL_USERNAME_KEY, username);
  } catch {
    /* storage unavailable — the page holds the token in memory instead */
  }
};

export const readAppealContext = (): { appealToken: string | null; username: string | null } => {
  try {
    return {
      appealToken: sessionStorage.getItem(APPEAL_TOKEN_KEY),
      username: sessionStorage.getItem(APPEAL_USERNAME_KEY),
    };
  } catch {
    return { appealToken: null, username: null };
  }
};

export const clearAppealContext = (): void => {
  try {
    sessionStorage.removeItem(APPEAL_TOKEN_KEY);
    sessionStorage.removeItem(APPEAL_USERNAME_KEY);
  } catch {
    /* ignore */
  }
};
