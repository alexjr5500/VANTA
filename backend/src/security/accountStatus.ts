// ============================================================================
// VANTA ACCOUNT-STATUS SECURITY
// ----------------------------------------------------------------------------
// Single source of truth for how account moderation states (ACTIVE,
// SUSPENDED, BANNED, DEACTIVATED, LOCKED) translate into HTTP responses and
// what a restricted account is still allowed to do.
//
// Machine-readable `code` values let the frontend route suspended users to the
// dedicated suspended screen and banned users to the banned/appeal screen
// instead of a generic error — while the backend remains the enforcement
// point for every protected mutation.
// ============================================================================
import jwt from 'jsonwebtoken';
import { config } from './config';

/** Machine-readable account-status error codes returned with HTTP 403. */
export const ACCOUNT_STATUS_CODES = {
  ACTIVE: 'ACCOUNT_ACTIVE',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
  BANNED: 'ACCOUNT_BANNED',
  DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  LOCKED: 'ACCOUNT_LOCKED',
} as const;

export type AccountStatusCode =
  (typeof ACCOUNT_STATUS_CODES)[keyof typeof ACCOUNT_STATUS_CODES];

export interface AccountStatusErrorBody {
  status: number;
  error: string;
  code: AccountStatusCode | string;
}

const STATUS_ERROR_BODIES: Record<string, AccountStatusErrorBody> = {
  SUSPENDED: { status: 403, error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' },
  BANNED: { status: 403, error: 'Account banned', code: 'ACCOUNT_BANNED' },
  DEACTIVATED: { status: 403, error: 'Account deactivated', code: 'ACCOUNT_DEACTIVATED' },
  LOCKED: { status: 423, error: 'Account locked', code: 'ACCOUNT_LOCKED' },
};

/** HTTP status + error + machine-readable code for a restricted account. */
export function accountStatusError(status: string): AccountStatusErrorBody {
  return STATUS_ERROR_BODIES[status] || {
    status: 403,
    error: 'Account restricted',
    code: 'ACCOUNT_STATUS_RESTRICTED',
  };
}

// ----------------------------------------------------------------------------
// Suspended-account restricted allowlist
// ----------------------------------------------------------------------------
// A suspended account keeps a valid session so it can sign in, read the
// suspension notice, submit/track an appeal and sign out — and NOTHING else.
// Every other authenticated endpoint (posts, likes, comments, messages,
// follows, profile edits, admin, ...) is denied with 403 ACCOUNT_SUSPENDED,
// so restrictions cannot be bypassed by calling the API directly.
//
// Entries are `METHOD pathname` pairs. Pathnames are matched against the
// absolute request path (query string stripped), exactly.
// ----------------------------------------------------------------------------
const SUSPENDED_ALLOWED_ROUTES: readonly string[] = [
  // Session/account introspection + sign-out
  'GET /api/auth/me',
  'POST /api/auth/logout',
  // Read-only own profile (suspended screen / own profile may render, never write)
  'GET /api/profiles/me',
  'GET /api/profiles/me/*',
  // Appeal submission + status (restricted scope, no admin data)
  'POST /api/appeals',
  'GET /api/appeals/mine',
  'GET /api/appeals/account',
];

/** Strip query string + hash from an absolute request URL/path. */
function normalizeRequestPath(path: string): string {
  const withoutQuery = path.split('?')[0].split('#')[0];
  return withoutQuery.length > 1 && withoutQuery.endsWith('/')
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

/**
 * True when a SUSPENDED account may perform this exact request. Deny by
 * default: anything not explicitly allowlisted is a restricted mutation or
 * protected resource and must be rejected.
 */
export function isSuspendedAllowedRequest(method: string, path: string): boolean {
  const normalizedMethod = (method || 'GET').toUpperCase();
  const normalizedPath = normalizeRequestPath(path);
  return SUSPENDED_ALLOWED_ROUTES.some((route) => {
    const [routeMethod, routePath] = route.split(' ');
    if (routeMethod !== normalizedMethod) return false;
    if (routePath.endsWith('/*')) {
      const prefix = routePath.slice(0, -2);
      return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
    }
    return normalizedPath === routePath;
  });
}

// ----------------------------------------------------------------------------
// Banned-account appeal token
// ----------------------------------------------------------------------------
// A banned user never receives an application session. After credential
// verification at login we issue a short-lived, narrowly-scoped JWT that ONLY
// the appeal endpoints accept. It carries no role, no sessionId and cannot be
// refreshed or exchanged for an access token.
// ----------------------------------------------------------------------------
export const APPEAL_TOKEN_TYPE = 'vanta-appeal';
export const APPEAL_TOKEN_EXPIRES_IN = process.env.APPEAL_TOKEN_EXPIRES_IN || '30m';

export interface AppealTokenPayload {
  userId: string;
  type: typeof APPEAL_TOKEN_TYPE;
}

/** Issue the short-lived appeal token handed to a banned user at login. */
export function signAppealToken(userId: string): string {
  return jwt.sign({ userId, type: APPEAL_TOKEN_TYPE }, config.jwt.accessToken.secret(), {
    expiresIn: APPEAL_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verify an appeal token. Returns the userId on success, null otherwise.
 * The token is only honored while the referenced account is still BANNED —
 * callers must re-check account status against the database.
 */
export function verifyAppealToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, config.jwt.accessToken.secret()) as AppealTokenPayload;
    if (!decoded || decoded.type !== APPEAL_TOKEN_TYPE || !decoded.userId) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}
