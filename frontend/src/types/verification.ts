/**
 * Canonical Verified Badge tier used across the whole VANTA frontend.
 *
 * The backend serializes `verificationType` on every public user object (see
 * backend `services/public-verification.ts`). It is derived from the user's
 * ACTIVE (non-expired) paid badge entitlement — or, for legacy server-verified
 * identities, `GOLD`. A user is only verified when `verified === true`, and at
 * that point `verificationType` is always either `'BLUE'` or `'GOLD'` — it is
 * never a bare truthy flag that silently defaults to GOLD.
 *
 * The `| string` widening that used to appear inline on ~20 component types has
 * been removed so an arbitrary string can never be mistaken for a badge tier.
 */
export type VerificationType = 'BLUE' | 'GOLD';

/** Public API value of a `verificationType` field (absent when unverified). */
export type VerificationTypeValue = VerificationType | null;
