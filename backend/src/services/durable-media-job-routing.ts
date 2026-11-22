/**
 * A PostgreSQL queue can contain jobs for multiple media storage backends.
 * Never claim jobs whose payload belongs to a different worker mode:
 * a local worker expects inputPath, while Cloudinary workers expect fileId.
 */
export const LOCAL_MEDIA_JOB_TYPES = [
  'image:optimize', 'thumbnail:generate', 'video:transcode', 'cleanup:temp',
] as const;
export const CLOUDINARY_MEDIA_JOB_TYPES = [
  'cloudinary:image:optimize', 'cloudinary:thumbnail:generate', 'cloudinary:video:transcode',
] as const;

export function excludedMediaJobTypes(
  mediaHandlersEnabled: boolean,
  mode: string = 'local',
): string[] {
  if (!mediaHandlersEnabled) return [...LOCAL_MEDIA_JOB_TYPES, ...CLOUDINARY_MEDIA_JOB_TYPES];
  if (mode === 'cloudinary') return [...LOCAL_MEDIA_JOB_TYPES];
  if (mode === 'local') return [...CLOUDINARY_MEDIA_JOB_TYPES];
  throw new Error('Unsupported durable media storage mode');
}
