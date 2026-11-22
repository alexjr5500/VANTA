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
  return configured.length === names.length;
}
