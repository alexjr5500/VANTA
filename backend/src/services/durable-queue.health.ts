import { DurableQueueClient } from './durable-queue.repository';

export interface DurableQueueHealth {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  /** Only due pending jobs, not work scheduled for a future runAt. */
  oldestPendingAgeSeconds: number;
  expiredLeases: number;
  /** Terminally failed jobs updated within the last 15 minutes. */
  recentFailures: number;
}

function safeCount(value: bigint | number, field: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid durable queue health count for ' + field);
  }
  return count;
}

/**
 * Aggregate-only, read-only queue health snapshot. Does not load job payloads,
 * usernames, device IDs, lastError, or any other sensitive job details.
 * Pass excludedTypes to monitor only work the selected worker can claim.
 */
export async function getDurableQueueHealth(
  db: DurableQueueClient,
  excludedTypes: readonly string[] = [],
): Promise<DurableQueueHealth> {
  if (excludedTypes.some(type => typeof type !== 'string' || !type.trim())) {
    throw new Error('Excluded queue job types must be nonempty strings');
  }
  const rows = await db.$queryRawUnsafe<Array<{
    pending: bigint; active: bigint; completed: bigint; failed: bigint;
    oldestPendingAgeSeconds: number | null; expiredLeases: bigint; recentFailures: bigint;
  }>>(`
    WITH monitored AS (
      SELECT "status", "runAt", "lockedUntil", "updatedAt"
      FROM "QueueJob" WHERE "type" <> ALL($1::text[])
    )
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'pending') AS pending,
      COUNT(*) FILTER (WHERE "status" = 'active') AS active,
      COUNT(*) FILTER (WHERE "status" = 'completed') AS completed,
      COUNT(*) FILTER (WHERE "status" = 'failed') AS failed,
      COALESCE(EXTRACT(EPOCH FROM NOW() - MIN("runAt") FILTER
        (WHERE "status" = 'pending' AND "runAt" <= NOW())), 0)::float8 AS "oldestPendingAgeSeconds",
      COUNT(*) FILTER (WHERE "status" = 'active' AND "lockedUntil" <= NOW()) AS "expiredLeases",
      COUNT(*) FILTER (WHERE "status" = 'failed'
        AND "updatedAt" >= NOW() - INTERVAL '15 minutes') AS "recentFailures"
    FROM monitored
  `, [...excludedTypes]);
  const row = rows[0];
  if (!row) throw new Error('Queue health query returned no rows');
  const age = Number(row.oldestPendingAgeSeconds);
  if (!Number.isFinite(age) || age < 0) throw new Error('Invalid oldest pending job age');
  return {
    pending: safeCount(row.pending, 'pending'),
    active: safeCount(row.active, 'active'),
    completed: safeCount(row.completed, 'completed'),
    failed: safeCount(row.failed, 'failed'),
    oldestPendingAgeSeconds: age,
    expiredLeases: safeCount(row.expiredLeases, 'expiredLeases'),
    recentFailures: safeCount(row.recentFailures, 'recentFailures'),
  };
}
