// ============================================================================
// VANTA VERIFIED BADGE PLANS — PAYMENT CATALOG & PURCHASE CONSTANTS
// ============================================================================
//
// Server-authoritative catalog for the paid Verified Badge system. The client
// can only ever reference a plan id; the backend alone resolves the
// badgeType, duration, and price — a tampered price or duration from the
// frontend is never trusted (the amount a user pays is always the value in
// this catalog, and the entitlement is computed from `durationMonths`).
//
// Payment mode / deposit address / webhook secret / test-simulate token
// helpers are SHARED with the existing Buy-Coins payment provider
// (see ./coin-payments.config.ts) so both purchase flows talk to the same
// provider configuration.
// ============================================================================

export interface VerifiedBadgePlan {
  id: string;
  name: string;
  badgeType: 'BLUE' | 'GOLD';
  durationMonths: number;
  durationLabel: string;
  priceUSD: number;
  description: string;
  benefits: string[];
  sortOrder: number;
}

export const VERIFIED_BADGE_PLANS: readonly VerifiedBadgePlan[] = Object.freeze([
  {
    id: 'plan_blue_1month',
    name: 'Blue Verified — 1 Month',
    badgeType: 'BLUE',
    durationMonths: 1,
    durationLabel: '1 month',
    priceUSD: 1.99,
    description: 'Blue Verified badge for 1 month.',
    benefits: ['Blue Verified badge', 'Verified account status', 'Invalidates on expiry'],
    sortOrder: 10,
  },
  {
    id: 'plan_blue_3months',
    name: 'Blue Verified — 3 Months',
    badgeType: 'BLUE',
    durationMonths: 3,
    durationLabel: '3 months',
    priceUSD: 4.99,
    description: 'Blue Verified badge for 3 months.',
    benefits: ['Blue Verified badge', 'Verified account status', 'Save vs monthly'],
    sortOrder: 11,
  },
  {
    id: 'plan_blue_6months',
    name: 'Blue Verified — 6 Months',
    badgeType: 'BLUE',
    durationMonths: 6,
    durationLabel: '6 months',
    priceUSD: 8.99,
    description: 'Blue Verified badge for 6 months.',
    benefits: ['Blue Verified badge', 'Verified account status', 'Best Blue value'],
    sortOrder: 12,
  },
  {
    id: 'plan_gold_1year',
    name: 'Gold Verified — 1 Year',
    badgeType: 'GOLD',
    durationMonths: 12,
    durationLabel: '1 year',
    priceUSD: 14.99,
    description: 'Gold Verified badge for 1 year.',
    benefits: ['Gold Verified badge', 'Creator Studio access', 'Top verified status'],
    sortOrder: 20,
  },
]);

export const BADGE_PLAN_BY_ID: ReadonlyMap<string, VerifiedBadgePlan> = new Map(
  VERIFIED_BADGE_PLANS.map((plan) => [plan.id, plan])
);

/** Orders expire this long after creation if no verified payment arrives. */
export const VERIFICATION_PURCHASE_TTL_SECONDS = 1800; // 30 minutes

/** Purchase order lifecycle statuses (mirrors the Buy-Coins order statuses). */
export const VERIFICATION_PURCHASE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
});

/** Statuses the atomic activation claim will accept (i.e. not yet activated). */
export const VERIFICATION_PURCHASE_ACTIVABLE_STATUSES: readonly string[] = Object.freeze([
  VERIFICATION_PURCHASE_STATUS.PENDING,
  VERIFICATION_PURCHASE_STATUS.PROCESSING,
  VERIFICATION_PURCHASE_STATUS.PAID,
]);

/** Badge statuses considered "currently displayed as verified". */
export const ACTIVE_BADGE_STATUSES: readonly string[] = Object.freeze(['ACTIVE']);

/** Array form for `.includes()` visibility in older TS settings. */
export function isVerifiedBadgePlanId(value: unknown): value is string {
  return typeof value === 'string' && BADGE_PLAN_BY_ID.has(value);
}