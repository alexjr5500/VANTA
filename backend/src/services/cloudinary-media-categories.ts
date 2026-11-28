/** Only explicitly public upload categories may produce CDN derivatives. */
const IMAGE_CATEGORIES = new Set([
  'avatar', 'banner', 'profile-media', 'thumbnail', 'group-avatar',
  'channel-avatar', 'community-avatar', 'community-banner',
  'post-image', 'post-media', 'story', 'reel',
]);
const VIDEO_CATEGORIES = new Set(['reel', 'story', 'post-video', 'post-media']);

export function isPublicCloudinaryDerivative(fileType: string, category: string): boolean {
  if (fileType === 'IMAGE') return IMAGE_CATEGORIES.has(category);
  if (fileType === 'VIDEO') return VIDEO_CATEGORIES.has(category);
  return false;
}
