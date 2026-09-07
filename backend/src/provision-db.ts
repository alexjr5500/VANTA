import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Provision the PostgreSQL schema before the API starts listening.
 *
 * This is the application-level safety net for Railway: `backend/railway.json`
 * already runs `npx prisma db push` in its start command, but provisioning from
 * inside the app guarantees the schema is created even if a deployment platform
 * setting ever overrides that start command. It only runs when:
 *
 *   - NODE_ENV === "production" (never in local dev/tests), and
 *   - DATABASE_URL is a PostgreSQL URL (never SQLite).
 *
 * It never passes `--accept-data-loss`: if the schema diff would be destructive
 * the command fails loudly (after retries) instead of dropping data.
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

  const runPush = (): void => {
    execFileSync(
      nodeBin,
      [prismaCli, 'db', 'push', '--skip-generate', '--schema', schemaPath],
      {
        cwd: backendDir,
        stdio: 'inherit',
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      }
    );
  };

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      runPush();
      return;
    } catch (err) {
      if (attempt >= retries) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `prisma db push failed after ${retries} attempts while provisioning the PostgreSQL schema: ${detail}`
        );
      }
      console.error(
        `[SCHEMA] prisma db push attempt ${attempt}/${retries} failed; retrying in ${retryDelayMs}ms`
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