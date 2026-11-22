import { generateLocalThumbnail } from './media-thumbnail-job';
import { transcodeLocalHls } from './media-hls-job';
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

  // Media jobs are explicitly opt-in and require a separately provisioned worker
  // image with Sharp/FFmpeg and a shared persistent upload volume.
  if (process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS === 'true') {
    const root = process.env.UPLOAD_STORAGE_DIR;
    if (!root) throw new Error('UPLOAD_STORAGE_DIR is required for durable media jobs');
    handlers.set('thumbnail:generate', async (job: DurableJob): Promise<void> => {
      const data = job.payload as { inputPath?: unknown; outputName?: unknown } | null;
      if (!data || typeof data.inputPath !== 'string' || typeof data.outputName !== 'string') {
        throw new Error('Invalid thumbnail:generate payload');
      }
      await generateLocalThumbnail(root, { inputPath: data.inputPath, outputName: data.outputName });
    });
    handlers.set('video:transcode', async (job: DurableJob): Promise<void> => {
      const data = job.payload as { inputPath?: unknown; outputName?: unknown; qualities?: unknown } | null;
      if (!data || typeof data.inputPath !== 'string' || typeof data.outputName !== 'string' ||
          (data.qualities !== undefined && (!Array.isArray(data.qualities) ||
           !data.qualities.every(q => typeof q === 'string')))) {
        throw new Error('Invalid video:transcode payload');
      }
      await transcodeLocalHls(root, {
        inputPath: data.inputPath, outputName: data.outputName, qualities: data.qualities as string[] | undefined,
      });
    });
  }

  return handlers;
}
