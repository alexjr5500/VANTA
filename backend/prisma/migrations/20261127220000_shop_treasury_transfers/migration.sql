CREATE TABLE "ShopTreasuryTransfer" (
  "id" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "network" TEXT NOT NULL,
  "source" TEXT NOT NULL, "destination" TEXT NOT NULL, "amountAtomic" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AUTHORIZED', "authorizedBy" TEXT NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transactionHash" TEXT, "submittedAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopTreasuryTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopTreasuryTransfer_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ShopCryptoInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ShopTreasuryTransfer_invoiceId_key" ON "ShopTreasuryTransfer"("invoiceId");
CREATE UNIQUE INDEX "ShopTreasuryTransfer_network_transactionHash_key" ON "ShopTreasuryTransfer"("network","transactionHash");
CREATE INDEX "ShopTreasuryTransfer_status_authorizedAt_idx" ON "ShopTreasuryTransfer"("status","authorizedAt");
