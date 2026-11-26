/**
 * Cloudinary is optional, but partial credentials must not silently switch
 * uploads to ephemeral local disk after a misconfigured deployment.
 * Keep secret values out of thrown errors and logs.
 */
export function isCloudinaryStorageConfigured(
  env: Record<string, string | undefined>,
): boolean {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
  const configured = names.filter(name => Boolean(env[name]?.trim()));
  if (configured.length > 0 && configured.length < names.length) {
    throw new Error(
      'Incomplete Cloudinary configuration: configure all CLOUDINARY_CLOUD_NAME, ' +
      'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or remove all three',
    );
  }
  // An explicitly selected Cloudinary worker/producer topology must never
  // silently fall back to ephemeral local disk while waiting for credentials.
  // The default local mode remains valid for development and legacy services.
  if (env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE === 'cloudinary' && configured.length === 0) {
    throw new Error('Cloudinary storage mode requires all Cloudinary credentials');
  }
  return configured.length === names.length;
}

/** Verification submission is under maintenance. Do not accept new identity
 * documents through either storage backend until private reviewer access exists.
 */
export function isVerificationDocument(category: string, recordType?: string | null): boolean {
  return ['verification', 'identity', 'kyc'].includes(category.trim().toLowerCase()) ||
    recordType?.trim().toLowerCase() === 'verificationrequest';
}
export function assertVerificationUploadAvailable(category: string, recordType?: string | null): void {
  if (isVerificationDocument(category, recordType)) {
    throw new Error('Secure verification document storage is temporarily unavailable');
  }
}
