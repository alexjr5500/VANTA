import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

let loaded = false;

/**
 * Deterministic .env loading for the VANTA backend.
 *
 * The backend process can be launched from different working directories
 * (repo root, `backend/`, dist builds, CI, Electron, etc.) so we can never
 * rely on `dotenv/config` loading the "right" `.env` from `process.cwd()`.
 * The classic symptom of that mismatch is the backend silently falling back
 * to LIVE payment mode (because `VANTA_COIN_PAYMENT_MODE` is not set) and
 * then failing every "Buy Coins" order with:
 *
 *   "the live payment deposit address is not configured"
 *
 * This loader resolves candidate `.env` files deterministically in this
 * priority order (first value seen wins, so explicitly-set process env and
 * deployment-injected variables are never overridden):
 *
 *   1. process.env (already populated by the OS / launcher / CI)
 *   2. backend/.env      (this project's canonical backend configuration)
 *   3. <cwd>/.env        (whatever directory the process was started from)
 *   4. <repo-root>/.env  (monorepo-level fallback)
 *
 * `dotenv` never overwrites an existing variable, so a variable that appears
 * in an earlier candidate always wins over a later candidate.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const backendDir = path.resolve(__dirname, '..', '..'); // src/config|dist/config -> backend/
  const repoRoot = path.resolve(backendDir, '..');

  const candidates: string[] = [
    path.join(backendDir, '.env'),
    path.resolve(process.cwd(), '.env'),
    path.join(repoRoot, '.env'),
  ];

  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      if (fs.existsSync(file)) {
        dotenv.config({ path: file });
      }
    } catch {
      // A missing/unreadable .env must never break backend startup.
      // Environment-injected variables are the source of truth in production.
    }
  }
}

// Self-invoke so a plain `import './config/env'` behaves like `dotenv/config`.
loadEnv();