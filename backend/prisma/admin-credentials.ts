/**
 * VANTA - Administrator Credentials Configuration
 *
 * The administrator password is intentionally NOT hard-coded in source. It is
 * read from the environment so the value never leaks into the git repository
 * or the compiled bundle:
 *
 *   - Production (Railway): set `ADMIN_PASSWORD` in the backend service
 *     Variables. If it is missing, seeding FAILS FAST rather than creating an
 *     admin with a guessable default.
 *
 *   - Local development: `.env` (backend/.env or repo-root .env) may set
 *     `ADMIN_PASSWORD`. When unset in a non-production environment, a random
 *     password is generated and printed once to STDOUT so a developer can log
 *     into the local admin account.
 *
 * The VANTA administrator identity is fixed to the explicitly designated
 * account below. Only the password remains environment-provided.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Resolve and load dotenv candidates the same way the backend runtime does
 * (see backend/src/config/env.ts) so `npm run seed` and `verify-admin.ts`
 * pick up ADMIN_PASSWORD from the same environment files.
 */
function loadEnvForPrisma(): void {
  const backendDir = path.resolve(__dirname); // backend/prisma
  const repoRoot = path.resolve(backendDir, '..'); // backend
  const monorepoRoot = path.resolve(repoRoot, '..'); // repo root

  const candidates = [
    path.join(repoRoot, '.env'), // backend/.env
    path.resolve(process.cwd(), '.env'),
    path.join(monorepoRoot, '.env'), // repo-root/.env
  ];

  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      if (fs.existsSync(file)) {
        // Minimal inline dotenv parse to avoid a hard dependency in prisma scripts.
        const raw = fs.readFileSync(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim();
          let value = trimmed.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (key && process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
      }
    } catch {
      // Ignore unreadable .env files; environment vars are authoritative.
    }
  }
}

loadEnvForPrisma();

/** Canonical administrator identity comes from backend environment variables. */
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'vantapp74@gmail.com').trim().toLowerCase();
export const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'alex').trim();
export const ADMIN_FULL_NAME = (process.env.ADMIN_FULL_NAME || ADMIN_USERNAME).trim();

/**
 * Admin password resolution:
 *  - ADMIN_PASSWORD env var (authoritative).
 *  - In non-production, a generated random password is returned and logged once.
 *  - In production, missing ADMIN_PASSWORD throws so we never bake in a default.
 */
export function resolveAdminPassword(): string {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    throw new Error(
      'ADMIN_PASSWORD is not set. Refusing to seed an administrator without an explicit ' +
        'production password. Set ADMIN_PASSWORD in the Railway backend Variables and re-run the seed.',
    );
  }

  const generated = crypto.randomBytes(18).toString('base64');
  console.warn(
    '\n⚠️  No ADMIN_PASSWORD environment variable set in a non-production environment.\n' +
      `   A temporary admin password was generated for local development:\n\n      ${generated}\n` +
      '   Add ADMIN_PASSWORD to backend/.env to use a stable password.\n',
  );
  return generated;
}