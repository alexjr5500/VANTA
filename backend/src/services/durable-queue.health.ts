import { DurableQueueClient } from './durable-queue.repository';

export interface DurableQueueHealth {
  pending: number;
  /** Pending jobs whose scheduled time has arrived, including due retries. */
  duePending: number;
  /** Pending jobs that have already been claimed at least once. */
  retryPending: number;
  /** Successful completions in the last 15 minutes. */
  recentCompletions: number;
  /** Mean enqueue-to-completion time in seconds over recent completions; null when none. */
  recentCompletionLatencySeconds: number | null;
  active: number;
  completed: number;
  failed: number;
  /** Only due pending jobs, not work scheduled for a future runAt. */
  oldestPendingAgeSeconds: number;
  expiredLeases: number;
  /** Terminally failed jobs updated within the last 15 minutes. */
  recentFailures: number;
}

function safeCount(value: unknown, field: string): number {
  // Prisma returns bigint; node-postgres returns int8 as a decimal string.
  if (typeof value !== 'bigint' && typeof value !== 'number' &&
      !(typeof value === 'string' && /^[0-9]+$/.test(value))) {
    throw new Error('Invalid durable queue health count for ' + field);
  }
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
    pending: bigint; duePending: bigint; retryPending: bigint; recentCompletions: bigint;
    recentCompletionLatencySeconds: number | null;
    active: bigint; completed: bigint; failed: bigint;
    oldestPendingAgeSeconds: number | null; expiredLeases: bigint; recentFailures: bigint;
  }>>(`
    WITH monitored AS (
      SELECT "status", "runAt", "lockedUntil", "updatedAt", "attempts", "createdAt", "completedAt"
      FROM "QueueJob" WHERE "type" <> ALL($1::text[])
    )
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'pending') AS pending,
      COUNT(*) FILTER (WHERE "status" = 'pending' AND "runAt" <= NOW()) AS "duePending",
      COUNT(*) FILTER (WHERE "status" = 'pending' AND "attempts" > 0) AS "retryPending",
      COUNT(*) FILTER (WHERE "status" = 'completed' AND "completedAt" >= NOW() - INTERVAL '15 minutes'
        AND "completedAt" <= NOW()) AS "recentCompletions",
      AVG(EXTRACT(EPOCH FROM "completedAt" - "createdAt")) FILTER
        (WHERE "status" = 'completed' AND "completedAt" >= NOW() - INTERVAL '15 minutes'
          AND "completedAt" <= NOW())::float8 AS "recentCompletionLatencySeconds",
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
  const latency = row.recentCompletionLatencySeconds;
  if (latency !== null && (!Number.isFinite(latency) || latency < 0)) {
    throw new Error('Invalid recent completion latency');
  }
  return {
    duePending: safeCount(row.duePending, 'duePending'),
    retryPending: safeCount(row.retryPending, 'retryPending'),
    recentCompletions: safeCount(row.recentCompletions, 'recentCompletions'),
    recentCompletionLatencySeconds: latency,
    pending: safeCount(row.pending, 'pending'),
    active: safeCount(row.active, 'active'),
    completed: safeCount(row.completed, 'completed'),
    failed: safeCount(row.failed, 'failed'),
    oldestPendingAgeSeconds: age,
    expiredLeases: safeCount(row.expiredLeases, 'expiredLeases'),
    recentFailures: safeCount(row.recentFailures, 'recentFailures'),
  };
}
