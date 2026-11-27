ALTER TABLE "ShopTreasuryTransfer"
  ADD COLUMN "automation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxFeeAtomic" TEXT,
  ADD COLUMN "signerRequestId" TEXT,
  ADD COLUMN "signerPolicyId" TEXT,
  ADD COLUMN "orderAmountCents" INTEGER,
  ADD COLUMN "dispatchStartedAt" TIMESTAMP(3),
  ADD COLUMN "dispatchDeadline" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastFailure" TEXT,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3);
CREATE UNIQUE INDEX "ShopTreasuryTransfer_signerRequestId_key" ON "ShopTreasuryTransfer"("signerRequestId");
CREATE INDEX "ShopTreasuryTransfer_automation_status_nextAttemptAt_idx" ON "ShopTreasuryTransfer"("automation","status","nextAttemptAt");
