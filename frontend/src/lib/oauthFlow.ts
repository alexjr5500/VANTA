import type { AuthResponse } from '@/lib/authApi';
import { API_BASE_URL, ApiError } from '@/lib/api';

// ============================================================================
// Pure helpers for the Google / Telegram OAuth sign-in + sign-up flows used by
// the login/register screens. Kept free of React/DOM so the redirect-parsing,
// user-facing error mapping, and destination safety can be unit tested.
// ============================================================================

export type OAuthProviderName = 'google' | 'telegram';

export interface OAuthCallbackParams {
  provider: OAuthProviderName | null;
  code: string;
  ticket: string;
  email: string;
  name: string;
  redirect: string;
  status: string;
  reason: string;
}

/**
 * Read the provider callback parameters the backend appends to the login or
 * register URL after a provider round-trip (e.g. `/login?oauth=google&code=…`
 * or `/register?oauth=telegram&ticket=…`). Returns empty values for absent
 * parameters so callers can branch on truthiness.
 */
export const parseOAuthCallbackParams = (search: string): OAuthCallbackParams => {
  const params = new URLSearchParams(search);
  const providerRaw = params.get('oauth');
  const provider = providerRaw === 'google' || providerRaw === 'telegram' ? providerRaw : null;
  return {
    provider,
    code: params.get('code') || '',
    ticket: params.get('ticket') || '',
    email: params.get('email') || '',
    name: params.get('name') || '',
    redirect: params.get('redirect') || '',
    status: params.get('status') || '',
    reason: params.get('reason') || '',
  };
};

/**
 * Only allow same-app absolute paths (starting with a single `/`). Rejects
 * `//host`, backslashes, whitespace and absolute URLs. Mirrors the backend
 * `safeFrontendPath` rule.
 */
export const safeOAuthDestination = (value: string | null | undefined): string => {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/reels';
  if (/[\u0000-\u0020\\]/.test(raw)) return '/reels';
  return raw;
};

/** Map backend OAuth error reasons to user-facing messages. */
export const oauthReasonMessage = (reason: string): string => {
  switch (reason) {
    case 'cancelled':
      return 'Sign-in was cancelled. Your account has not been changed.';
    case 'existing-account':
      return 'This provider account is already used by an existing VANTA account. Sign in with your VANTA email and password instead.';
    case 'not-configured':
      return 'This sign-in option is not set up yet. Please try another method.';
    case 'invalid-state':
    case 'invalid-callback':
      return 'This sign-in link is invalid or has expired. Please try again.';
    case 'expired-code':
    case 'invalid-code':
      return 'This sign-in link has expired. Please try again.';
    case 'already-linked':
      return 'This provider account is already linked to another VANTA account.';
    case 'account-restricted':
      return 'This account is restricted. Please contact support.';
    case 'provider-unavailable':
      return 'The sign-in provider could not be reached. Please try again.';
    case 'login-failed':
    default:
      return 'We could not complete sign-in. Please try again.';
  }
};

export const providerDisplayName = (provider: OAuthProviderName): string =>
  provider === 'google' ? 'Google' : 'Telegram';

export const oauthAuthorizeEndpoint = (provider: OAuthProviderName, redirect?: string): string => {
  const apiBase = (() => {
    if (typeof window !== 'undefined') {
      const configured = process.env.NEXT_PUBLIC_API_URL;
      if (configured) return configured.replace(/\/+$/, '');
      const hostname = window.location.hostname;
      const backendHost = hostname === 'localhost' || hostname === '127.0.0.1' ? 'localhost' : hostname;
      return `${window.location.protocol}//${backendHost}:5000`;
    }
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  })();
  const path = `/api/auth/oauth/authorize/${provider}`;
  if (!redirect || redirect.startsWith('//')) return `${apiBase}${path}`;
  return `${apiBase}${path}?redirect=${encodeURIComponent(redirect)}`;
};

export interface OAuthCreateAccountPayload {
  ticket: string;
  username: string;
  fullName?: string;
}

/**
 * Thin wrappers so the component only deals with typed calls. The exchange and
 * registration responses are the same AuthResponse shape as login/register.
 */
export const oauthExchange = (code: string): Promise<AuthResponse> =>
  postOAuth<AuthResponse>('/api/auth/oauth/exchange', { code });

export const oauthCompleteRegistration = (payload: OAuthCreateAccountPayload): Promise<AuthResponse> =>
  postOAuth<AuthResponse>('/api/auth/oauth/register', payload);

export const oauthStatus = (provider: OAuthProviderName): Promise<{ configured?: boolean }> =>
  postOAuth<{ configured?: boolean }>(`/api/auth/oauth/status/${provider}`, undefined, true);

async function postOAuth<T>(path: string, body?: unknown, isGet = false): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: isGet ? undefined : JSON.stringify(body || {}),
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'Network error');
  }
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    throw new ApiError(response.status, typeof data.error === 'string' ? data.error : 'Request failed', data);
  }
  return data as T;
}