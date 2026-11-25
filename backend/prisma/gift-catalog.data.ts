// Use the same CommonJS catalog at runtime and during TypeScript seeding.
export const { initialGiftCatalog } = require('./gift-catalog.data.js') as {
  initialGiftCatalog: Array<{
    slug: string; name: string; price: number; category: string;
    isPopular: boolean; isTrending: boolean; isFeatured: boolean; isLegendary: boolean;
    artworkType: string; animationType: string; animationDuration: number;
    glowColor: string; particleColor: string; description: string; sortOrder: number;
    rarity: string; tier: string; impactLevel: number; effectProfile: string;
  }>;
};
