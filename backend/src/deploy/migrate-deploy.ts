/**
 * VANTA — the single, controlled production migration step.
 * ============================================================================
 * WHY THIS MODULE EXISTS
 *
 * Railway runs this module ONCE per deployment, from a separate container,
 * BEFORE any application replica starts (see `deploy.preDeployCommand` in
 * backend/railway.json). That is what makes migrations serialized: with N
 * replicas, an in-start-command `prisma migrate deploy` would be executed by
 * every replica simultaneously.
 *
 * THE BUG THIS FIXES
 *
 * VANTA's production PostgreSQL database was originally created and maintained
 * with `prisma db push`. `db push` is a diff tool and NEVER records migration
 * history, so production has a complete schema but NO `_prisma_migrations`
 * table. When `prisma migrate deploy` was adopted (commit 28ce038) it refuses
 * to run against a non-empty database with no history and aborts with:
 *
 *     P3005 — The database schema is not empty.
 *
 * The previous start command wrapped `migrate deploy` in
 * `until ... do ... retry 10`, and `src/provision-db.ts` retried 10 more times,
 * and `restartPolicyMaxRetries: 3` restarted the container. A PERMANENT error
 * (P3005) was therefore retried as if the database were merely still starting —
 * the endless migration-retry loop that blocked the deployment.
 *
 * THE RULE IMPLEMENTED HERE
 *
 *   * P1001/P1002/P1003/P1000/P1017 (TRANSIENT — database unreachable)  -> retry,
 *     bounded, with backoff. This is the ONLY retryable class.
 *   * P3005 (PERMANENT — no migration history on a populated database)  -> fail
 *     immediately with the exact baselining remediation. NEVER retried.
 *   * P3009/P3018/... (PERMANENT — a migration failed / drifted)        -> fail
 *     immediately. NEVER retried.
 *
 * Retrying a permanent error can never fix it; it only burns the build queue
 * and produces an unbounded restart loop.
 *
 * DATA SAFETY: only ever runs `prisma migrate deploy` — never `db push`, never
 * `migrate reset`, never `--accept-data-loss`, and never a seed. Existing rows
 * are never touched by this module.
 */
import { execFileSync } from 'child_process';
import path from 'path';

/** How a `prisma migrate deploy` failure must be treated by the caller. */
export type MigrateErrorKind =
  /** Transient: the database could not be reached yet. Safe to retry. */
  | 'CONNECTION'
  /** Permanent: populated database with no `_prisma_migrations` history. */
  | 'HISTORY_MISSING'
  /** Permanent: a migration failed to apply, or history drifted. */
  | 'MIGRATION_FAILED'
  /** Unrecognised failure. Treated as permanent (fail fast, never loop). */
  | 'UNKNOWN';

/** The one migration that is genuinely already represented in production. */
export const BASELINE_MIGRATION = '20261005000000_baseline_production_schema';

/** Operator-facing runbook for the P3005 baselining step. */
export const MIGRATION_RUNBOOK = 'backend/prisma/MIGRATION_RUNBOOK.md';

const CONNECTION_PATTERNS: RegExp[] = [
  /\bP1001\b/i,
  /\bP1002\b/i,
  /\bP1003\b/i,
  /\bP1000\b/i,
  /\bP1017\b/i,
  /can'?t reach database server/i,
  /server was reached but timed out/i,
  /server has closed the connection/i,
  /\bECONNREFUSED\b/,
  /\bENOTFOUND\b/,
  /\bETIMEDOUT\b/,
  /\bEAI_AGAIN\b/,
  /\bgetaddrinfo\b/i,
];

const HISTORY_MISSING_PATTERNS: RegExp[] = [
  /\bP3005\b/i,
  /database schema is not empty/i,
  /baseline an existing database/i,
];

const MIGRATION_FAILED_PATTERNS: RegExp[] = [
  /\bP3009\b/i,
  /\bP3018\b/i,
  /\bP3019\b/i,
  /\bP3014\b/i,
  /\bP3015\b/i,
  /\bP3016\b/i,
  /\bP3021\b/i,
  /migration failed to apply/i,
  /found failed migrations/i,
  /was modified after it was applied/i,
  /does not exist locally/i,
];

