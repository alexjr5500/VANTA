import { getDurableQueueHealth } from '../services/durable-queue.health';
import { DurableQueueClient } from '../services/durable-queue.repository';

describe('durable queue health snapshot', () => {
  it('converts PostgreSQL counts to JSON-safe numeric values', async () => {
    const db = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{
        pending: 4n, active: 2n, completed: 19n, failed: 1n,
        oldestPendingAgeSeconds: 12.5, expiredLeases: 1n,
      }]),
      $executeRawUnsafe: jest.fn(),
    } as unknown as DurableQueueClient;
    await expect(getDurableQueueHealth(db)).resolves.toEqual({
      pending: 4, active: 2, completed: 19, failed: 1,
      oldestPendingAgeSeconds: 12.5, expiredLeases: 1,
    });
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
