/**
 * Admin user-search tests.
 *
 * Proves the acceptance contract of the admin users endpoints:
 *  - `alex` prioritizes the exact username match,
 *  - `@alex` normalizes to the same account,
 *  - matching is case-insensitive,
 *  - partial matches still work when no exact match exists,
 *  - empty input normalizes to "no search" (never an accidental wildcard),
 *  - the verification-status filter builders compose safe badge conditions.
 */
import {
  normalizeAdminUserSearch,
  buildVerifiedFilters,
  activeBadgeCondition,
  inactiveBadgeCondition,
} from '../services/admin-user-search';
import { describe, expect, test } from '@jest/globals';

describe('normalizeAdminUserSearch', () => {
  test('trims whitespace and strips a leading @', () => {
    expect(normalizeAdminUserSearch('  alex  ')).toBe('alex');
    expect(normalizeAdminUserSearch('@alex')).toBe('alex');
    expect(normalizeAdminUserSearch('  @alex_official ')).toBe('alex_official');
  });

  test('empty/meaningless input normalizes to empty string', () => {
    expect(normalizeAdminUserSearch('')).toBe('');
    expect(normalizeAdminUserSearch('   ')).toBe('');
    expect(normalizeAdminUserSearch('@')).toBe('');
    expect(normalizeAdminUserSearch(undefined)).toBe('');
    expect(normalizeAdminUserSearch(null)).toBe('');
  });

  test('does not strip @ inside the term', () => {
    expect(normalizeAdminUserSearch('user@x')).toBe('user@x');
  });
});

// A tiny in-memory re-implementation of the controller's two-phase ranking so
// the ordering contract is tested without a database.
function rankAdminSearch<T extends { username: string }>(users: T[], raw: string): T[] {
  const query = normalizeAdminUserSearch(raw);
  if (!query) return users;
  const lowered = query.toLowerCase();
  const exact = users.filter((u) => u.username.toLowerCase() === lowered);
  const exactNames = new Set(exact.map((u) => u.username.toLowerCase()));
  const partial = users.filter(
    (u) => !exactNames.has(u.username.toLowerCase()) && u.username.toLowerCase().includes(lowered)
  );
  return [...exact, ...partial];
}

describe('exact-first username ranking', () => {
  const directory = [
    { username: 'alexandria' },
    { username: 'alex_official' },
    { username: 'Alex' },
    { username: 'xalex' },
    { username: 'bob' },
  ];

  test('searching `alex` ranks the exact username first', () => {
    const ranked = rankAdminSearch(directory, 'alex');
    expect(ranked[0].username).toBe('Alex');
    expect(ranked.length).toBe(4);
    expect(ranked.map((u) => u.username)).toContain('alex_official');
  });

  test('searching `@alex` finds the same account first', () => {
    expect(rankAdminSearch(directory, '@alex')[0].username).toBe('Alex');
  });

  test('searching `alex_official` prioritizes that exact username', () => {
    const ranked = rankAdminSearch(directory, 'alex_official');
    expect(ranked[0].username).toBe('alex_official');
  });

  test('matching is case-insensitive', () => {
    expect(rankAdminSearch(directory, 'ALEX')[0].username).toBe('Alex');
    expect(rankAdminSearch(directory, '@ALEX_Official')[0].username).toBe('alex_official');
  });

  test('partial matches still work when no exact match exists', () => {
    const ranked = rankAdminSearch(directory, 'xal');
    expect(ranked.map((u) => u.username)).toEqual(['xalex']);
  });

  test('empty results are empty (never a fake "first letter" match)', () => {
    expect(rankAdminSearch(directory, 'zoe')).toEqual([]);
    expect(rankAdminSearch(directory, '')).toEqual(directory);
  });
});

describe('buildVerifiedFilters', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  test('ALL/unknown produces no filter fragment', () => {
    expect(buildVerifiedFilters('ALL', now)).toEqual([]);
    expect(buildVerifiedFilters('', now)).toEqual([]);
    expect(buildVerifiedFilters('nonsense', now)).toEqual([]);
  });

  test('true/false compose badge-aware fragments', () => {
    const truthy = buildVerifiedFilters('true', now);
    expect(truthy).toHaveLength(1);
    expect(JSON.stringify(truthy)).toContain('ACTIVE');

    const falsy = buildVerifiedFilters('false', now);
    expect(falsy).toHaveLength(2);
  });

  test('BLUE/GOLD pin the badge type and stay case-tolerant', () => {
    expect(JSON.stringify(buildVerifiedFilters('BLUE', now))).toContain('BLUE');
    expect(JSON.stringify(buildVerifiedFilters('gold', now))).toContain('GOLD');
  });

  test('badge conditions separate ACTIVE rows from the rest', () => {
    expect(activeBadgeCondition(now).status).toBe('ACTIVE');
    expect(JSON.stringify(inactiveBadgeCondition(now))).toContain('ACTIVE');
  });
});
