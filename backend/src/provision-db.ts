import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Provision the PostgreSQL schema before the API starts listening.
 *
 * This is the application-level safety net for Railway: `backend/railway.json`
 * already runs `npx prisma migrate deploy` in its start command, but
 * provisioning from inside the app guarantees the schema is applied even if a
 * deployment platform setting ever overrides that start command. It only runs
 * when:
 *
 *   - NODE_ENV === "production" (never in local dev/tests), and
 *   - DATABASE_URL is a PostgreSQL URL (never SQLite).
 *
 * Schema management is PRISMA MIGRATE ONLY:
 *
 *   * `prisma migrate deploy` applies the COMMITTED, reviewed migrations in
 *     backend/prisma/migrations/ — including
 *     20261005000000_baseline_production_schema (an idempotent, additive-only
 *     snapshot of the production schema) and the additive
 *     20261006000000_transfer_otp_challenges migration that adds the
 *     CoinTransfer.requestId idempotency column + UNIQUE(senderId, requestId)
 *     without touching existing rows (legacy rows keep NULL requestId).
 *
 *   * We deliberately do NOT use `prisma db push` in production anymore: `db
 *     push` is a diff-based "make the schema match" tool that refuses to add a
 *     new unique constraint without --accept-data-loss (the exact failure that
 *     crashed the production deploy), and it never records migration history.
 *     `migrate deploy` applies the exact reviewed SQL instead, so the 12
 *     existing COMPLETED CoinTransfer rows and all wallet balances are
 *     untouched. A genuinely breaking migration fails loudly (after retries)
 *     instead of dropping data.
 */
export function provisionDatabaseSchema(options: { retries?: number; retryDelayMs?: number } = {}): void {
  const { retries = 10, retryDelayMs = 5000 } = options;

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set; cannot provision the database schema.');
  }
  if (!/^postgres(?:ql)?:\/\//i.test(dbUrl)) {
    throw new Error(
      'DATABASE_URL does not point at PostgreSQL; refusing to provision the schema. ' +
        'The deployment database must stay on PostgreSQL (never SQLite).'
    );
  }

  const backendDir = path.join(__dirname, '..'); // dist/ -> backend/
  const schemaPath = path.join(backendDir, 'prisma', 'schema.prisma');
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [backendDir] });
  const nodeBin = process.execPath || process.argv[0];

  const runSync = (): void => {
    // Apply all committed migrations that have not yet been recorded in the
    // _prisma_migrations table. New objects are added, existing rows are never
    // touched. On a database that predates Prisma Migrate the idempotent
    // baseline migration is a no-op (CREATE TABLE IF NOT EXISTS skips existing
    // tables) and only the pending additive migrations run.
    execFileSync(
      nodeBin,
      [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
      {
        cwd: backendDir,
        stdio: 'inherit',
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' },
      }
    );
  };

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      runSync();
      return;
    } catch (err) {
      if (attempt >= retries) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `prisma migrate deploy failed after ${retries} attempts while provisioning the PostgreSQL schema: ${detail}`
        );
      }
      console.error(
        `[SCHEMA] prisma migrate deploy attempt ${attempt}/${retries} failed; retrying in ${retryDelayMs}ms`
      );
      sleepSync(retryDelayMs);
    }
  }
}

function sleepSync(ms: number): void {
  if (typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, ms);
    return;
  }
  // Fallback for Node builds without the global Atomics API.
  const start = Date.now();
  while (Date.now() - start < ms) {
    /* busy-wait; only reached on older Node versions */
  }
}