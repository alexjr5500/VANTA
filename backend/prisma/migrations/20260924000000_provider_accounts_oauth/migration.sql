-- ============================================================================
-- VANTA — External provider accounts (Google / Telegram OAuth + OIDC)
-- ============================================================================
-- Adds the canonical provider -> VANTA user identity relationship plus the
-- one-time exchange credentials used to deliver OAuth sessions to the
-- frontend without exposing tokens in redirect URLs.
--
-- SAFETY: purely additive and non-destructive.

-- ProviderAccount: one provider identity (provider + providerAccountId) may
-- belong to exactly one VANTA user. Prevents a single Google or Telegram
-- account from ever creating multiple VANTA accounts.
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- Unique provider identity -> exactly one VANTA user.
CREATE UNIQUE INDEX "ProviderAccount_provider_providerAccountId_key"
    ON "ProviderAccount"("provider", "providerAccountId");

CREATE INDEX "ProviderAccount_userId_idx" ON "ProviderAccount"("userId");
CREATE INDEX "ProviderAccount_provider_providerAccountId_idx"
    ON "ProviderAccount"("provider", "providerAccountId");
CREATE INDEX "ProviderAccount_provider_email_idx" ON "ProviderAccount"("provider", "email");

ALTER TABLE "ProviderAccount"
    ADD CONSTRAINT "ProviderAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Session: single-use exchange code for OAuth session delivery.
ALTER TABLE "Session" ADD COLUMN "oauthExchangeCode" TEXT;
ALTER TABLE "Session" ADD COLUMN "oauthExchangeExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Session_oauthExchangeCode_key" ON "Session"("oauthExchangeCode");