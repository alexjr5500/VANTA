/**
 * Optional local WebP artwork for known catalog slugs.
 *
 * Catalog records remain authoritative for gift IDs, names, prices, and sending.
 * When an asset is missing or fails to load, GiftArtwork renders its existing
 * SVG/3D fallback. These paths are deliberately limited to existing slugs.
 */
const GIFT_ARTWORK_ASSETS: Record<string, string> = {
  'aurora-castle': '/gifts/royal-castle.webp',
  rose: '/gifts/blue-rose.webp',
  'first-place': '/gifts/golden-lion.webp',
  'lunar-rose': '/gifts/forever-roses.webp',
  teddy: '/gifts/cool-panda.webp',
  crown: '/gifts/crown.webp',
  'nebula-heart': '/gifts/diamond-heart.webp',
  'lets-ride': '/gifts/dream-car.webp',
  'crystal-star': '/gifts/shooting-star.webp',
  yacht: '/gifts/luxury-yacht.webp',
  'starlight-capsule': '/gifts/mystery-box.webp',
  'hyper-roadster': '/gifts/golden-bike.webp',
  'phoenix-flame': '/gifts/phoenix-rise.webp',
  'royal-dragon': '/gifts/dragon-legend.webp',
  'happy-day': '/gifts/fireworks.webp',
};

export function giftArtworkAsset(slug?: string, name?: string): string | undefined {
  const key = (slug || name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return GIFT_ARTWORK_ASSETS[key];
}
