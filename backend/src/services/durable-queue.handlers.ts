import { DurableJob } from './durable-queue.repository';
import { DurableJobHandler } from './durable-queue.worker';
import { pushNotificationService } from './push/push-notification.service';
import { PushNotificationPayload, PushSendResult } from './push/push-types';

export interface DurablePushRetryService {
  deliverByDeviceId(
    deviceId: string,
    payload: PushNotificationPayload,
    options?: { scheduleRetry?: boolean },
  ): Promise<PushSendResult | null>;
}

/**
 * Build the allow-listed handler registry for the PostgreSQL queue.
 * The worker is still explicitly started by its caller; importing this module
 * does not start background processing.
 */
export function createDurableQueueHandlers(
  pushService: DurablePushRetryService = pushNotificationService,
): ReadonlyMap<string, DurableJobHandler> {
  const handlers = new Map<string, DurableJobHandler>();

  handlers.set('push:deliver', async (job: DurableJob): Promise<void> => {
    const payload = job.payload as { deviceId?: unknown; payload?: PushNotificationPayload } | null;
    if (!payload || typeof payload.deviceId !== 'string' || !payload.deviceId || !payload.payload?.eventId) {
      throw new Error('Invalid push:deliver durable job payload');
    }

    // Durable retries are owned by PostgreSQL. Do not enqueue another retry
    // into the legacy in-memory queue from inside this handler.
    const result = await pushService.deliverByDeviceId(payload.deviceId, payload.payload, {
      scheduleRetry: false,
    });
    if (result?.status === 'FAILED') {
      throw new Error(result.error || 'Push delivery failed');
    }
  });

  return handlers;
}
