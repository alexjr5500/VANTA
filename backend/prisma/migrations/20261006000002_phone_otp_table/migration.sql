-- ============================================================================
-- VANTA — PhoneOTP model (secure phone sign-in)
-- ============================================================================
-- The phone sign-in flow was calling `prisma.phoneOTP` without a model in the
-- schema (the endpoint crashed at runtime). This adds the table. It stores
-- ONLY a bcrypt hash of the OTP — never the plaintext code — plus expiry and
-- attempt counts for single-use, expiring, brute-force-limited codes.
--
-- SAFETY: purely additive (new table only).
-- ============================================================================

CREATE TABLE "PhoneOTP" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOTP_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PhoneOTP_phoneNumber_createdAt_idx" ON "PhoneOTP"("phoneNumber", "createdAt");
CREATE INDEX "PhoneOTP_expiresAt_idx" ON "PhoneOTP"("expiresAt");