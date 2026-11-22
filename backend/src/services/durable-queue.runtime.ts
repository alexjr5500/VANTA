import { prisma } from '../prisma';
import { DurableQueueRepository } from './durable-queue.repository';
import { DurableQueueWorker, DurableWorkerOptions } from './durable-queue.worker';
import { createDurableQueueHandlers } from './durable-queue.handlers';

/**
 * Construct (but do not start) the durable worker.
 * Startup remains an explicit operational decision; this factory has no
 * import-time side effects and does not activate the worker in production.
 */
export function createDurableQueueWorker(options: DurableWorkerOptions = {}): DurableQueueWorker {
  return new DurableQueueWorker(
    new DurableQueueRepository(prisma),
    createDurableQueueHandlers(),
    {
      ...options,
      excludedJobTypes: process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS === 'true'
        ? (options.excludedJobTypes ?? [])
        : [...(options.excludedJobTypes ?? []), 'image:optimize', 'thumbnail:generate', 'video:transcode', 'cleanup:temp'],
    },
  );
}