/**
 * Classify captured `prisma migrate deploy` output.
 *
 * Order is deliberate: the permanent, precisely-identifiable classes are tested
 * before the broad connection heuristics, so a P3005 message can never be
 * mis-read as a transient blip and retried forever.
 */
export function classifyMigrateError(output: string): MigrateErrorKind {
  const text = String(output ?? '');
  for (const pattern of HISTORY_MISSING_PATTERNS) {
    if (pattern.test(text)) return 'HISTORY_MISSING';
  }
  for (const pattern of MIGRATION_FAILED_PATTERNS) {
    if (pattern.test(text)) return 'MIGRATION_FAILED';
  }
  for (const pattern of CONNECTION_PATTERNS) {
    if (pattern.test(text)) return 'CONNECTION';
  }
  return 'UNKNOWN';
}

/** True only for failures that can plausibly resolve themselves by waiting. */
export function isRetriableMigrateError(kind: MigrateErrorKind): boolean {
  return kind === 'CONNECTION';
}

/**
 * Human-readable remediation for a permanent failure. This text is what an
 * on-call operator sees in the Railway logs, so it must name the exact command
 * and the exact migration — no guessing.
 */
export function buildRemediationGuidance(kind: MigrateErrorKind): string {
  if (kind === 'HISTORY_MISSING') {
    return [
      'P3005 (database schema is not empty) is a PERMANENT, one-time condition,',
      'not a "database still starting" condition — retrying it can never succeed.',
      '',
      'The production schema was created by `prisma db push`, which never records',
      'migration history, so `_prisma_migrations` is missing/empty. The schema must',
      'be BASELINED once before `migrate deploy` will run.',
      '',
      'ONE-TIME FIX (requires a verified backup — see the runbook):',
      `  npx prisma migrate resolve --applied ${BASELINE_MIGRATION}`,
      '  npx prisma migrate deploy --schema prisma/schema.prisma',
      '  npx prisma migrate status  --schema prisma/schema.prisma   # must be "up to date"',
      '',
      `Mark ONLY ${BASELINE_MIGRATION} as applied: it is the idempotent snapshot of the`,
      'already-live schema. The later additive migrations (transfer_otp_challenges,',
      'wallet_reconciliation, phone_otp_table, add_push_notifications,',
      'add_password_reset_tokens) are NOT yet in production and must actually run.',
      `Full procedure: ${MIGRATION_RUNBOOK}`,
    ].join('\n');
  }
  if (kind === 'MIGRATION_FAILED') {
    return [
      'A committed migration failed to apply against the database, or the recorded',
      'migration history no longer matches the files in prisma/migrations.',
      'This is PERMANENT — retrying cannot fix it.',
      '',
      'Inspect the failing statement above, then either fix the migration (preferred,',
      'so the fix is reproducible in every environment) or, if a migration was left',
      'half-applied, reconcile it explicitly with:',
      '  npx prisma migrate status  --schema prisma/schema.prisma',
      '  npx prisma migrate resolve --schema prisma/schema.prisma   # --applied | --rolled-back',
      '',
      'Never use `prisma db push` or `--accept-data-loss` to force past this in',
      'production: it can silently alter or drop schema and user data.',
      `Full procedure: ${MIGRATION_RUNBOOK}`,
    ].join('\n');
  }
  return [
    '`prisma migrate deploy` failed with an unrecognised error.',
    'Treated as PERMANENT (fail fast) so the deployment cannot enter a retry loop.',
    `See ${MIGRATION_RUNBOOK} for the diagnostics to run.`,
  ].join('\n');
}

export interface MigrateOptions {
  /** Absolute path to prisma/schema.prisma. Defaults to <backend>/prisma/schema.prisma. */
  schemaPath?: string;
  /** Total attempts. Only CONNECTION failures consume more than one attempt. */
  attempts?: number;
  /** Delay between CONNECTION retries, in milliseconds. */
  retryDelayMs?: number;
  /** Environment for the child process. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Suppress informational logging (used by tests). */
  silent?: boolean;
}

