import { DurableQueueWorker } from '../services/durable-queue.worker';
import type { DurableJob, DurableQueueRepository } from '../services/durable-queue.repository';

describe('durable worker shutdown claim boundary', () => {
  it('finishes a job claimed concurrently with shutdown and never claims another', async () => {
    let release!: (value: DurableJob) => void;
    const pending = new Promise<DurableJob>(resolve => { release = resolve; });
    const claim = jest.fn(() => pending);
    const complete = jest.fn().mockResolvedValue(true);
    const repo = { claim, complete } as unknown as DurableQueueRepository;
    const handler = jest.fn().mockResolvedValue(undefined);
    const worker = new DurableQueueWorker(repo, new Map([['synthetic', handler]]), {
      workerId: 'shutdown-ci', concurrency: 1, leaseMs: 3000, pollIntervalMs: 5,
    });
    worker.start();
    const stopped = worker.stop();
    release({ id: 'synthetic-job', type: 'synthetic', attempts: 1 } as DurableJob);
    await stopped;
    expect(claim).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('synthetic-job', 'shutdown-ci');
  });
});
