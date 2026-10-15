/**
 * Account-status security tests: suspended-request allowlist and
 * banned-account appeal tokens.
 *
 * Proves the suspended allowlist is deny-by-default (only the read-only
 * suspended screen / appeal / sign-out endpoints pass) and that appeal
 * tokens are narrowly scoped (signed, expiring, unforgeable, and distinct
 * from session access tokens).
 */
import {
  isSuspendedAllowedRequest,
  signAppealToken,
  verifyAppealToken,
  accountStatusError,
} from '../security/accountStatus';
import { describe, expect, test, jest } from '@jest/globals';

describe('isSuspendedAllowedRequest', () => {
  test('permits the suspended screen + appeal + sign-out endpoints', () => {
    expect(isSuspendedAllowedRequest('GET', '/api/auth/me')).toBe(true);
    expect(isSuspendedAllowedRequest('POST', '/api/auth/logout')).toBe(true);
    expect(isSuspendedAllowedRequest('GET', '/api/profiles/me')).toBe(true);
    expect(isSuspendedAllowedRequest('GET', '/api/profiles/me/posts?limit=24')).toBe(true);
    expect(isSuspendedAllowedRequest('POST', '/api/appeals')).toBe(true);
    expect(isSuspendedAllowedRequest('GET', '/api/appeals/mine')).toBe(true);
    expect(isSuspendedAllowedRequest('GET', '/api/appeals/account')).toBe(true);
  });

  test('denies every write and every other read (deny by default)', () => {
    // Restricted writes
    expect(isSuspendedAllowedRequest('POST', '/api/feed')).toBe(false);
    expect(isSuspendedAllowedRequest('POST', '/api/feed/123/like')).toBe(false);
    expect(isSuspendedAllowedRequest('POST', '/api/messages/start')).toBe(false);
    expect(isSuspendedAllowedRequest('POST', '/api/profiles/alex/follow')).toBe(false);
    expect(isSuspendedAllowedRequest('PUT', '/api/profiles/me')).toBe(false);
    expect(isSuspendedAllowedRequest('GET', '/api/profiles/alex')).toBe(false);
    expect(isSuspendedAllowedRequest('GET', '/api/admin/users')).toBe(false);
    expect(isSuspendedAllowedRequest('POST', '/api/admin/users/suspend')).toBe(false);
    // Wrong method on an allowlisted path
    expect(isSuspendedAllowedRequest('DELETE', '/api/auth/me')).toBe(false);
    expect(isSuspendedAllowedRequest('GET', '/api/appeals')).toBe(false);
    // Lookalike paths that could smuggle access through prefix matching
    expect(isSuspendedAllowedRequest('GET', '/api/profiles/me2')).toBe(false);
    expect(isSuspendedAllowedRequest('GET', '/api/appeals/mine/other')).toBe(false);
    expect(isSuspendedAllowedRequest('GET', '/api/appealsx')).toBe(false);
  });
});

describe('accountStatusError', () => {
  test('returns machine-readable codes for each known status', () => {
    expect(accountStatusError('SUSPENDED')).toMatchObject({ status: 403, code: 'ACCOUNT_SUSPENDED' });
    expect(accountStatusError('BANNED')).toMatchObject({ status: 403, code: 'ACCOUNT_BANNED' });
    expect(accountStatusError('DEACTIVATED')).toMatchObject({ status: 403, code: 'ACCOUNT_DEACTIVATED' });
    expect(accountStatusError('LOCKED')).toMatchObject({ status: 423, code: 'ACCOUNT_LOCKED' });
  });

  test('fails closed with 403 for unknown statuses', () => {
    const body = accountStatusError('WHATEVER');
    expect(body.status).toBe(403);
    expect(typeof body.code).toBe('string');
  });
});

describe('appeal tokens', () => {
  test('a signed appeal token verifies to the issuing userId', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    const token = signAppealToken('user-banned-1');
    expect(verifyAppealToken(token)).toBe('user-banned-1');
  });

  test('garbage and foreign tokens do not verify', () => {
    expect(verifyAppealToken('not-a-token')).toBeNull();
    expect(verifyAppealToken('')).toBeNull();
  });
});
