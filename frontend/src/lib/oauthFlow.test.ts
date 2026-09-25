// @vitest-environment node
/**
 * Unit coverage for the Google/Telegram OAuth flow helpers used by the
 * login/register screens: provider callback parameter parsing, open-redirect
 * destination safety, and user-facing error mapping.
 */
import { describe, expect, test } from 'vitest';
import {
  oauthReasonMessage,
  parseOAuthCallbackParams,
  safeOAuthDestination,
} from './oauthFlow';

describe('parseOAuthCallbackParams', () => {
  test('parses a successful provider sign-in callback (?oauth=google&code=…)', () => {
    const params = parseOAuthCallbackParams('?oauth=google&code=abc123&redirect=%2Freels');
    expect(params.provider).toBe('google');
    expect(params.code).toBe('abc123');
    expect(params.redirect).toBe('/reels');
    expect(params.ticket).toBe('');
    expect(params.status).toBe('');
    expect(params.reason).toBe('');
  });

  test('parses a new-provider registration redirect (?oauth=telegram&ticket=…)', () => {
    const params = parseOAuthCallbackParams('?oauth=telegram&ticket=eyJ.tok&email=u%40e.com&name=A');
    expect(params.provider).toBe('telegram');
    expect(params.ticket).toBe('eyJ.tok');
    expect(params.email).toBe('u@e.com');
    expect(params.name).toBe('A');
    expect(params.code).toBe('');
  });

  test('parses an error redirect (?oauth=google&status=error&reason=existing-account)', () => {
    const params = parseOAuthCallbackParams('?oauth=google&status=error&reason=existing-account');
    expect(params.provider).toBe('google');
    expect(params.status).toBe('error');
    expect(params.reason).toBe('existing-account');
  });

  test('returns provider=null for a non-OAuth query string', () => {
    const params = parseOAuthCallbackParams('?redirect=%2Fhome');
    expect(params.provider).toBeNull();
    expect(params.code).toBe('');
  });

  test('ignores an unknown provider value', () => {
    const params = parseOAuthCallbackParams('?oauth=apple&code=x');
    expect(params.provider).toBeNull();
  });
});

describe('safeOAuthDestination', () => {
  test('keeps same-app absolute paths', () => {
    expect(safeOAuthDestination('/reels')).toBe('/reels');
    expect(safeOAuthDestination('/profile/me')).toBe('/profile/me');
  });

  test('rejects protocol-relative and absolute URLs (open-redirect defence)', () => {
    expect(safeOAuthDestination('//evil.example.com')).toBe('/reels');
    expect(safeOAuthDestination('https://evil.example.com')).toBe('/reels');
    expect(safeOAuthDestination('http://evil.example.com')).toBe('/reels');
  });

  test('rejects whitespace, backslashes and empty values', () => {
    expect(safeOAuthDestination('/reels\\evil')).toBe('/reels');
    expect(safeOAuthDestination('/reels evil')).toBe('/reels');
    expect(safeOAuthDestination('')).toBe('/reels');
    expect(safeOAuthDestination(null)).toBe('/reels');
    expect(safeOAuthDestination(undefined)).toBe('/reels');
  });
});

describe('oauthReasonMessage', () => {
  const cases: Array<[string, string]> = [
    ['cancelled', 'Sign-in was cancelled.'],
    ['existing-account', 'already used by an existing VANTA account'],
    ['not-configured', 'not set up yet'],
    ['invalid-state', 'invalid or has expired'],
    ['expired-code', 'has expired'],
    ['already-linked', 'already linked to another VANTA account'],
    ['account-restricted', 'restricted'],
    ['provider-unavailable', 'could not be reached'],
  ];
  for (const [reason, expectedFragment] of cases) {
    test(`maps ${reason} to a user-facing message`, () => {
      expect(oauthReasonMessage(reason).toLowerCase()).toContain(expectedFragment.toLowerCase());
    });
  }

  test('maps unknown reasons to a generic message', () => {
    const text = oauthReasonMessage('some-unknown-reason').toLowerCase();
    expect(text).toContain('could not complete sign-in');
  });

  test('never leaks internal error details', () => {
    const text = oauthReasonMessage('jwt expired: token_signature_invalid');
    expect(text).not.toContain('jwt');
    expect(text).not.toContain('signature');
  });
});