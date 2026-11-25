import './config/env';
import { prisma } from './prisma';
import { excludedMediaJobTypes } from './services/durable-media-job-routing';
import { getDurableQueueHealth } from './services/durable-queue.health';
import { evaluateDurableQueueHealth } from './services/durable-queue.alerts';
import { AlertDelivery, alertConfig } from './services/alert-delivery';

/**
 * Explicit read-only monitoring command suitable for a *separately configured*
 * scheduler. It does not start queue workers, mutate jobs or send payloads.
 */
async function main(): Promise<void> {
  if (process.env.VANTA_DURABLE_QUEUE_MONITOR_ENABLED !== 'true') {
    throw new Error('Durable queue monitor is disabled');
  }
  if (!process.env.DATABASE_URL) throw new Error('Missing monitoring database connection');
  const delivery = new AlertDelivery(alertConfig(process.env));
  try {
    await prisma.$connect();
    const excluded = excludedMediaJobTypes(
      process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS === 'true',
      process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE || 'local',
    );
    const snapshot = await getDurableQueueHealth(prisma, excluded);
    const report = evaluateDurableQueueHealth(snapshot);
    // Job payloads, IDs, errors and database connection details are excluded.
    console.info('[DurableQueueMonitor]', JSON.stringify(report));
    for (const alert of report.alerts) delivery.enqueue({ code: alert.code, severity: alert.severity, transition: 'degraded' });
    if (report.status !== 'ok') process.exitCode = 2;
  } catch {
    // Deliberately no raw Prisma/connection error output; it may contain secrets.
    console.error('[DurableQueueMonitor] Unavailable: queue query, database or migration failed');
    delivery.enqueue({ code: 'queue_monitor_unavailable', severity: 'critical', transition: 'degraded' });
    process.exitCode = 2;
  } finally {
    await delivery.close();
    await prisma.$disconnect().catch(() => {
      console.error('[DurableQueueMonitor] Database disconnect failed');
      process.exitCode = 2;
    });
  }
}

void main().catch(() => {
  console.error('[DurableQueueMonitor] Startup failed');
  process.exitCode = 2;
});
