-- ============================================================================
-- VANTA — Transfer OTP challenges + idempotent coin transfers
-- ============================================================================
-- 1. New TransferOtpChallenge table. Step-up verification for high-value coin
--    transfers: stores ONLY a one-way hash of the OTP, plus the transfer intent
--    (recipient + amount + session) it was bound to. One-time use via
--    consumedAt, expiring via expiresAt, attempt-limited via maxAttempts.
--    Replaces the legacy plaintext CoinTransfer.otpCode field (which is now
--    DEPRECATED and never written by new code).
--
-- 2. CoinTransfer.requestId — client-supplied idempotency key. UNIQUE
--    (senderId, requestId) guarantees a double-submitted / retried request can
--    never debit the sender twice.
--
-- SAFETY: purely additive and non-destructive (new table + new nullable
-- column + new unique index). Safe to apply to an existing production DB;
-- existing rows keep NULL requestId (no idempotency) and NULL otpCode.
-- ============================================================================

CREATE TABLE "TransferOtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "receiverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "deviceFingerprint" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransferOtpChallenge_userId_createdAt_idx" ON "TransferOtpChallenge"("userId", "createdAt");
CREATE INDEX "TransferOtpChallenge_userId_expiresAt_idx" ON "TransferOtpChallenge"("userId", "expiresAt");
CREATE INDEX "TransferOtpChallenge_sessionId_createdAt_idx" ON "TransferOtpChallenge"("sessionId", "createdAt");

ALTER TABLE "TransferOtpChallenge"
    ADD CONSTRAINT "TransferOtpChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CoinTransfer idempotency key (nullable → existing rows unaffected).
ALTER TABLE "CoinTransfer" ADD COLUMN "requestId" TEXT;

CREATE UNIQUE INDEX "CoinTransfer_senderId_requestId_key" ON "CoinTransfer"("senderId", "requestId");