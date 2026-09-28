-- ============================================================================
-- Migration: Verified Badge Payments
-- ============================================================================
-- Adds the paid Verified Badge purchase infrastructure:
--   1. VerificationBadge.sourcePurchaseId + planId (paid-entitlement tracking)
--   2. VerificationPurchase table (server-verified purchase orders)
--   3. The four canonical Verified Badge plans (Blue 1/3/6 mo + Gold 1 yr)
--
-- Strictly idempotent and additive (IF NOT EXISTS / catalog checks). The
-- foreign keys are added by `prisma db push` that follows in deployment, and
-- are therefore intentionally NOT created here (see startup-sync.sql note).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. VerificationBadge: new nullable columns
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. VerificationPurchase table (order lifecycle + idempotency fields)
-- ---------------------------------------------------------------------------
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
-- ---------------------------------------------------------------------------
-- 3. Seed the four canonical Verified Badge plans (idempotent).
--    The FK to SubscriptionPlan is added later by `prisma db push`.
-- ---------------------------------------------------------------------------
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