import type { AuthUser } from '@/lib/authApi';

// Server staff can still create fundraisers even if their own profile badge is
// disabled — this mirrors the backend policy in `fundraiser.service.ts`.
const STAFF_ROLES = new Set(['ADMIN', 'CEO', 'SUPER_ADMIN']);

/**
 * Whether a user may create/start a fundraiser. Only VERIFIED users may create
 * fundraisers (platform staff are exempt). This is a UX gate; the backend
 * enforces the same rule server-side and must never be bypassed.
 */
export function canCreateFundraiser(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.verified === true) return true;
  const role = String(user.role || '').toUpperCase();
  return STAFF_ROLES.has(role);
}
