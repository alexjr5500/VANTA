import { getDurableQueueHealth } from '../services/durable-queue.health';
import { DurableQueueClient } from '../services/durable-queue.repository';

describe('durable queue health snapshot', () => {
  const database = (metrics: Record<string, unknown>) => ({
    $queryRawUnsafe: jest.fn().mockResolvedValue([{
      pending: 4n, active: 2n, completed: 19n, failed: 1n,
      oldestPendingAgeSeconds: 12.5, expiredLeases: 1n, recentFailures: 1n,
      ...metrics,
    }]),
    $executeRawUnsafe: jest.fn(),
  });

  it('converts PostgreSQL counts and recent failures to JSON-safe values', async () => {
    const db = database({});
    await expect(getDurableQueueHealth(db as unknown as DurableQueueClient)).resolves.toEqual({
      pending: 4, active: 2, completed: 19, failed: 1,
      oldestPendingAgeSeconds: 12.5, expiredLeases: 1, recentFailures: 1,
    });
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FROM monitored'), []);
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain("INTERVAL '15 minutes'");
  });

  it('uses parameterized exclusions rather than interpolating job type names', async () => {
    const db = database({});
    await getDurableQueueHealth(db as unknown as DurableQueueClient, ['image:optimize', 'cloudinary:video:transcode']);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"type" <> ALL($1::text[])'),
      ['image:optimize', 'cloudinary:video:transcode'],
    );
  });

  it('rejects invalid health data rather than reporting false success', async () => {
    for (const metrics of [{ pending: Number.MAX_SAFE_INTEGER + 1 }, { recentFailures: -1n },
      { oldestPendingAgeSeconds: Number.NaN }]) {
      const db = database(metrics);
      await expect(getDurableQueueHealth(db as unknown as DurableQueueClient)).rejects.toThrow();
    }
  });

  it('rejects invalid exclusion names', async () => {
    const db = database({});
    await expect(getDurableQueueHealth(db as unknown as DurableQueueClient, ['']))
      .rejects.toThrow('nonempty strings');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
