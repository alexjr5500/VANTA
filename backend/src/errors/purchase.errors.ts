// ============================================================================
// PURCHASE ERROR TYPES (shared by the coin + badge + monetization flows)
// ============================================================================
// Application-level errors the routes translate into clean HTTP responses.
// Prisma/database errors must NEVER be sent to clients as-is; controllers log
// the raw error server-side and reply with a safe generic message instead.
// ============================================================================

/**
 * Raised when a purchase flow references a package/plan id that does not exist
 * as an ACTIVE row in the database (or does not exist at all).
 *
 * The client-supplied id is only a lookup key — every sellable attribute
 * (price, coins, badge type, duration) is resolved server-side from the
 * database record, so this guard guarantees `purchaseOrder.create()` is never
 * reached with a package id that would violate the `PurchaseOrder_packageId_fkey`
 * foreign key.
 */
export class PurchasePackageNotFoundError extends Error {
  readonly statusCode: number = 404;

  constructor(message = 'This purchase package is currently unavailable. Please try again.') {
    super(message);
    this.name = 'PurchasePackageNotFoundError';
  }
}

/**
 * Heuristic for controller catch blocks: Prisma throws errors carrying a
 * `code` (e.g. P2002/P2003/P2025) and `meta`. Any error with a `code` is
 * treated as a system/database error whose raw text must never reach the user.
 */
export function isSystemOrDatabaseError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (typeof (error as { code?: unknown }).code === 'string' ||
      typeof (error as { code?: unknown }).code === 'number')
  );
}
