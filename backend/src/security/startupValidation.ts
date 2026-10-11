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

/**
 * Validate the password-recovery (forgot/reset) configuration. These settings
 * are NOT production-blocking (the rest of VANTA keeps working without email),
 * but missing values are logged loudly so operators know self-service password
 * recovery cannot complete until they are configured.
 */
export interface RecoveryConfigValidationResult {
  isProduction: boolean;
  missing: string[];
}

export function validateRecoveryConfiguration(env: Record<string, string | undefined> = process.env): RecoveryConfigValidationResult {
  const isProduction = env.NODE_ENV === 'production';
  const missing: string[] = [];

  // Trusted app origin used to build reset links. In non-production the
  // resolver falls back to http://localhost:3000 when nothing is configured.
  if (!env.APP_PUBLIC_URL && !env.FRONTEND_URL) {
    missing.push('APP_PUBLIC_URL');
  }

  if (isProduction) {
    // Self-service recovery REQUIRES a working transactional email provider.
    if (!env.SENDGRID_API_KEY) missing.push('SENDGRID_API_KEY');
    if (!env.EMAIL_FROM_ADDRESS) missing.push('EMAIL_FROM_ADDRESS');
  }

  return { isProduction, missing };
}

/**
 * Log a clear, non-fatal warning for missing recovery configuration. Never
 * crashes startup: the rest of the application remains fully functional and
 * only the email-delivery step of password recovery degrades.
 */
export function warnRecoveryConfiguration(env: Record<string, string | undefined> = process.env): void {
  const result = validateRecoveryConfiguration(env);
  if (result.missing.length === 0) return;
  const label = result.isProduction ? 'PRODUCTION' : 'DEVELOPMENT';
  console.warn(
    `[EMAIL][${label}] Password recovery requires configuration that is currently missing: ${result.missing.join(', ')}. ` +
    'Until configured, forgot-password will not deliver reset emails (issued tokens are not left outstanding). ' +
    'See docs/PASSWORD_RECOVERY.md for setup steps.'
  );
}