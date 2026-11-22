import { EnqueueOptions } from './durable-queue.repository';

interface QueueWriter {
  enqueue(type: string, payload: unknown, options?: EnqueueOptions): Promise<string>;
}
interface UploadedMedia {
  id: string;
  fileType: string;
  category: string;
}
interface UploadProcessingOptions {
  optimize: boolean;
  generateThumbnail: boolean;
}

/**
 * Enqueue only Cloudinary-compatible jobs. Call inside the same PostgreSQL
 * transaction that creates UploadedFile, so missing queue migrations or enqueue
 * failures cannot commit an unprocessed upload when the producer is enabled.
 */
export async function enqueueCloudinaryMediaForUpload(
  file: UploadedMedia,
  options: UploadProcessingOptions,
  repository: QueueWriter,
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(file.id)) throw new Error('Invalid UploadedFile ID');
  // Private message attachments must use the token-checked media route.
  // Do not create public derivative jobs for them.
  if (file.category === 'message') return;
  const jobs: string[] = [];
  if (file.fileType === 'IMAGE') {
    if (options.optimize) jobs.push('cloudinary:image:optimize');
    if (options.generateThumbnail) jobs.push('cloudinary:thumbnail:generate');
  } else if (file.fileType === 'VIDEO' &&
             ['reel', 'story', 'post-video'].includes(file.category)) {
    jobs.push('cloudinary:video:transcode');
  }
  for (const type of jobs) {
    await repository.enqueue(type, { fileId: file.id }, {
      id: `media-${type.replace(/:/g, '-')}-${file.id}`,
      maxAttempts: 3,
    });
  }
}
