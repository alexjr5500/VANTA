type CatalogGift = {
  slug: string;
  name: string;
  price: number;
  category: string;
  artworkType: string;
  animationType: string;
  animationDuration: number;
  glowColor: string;
  particleColor: string;
  description: string;
  sortOrder: number;
  rarity: string;
  tier: string;
  impactLevel: number;
  effectProfile: string;
  isActive?: boolean;
  isFeatured?: boolean;
  isTrending?: boolean;
  isPopular?: boolean;
  isLimited?: boolean;
  isLegendary?: boolean;
};

// Runtime require keeps Prisma's seed catalog as the single source of truth
// without pulling the prisma directory into the application compiler root.
export const { initialGiftCatalog } = require('../../prisma/gift-catalog.data') as {
  initialGiftCatalog: CatalogGift[];
};