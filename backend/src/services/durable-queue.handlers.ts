import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../prisma';
import { isCloudinaryStorageConfigured } from './cloudinary-storage-config';
import { prepareCloudinaryMedia, CloudinaryJobKind, CloudinaryMediaJob } from './cloudinary-media-job';
import { optimizeLocalImage } from './media-image-job';
import { cleanupExpiredMediaTemp } from './media-cleanup-job';
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
    const mode = process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE || 'local';
    if (mode === 'cloudinary') {
      if (!isCloudinaryStorageConfigured(process.env)) {
        throw new Error('Cloudinary media jobs require all Cloudinary credentials');
      }
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
      const store = {
        findById: (id: string) => prisma.uploadedFile.findUnique({
          where: { id },
          select: { id: true, path: true, category: true, fileType: true, deletedAt: true },
        }),
      };
      const client = {
        explicit: (id: string, options: Parameters<typeof cloudinary.uploader.explicit>[1]) =>
          cloudinary.uploader.explicit(id, options),
      };
      for (const kind of ['cloudinary:image:optimize', 'cloudinary:thumbnail:generate', 'cloudinary:video:transcode'] as CloudinaryJobKind[]) {
        handlers.set(kind, async (job: DurableJob): Promise<void> => {
          await prepareCloudinaryMedia(kind, job.payload as CloudinaryMediaJob, store, client);
        });
      }
      return handlers;
    }
    if (mode !== 'local') throw new Error('Unsupported durable media storage mode');
    const root = process.env.UPLOAD_STORAGE_DIR;
    if (!root) throw new Error('UPLOAD_STORAGE_DIR is required for durable media jobs');
    handlers.set('image:optimize', async (job: DurableJob): Promise<void> => {
      const data = job.payload as { inputPath?: unknown; outputName?: unknown; maxWidth?: unknown } | null;
      if (!data || typeof data.inputPath !== 'string' || typeof data.outputName !== 'string' ||
          (data.maxWidth !== undefined && typeof data.maxWidth !== 'number')) {
        throw new Error('Invalid image:optimize payload');
      }
      await optimizeLocalImage(root, {
        inputPath: data.inputPath, outputName: data.outputName, maxWidth: data.maxWidth as number | undefined,
      });
    });
    handlers.set('cleanup:temp', async (job: DurableJob): Promise<void> => {
      const data = job.payload as { relativePath?: unknown; olderThanMs?: unknown } | null;
      if (!data || typeof data.relativePath !== 'string' ||
          (data.olderThanMs !== undefined && typeof data.olderThanMs !== 'number')) {
        throw new Error('Invalid cleanup:temp payload');
      }
      cleanupExpiredMediaTemp(root, data.relativePath, data.olderThanMs as number | undefined);
    });
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
