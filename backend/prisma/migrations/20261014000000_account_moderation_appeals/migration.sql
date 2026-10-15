-- ============================================================================
-- VANTA — Account moderation metadata + AccountAppeal model
-- ----------------------------------------------------------------------------
-- Adds persisted moderation metadata to "User" so suspension/ban reasons and
-- dates survive process restarts and can be shown on the dedicated
-- suspended/banned account screens, plus the "AccountAppeal" table backing
-- the suspended/banned appeal lifecycle (PENDING → UNDER_REVIEW →
-- APPROVED | REJECTED).
--
-- SAFETY: purely additive. New nullable columns on "User" plus a brand-new
-- "AccountAppeal" table. No existing rows or tables are touched, no NOT NULL
-- constraint or DROP is issued, and no production data is rewritten.
-- Compatible with PostgreSQL (production) and SQLite (local dev).
-- ============================================================================

ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "suspendedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "bannedReason" TEXT;

CREATE TABLE "AccountAppeal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountStatus" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ACCOUNT_RESTRICTION',
    "explanation" TEXT NOT NULL,
    "supportingInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "accountRestored" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountAppeal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountAppeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AccountAppeal_status_createdAt_idx" ON "AccountAppeal"("status", "createdAt");
CREATE INDEX "AccountAppeal_userId_status_idx" ON "AccountAppeal"("userId", "status");
CREATE INDEX "AccountAppeal_userId_createdAt_idx" ON "AccountAppeal"("userId", "createdAt");
CREATE INDEX "AccountAppeal_accountStatus_status_idx" ON "AccountAppeal"("accountStatus", "status");
