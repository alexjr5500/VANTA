CREATE TABLE "ShopCardCheckout" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "payerId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "sessionId" TEXT,
  "paymentIntentId" TEXT,
  "paidAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopCardCheckout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopCardCheckout_orderId_key" ON "ShopCardCheckout"("orderId");
CREATE UNIQUE INDEX "ShopCardCheckout_sessionId_key" ON "ShopCardCheckout"("sessionId");
CREATE UNIQUE INDEX "ShopCardCheckout_paymentIntentId_key" ON "ShopCardCheckout"("paymentIntentId");
CREATE INDEX "ShopCardCheckout_payerId_createdAt_idx" ON "ShopCardCheckout"("payerId","createdAt");
