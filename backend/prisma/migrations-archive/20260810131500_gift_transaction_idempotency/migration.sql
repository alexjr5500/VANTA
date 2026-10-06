ALTER TABLE "GiftTransaction" ADD COLUMN "requestId" TEXT;

CREATE UNIQUE INDEX "GiftTransaction_requestId_key" ON "GiftTransaction"("requestId");