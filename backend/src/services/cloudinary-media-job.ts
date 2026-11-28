import { isPublicCloudinaryDerivative } from './cloudinary-media-categories';
export type CloudinaryJobKind = 'cloudinary:image:optimize' | 'cloudinary:thumbnail:generate' | 'cloudinary:video:transcode';

export interface CloudinaryMediaRecord {
  id: string;
  path: string | null;
  category: string;
  fileType: string;
  deletedAt: Date | null;
}
export interface CloudinaryMediaStore {
  findById(fileId: string): Promise<CloudinaryMediaRecord | null>;
  saveDerivative(source: CloudinaryMediaRecord, kind: CloudinaryJobKind, url: string): Promise<boolean>;
}
export interface CloudinaryMediaClient {
  /** The configured Cloudinary account; used to verify provider result URLs. */
  cloudName: string;
  explicit(publicId: string, options: {
    resource_type: 'image' | 'video';
    type: 'upload' | 'authenticated';
    eager: Record<string, unknown>[];
    eager_async: false;
  }): Promise<{ eager?: Array<{ secure_url?: string }> }>;
}

export interface CloudinaryMediaJob {
  fileId: string;
  maxWidth?: number;
  qualities?: string[];
}

/**
 * Processes an asset already uploaded to Cloudinary. The queue payload contains
 * an UploadedFile ID, never a remote URL or arbitrary Cloudinary public ID.
 * Source ownership and visibility always come from the application's database.
 *
 * Does not mutate the original asset URL or make private messages public.
 * Callers can use the deterministic Cloudinary transformation for playback
 * once the application delivery flow is explicitly integrated.
 */
export async function prepareCloudinaryMedia(
  kind: CloudinaryJobKind,
  job: CloudinaryMediaJob,
  store: CloudinaryMediaStore,
  client: CloudinaryMediaClient,
): Promise<void> {
  if (!job || typeof job.fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(job.fileId)) {
    throw new Error('Cloudinary media job requires a valid UploadedFile ID');
  }
  const record = await store.findById(job.fileId);
  if (!record || record.deletedAt) throw new Error('Cloudinary media source is unavailable');
  // Private message derivatives must not be published as ordinary CDN URLs.
  // Their token-checked delivery path is separate from public uploaded media.
  if (record.category === 'message') {
    throw new Error('Private message media is not supported by public derivative delivery');
  }

  if (!isPublicCloudinaryDerivative(record.fileType, record.category)) {
    throw new Error('Unsupported private media category for public derivative processing');
  }

  const match = /^cloudinary:(image|video):(.+)$/.exec(record.path || '');
  if (!match || !match[2].startsWith('vanta/') ||
      !/^[a-zA-Z0-9_/-]{1,255}$/.test(match[2]) ||
      match[2].includes('..')) {
    throw new Error('Cloudinary media source is not a supported VANTA asset');
  }
  const resourceType = match[1] as 'image' | 'video';
  const expectedType = kind === 'cloudinary:video:transcode' ? 'VIDEO' : 'IMAGE';
  if (record.fileType !== expectedType || (kind === 'cloudinary:video:transcode' ? resourceType !== 'video' : resourceType !== 'image')) {
    throw new Error('Cloudinary media source type does not match the job');
  }

  let transformation: Record<string, unknown>;
  if (kind === 'cloudinary:image:optimize') {
    const width = job.maxWidth ?? 1200;
    if (!Number.isInteger(width) || width < 64 || width > 3840) throw new Error('Invalid image width');
    transformation = { width, crop: 'limit', quality: 80, format: 'webp' };
  } else if (kind === 'cloudinary:thumbnail:generate') {
    transformation = { width: 320, height: 180, crop: 'fill', quality: 70, format: 'webp' };
  } else {
    // Cloudinary owns the ABR ladder, unlike the local FFmpeg implementation.
    // Never silently pretend a requested list of local quality presets was met.
    if (job.qualities !== undefined) {
      throw new Error('Cloudinary HLS uses a managed streaming profile; explicit qualities are unsupported');
    }
    transformation = { streaming_profile: 'hd', format: 'm3u8' };
  }

  // Message attachments are stored as authenticated Cloudinary assets. Eager
  // derivation must use the same delivery type; never downgrade to public.
  const response = await client.explicit(match[2], {
    resource_type: resourceType,
    type: record.category === 'message' ? 'authenticated' : 'upload',
    eager: [transformation],
    eager_async: false,
  });
  const url = response?.eager?.[0]?.secure_url;
  // Never persist arbitrary provider URLs, insecure HTTP, or mismatched formats.
  let verified: URL;
  try {
    verified = new URL(url);
  } catch {
    throw new Error('Cloudinary did not confirm a prepared media derivative');
  }
  const expectedExt = kind === 'cloudinary:video:transcode' ? '.m3u8' : '.webp';
  // The provider response must match this Cloudinary account *and* the
  // original VANTA public ID. A URL for a different account or asset must
  // never become a public media URL in the database.
  if (!/^[a-zA-Z0-9_-]+$/.test(client.cloudName) ||
      verified.protocol !== 'https:' || verified.hostname !== 'res.cloudinary.com' ||
      verified.port || verified.username || verified.password || verified.search || verified.hash ||
      !verified.pathname.startsWith(`/${client.cloudName}/${resourceType}/upload/`) ||
      !verified.pathname.endsWith(`/${match[2]}${expectedExt}`)) {
    throw new Error('Cloudinary did not confirm a safe media derivative URL');
  }
  const updated = await store.saveDerivative(record, kind, url);
  if (!updated) {
    throw new Error('Cloudinary media source changed or was deleted before publishing the derivative');
  }
}
