-- ============================================================================
-- Migration: Gold Verified Follower Rewards
-- ============================================================================
-- Adds the creator-side follower reward campaign + immutable claim ledger:
--   1. FollowerRewardCampaign  (reserved coins / gift rewards, lifecycle)
--   2. FollowerRewardClaim     (permanent claims, UNIQUE(campaignId, userId))
--
-- Strictly idempotent and additive (IF NOT EXISTS / catalog checks). Foreign
-- keys are added by `prisma db push` that follows in deployment and are
-- therefore intentionally NOT created here (see startup-sync.sql note).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. FollowerRewardCampaign table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "FollowerRewardCampaign" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "eligibilityType" TEXT NOT NULL,
    "totalAllocation" INTEGER NOT NULL,
    "rewardPerUser" INTEGER NOT NULL,
    "coinAmount" INTEGER,
    "giftId" TEXT,
    "reservedAmount" INTEGER NOT NULL,
    "distributedAmount" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL,
    "claimedUsers" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowerRewardCampaign_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2. FollowerRewardClaim table + uniqueness guard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "FollowerRewardClaim" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "coinAmount" INTEGER,
    "giftId" TEXT,
    "giftSnapshot" TEXT,
    "walletTransactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowerRewardClaim_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    -- Database-level double-claim protection: a follower can claim a given
    -- campaign only once, forever (unfollow -> refollow cannot reset it).
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardClaim'
          AND indexname = 'FollowerRewardClaim_campaignId_userId_key'
    ) THEN
        CREATE UNIQUE INDEX "FollowerRewardClaim_campaignId_userId_key"
            ON "FollowerRewardClaim"("campaignId", "userId");
    END IF;

    -- One active campaign per creator: DRAFT/ACTIVE/PAUSED campaigns are
    -- mutually exclusive for a creator. Terminal records (history) can accrue.
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardCampaign'
          AND indexname = 'FollowerRewardCampaign_single_live_per_creator'
    ) THEN
        CREATE UNIQUE INDEX "FollowerRewardCampaign_single_live_per_creator"
            ON "FollowerRewardCampaign"("creatorId")
            WHERE "status" IN ('DRAFT', 'ACTIVE', 'PAUSED');
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardCampaign'
          AND indexname = 'FollowerRewardCampaign_creatorId_status_idx'
    ) THEN
        CREATE INDEX "FollowerRewardCampaign_creatorId_status_idx"
            ON "FollowerRewardCampaign"("creatorId", "status");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardCampaign'
          AND indexname = 'FollowerRewardCampaign_status_expiresAt_idx'
    ) THEN
        CREATE INDEX "FollowerRewardCampaign_status_expiresAt_idx"
            ON "FollowerRewardCampaign"("status", "expiresAt");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardCampaign'
          AND indexname = 'FollowerRewardCampaign_status_createdAt_idx'
    ) THEN
        CREATE INDEX "FollowerRewardCampaign_status_createdAt_idx"
            ON "FollowerRewardCampaign"("status", "createdAt");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardCampaign'
          AND indexname = 'FollowerRewardCampaign_creatorId_createdAt_idx'
    ) THEN
        CREATE INDEX "FollowerRewardCampaign_creatorId_createdAt_idx"
            ON "FollowerRewardCampaign"("creatorId", "createdAt");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardCampaign'
          AND indexname = 'FollowerRewardCampaign_giftId_idx'
    ) THEN
        CREATE INDEX "FollowerRewardCampaign_giftId_idx"
            ON "FollowerRewardCampaign"("giftId");
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardClaim'
          AND indexname = 'FollowerRewardClaim_campaignId_idx'
    ) THEN
        CREATE INDEX "FollowerRewardClaim_campaignId_idx"
            ON "FollowerRewardClaim"("campaignId");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardClaim'
          AND indexname = 'FollowerRewardClaim_campaignId_status_idx'
    ) THEN
        CREATE INDEX "FollowerRewardClaim_campaignId_status_idx"
            ON "FollowerRewardClaim"("campaignId", "status");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardClaim'
          AND indexname = 'FollowerRewardClaim_userId_createdAt_idx'
    ) THEN
        CREATE INDEX "FollowerRewardClaim_userId_createdAt_idx"
            ON "FollowerRewardClaim"("userId", "createdAt");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FollowerRewardClaim'
          AND indexname = 'FollowerRewardClaim_creatorId_createdAt_idx'
    ) THEN
        CREATE INDEX "FollowerRewardClaim_creatorId_createdAt_idx"
            ON "FollowerRewardClaim"("creatorId", "createdAt");
    END IF;
END $$;