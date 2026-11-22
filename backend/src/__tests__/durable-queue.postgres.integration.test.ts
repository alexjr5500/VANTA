import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { DurableQueueRepository, DurableQueueClient } from '../services/durable-queue.repository';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('DurableQueueRepository PostgreSQL integration', () => {
  let admin: Pool;
  let pool: Pool;
  let repository: DurableQueueRepository;
  let schema: string;

  beforeAll(async () => {
    if (!databaseUrl) return;
    schema = `durable_queue_test_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE "QueueJob" (
        "id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "payload" JSONB NOT NULL,
        "priority" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'pending',
        "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 3,
        "runAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "lockedAt" TIMESTAMPTZ,
        "lockedUntil" TIMESTAMPTZ, "workerId" TEXT, "lastError" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "completedAt" TIMESTAMPTZ
      )
    `);
    const client: DurableQueueClient = {
      $executeRawUnsafe: async (query, ...values) => (await pool.query(query, values)).rowCount ?? 0,
      $queryRawUnsafe: async <T>(query: string, ...values: unknown[]) => (await pool.query(query, values)).rows as T,
    };
    repository = new DurableQueueRepository(client);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin && schema) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => { if (pool) await pool.query('TRUNCATE TABLE "QueueJob"'); });

  it('leaves disabled media jobs pending while claiming eligible jobs', async () => {
    await repository.enqueue('image:optimize', {}, { id: 'media-job', priority: 10 });
    await repository.enqueue('push:deliver', {}, { id: 'push-job', priority: 0 });
    const excluded = ['image:optimize', 'thumbnail:generate', 'video:transcode', 'cleanup:temp'];
    await expect(repository.claim('worker-a', 60_000, excluded)).resolves.toMatchObject({
      id: 'push-job', type: 'push:deliver',
    });
    const media = await pool.query('SELECT "status", "attempts" FROM "QueueJob" WHERE "id" = $1', ['media-job']);
    expect(media.rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
    await expect(repository.claim('worker-b', 60_000, excluded)).resolves.toBeNull();
    await expect(repository.claim('media-enabled-worker')).resolves.toMatchObject({
      id: 'media-job', type: 'image:optimize',
    });
  });

  it('does not exhaust disabled media jobs with expired leases', async () => {
    await repository.enqueue('video:transcode', {}, { id: 'expired-media', maxAttempts: 1 });
    await expect(repository.claim('media-worker')).resolves.toMatchObject({ id: 'expired-media' });
    await pool.query(
      `UPDATE "QueueJob" SET "lockedUntil" = NOW() - INTERVAL '1 second' WHERE "id" = $1`,
      ['expired-media'],
    );
    await expect(repository.claim('disabled-worker', 60_000, ['video:transcode'])).resolves.toBeNull();
    const media = await pool.query('SELECT "status", "attempts" FROM "QueueJob" WHERE "id" = $1', ['expired-media']);
    expect(media.rows[0]).toMatchObject({ status: 'active', attempts: 1 });
  });

  it('keeps local and Cloudinary jobs isolated between storage modes', async () => {
    await repository.enqueue('image:optimize', { inputPath: 'source.jpg', outputName: 'local' }, { id: 'local-job', priority: 5 });
    await repository.enqueue('cloudinary:image:optimize', { fileId: 'asset_123' }, { id: 'cloud-job', priority: 10 });
    const localExcluded = ['cloudinary:image:optimize', 'cloudinary:thumbnail:generate', 'cloudinary:video:transcode'];
    const remoteExcluded = ['image:optimize', 'thumbnail:generate', 'video:transcode', 'cleanup:temp'];
    await expect(repository.claim('local-worker', 60_000, localExcluded)).resolves.toMatchObject({ id: 'local-job' });
    await expect(repository.claim('cloud-worker', 60_000, remoteExcluded)).resolves.toMatchObject({ id: 'cloud-job' });
    await expect(repository.claim('local-worker', 60_000, localExcluded)).resolves.toBeNull();
    await expect(repository.claim('cloud-worker', 60_000, remoteExcluded)).resolves.toBeNull();
  });

  it('allows only one worker to claim a single job under concurrent contention', async () => {
    await repository.enqueue('integration:once', { value: 42 }, { id: 'single-job' });
    const claims = await Promise.all([repository.claim('worker-a'), repository.claim('worker-b')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ id: 'single-job', status: 'active', attempts: 1 });
  });

  it('reclaims an expired lease and prevents the previous worker from completing it', async () => {
    await repository.enqueue('integration:lease', {}, { id: 'lease-job', maxAttempts: 2 });
    const first = await repository.claim('worker-a', 60_000);
    expect(first).not.toBeNull();
    await pool.query('UPDATE "QueueJob" SET "lockedUntil" = NOW() - INTERVAL \'1 second\' WHERE "id" = $1', ['lease-job']);
    const second = await repository.claim('worker-b', 60_000);
    expect(second).toMatchObject({ id: 'lease-job', workerId: 'worker-b', attempts: 2 });
    // A worker cannot extend a lease after it has expired or after ownership changes.
    await expect(repository.renewLease('lease-job', 'worker-a', 60_000)).resolves.toBe(false);
    await expect(repository.renewLease('lease-job', 'worker-b', 60_000)).resolves.toBe(true);
    await expect(repository.complete('lease-job', 'worker-a')).resolves.toBe(false);
    await expect(repository.complete('lease-job', 'worker-b')).resolves.toBe(true);
  });

  it('refuses all terminal updates when the owner lease has expired but is not yet reclaimed', async () => {
    await repository.enqueue('integration:expired', {}, { id: 'expired-job', maxAttempts: 2 });
    await expect(repository.claim('worker-a')).resolves.toMatchObject({ id: 'expired-job' });
    await pool.query(
      `UPDATE "QueueJob" SET "lockedUntil" = NOW() - INTERVAL '1 second' WHERE "id" = $1`,
      ['expired-job'],
    );
    await expect(repository.complete('expired-job', 'worker-a')).resolves.toBe(false);
    await expect(repository.fail('expired-job', 'worker-a', 'stale failure')).resolves.toBe(false);
    await expect(repository.failPermanently('expired-job', 'worker-a', 'stale permanent failure')).resolves.toBe(false);
    const state = await pool.query('SELECT "status", "attempts" FROM "QueueJob" WHERE "id" = $1', ['expired-job']);
    expect(state.rows[0]).toMatchObject({ status: 'active', attempts: 1 });
    await expect(repository.claim('worker-b')).resolves.toMatchObject({ id: 'expired-job', attempts: 2 });
  });

  it('persists retry scheduling and marks a job failed after its final attempt', async () => {
    await repository.enqueue('integration:retry', {}, { id: 'retry-job', maxAttempts: 2 });
    const firstClaim = await repository.claim('worker-a');
    expect(firstClaim).toMatchObject({ id: 'retry-job', attempts: 1, status: 'active' });

    await expect(repository.fail('retry-job', 'worker-a', new Error('first failure'), 60_000)).resolves.toBe(true);
    const pending = await pool.query(
      'SELECT "status", "lastError", "workerId", "runAt" FROM "QueueJob" WHERE "id" = $1',
      ['retry-job'],
    );
    expect(pending.rows[0]).toMatchObject({
      status: 'pending',
      lastError: 'first failure',
      workerId: null,
    });
    expect(new Date(pending.rows[0].runAt).getTime()).toBeGreaterThan(Date.now());
    await expect(repository.claim('worker-b')).resolves.toBeNull();

    await pool.query(
      'UPDATE "QueueJob" SET "runAt" = NOW() - INTERVAL \'1 second\' WHERE "id" = $1',
      ['retry-job'],
    );
    const secondClaim = await repository.claim('worker-b');
    expect(secondClaim).toMatchObject({ id: 'retry-job', attempts: 2, status: 'active' });

    await expect(repository.fail('retry-job', 'worker-b', new Error('final failure'), 0)).resolves.toBe(true);
    const failed = await pool.query(
      'SELECT "status", "lastError", "workerId", "attempts" FROM "QueueJob" WHERE "id" = $1',
      ['retry-job'],
    );
    expect(failed.rows[0]).toMatchObject({
      status: 'failed',
      lastError: 'final failure',
      workerId: null,
      attempts: 2,
    });
    await expect(repository.claim('worker-c')).resolves.toBeNull();
  });
});
