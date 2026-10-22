/**
 * Optional local WebP artwork for known catalog slugs.
 *
 * Catalog records remain authoritative for gift IDs, names, prices, and sending.
 * Missing or failed assets fall back to GiftArtwork's existing SVG/3D library.
 */
const GIFT_ARTWORK_ASSETS: Record<string, string> = {
  rose: '/gifts/blue-rose.webp',
};

export function giftArtworkAsset(slug?: string, name?: string): string | undefined {
  const key = (slug || name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return GIFT_ARTWORK_ASSETS[key];
}
