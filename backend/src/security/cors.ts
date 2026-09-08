/**
 * VANTA CORS allow-list logic.
 *
 * The allow list is intentionally STRICT and exact-origin based — never a
 * wildcard ("*"): VANTA authenticates API clients with JWT Bearer headers and
 * session cookies, so the backend must echo the exact request origin. Unknown
 * origins are denied (no `Access-Control-Allow-Origin` header is emitted),
 * which is what makes the browser block the cross-origin response.
 *
 * Origin sources (all exact origins):
 *   1. CORS_ALLOWED_ORIGINS — comma-separated env var (extra production origins)
 *   2. FRONTEND_URL         — the canonical frontend origin
 *   3. https://vanta-nu.vercel.app — the deployed Vercel frontend. Always
 *      allowed even if a Railway environment variable is missing so the
 *      production web app can never be taken down by a config typo.
 *   4. http://127.0.0.1:3000 — local development default
 *   5. Electron app://*     — desktop client
 *
 * In development only, localhost / private-LAN origins on port 3000 are also
 * accepted so a physical phone on the same LAN can reach the laptop-hosted
 * frontend. Production relies exclusively on the explicit allow list above.
 */

export interface CorsEnv {
  CORS_ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;
  ELECTRON_URL?: string;
}

/** Exact production frontend origin (Vercel deployment). Keep in sync with the
 *  Vercel project and deploy/PROD_ENV_GUIDE.md. */
export const PRODUCTION_FRONTEND_ORIGIN = 'https://vanta-nu.vercel.app';

/** Strip surrounding whitespace and trailing slashes so `https://x/` == `https://x`. */
export const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '');

/** A literal wildcard would disable the origin whitelist. VANTA never uses
 *  `Access-Control-Allow-Origin: *` (cookie/Bearer-auth + credentials), so
 *  drop it defensively if it is ever configured. */
const isOriginEntryValid = (origin: string): boolean => origin !== '*';

/** Build the exact-origin allow list from the environment (defaults to
 *  process.env when no argument is supplied). */
export function buildAllowedOrigins(env: CorsEnv = process.env): string[] {
  const extraOrigins = (env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(isOriginEntryValid);

  const frontendOrigin = normalizeOrigin(env.FRONTEND_URL || 'http://localhost:3000');
  const electronOrigin = normalizeOrigin(env.ELECTRON_URL || 'app://.');

  const origins = [
    ...extraOrigins,
    frontendOrigin,
    electronOrigin,
    'http://127.0.0.1:3000',
    PRODUCTION_FRONTEND_ORIGIN,
  ];
  return [...new Set(origins)];
}

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

const isPrivateLanHostname = (hostname: string): boolean =>
  /^10\./.test(hostname) ||
  /^192\.168\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

/** Localhost / private-LAN origins on port 3000 are local dev frontends.
 *  `isProduction` gates the private-LAN branch — production must only ever
 *  trust the explicit allow list. */
export function isAllowedLocalOrigin(origin: string, isProduction: boolean): boolean {
  try {
    const url = new URL(normalizeOrigin(origin));
    const hostname = url.hostname.toLowerCase();
    // URL.port returns a number when present and '' otherwise; compare as a
    // string so `3000 === '3000'` cannot silently fail.
    const port = url.port ? String(url.port) : (url.protocol === 'https:' ? '443' : '80');
    if (LOCAL_HOSTNAMES.includes(hostname) && port === '3000') return true;
    if (!isProduction && port === '3000' && isPrivateLanHostname(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Decide whether a request Origin may be answered with an ACAO header.
 *  Requests without an Origin header (curl, server-to-server, same-origin)
 *  always pass through. */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
  isProduction: boolean,
): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalized)) return true;
  if (normalized.startsWith('app://')) return true;
  return isAllowedLocalOrigin(normalized, isProduction);
}