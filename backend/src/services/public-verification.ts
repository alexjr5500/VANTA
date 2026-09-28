// ============================================================================
// PUBLIC VERIFICATION SERIALIZATION HELPER
// ============================================================================
// Single source of truth for how a "user" object rendered in any public
// context (feed, posts, comments, messages, search, live, stories,
// notifications...) reflects their Verified Badge entitlement.
//
// `verified` is the boolean all existing components already render on, and it
// now ALSO reflects an active paid badge (not only `User.verified`). The
// `verificationType` carries the explicit BLUE/GOLD tier the frontend badge
// renders, so Blue and Gold can never be confused.
//
// The badge is only considered active when it is ACTIVE and not yet expired —
// the frontend can never make an expired badge display.
// ============================================================================

export const BADGE_USER_SELECT = {
  verificationBadge: { select: { badgeType: true, status: true, expiresAt: true } },
} as const;

export type BadgeAwareUser = Record<string, any>;

/** True when a (potentially stale) badge row should be treated as active now. */
export function isBadgeRowActive(badge?: { status?: string | null; expiresAt?: Date | string | null } | null): boolean {
  if (!badge || badge.status !== 'ACTIVE') return false;
  if (!badge.expiresAt) return true; // lifetime badge (admin grants)
  return new Date(badge.expiresAt).getTime() > Date.now();
}

/**
 * Enrich a raw Prisma user row (that includes `verificationBadge`) into the
 * object the whole frontend consumes. Idempotent: safe to re-apply.
 */
export function enrichPublicUser<T extends BadgeAwareUser | null | undefined>(user: T): T {
  if (!user) return user;
  const badgeActive = isBadgeRowActive(user.verificationBadge);
  const serverVerified = Boolean(user.verified);

  const enriched: BadgeAwareUser = {
    ...user,
    verified: serverVerified || badgeActive,
    // Explicit tier: a paid badge wins; otherwise the legacy server-verified
    // identity keeps the Gold badge that the whole app already displays.
    verificationType: badgeActive
      ? user.verificationBadge.badgeType === 'BLUE'
        ? 'BLUE'
        : 'GOLD'
      : serverVerified
        ? 'GOLD'
        : user.verificationBadge?.badgeType || null,
  };
  if ('verificationBadge' in enriched) delete enriched.verificationBadge;
  return enriched as T;
}

/**
 * Apply enrichment to a possibly-nested list of users (posts/items carrying an
 * `author`/`user`/`host`/`creator` key, or a plain array of users).
 */
export function enrichItemAuthors<T extends BadgeAwareUser>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  const out: BadgeAwareUser = { ...item };
  for (const key of ['author', 'user', 'creator', 'host'] as const) {
    if (out[key] && typeof out[key] === 'object') {
      out[key] = enrichPublicUser(out[key]);
    }
  }
  return out as T;
}