-- Expand the existing Gift catalog. Values are backfilled before slug becomes unique.
ALTER TABLE "Gift" ADD COLUMN "slug" TEXT;
ALTER TABLE "Gift" ADD COLUMN "image" TEXT;
ALTER TABLE "Gift" ADD COLUMN "animationType" TEXT NOT NULL DEFAULT 'float';
ALTER TABLE "Gift" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Gift" ADD COLUMN "isTrending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Gift" ADD COLUMN "isPopular" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Gift"
SET "slug" = lower(replace(replace(trim("name"), ' ', '-'), '_', '-'))
WHERE "slug" IS NULL;

CREATE UNIQUE INDEX "Gift_slug_key" ON "Gift"("slug");
CREATE INDEX "Gift_isFeatured_isActive_sortOrder_idx" ON "Gift"("isFeatured", "isActive", "sortOrder");
CREATE INDEX "Gift_isTrending_isActive_sortOrder_idx" ON "Gift"("isTrending", "isActive", "sortOrder");
CREATE INDEX "Gift_isPopular_isActive_sortOrder_idx" ON "Gift"("isPopular", "isActive", "sortOrder");