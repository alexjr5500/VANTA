ALTER TABLE "Gift" ADD COLUMN "artworkType" TEXT NOT NULL DEFAULT 'artifact';
ALTER TABLE "Gift" ADD COLUMN "rarity" TEXT NOT NULL DEFAULT 'common';
ALTER TABLE "Gift" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'low';
ALTER TABLE "Gift" ADD COLUMN "impactLevel" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Gift" ADD COLUMN "effectProfile" TEXT NOT NULL DEFAULT 'shimmer';
ALTER TABLE "Gift" ADD COLUMN "previewAssetUrl" TEXT;
CREATE INDEX "Gift_rarity_tier_isActive_idx" ON "Gift"("rarity", "tier", "isActive");