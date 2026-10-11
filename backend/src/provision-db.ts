import { runMigrations } from './deploy/migrate-deploy';

/**
 * In-app safety net for the PostgreSQL schema.
 *
 * MIGRATION STRATEGY (single controlled step)
 * -------------------------------------------
 * Production migrations run in Railway's PRE-DEPLOY phase
 * (`deploy.preDeployCommand` -> `node dist/deploy/migrate-deploy.js`), which
 * executes ONCE per deployment in its own container, before ANY application
 * replica starts. That is what prevents N replicas from concurrently running
 * `prisma migrate deploy`.
 *
 * This function is therefore NOT the primary migration path. It is a guarded
 * fallback that only runs when an operator explicitly opts in with
 * `VANTA_PROVISION_SCHEMA_ON_START=true`, for the case where a deployment
 * platform setting overrides the pre-deploy command. By default it is a no-op,
 * so a normal boot never re-runs migrations and never races other replicas.
 *
 * WHY THE PREVIOUS BEHAVIOUR WAS BROKEN
 * -------------------------------------
 * It used to run `prisma migrate deploy` on EVERY production boot and retry
 * ANY failure 10x. Because production's schema was created by `prisma db push`
 * (which never records `_prisma_migrations`), `migrate deploy` failed
 * permanently with P3005 "The database schema is not empty" — and a permanent
 * error was retried as if the database were merely still starting. Combined
 * with `restartPolicyMaxRetries`, that produced the endless migration-retry
 * loop that blocked the deployment.
 *
 * The retry policy is now correct: only TRANSIENT connection failures
 * (P1001/P1002/...) are retried; P3005 and failed migrations fail immediately
 * with remediation. See ./deploy/migrate-deploy.ts.
 */
export function provisionDatabaseSchema(options: { retries?: number; retryDelayMs?: number } = {}): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  // Opt-in only. The pre-deploy step in railway.json is the real migration path.
  const optIn = (process.env.VANTA_PROVISION_SCHEMA_ON_START || '').toLowerCase();
  if (optIn !== 'true' && optIn !== '1') {
    console.info(
      '[SCHEMA] Skipping in-app schema provisioning (default). Migrations run once per ' +
        'deployment via railway.json deploy.preDeployCommand. Set ' +
        'VANTA_PROVISION_SCHEMA_ON_START=true only as a fallback when that step is unavailable.'
    );
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

  console.warn(
    '[SCHEMA] VANTA_PROVISION_SCHEMA_ON_START=true — running in-app migration safety net. ' +
      'Ensure the service runs a single replica to avoid concurrent migrations.'
  );

  runMigrations({ retries: options.retries, retryDelayMs: options.retryDelayMs });
}
