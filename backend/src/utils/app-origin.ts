/**
 * Trusted application-origin resolution for security-sensitive URLs
 * (password-reset links, email-verification links, OAuth callbacks).
 *
 * Reset links MUST be built from an explicitly configured origin
 * (APP_PUBLIC_URL, falling back to FRONTEND_URL), never from the incoming
 * HTTP `Host` header — a Host header can be attacker-controlled (DNS
 * rebinding / host-header injection) and would let a phishing page mint
 * VANTA-branded recovery links.
 */
export interface AppOriginResult {
  /** Normalized origin (https://host[:port] with trailing slash stripped) or null. */
  origin: string | null;
  /** Human-readable reason when origin is null, or null when valid. */
  error: string | null;
}

const DEFAULT_DEV_ORIGIN = 'http://localhost:3000';

/**
 * Resolve and validate the trusted public application origin.
 *
 * Rules:
 *  - Reads APP_PUBLIC_URL first, then FRONTEND_URL.
 *  - Must be an absolute http(s) URL with a real hostname.
 *  - In production the scheme MUST be https (browser clipboard/email clients
 *    refuse to deliver links over plain http to end users, and a non-TLS
 *    origin weakens the whole recovery flow).
 *  - In non-production, missing config falls back to http://localhost:3000 so
 *    local development still produces working links.
 */
export function resolveAppOrigin(env: Record<string, string | undefined> = process.env): AppOriginResult {
  const configured = env.APP_PUBLIC_URL || env.FRONTEND_URL;
  const isProduction = env.NODE_ENV === 'production';

  if (!configured) {
    if (isProduction) {
      return {
        origin: null,
        error: 'APP_PUBLIC_URL is not configured. Set APP_PUBLIC_URL to the public https origin of the VANTA frontend (e.g. https://vanta.example.com).',
      };
    }
    return { origin: DEFAULT_DEV_ORIGIN, error: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(configured.trim());
  } catch {
    return {
      origin: null,
      error: `APP_PUBLIC_URL is not a valid absolute URL: "${configured}"`,
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      origin: null,
      error: `APP_PUBLIC_URL must use http(s), got "${parsed.protocol}//"`,
    };
  }

  if (!parsed.hostname) {
    return { origin: null, error: 'APP_PUBLIC_URL is missing a hostname.' };
  }

  if (isProduction && parsed.protocol !== 'https:') {
    return {
      origin: null,
      error: 'APP_PUBLIC_URL must use https:// in production.',
    };
  }

  // Use the normalized origin (protocol://host[:port]) so relative app paths
  // like /reset-password always resolve against the site root.
  return { origin: parsed.origin.replace(/\/+$/, ''), error: null };
}

/**
 * Convenience resolver that returns the normalized origin or throws a clear,
 * actionable error when the trusted origin cannot be established.
 */
export function requireAppOrigin(env: Record<string, string | undefined> = process.env): string {
  const result = resolveAppOrigin(env);
  if (!result.origin) {
    throw new Error(`Cannot build a trusted application link: ${result.error}`);
  }
  return result.origin;
}