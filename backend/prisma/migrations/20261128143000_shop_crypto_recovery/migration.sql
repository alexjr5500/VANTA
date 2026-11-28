ALTER TABLE "ShopCryptoInvoice" ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "paymentSender" TEXT;
CREATE TABLE "ShopCryptoCase" (
 "id" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
 "reason" TEXT NOT NULL, "reportedHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, "reviewedBy" TEXT, "reviewNote" TEXT,
 CONSTRAINT "ShopCryptoCase_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ShopCryptoCase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ShopCryptoInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ShopCryptoCase_invoiceId_key" ON "ShopCryptoCase"("invoiceId");
CREATE INDEX "ShopCryptoCase_status_createdAt_idx" ON "ShopCryptoCase"("status","createdAt");
