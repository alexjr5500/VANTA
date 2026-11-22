export interface DurableQueueClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}
export type DurableJobStatus = 'pending' | 'active' | 'completed' | 'failed';
export interface DurableJob {
  id: string; type: string; payload: unknown; priority: number; status: DurableJobStatus;
  attempts: number; maxAttempts: number; runAt: Date; lockedAt: Date | null;
  lockedUntil: Date | null; workerId: string | null; lastError: string | null;
  createdAt: Date; updatedAt: Date; completedAt: Date | null;
}
export interface EnqueueOptions { id?: string; priority?: number; maxAttempts?: number; runAt?: Date; }

export class DurableQueueRepository {
  constructor(private readonly db: DurableQueueClient) {}

  async enqueue(type: string, payload: unknown, options: EnqueueOptions = {}): Promise<string> {
    if (!type.trim()) throw new Error('Job type is required');
    const maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
    const priority = options.priority ?? 0;
    if (!Number.isInteger(priority)) throw new Error('priority must be an integer');
    const runAt = options.runAt ?? new Date();
    if (!(runAt instanceof Date) || Number.isNaN(runAt.getTime())) throw new Error('runAt must be a valid date');
    const id = options.id ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.db.$executeRawUnsafe(
      `INSERT INTO "QueueJob" ("id", "type", "payload", "priority", "maxAttempts", "runAt")
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
      id, type.trim(), JSON.stringify(payload ?? null), priority, maxAttempts, runAt,
    );
    return id;
  }

  async claim(workerId: string, leaseMs = 60_000, excludedTypes: readonly string[] = []): Promise<DurableJob | null> {
    if (!workerId.trim()) throw new Error('Worker id is required');
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive');
    if (excludedTypes.some(type => typeof type !== 'string' || !type.trim())) {
      throw new Error('Excluded job types must be nonempty strings');
    }
    const rows = await this.db.$queryRawUnsafe<DurableJob[]>(
      `WITH exhausted AS (
         UPDATE "QueueJob" SET "status" = 'failed', "lastError" = COALESCE("lastError", 'Worker lease expired; retry limit reached'),
           "lockedAt" = NULL, "lockedUntil" = NULL, "workerId" = NULL, "updatedAt" = NOW()
         WHERE "type" <> ALL($3::text[]) AND "status" = 'active' AND "lockedUntil" <= NOW() AND "attempts" >= "maxAttempts"
         RETURNING "id"
       ), candidate AS (
         SELECT "id" FROM "QueueJob"
         WHERE ("type" <> ALL($3::text[])) AND (("status" = 'pending' AND "runAt" <= NOW() AND "attempts" < "maxAttempts")
            OR ("status" = 'active' AND "lockedUntil" <= NOW() AND "attempts" < "maxAttempts"))
         ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE "QueueJob" AS job
       SET "status" = 'active', "workerId" = $1, "lockedAt" = NOW(),
           "lockedUntil" = NOW() + ($2 * INTERVAL '1 millisecond'),
           "attempts" = job."attempts" + 1, "updatedAt" = NOW()
       FROM candidate WHERE job."id" = candidate."id"
       RETURNING job.*`,
      workerId.trim(), leaseMs, [...excludedTypes],
    );
    return rows[0] ?? null;
  }

  /** Extend an active lease only while this worker still owns an unexpired lease. */
  async renewLease(jobId: string, workerId: string, leaseMs = 60_000): Promise<boolean> {
    if (!jobId.trim()) throw new Error('Job id is required');
    if (!workerId.trim()) throw new Error('Worker id is required');
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive');
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "QueueJob" SET "lockedUntil" = NOW() + ($3 * INTERVAL '1 millisecond'), "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'active' AND "workerId" = $2 AND "lockedUntil" > NOW()`,
      jobId, workerId, leaseMs,
    );
    return count === 1;
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "QueueJob" SET "status" = 'completed', "completedAt" = NOW(),
       "lockedAt" = NULL, "lockedUntil" = NULL, "workerId" = NULL, "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'active' AND "workerId" = $2 AND "lockedUntil" > NOW()`,
      jobId, workerId,
    );
    return count === 1;
  }

  /** Mark an owned job terminally failed (used for unsupported job types). */
  async failPermanently(jobId: string, workerId: string, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "QueueJob" SET "status" = 'failed', "lastError" = $3,
       "lockedAt" = NULL, "lockedUntil" = NULL, "workerId" = NULL, "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'active' AND "workerId" = $2 AND "lockedUntil" > NOW()`,
      jobId, workerId, message,
    );
    return count === 1;
  }

  async fail(jobId: string, workerId: string, error: unknown, retryDelayMs = 1000): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    const delay = Number.isFinite(retryDelayMs) ? Math.max(0, retryDelayMs) : 1000;
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "QueueJob" SET
       "status" = CASE WHEN "attempts" >= "maxAttempts" THEN 'failed' ELSE 'pending' END,
       "runAt" = CASE WHEN "attempts" >= "maxAttempts" THEN "runAt"
                     ELSE NOW() + ($3 * INTERVAL '1 millisecond') END,
       "lastError" = $4, "lockedAt" = NULL, "lockedUntil" = NULL,
       "workerId" = NULL, "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'active' AND "workerId" = $2 AND "lockedUntil" > NOW()`,
      jobId, workerId, delay, message,
    );
    return count === 1;
  }
}
