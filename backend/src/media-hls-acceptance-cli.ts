import { verifyPublicCloudinaryHls } from './services/cloudinary-hls-acceptance';

async function main(): Promise<void> {
  // This command only reads public CDN assets; it never creates media or jobs.
  if (process.env.VANTA_STAGING_MEDIA_ACCEPTANCE !== 'yes') {
    throw new Error('VANTA_STAGING_MEDIA_ACCEPTANCE=yes is required for the staging HLS probe');
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const manifest = process.env.VANTA_STAGING_HLS_URL;
  if (!cloudName || !manifest) {
    throw new Error('CLOUDINARY_CLOUD_NAME and VANTA_STAGING_HLS_URL are required');
  }
  const result = await verifyPublicCloudinaryHls(manifest, cloudName);
  console.info('[Staging HLS acceptance] Verified public master, variants and media segments:', result);
}

void main().catch(error => {
  console.error('[Staging HLS acceptance] Failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
