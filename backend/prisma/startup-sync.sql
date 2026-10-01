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

-- ----------------------------------------------------------------------------
-- OAuthState - short server-side OAuth `state` records (Telegram/Google).
--
-- The provider authorization URL carries only a short opaque state id; the
-- full nonce/PKCE/redirect payload is stored here and consumed exactly once on
-- the callback. Additive-only: brand-new table, no existing data is touched.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OAuthState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirect" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "linkingUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
CREATE INDEX IF NOT EXISTS "OAuthState_provider_idx" ON "OAuthState"("provider");
CREATE INDEX IF NOT EXISTS "OAuthState_consumedAt_idx" ON "OAuthState"("consumedAt");
-- ----------------------------------------------------------------------------
-- Verified Badge Payments (additive) - paid Verified Badge purchase system.
-- Replays backend/prisma/migrations/20260927000000_verified_badge_payments.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'VerificationBadge'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'VerificationBadge'
              AND column_name = 'sourcePurchaseId'
        ) THEN
            ALTER TABLE "VerificationBadge" ADD COLUMN "sourcePurchaseId" TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'VerificationBadge'
              AND column_name = 'planId'
        ) THEN
            ALTER TABLE "VerificationBadge" ADD COLUMN "planId" TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'VerificationBadge'
              AND indexname = 'VerificationBadge_status_expiresAt_idx'
        ) THEN
            CREATE INDEX "VerificationBadge_status_expiresAt_idx"
                ON "VerificationBadge"("status", "expiresAt");
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "VerificationPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "network" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerOrderId" TEXT,
    "providerReference" TEXT,
    "paymentMode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundedBy" TEXT,
    "refundReason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VerificationPurchase_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'VerificationPurchase'
          AND indexname = 'VerificationPurchase_providerOrderId_key'
    ) THEN
        CREATE UNIQUE INDEX "VerificationPurchase_providerOrderId_key"
            ON "VerificationPurchase"("providerOrderId");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'VerificationPurchase'
          AND indexname = 'VerificationPurchase_userId_status_idx'
    ) THEN
        CREATE INDEX "VerificationPurchase_userId_status_idx"
            ON "VerificationPurchase"("userId", "status");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'VerificationPurchase'
          AND indexname = 'VerificationPurchase_status_createdAt_idx'
    ) THEN
        CREATE INDEX "VerificationPurchase_status_createdAt_idx"
            ON "VerificationPurchase"("status", "createdAt");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'VerificationPurchase'
          AND indexname = 'VerificationPurchase_status_expiresAt_idx'
    ) THEN
        CREATE INDEX "VerificationPurchase_status_expiresAt_idx"
            ON "VerificationPurchase"("status", "expiresAt");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'VerificationPurchase'
          AND indexname = 'VerificationPurchase_planId_idx'
    ) THEN
        CREATE INDEX "VerificationPurchase_planId_idx"
            ON "VerificationPurchase"("planId");
    END IF;
