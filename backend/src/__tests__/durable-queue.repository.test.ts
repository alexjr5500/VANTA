import { DurableQueueRepository, DurableQueueClient, DurableJob } from '../services/durable-queue.repository';

describe('DurableQueueRepository', () => {
  let db: jest.Mocked<DurableQueueClient>;
  let repo: DurableQueueRepository;
  beforeEach(() => {
    db = { $executeRawUnsafe: jest.fn().mockResolvedValue(1), $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    repo = new DurableQueueRepository(db);
  });
  it('persists enqueue values with parameterized SQL', async () => {
    const scheduled = new Date('2026-11-21T12:00:00Z');
    const id = await repo.enqueue('email:send', { to: 'user@example.test' }, { id: 'test-job', priority: 5, maxAttempts: 4, runAt: scheduled });
    expect(id).toBe('test-job');
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO "QueueJob"'), 'test-job', 'email:send', JSON.stringify({ to: 'user@example.test' }), 5, 4, scheduled);
  });
  it('rejects blank type and invalid attempt counts', async () => {
    await expect(repo.enqueue('  ', {})).rejects.toThrow('Job type is required');
    await expect(repo.enqueue('type', {}, { maxAttempts: 0 })).rejects.toThrow('maxAttempts must be a positive integer');
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('rejects invalid priority and dates', async () => {
    await expect(repo.enqueue('type', {}, { priority: Number.NaN })).rejects.toThrow('priority must be an integer');
    await expect(repo.enqueue('type', {}, { priority: 1.5 })).rejects.toThrow('priority must be an integer');
    await expect(repo.enqueue('type', {}, { runAt: new Date('invalid') })).rejects.toThrow('runAt must be a valid date');
  });
  it('claims a due job atomically and returns null when none is available', async () => {
    const job = { id: 'j1' } as DurableJob;
    db.$queryRawUnsafe.mockResolvedValueOnce([job]);
    await expect(repo.claim('worker-a', 5000)).resolves.toBe(job);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE SKIP LOCKED'), 'worker-a', 5000);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('"attempts" < "maxAttempts"'), 'worker-a', 5000);
    db.$queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(repo.claim('worker-a')).resolves.toBeNull();
  });
  it('rejects blank workers and invalid lease durations', async () => {
    await expect(repo.claim('')).rejects.toThrow('Worker id is required');
    await expect(repo.claim('worker', 0)).rejects.toThrow('leaseMs must be positive');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('renews only an unexpired lease owned by the worker', async () => {
    await expect(repo.renewLease('j1', 'worker-a', 30_000)).resolves.toBe(true);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"lockedUntil" > NOW()'),
      'j1', 'worker-a', 30_000,
    );
    db.$executeRawUnsafe.mockResolvedValueOnce(0);
    await expect(repo.renewLease('j1', 'worker-b', 30_000)).resolves.toBe(false);
  });
  it('rejects invalid lease renewal inputs', async () => {
    await expect(repo.renewLease('', 'worker-a')).rejects.toThrow('Job id is required');
    await expect(repo.renewLease('j1', '')).rejects.toThrow('Worker id is required');
    await expect(repo.renewLease('j1', 'worker-a', 0)).rejects.toThrow('leaseMs must be positive');
  });
  it('only completes a job owned by the worker', async () => {
    await expect(repo.complete('j1', 'worker-a')).resolves.toBe(true);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('WHERE "id" = $1'), 'j1', 'worker-a');
    db.$executeRawUnsafe.mockResolvedValueOnce(0);
    await expect(repo.complete('j1', 'worker-b')).resolves.toBe(false);
  });
  it('terminally fails an owned job without scheduling another attempt', async () => {
    await expect(repo.failPermanently('j1', 'worker-a', new Error('unsupported type'))).resolves.toBe(true);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`"status" = 'failed'`),
      'j1', 'worker-a', 'unsupported type',
    );
    db.$executeRawUnsafe.mockResolvedValueOnce(0);
    await expect(repo.failPermanently('j1', 'worker-b', 'stale owner')).resolves.toBe(false);
  });
  it('persists retry timing and only mutates worker-owned jobs', async () => {
    await expect(repo.fail('j1', 'worker-a', new Error('boom'), 2500)).resolves.toBe(true);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('CASE WHEN "attempts" >= "maxAttempts"'), 'j1', 'worker-a', 2500, 'boom');
    db.$executeRawUnsafe.mockResolvedValueOnce(0);
    await expect(repo.fail('j1', 'worker-b', 'error')).resolves.toBe(false);
  });
  it('requires a live lease for completion and failure updates', async () => {
    await repo.complete('j1', 'worker-a');
    await repo.fail('j1', 'worker-a', 'retry');
    await repo.failPermanently('j1', 'worker-a', 'permanent');
    for (const call of db.$executeRawUnsafe.mock.calls) {
      const query = call[0];
      if (query.includes('UPDATE "QueueJob"')) {
        expect(query).toContain('"lockedUntil" > NOW()');
      }
    }
  });

  it('normalizes negative and non-finite retry delay', async () => {
    await repo.fail('j2', 'worker-a', 'failed', -20);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), 'j2', 'worker-a', 0, 'failed');
    await repo.fail('j3', 'worker-a', 'failed', Number.NaN);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), 'j3', 'worker-a', 1000, 'failed');
  });
});