/** `<backend>/` — works from both `dist/deploy/` and `src/deploy/`. */
export function resolveBackendDir(): string {
  return path.resolve(__dirname, '..', '..');
}

export function sleepSync(ms: number): void {
  if (typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, ms);
    return;
  }
  const start = Date.now();
  while (Date.now() - start < ms) {
    /* busy-wait; only reached on Node builds without the global Atomics API */
  }
}


/**
 * Run `prisma migrate deploy` with retries scoped strictly to transient
 * connection failures.
 *
 * Throws on the FIRST permanent failure (P3005, failed migration, unknown) with
 * actionable remediation attached, so the deployment fails loudly and quickly
 * instead of looping.
 */
export function runMigrations(options: MigrateOptions = {}): void {
  const backendDir = resolveBackendDir();
  const schemaPath = options.schemaPath ?? path.join(backendDir, 'prisma', 'schema.prisma');
  const attempts = Math.max(1, options.attempts ?? 20);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 3000);
  const silent = options.silent === true;

  const log = (message: string): void => {
    if (!silent) console.log(message);
  };

  const dbUrl = (options.env ?? process.env).DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set; cannot run database migrations.');
  }
  if (!/^postgres(?:ql)?:\/\//i.test(dbUrl)) {
    throw new Error(
      'DATABASE_URL does not point at PostgreSQL; refusing to run migrations. ' +
        'The deployment database must stay on PostgreSQL (never SQLite).'
    );
  }

  const prismaCli = require.resolve('prisma/build/index.js', { paths: [backendDir] });
  const nodeBin = process.execPath || process.argv[0];
  const childEnv: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
    CHECKPOINT_DISABLE: '1',
  };

  let lastOutput = '';
  let lastKind: MigrateErrorKind = 'UNKNOWN';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // execFileSync returns a string with `encoding: 'utf8'`, but coerce
      // defensively: a Buffer must never reach `.trim()`.
      const stdout = execFileSync(
        nodeBin,
        [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
        { cwd: backendDir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: childEnv }
      );
      const out = stdout ? String(stdout).trim() : '';
      if (out) log(out);
      return;
    } catch (err: unknown) {
      const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
      const parts = [e.stdout, e.stderr].map((v) => (v ? String(v) : '')).filter(Boolean);
      lastOutput = (parts.length > 0 ? parts.join('\n') : e.message ?? String(err)).trim();
      lastKind = classifyMigrateError(lastOutput);

      // Permanent failures are NEVER retried: waiting cannot fix a missing
      // migration history or a broken migration, and retrying is exactly what
      // produced the endless migration-retry loop in production.
      if (!isRetriableMigrateError(lastKind)) {
        throw new Error(
          [
            `prisma migrate deploy failed permanently (${lastKind}) on attempt ${attempt}/${attempts}.`,
            '',
            buildRemediationGuidance(lastKind),
            '',
            '--- prisma output ---',
            lastOutput,
          ].join('\n')
        );
      }

      if (attempt >= attempts) {
        throw new Error(
          [
            `Database was still unreachable after ${attempts} attempt(s) (${lastKind}).`,
            'This is a TRANSIENT connectivity problem: verify the PostgreSQL service is',
            'running and that DATABASE_URL points at it (Railway internal networking).',
            '',
            '--- prisma output ---',
            lastOutput,
          ].join('\n')
        );
      }

      log(`[MIGRATE] database not reachable yet (attempt ${attempt}/${attempts}); retrying in ${retryDelayMs}ms`);
      if (lastOutput) log(`[MIGRATE] ${lastOutput.split('\n').slice(-3).join(' | ')}`);
      sleepSync(retryDelayMs);
    }
  }

  throw new Error(
    `prisma migrate deploy did not complete (${lastKind}).\n--- prisma output ---\n${lastOutput}`
  );
}

/**
 * Entry point used by Railway's `deploy.preDeployCommand`. Exits non-zero on
 * failure so Railway does not proceed to start any replica.
 */
export function main(): void {
  try {
    runMigrations();
    console.log('[MIGRATE] Database migration step completed successfully.');
  } catch (err: unknown) {
    console.error(`[MIGRATE] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

