// ============================================================================
// ADMIN USER SEARCH HELPERS
// ----------------------------------------------------------------------------
// Shared normalization + filter builders for the admin user-management
// endpoints, extracted into pure, unit-testable functions.
//
// Search contract:
//  - Input is trimmed; a leading `@` is stripped (`@alex` === `alex`).
//  - Matching is case-insensitive (Prisma `mode: 'insensitive'`, Postgres).
//  - Exact username matches rank ahead of partial username / email /
//    display-name matches (enforced by the two-phase query in the admin
//    controller, using the normalized term produced here).
// ============================================================================

/** Normalize raw admin search input. Returns '' when the input is empty. */
export function normalizeAdminUserSearch(raw: unknown): string {
  const normalized = String(raw ?? '').trim().replace(/^@+/, '').trim();
  return normalized;
}

/**
 * Prisma where-clause fragments for the legacy `verified` filter, extended
 * with badge-aware semantics:
 *  - 'true'  → legacy verified flag OR an ACTIVE (non-expired) badge row.
 *  - 'false' → neither the flag nor an ACTIVE badge row.
 *  - 'BLUE'  → an ACTIVE BLUE badge row.
 *  - 'GOLD'  → an ACTIVE GOLD badge row, or the legacy flag with no badge row.
 *  - anything else (incl. 'ALL') → no filter fragment.
 */
export function buildVerifiedFilters(verified: unknown, now: Date = new Date()): any[] {
  const value = String(verified ?? '').trim().toUpperCase();
  switch (value) {
    case 'TRUE':
      return [
        {
          OR: [
            { verified: true },
            { verificationBadge: { is: activeBadgeCondition(now) } },
          ],
        },
      ];
    case 'FALSE':
      return [
        { verified: false },
        {
          OR: [
            { verificationBadge: null },
            { verificationBadge: { is: inactiveBadgeCondition(now) } },
          ],
        },
      ];
    case 'BLUE':
      return [{ verificationBadge: { is: { ...activeBadgeCondition(now), badgeType: 'BLUE' } } }];
    case 'GOLD':
      return [
        {
          OR: [
            { verificationBadge: { is: { ...activeBadgeCondition(now), badgeType: 'GOLD' } } },
            { AND: [{ verified: true }, { verificationBadge: null }] },
          ],
        },
      ];
    default:
      return [];
  }
}

/** A VerificationBadge row that counts as ACTIVE right now (read-time check). */
export function activeBadgeCondition(now: Date = new Date()): any {
  return {
    status: 'ACTIVE',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/** A VerificationBadge row that is present but NOT active (expired/revoked/...). */
export function inactiveBadgeCondition(now: Date = new Date()): any {
  return {
    OR: [
      { status: { not: 'ACTIVE' } },
      { AND: [{ expiresAt: { not: null } }, { expiresAt: { lte: now } }] },
    ],
  };
}
