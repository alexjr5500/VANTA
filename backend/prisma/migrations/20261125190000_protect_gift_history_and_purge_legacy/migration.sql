-- Protect dependent records, purge only unreferenced legacy gifts, and permanently retire the rest.
BEGIN;
ALTER TABLE "Gift" ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "GiftTransaction" DROP CONSTRAINT "GiftTransaction_giftId_fkey";
ALTER TABLE "GiftTransaction" ADD CONSTRAINT "GiftTransaction_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveGiftEvent" DROP CONSTRAINT "LiveGiftEvent_giftId_fkey";
ALTER TABLE "LiveGiftEvent" ADD CONSTRAINT "LiveGiftEvent_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCombo" DROP CONSTRAINT "GiftCombo_giftId_fkey";
ALTER TABLE "GiftCombo" ADD CONSTRAINT "GiftCombo_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventGift" DROP CONSTRAINT "EventGift_giftId_fkey";
ALTER TABLE "EventGift" ADD CONSTRAINT "EventGift_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowerRewardCampaign" DROP CONSTRAINT "FollowerRewardCampaign_giftId_fkey";
ALTER TABLE "FollowerRewardCampaign" ADD CONSTRAINT "FollowerRewardCampaign_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowerRewardClaim" DROP CONSTRAINT "FollowerRewardClaim_giftId_fkey";
ALTER TABLE "FollowerRewardClaim" ADD CONSTRAINT "FollowerRewardClaim_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- The preceding approved-catalog migration has already disabled all non-catalog rows.
DELETE FROM "Gift" g
WHERE NOT g."isActive" AND g."slug" NOT IN ('rose','heart','crown','panda','dragon','lion','yacht','galaxy','diamond','private-jet','phoenix','castle','galaxy-dragon','golden-throne','infinity','luxury-car','motorcycle','ferrari','g-wagon','superyacht','helicopter','space-shuttle','royal-carriage','magic-wand','magic-hat','teddy-bear','gift-box','music-note','shooting-star','fireworks','ice-cream','bubble-tea','coffee','pizza','burger','fries','sushi','cake','donut','chocolate','snowman','santa','reindeer','christmas-tree','gift-sack','valentine-bear','love-letter','rain-cloud','sunshine','moon','ocean-wave','butterfly','dolphin','star','moonlight','aurora','crystal-ball','treasure-chest','golden-key','time-hourglass','dragon-egg','phoenix-feather','lightning','fire-elemental','water-elemental','earth-elemental','wind-elemental','space-ring','golden-butterfly','diamond-heart')
 AND NOT EXISTS (SELECT 1 FROM "GiftTransaction" d WHERE d."giftId" = g.id)
 AND NOT EXISTS (SELECT 1 FROM "LiveGiftEvent" d WHERE d."giftId" = g.id)
 AND NOT EXISTS (SELECT 1 FROM "GiftCombo" d WHERE d."giftId" = g.id)
 AND NOT EXISTS (SELECT 1 FROM "EventGift" d WHERE d."giftId" = g.id)
 AND NOT EXISTS (SELECT 1 FROM "FollowerRewardCampaign" d WHERE d."giftId" = g.id)
 AND NOT EXISTS (SELECT 1 FROM "FollowerRewardClaim" d WHERE d."giftId" = g.id);
UPDATE "Gift" SET "retiredAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT "isActive" AND "retiredAt" IS NULL AND "slug" NOT IN ('rose','heart','crown','panda','dragon','lion','yacht','galaxy','diamond','private-jet','phoenix','castle','galaxy-dragon','golden-throne','infinity','luxury-car','motorcycle','ferrari','g-wagon','superyacht','helicopter','space-shuttle','royal-carriage','magic-wand','magic-hat','teddy-bear','gift-box','music-note','shooting-star','fireworks','ice-cream','bubble-tea','coffee','pizza','burger','fries','sushi','cake','donut','chocolate','snowman','santa','reindeer','christmas-tree','gift-sack','valentine-bear','love-letter','rain-cloud','sunshine','moon','ocean-wave','butterfly','dolphin','star','moonlight','aurora','crystal-ball','treasure-chest','golden-key','time-hourglass','dragon-egg','phoenix-feather','lightning','fire-elemental','water-elemental','earth-elemental','wind-elemental','space-ring','golden-butterfly','diamond-heart');
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_retired_not_active" CHECK ("retiredAt" IS NULL OR NOT "isActive");
COMMIT;
