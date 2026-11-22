import { DurableQueueClient } from './durable-queue.repository';

export interface DurableQueueHealth {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  oldestPendingAgeSeconds: number;
  expiredLeases: number;
}

/** Read-only queue health snapshot for monitoring; does not start a worker. */
export async function getDurableQueueHealth(db: DurableQueueClient): Promise<DurableQueueHealth> {
  const rows = await db.$queryRawUnsafe<Array<{
    pending: bigint; active: bigint; completed: bigint; failed: bigint;
    oldestPendingAgeSeconds: number | null; expiredLeases: bigint;
  }>>(`
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'pending') AS pending,
      COUNT(*) FILTER (WHERE "status" = 'active') AS active,
      COUNT(*) FILTER (WHERE "status" = 'completed') AS completed,
      COUNT(*) FILTER (WHERE "status" = 'failed') AS failed,
      COALESCE(EXTRACT(EPOCH FROM NOW() - MIN("runAt") FILTER
        (WHERE "status" = 'pending' AND "runAt" <= NOW())), 0)::float8 AS "oldestPendingAgeSeconds",
      COUNT(*) FILTER (WHERE "status" = 'active' AND "lockedUntil" <= NOW()) AS "expiredLeases"
    FROM "QueueJob"
  `);
  const row = rows[0];
  if (!row) throw new Error('Queue health query returned no rows');
  return {
    pending: Number(row.pending),
    active: Number(row.active),
    completed: Number(row.completed),
    failed: Number(row.failed),
    oldestPendingAgeSeconds: Math.max(0, Number(row.oldestPendingAgeSeconds)),
    expiredLeases: Number(row.expiredLeases),
  };
}
