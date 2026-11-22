import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
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
  // Fail fast rather than repeatedly claiming jobs that cannot be processed.
  if (process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS === 'true') {
    const storage = process.env.UPLOAD_STORAGE_DIR;
    if (!storage || !path.isAbsolute(storage)) {
      throw new Error('Media worker requires an absolute UPLOAD_STORAGE_DIR');
    }
    const resolved = path.resolve(storage);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory() ||
        fs.realpathSync(resolved) !== resolved) {
      throw new Error('Media worker requires an existing, non-symlink upload directory');
    }
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    const ffmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], {
      timeout: 5_000, encoding: 'utf8',
    });
    if (ffmpeg.error || ffmpeg.status !== 0) {
      throw new Error('Media worker requires an executable FFmpeg binary');
    }
    const encoders = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-encoders'], {
      timeout: 5_000, encoding: 'utf8',
    });
    if (encoders.error || encoders.status !== 0 ||
        !/\blibx264\b/.test(encoders.stdout) || !/\baac\b/.test(encoders.stdout)) {
      throw new Error('Media worker requires FFmpeg with libx264 and AAC encoders');
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('sharp');
    } catch {
      throw new Error('Media worker requires the Sharp image encoder');
    }
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
