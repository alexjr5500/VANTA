/**
 * Fail-closed production secret validation (Phase 2).
 *
 * This module is intentionally PURE (no prisma/socket/express imports) so it
 * can run first during startup and be unit-tested in isolation.
 *
 * Rules:
 *  - production requires JWT_SECRET, JWT_REFRESH_SECRET and ENCRYPTION_KEY;
 *  - production rejects the documented development defaults;
 *  - non-production only warns.
 */
export interface SecretValidationResult {
  isProduction: boolean;
  missing: string[];
  weak: string[];
  ok: boolean;
}

const WEAK_JWT_SECRETS = new Set([
  'fallback_secret',
  'change-this-to-a-strong-random-secret-in-production',
  'change-this-to-a-different-strong-random-secret',
  'vanta-dev-secret',
  'vanta-dev-refresh-secret',
  'secret',
]);

export function validateProductionSecrets(env: Record<string, string | undefined> = process.env): SecretValidationResult {
  const isProduction = env.NODE_ENV === 'production';
  const missing: string[] = [];
  const weak: string[] = [];

  if (!env.JWT_SECRET) {
    missing.push('JWT_SECRET');
  } else if (WEAK_JWT_SECRETS.has(env.JWT_SECRET)) {
    weak.push('JWT_SECRET');
  }

  if (!env.JWT_REFRESH_SECRET) {
    missing.push('JWT_REFRESH_SECRET');
  } else if (WEAK_JWT_SECRETS.has(env.JWT_REFRESH_SECRET)) {
    weak.push('JWT_REFRESH_SECRET');
  }

  if (!env.ENCRYPTION_KEY) {
    missing.push('ENCRYPTION_KEY');
  }

  return { isProduction, missing, weak, ok: !(isProduction && (missing.length > 0 || weak.length > 0)) };
}

/**
 * Enforce the policy (abort when invalid in production, warn otherwise).
 * Throws ONLY in production so a misconfigured backend never serves traffic
 * with forgeable/guessable credentials.
 */
export function enforceSecretPolicy(env: Record<string, string | undefined> = process.env): void {
  const result = validateProductionSecrets(env);

  if (result.isProduction) {
    if (result.missing.length > 0) {
      const msg =
        `Production startup aborted — missing required secrets: ${result.missing.join(', ')}. ` +
        'Set strong random secrets (crypto.randomBytes(32).toString("hex")) before launching.';
      console.error(`[SECURITY] FATAL: ${msg}`);
      throw new Error(msg);
    }
    if (result.weak.length > 0) {
      const msg =
        `Production startup aborted — development/default secrets must never be used in production: ${result.weak.join(', ')}`;
      console.error(`[SECURITY] FATAL: ${msg}`);
      throw new Error(msg);
    }
    return;
  }

  if (result.missing.includes('JWT_SECRET')) console.warn('[SECURITY] JWT_SECRET is not set. Using a development fallback is unsafe for production.');
  if (result.missing.includes('JWT_REFRESH_SECRET')) console.warn('[SECURITY] JWT_REFRESH_SECRET is not set. Using JWT_SECRET as fallback (development only).');
  if (result.missing.includes('ENCRYPTION_KEY')) console.warn('[SECURITY] ENCRYPTION_KEY is not set. Sensitive data will not be encrypted at rest.');
}