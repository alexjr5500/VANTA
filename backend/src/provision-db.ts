import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Provision the PostgreSQL schema before the API starts listening.
 *
 * This is the application-level safety net for Railway: `backend/railway.json`
 * already runs `npx prisma db execute` (additive sync) + `npx prisma db push`
 * in its start command, but provisioning from inside the app guarantees the
 * schema is created even if a deployment platform setting ever overrides that
 * start command. It only runs when:
 *
 *   - NODE_ENV === "production" (never in local dev/tests), and
 *   - DATABASE_URL is a PostgreSQL URL (never SQLite).
 *
 * It never passes `--accept-data-loss`: instead, an idempotent, ADDITIVE-ONLY
 * SQL script (prisma/startup-sync.sql, checked in next to the schema) is
 * applied first, so the reviewed additive provider-accounts/OAuth migration is
 * never blocked by `prisma db push`'s data-loss guard. `prisma db push` still
 * runs WITHOUT --accept-data-loss afterwards, so any genuinely destructive
 * schema drift fails loudly (after retries) instead of dropping data.
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
  const syncSqlPath = path.join(backendDir, 'prisma', 'startup-sync.sql');
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [backendDir] });
  const nodeBin = process.execPath || process.argv[0];

  const runSync = (): void => {
    // 1. Idempotent, additive-only replay of the reviewed migrations so the
    //    subsequent `prisma db push` is never blocked by (and never needs
    //    --accept-data-loss for) pending additive changes.
    execFileSync(
      nodeBin,
      [prismaCli, 'db', 'execute', '--schema', schemaPath, '--file', syncSqlPath],
      {
        cwd: backendDir,
        stdio: 'inherit',
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' },
      }
    );
    // 2. Sync any remaining (new-object) changes and FAIL LOUDLY on any
    //    destructive drift (no --accept-data-loss, ever).
    execFileSync(
      nodeBin,
      [prismaCli, 'db', 'push', '--skip-generate', '--schema', schemaPath],
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
          `prisma schema sync failed after ${retries} attempts while provisioning the PostgreSQL schema: ${detail}`
        );
      }
      console.error(
        `[SCHEMA] prisma schema sync attempt ${attempt}/${retries} failed; retrying in ${retryDelayMs}ms`
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