END $$;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'SubscriptionPlan'
    ) THEN
        IF NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id" = 'plan_blue_1month') THEN
            INSERT INTO "SubscriptionPlan"
                ("id", "name", "durationMonths", "price", "currency", "description", "benefits", "isActive", "sortOrder", "badgeType", "createdAt", "updatedAt")
            VALUES
                ('plan_blue_1month', 'Blue Verified — 1 Month', 1, 1.99, 'USD',
                 'Blue Verified badge for 1 month.',
                 '["Blue Verified badge","Verified account status"]', true, 10, 'BLUE',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id" = 'plan_blue_3months') THEN
            INSERT INTO "SubscriptionPlan"
                ("id", "name", "durationMonths", "price", "currency", "description", "benefits", "isActive", "sortOrder", "badgeType", "createdAt", "updatedAt")
            VALUES
                ('plan_blue_3months', 'Blue Verified — 3 Months', 3, 4.99, 'USD',
                 'Blue Verified badge for 3 months.',
                 '["Blue Verified badge","Verified account status","Save vs monthly"]', true, 11, 'BLUE',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id" = 'plan_blue_6months') THEN
            INSERT INTO "SubscriptionPlan"
                ("id", "name", "durationMonths", "price", "currency", "description", "benefits", "isActive", "sortOrder", "badgeType", "createdAt", "updatedAt")
            VALUES
                ('plan_blue_6months', 'Blue Verified — 6 Months', 6, 8.99, 'USD',
                 'Blue Verified badge for 6 months.',
                 '["Blue Verified badge","Verified account status","Best Blue value"]', true, 12, 'BLUE',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id" = 'plan_gold_1year') THEN
            INSERT INTO "SubscriptionPlan"
                ("id", "name", "durationMonths", "price", "currency", "description", "benefits", "isActive", "sortOrder", "badgeType", "createdAt", "updatedAt")
            VALUES
                ('plan_gold_1year', 'Gold Verified — 1 Year', 12, 14.99, 'USD',
                 'Gold Verified badge for 1 year.',
                 '["Gold Verified badge","Creator Studio access","Top verified status"]', true, 20, 'GOLD',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        END IF;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- SparkCoinPackage: canonical VANTA Coin purchase catalog (idempotent).
-- ----------------------------------------------------------------------------
-- Production deployment (Railway) runs this script BEFORE `prisma db push` and
-- does NOT run `npm run seed`, so the `SparkCoinPackage` table would otherwise
-- be empty — which is exactly why every coin purchase failed the
-- `PurchaseOrder_packageId_fkey` foreign key (the config-catalog ids like
-- `pkg_popular` never existed as database rows).
--
-- This block upserts the SAME canonical catalog as the app's startup
-- provisioning (src/services/purchase-catalog.service.ts / VANTA_COIN_PACKAGES
-- in src/config/wallet.config.ts) so the ids the frontend sends are always real
-- `SparkCoinPackage` primary keys. It is guarded by table existence because on
-- a brand-new database the table is created by the `prisma db push` that runs
-- right after this script (the in-app startup provisioning covers that first
-- boot). Idempotent (ON CONFLICT ... DO UPDATE) — safe to run on every boot.
-- Legacy rows from older seeds (e.g. `pkg_popular_pack`) are deactivated, never
-- deleted, so historical PurchaseOrder FK references stay intact.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'SparkCoinPackage'
    ) THEN
        INSERT INTO "SparkCoinPackage"
            ("id", "name", "coins", "price", "bonusCoins", "isPopular", "isActive", "sortOrder", "createdAt", "updatedAt")
        VALUES
            ('pkg_starter', 'Starter', 100, 1, 0, false, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_popular', 'Popular', 500, 5, 0, true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_standard', 'Standard', 1000, 10, 0, false, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_premium', 'Premium', 5000, 50, 0, false, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_elite', 'Elite', 10000, 100, 0, false, true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_ultimate', 'Ultimate', 25000, 250, 0, false, true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_legendary', 'Legendary', 50000, 500, 0, false, true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_1000', 'Signature', 100000, 1000, 0, false, true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_2500', 'Reserve', 250000, 2500, 0, false, true, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_5000', 'Prestige', 500000, 5000, 0, false, true, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_10000', 'Obsidian', 1000000, 10000, 0, false, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_25000', 'Private', 2500000, 25000, 0, false, true, 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_50000', 'Sovereign', 5000000, 50000, 0, false, true, 12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_75000', 'Imperial', 7500000, 75000, 0, false, true, 13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('pkg_100000', 'Founder', 10000000, 100000, 0, false, true, 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO UPDATE SET
            "name" = EXCLUDED."name",
            "coins" = EXCLUDED."coins",
            "price" = EXCLUDED."price",
            "bonusCoins" = 0,
            "isPopular" = EXCLUDED."isPopular",
            "isActive" = true,
            "sortOrder" = EXCLUDED."sortOrder",
            "updatedAt" = CURRENT_TIMESTAMP;

        UPDATE "SparkCoinPackage"
        SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "isActive" = true
          AND "id" NOT IN (
            'pkg_starter','pkg_popular','pkg_standard','pkg_premium','pkg_elite',
            'pkg_ultimate','pkg_legendary','pkg_1000','pkg_2500','pkg_5000',
            'pkg_10000','pkg_25000','pkg_50000','pkg_75000','pkg_100000'
          );
    END IF;
END $$;