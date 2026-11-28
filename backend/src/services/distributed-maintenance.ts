import { Client } from 'pg';

// Stable, application-owned advisory-lock namespace and task identifiers.
const NAMESPACE = 1447120468;
export const maintenanceTasks = {
  liveSweep: 1,
  oauthSweep: 2,
  rewardExpiry: 3,
  userMilestones: 4,
  verificationExpiry: 5,
} as const;
export type MaintenanceTask = keyof typeof maintenanceTasks;
export type MaintenanceOutcome = 'completed' | 'busy';

export function maintenanceConnectionUrl(env: Record<string, string | undefined>): string | null {
  if (env.VANTA_DISTRIBUTED_MAINTENANCE_ENABLED !== 'true') return null;
  const url = env.VANTA_MAINTENANCE_DIRECT_DATABASE_URL;
  try {
    if (!url) throw new Error();
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        parsed.searchParams.get('pgbouncer') === 'true') throw new Error();
  } catch {
    throw new Error('Explicit direct primary database URL required for distributed maintenance');
  }
  return url;
}

/**
 * Session advisory lock on a dedicated direct connection. Never use a
 * transaction-pooling proxy. Tasks still require DB-level idempotency:
 * loss of the lock connection can allow another process to start.
 */
export class DistributedMaintenance {
  private readonly active = new Set<MaintenanceTask>();

  constructor(private readonly url: string | null) {}

  async run(task: MaintenanceTask, work: () => Promise<void>): Promise<MaintenanceOutcome> {
    if (!Object.prototype.hasOwnProperty.call(maintenanceTasks, task)) throw new Error('Unknown maintenance task');
    if (this.active.has(task)) return 'busy';
    this.active.add(task);
    let client: Client | undefined;
    let lost = false;
    try {
      if (!this.url) {
        await work();
        return 'completed';
      }
      client = new Client({ connectionString: this.url, connectionTimeoutMillis: 3000,
        query_timeout: 4000, statement_timeout: 3000, keepAlive: true });
      client.on('error', () => { lost = true; });
      client.on('end', () => { lost = true; });
      await client.connect();
      const primary = await client.query<{ recovery: boolean; read_only: string }>(
        "SELECT pg_is_in_recovery() AS recovery, current_setting('transaction_read_only') AS read_only",
      );
      if (primary.rows[0]?.recovery !== false || primary.rows[0]?.read_only !== 'off') {
        throw new Error('Maintenance requires writable primary');
      }
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired', [NAMESPACE, maintenanceTasks[task]],
      );
      if (lock.rows[0]?.acquired !== true) return 'busy';
      if (lost) throw new Error('Maintenance coordination unavailable');
      await work();
      if (lost) throw new Error('Maintenance lock connection lost');
      const released = await client.query<{ released: boolean }>(
        'SELECT pg_advisory_unlock($1::int, $2::int) AS released', [NAMESPACE, maintenanceTasks[task]],
      );
      if (released.rows[0]?.released !== true) throw new Error('Maintenance lock ownership lost');
      return 'completed';
    } catch {
      // Never emit credential-bearing connection errors or retry work unlocked.
      throw new Error('Maintenance task or coordination failed');
    } finally {
      try { if (client) await client.end(); }
      finally { this.active.delete(task); }
    }
  }
}
