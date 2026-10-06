-- ============================================================================
-- VANTA — Wallet reconciliation log (Phase 10)
-- ============================================================================
-- Automated reconciliation results. Each run compares the authoritative
-- ledger-computed balance against Wallet.coinBalance and records ONE row
-- (MATCH or DISCREPANCY) so discrepancies stay auditable.
--
-- SAFETY: purely additive (new table only). Safe to apply to production.
-- ============================================================================

CREATE TABLE "WalletReconciliationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "walletId" TEXT,
    "storedBalance" INTEGER NOT NULL DEFAULT 0,
    "ledgerBalance" INTEGER NOT NULL DEFAULT 0,
    "difference" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'VANTA_COIN',
    "status" TEXT NOT NULL DEFAULT 'DISCREPANCY',
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletReconciliationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletReconciliationLog_userId_createdAt_idx" ON "WalletReconciliationLog"("userId", "createdAt");
CREATE INDEX "WalletReconciliationLog_status_createdAt_idx" ON "WalletReconciliationLog"("status", "createdAt");
CREATE INDEX "WalletReconciliationLog_walletId_createdAt_idx" ON "WalletReconciliationLog"("walletId", "createdAt");