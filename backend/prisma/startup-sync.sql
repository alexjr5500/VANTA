-- ============================================================================
-- VANTA — startup schema synchronization (idempotent, additive-only)
-- ============================================================================
-- Runs BEFORE `prisma db push` on every production start (backend/railway.json
-- start command and backend/src/provision-db.ts) and replays the reviewed
-- additive migration
--
--     backend/prisma/migrations/20260924000000_provider_accounts_oauth/migration.sql
--
-- in a strictly idempotent AND non-destructive way:
--
--   * tables / columns / indexes are only CREATED when missing (IF NOT EXISTS
--     / catalog checks) - never dropped, never altered destructively;
--   * existing rows are never touched;
--   * therefore the `prisma db push` that follows is never blocked by (and
--     never needs --accept-data-loss for) this already-reviewed additive
--     change: once applied, `prisma db push` sees the schema as fully in sync.
--
-- This file stays strictly additive so the last line of defense is preserved:
-- `prisma db push` still runs WITHOUT --accept-data-loss, meaning any
-- genuinely destructive schema drift will abort the deployment loudly instead
-- of being applied silently.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ProviderAccount (Google / Telegram identity) - new table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ProviderAccount" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderAccount_provider_providerAccountId_key"
    ON "ProviderAccount"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "ProviderAccount_userId_idx"
    ON "ProviderAccount"("userId");
CREATE INDEX IF NOT EXISTS "ProviderAccount_provider_providerAccountId_idx"
    ON "ProviderAccount"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "ProviderAccount_provider_email_idx"
    ON "ProviderAccount"("provider", "email");

-- ----------------------------------------------------------------------------
-- PROVIDER NOTE: the FOREIGN KEY from ProviderAccount.userId -> User.id is NOT
-- created here. `prisma db push` (the step that always follows this script)
-- adds any missing FK constraints itself, and adding an FK is not treated as a
-- data-loss operation, so it is applied with zero warnings. Keeping the FK out
-- of this script also avoids Prisma `db execute`'s up-front model validation
-- (P1014) on a brand-new, still-empty database where the `User` table has not
-- been created yet.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Session.oauthExchangeCode + oauthExchangeExpiresAt - one-time OAuth session
-- hand-off credentials (single-use unique exchange code).
--
-- This is the exact change that made `prisma db push` refuse to run without
-- --accept-data-loss. It is brand-new, nullable, and written by the OAuth flow
-- with a fresh random 32-byte code (NULL otherwise), so a UNIQUE index is
-- trivially safe: Postgres unique indexes treat NULLs as distinct, existing
-- sessions are never duplicated or modified, and genuine duplicates (an
-- application bug, not user data) would make the CREATE INDEX fail loudly
-- instead of deleting anything.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'Session'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Session'
              AND column_name = 'oauthExchangeCode'
        ) THEN
            ALTER TABLE "Session" ADD COLUMN "oauthExchangeCode" TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Session'
              AND column_name = 'oauthExchangeExpiresAt'
        ) THEN
            ALTER TABLE "Session" ADD COLUMN "oauthExchangeExpiresAt" TIMESTAMP(3);
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'Session'
              AND indexname = 'Session_oauthExchangeCode_key'
        ) THEN
            CREATE UNIQUE INDEX "Session_oauthExchangeCode_key"
                ON "Session"("oauthExchangeCode");
        END IF;
    END IF;
END $$;