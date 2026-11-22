import { prisma } from './prisma';
import { createDurableQueueWorker } from './services/durable-queue.runtime';

/**
 * Dedicated worker process. Never start queue processing in the HTTP server.
 * Set VANTA_DURABLE_WORKER_ENABLED=true explicitly in an isolated service.
 */
async function main(): Promise<void> {
  if (process.env.VANTA_DURABLE_WORKER_ENABLED !== 'true') {
    throw new Error('VANTA_DURABLE_WORKER_ENABLED=true is required to start the durable worker');
  }
  const worker = createDurableQueueWorker();
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.info('[DurableQueueWorker] Shutdown requested:', signal);
    void worker.stop().then(() => prisma.$disconnect()).then(() => {
      process.exitCode = 0;
    }).catch(error => {
      console.error('[DurableQueueWorker] Shutdown failed:', error);
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  await prisma.$connect();
  if (stopping) return;
  worker.start();
  console.info('[DurableQueueWorker] Started:', worker.id);
}

void main().catch(async error => {
  console.error('[DurableQueueWorker] Startup failed:', error);
  process.exitCode = 1;
  await prisma.$disconnect();
});
