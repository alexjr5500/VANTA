import { DurableJob } from '../services/durable-queue.repository';
import { createDurableQueueHandlers, DurablePushRetryService } from '../services/durable-queue.handlers';

const makeJob = (payload: unknown): DurableJob => ({
  id: 'job-1',
  type: 'push:deliver',
  payload,
  priority: 50,
  status: 'active',
  attempts: 1,
  maxAttempts: 3,
  runAt: new Date(),
  lockedAt: new Date(),
  lockedUntil: new Date(Date.now() + 60_000),
  workerId: 'worker-1',
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
});

describe('durable queue handlers', () => {
  test('routes push retries through the delivery ledger without scheduling legacy retries', async () => {
    const service: DurablePushRetryService = {
      deliverByDeviceId: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const handler = createDurableQueueHandlers(service).get('push:deliver');
    expect(handler).toBeDefined();

    await handler!(makeJob({
      deviceId: 'device-1',
      payload: { eventId: 'notification:1', type: 'message', title: 'Hi', body: 'Hello' },
    }));

    expect(service.deliverByDeviceId).toHaveBeenCalledWith(
      'device-1',
      expect.objectContaining({ eventId: 'notification:1' }),
      { scheduleRetry: false },
    );
  });

  test('throws on transient delivery failure so PostgreSQL applies bounded retry policy', async () => {
    const service: DurablePushRetryService = {
      deliverByDeviceId: jest.fn().mockResolvedValue({ status: 'FAILED', error: 'provider unavailable' }),
    };
    const handler = createDurableQueueHandlers(service).get('push:deliver');

    await expect(handler!(makeJob({
      deviceId: 'device-1',
      payload: { eventId: 'notification:1', type: 'message', title: 'Hi', body: 'Hello' },
    }))).rejects.toThrow('provider unavailable');
  });

  test('rejects malformed payloads rather than acknowledging them', async () => {
    const service: DurablePushRetryService = {
      deliverByDeviceId: jest.fn(),
    };
    const handler = createDurableQueueHandlers(service).get('push:deliver');

    await expect(handler!(makeJob({ deviceId: '', payload: {} }))).rejects.toThrow('Invalid push:deliver');
    expect(service.deliverByDeviceId).not.toHaveBeenCalled();
  });

  test('treats a missing or inactive device as an idempotent no-op', async () => {
    const service: DurablePushRetryService = {
      deliverByDeviceId: jest.fn().mockResolvedValue(null),
    };
    const handler = createDurableQueueHandlers(service).get('push:deliver');

    await expect(handler!(makeJob({
      deviceId: 'device-1',
      payload: { eventId: 'notification:1', type: 'message', title: 'Hi', body: 'Hello' },
    }))).resolves.toBeUndefined();
  });
});
