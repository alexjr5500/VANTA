-- ============================================================================
-- VANTA — PasswordResetToken model (secure Forgot-Password / Reset-Password)
-- ============================================================================
-- The password-recovery flow previously issued a signed JWT that was never
-- stored server-side: it could not be single-use, superseded, or revoked, and
-- it was never delivered out-of-band. This adds a dedicated table that stores
-- ONLY a SHA-256 hash of the random recovery token (never the raw token),
-- bound to the account, expiring, and single-use (usedAt consumed atomically).
--
-- SAFETY: purely additive (new table only). No existing rows or tables are
-- touched. Compatible with PostgreSQL (production) and SQLite (local dev).
-- ============================================================================

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX "PasswordResetToken_usedAt_idx" ON "PasswordResetToken"("usedAt");