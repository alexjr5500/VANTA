CREATE TABLE "ShopCryptoInvoice" (
  "id" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "payerId" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "amountAtomic" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "transactionHash" TEXT,
  CONSTRAINT "ShopCryptoInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopCryptoInvoice_orderId_key" ON "ShopCryptoInvoice"("orderId");
CREATE UNIQUE INDEX "ShopCryptoInvoice_address_key" ON "ShopCryptoInvoice"("address");
CREATE INDEX "ShopCryptoInvoice_payerId_createdAt_idx" ON "ShopCryptoInvoice"("payerId","createdAt");
CREATE INDEX "ShopCryptoInvoice_network_expiresAt_idx" ON "ShopCryptoInvoice"("network","expiresAt");
