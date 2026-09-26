export interface GiftCatalogItem {
  id: string;
  slug?: string;
  name: string;
  price: number;
  category?: string;
  description?: string;
  image?: string;
  animationUrl?: string;
  thumbnailUrl?: string;
  previewAssetUrl?: string;
  isPopular?: boolean;
  isTrending?: boolean;
  isLimited?: boolean;
  isLegendary?: boolean;
  isFeatured?: boolean;
  glowColor?: string;
  particleColor?: string;
  animationDuration?: number;
  artworkType?: string;
  tier?: 'low' | 'mid' | 'high';
  impactLevel?: number;
  sortOrder?: number;
  comboEnabled?: boolean;
}

export function normalizeGiftCatalog(value: unknown): GiftCatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    const price = Number(item?.price);
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || !Number.isSafeInteger(price) || price < 1) {
      console.error('Ignoring invalid gift catalog record', item?.id ?? 'unknown');
      return [];
    }
    return [{ ...item, name: item.name.trim(), price } as GiftCatalogItem];
  });
}

export const GIFT_CATEGORIES = [
  { id: 'all', label: 'All Gifts' }, { id: 'popular', label: 'Popular' },
  { id: 'premium', label: 'Premium' }, { id: 'luxury', label: 'Luxury' }, { id: 'limited', label: 'Limited' },
] as const;
export type GiftCategoryId = typeof GIFT_CATEGORIES[number]['id'];
export function giftMatchesCategory(gift: GiftCatalogItem, category: GiftCategoryId) {
  if (category === 'all') return true;
  if (category === 'limited') return Boolean(gift.isLimited);
  // "Popular" mirrors the Gift Store: catalog category plus trending/popular flags.
  if (category === 'popular') return Boolean(gift.isPopular || gift.isTrending) || (gift.category || '').toLowerCase() === 'popular';
  return (gift.category || '').toLowerCase() === category;
}
export function giftCategoryCount(gifts: GiftCatalogItem[], category: GiftCategoryId) { return gifts.filter(gift => giftMatchesCategory(gift, category)).length; }
// Only surface a category tab when it holds gifts (All is always shown), so the
// picker never renders an empty "Limited" tab, matching the Gift Store screen.
export function visibleGiftCategories(gifts: GiftCatalogItem[]) {
  return GIFT_CATEGORIES.filter(category => category.id === 'all' || giftCategoryCount(gifts, category.id) > 0);
}
export function filterGiftCatalog(gifts: GiftCatalogItem[], category: GiftCategoryId, query = '') {
  const needle = query.trim().toLowerCase();
  return gifts.filter(gift => giftMatchesCategory(gift, category) && (!needle || [gift.name, gift.slug, gift.description, gift.category].some(value => value?.toLowerCase().includes(needle)))).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
/**
 * Artistic intensity tier (0-5) derived from the EXISTING catalog values.
 * Price and rarity stay separate signals — this only maps their combination
 * onto the artwork's visual richness (glow, aura, particles, material). It
 * never modifies any product data.
 *   0-1  clean premium 3D (common / < 50 coins)
 *   2    richer clean premium (50-200 coins)
 *   3    richer materials + glow (rare / 250-750)
 *   4    luxury cinema 3D (legendary/epic / 1000+)
 *   5    spectacular signature VANTA treatment (mythic / 2500+)
 */
export function giftVisualQuality(gift?: { price?: number; rarity?: string; impactLevel?: number; isLegendary?: boolean } | null): number {
  if (!gift) return 1;
  const price = Number(gift.price ?? 0);
  const rarity = (gift.rarity || '').toLowerCase();
  const impact = Number(gift.impactLevel ?? 0);
  if (gift.isLegendary || rarity === 'mythic' || impact >= 5 || price >= 2500) return 5;
  if (rarity === 'epic' || rarity === 'legendary' || impact === 4 || price >= 1000) return 4;
  if (rarity === 'rare' || impact === 3 || (price >= 250 && price < 1000)) return 3;
  if (impact >= 2 || (price >= 50 && price < 250)) return 2;
  return 1;
}
