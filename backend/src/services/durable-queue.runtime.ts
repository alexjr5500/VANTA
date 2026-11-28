import { prisma } from '../prisma';
import { DurableQueueRepository } from './durable-queue.repository';
import { DurableQueueWorker, DurableWorkerOptions } from './durable-queue.worker';
import { createDurableQueueHandlers } from './durable-queue.handlers';
import { excludedMediaJobTypes } from './durable-media-job-routing';

/**
 * Construct (but do not start) the durable worker.
 * Startup remains an explicit operational decision; this factory has no
 * import-time side effects and does not activate the worker in production.
 */
export function createDurableQueueWorker(options: DurableWorkerOptions = {}): DurableQueueWorker {
  const mediaHandlersEnabled = process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS === 'true';
  const mode = process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE || 'local';
  return new DurableQueueWorker(
    new DurableQueueRepository(prisma),
    createDurableQueueHandlers(),
    {
      ...options,
      excludedJobTypes: [
        ...(options.excludedJobTypes ?? []),
        ...excludedMediaJobTypes(mediaHandlersEnabled, mode),
      ],
    },
  );
}
