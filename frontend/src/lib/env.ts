/**
 * Production environment variable validation.
 * Validates required env vars at build/start time to prevent silent failures.
 */

const requiredEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const optionalEnvVars = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "NEXT_PUBLIC_REFERRAL_BASE_URL",
] as const;

type EnvStatus = {
  valid: boolean;
  missing: string[];
  warnings: string[];
};

/**
 * Validate that all required environment variables are set.
 * Call this during build/startup to catch configuration errors early.
 */
export function validateEnvironment(): EnvStatus {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  for (const key of optionalEnvVars) {
    if (!process.env[key]) {
      warnings.push(`${key} is not set. Some features may not work.`);
    }
  }

  if (missing.length > 0) {
    console.error(
      `[Environment] Missing required variables:\n${missing
        .map((k) => `  • ${k}`)
        .join("\n")}`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `[Environment] Optional variables not configured:\n${warnings.join("\n")}`
    );
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}