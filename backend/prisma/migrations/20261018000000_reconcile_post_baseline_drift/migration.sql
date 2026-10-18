-- ============================================================================
-- VANTA — RECONCILE POST-BASELINE SCHEMA DRIFT (additive, idempotent, no-op when healthy)
-- ----------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
--
-- Production serves `P2022 — The column User.suspendedAt does not exist in the
-- current database`, even though
-- `20261014000000_account_moderation_appeals` is committed and contains the
-- `ALTER TABLE "User" ADD COLUMN "suspendedAt"` statement.
--
-- Root cause (reproduced locally against PostgreSQL from a clean database):
--
--   1. `20261008000000_add_push_notifications` created "CallSession" WITHOUT
--      its `expiresAt` column, then issued
--        CREATE INDEX "CallSession_status_expiresAt_idx" ON "CallSession"("status","expiresAt");
--      which fails with 42703 `column "expiresAt" does not exist`.
--   2. Prisma applies each migration in a transaction, so that migration is
--      recorded as FAILED and NOTHING after it is ever applied.
--   3. Migrations that therefore never ran:
--        20261009000000_add_password_reset_tokens
--        20261014000000_account_moderation_appeals  <- User.suspended*, AccountAppeal
--      and `prisma migrate deploy` refuses to continue past a failed one
--      (P3009/P3018), so those columns were never created.
--
-- WHAT THIS MIGRATION DOES
--
--   It re-asserts, in one step, every object introduced by the post-baseline
--   migrations that were verified missing (or that can be missing when a
--   migration was recorded as applied without executing):
--
--     20261006000000_transfer_otp_challenges    TransferOtpChallenge + CoinTransfer.requestId
--     20261006000001_wallet_reconciliation      WalletReconciliationLog
--     20261006000002_phone_otp_table            PhoneOTP
--     20261008000000_add_push_notifications     PushDevice, PushDelivery, CallSession(+expiresAt)
--     20261009000000_add_password_reset_tokens  PasswordResetToken
--     20261014000000_account_moderation_appeals User.suspended*/banned* + AccountAppeal
--
--   Every statement is guarded (`IF NOT EXISTS` / `DO $$ ... pg_catalog and
--   information_schema checks`), so on a database where the original
--   migrations already succeeded this file is a COMPLETE NO-OP. That is what
--   makes it safe to run in any environment and in any history state.
--
-- SAFETY: strictly additive.
--   * No DROP, TRUNCATE, DELETE, UPDATE, or type/NOT NULL change on any
--     existing column.
--   * New columns are nullable (or have a DEFAULT), so no existing row fails
--     a constraint and no rewrite of user data is required.
--   * Existing rows in "User", "Wallet", "Post", "Message", "CoinTransfer",
--     "WalletTransaction", ... are never touched.
--   * Never run with `--accept-data-loss`, `db push` or `migrate reset`.
--
-- VERIFICATION: after this migration,
--   `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma`
-- must return no differences, and
--   `node scripts/preflight-schema-check.cjs`
-- must print `IN_SYNC`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 20261006000000_transfer_otp_challenges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "TransferOtpChallenge" (
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

CREATE INDEX IF NOT EXISTS "TransferOtpChallenge_userId_createdAt_idx" ON "TransferOtpChallenge"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TransferOtpChallenge_userId_expiresAt_idx" ON "TransferOtpChallenge"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "TransferOtpChallenge_sessionId_createdAt_idx" ON "TransferOtpChallenge"("sessionId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'TransferOtpChallenge_userId_fkey'
          AND conrelid = '"public"."TransferOtpChallenge"'::regclass
    ) THEN
        ALTER TABLE "TransferOtpChallenge"
            ADD CONSTRAINT "TransferOtpChallenge_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CoinTransfer idempotency key (nullable — legacy rows keep NULL, and
-- PostgreSQL unique indexes treat NULLs as distinct).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'CoinTransfer' AND column_name = 'requestId'
    ) THEN
        ALTER TABLE "CoinTransfer" ADD COLUMN "requestId" TEXT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CoinTransfer_senderId_requestId_key" ON "CoinTransfer"("senderId", "requestId");

-- ---------------------------------------------------------------------------
-- 20261006000001_wallet_reconciliation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WalletReconciliationLog" (
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

CREATE INDEX IF NOT EXISTS "WalletReconciliationLog_userId_createdAt_idx" ON "WalletReconciliationLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WalletReconciliationLog_status_createdAt_idx" ON "WalletReconciliationLog"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WalletReconciliationLog_walletId_createdAt_idx" ON "WalletReconciliationLog"("walletId", "createdAt");

-- ---------------------------------------------------------------------------
-- 20261006000002_phone_otp_table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PhoneOTP" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOTP_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PhoneOTP_phoneNumber_createdAt_idx" ON "PhoneOTP"("phoneNumber", "createdAt");
CREATE INDEX IF NOT EXISTS "PhoneOTP_expiresAt_idx" ON "PhoneOTP"("expiresAt");

-- ---------------------------------------------------------------------------
-- 20261008000000_add_push_notifications (PushDevice / PushDelivery / CallSession)
-- NOTE: unlike the original migration, "CallSession" is created WITH its
-- `expiresAt` column, which is what the index and the Prisma model require.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "provider" TEXT NOT NULL DEFAULT 'webpush',
    "deviceModel" TEXT,
    "appVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_isActive_idx" ON "PushDevice"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_platform_idx" ON "PushDevice"("userId", "platform");
CREATE INDEX IF NOT EXISTS "PushDevice_isActive_updatedAt_idx" ON "PushDevice"("isActive", "updatedAt");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_updatedAt_idx" ON "PushDevice"("userId", "updatedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'PushDevice_userId_fkey'
          AND conrelid = '"public"."PushDevice"'::regclass
    ) THEN
        ALTER TABLE "PushDevice"
            ADD CONSTRAINT "PushDevice_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PushDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    -- REQUIRED by the `PushDelivery` model in schema.prisma. It was missing
    -- from the original CREATE TABLE, which left a committed migration
    -- permanently divergent from the schema (prisma migrate diff reported it).
    "type" TEXT NOT NULL,
    "deviceId" TEXT,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushDelivery_eventId_deviceId_key" ON "PushDelivery"("eventId", "deviceId");
CREATE INDEX IF NOT EXISTS "PushDelivery_userId_createdAt_idx" ON "PushDelivery"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PushDelivery_status_createdAt_idx" ON "PushDelivery"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PushDelivery_createdAt_idx" ON "PushDelivery"("createdAt");

-- Last-resort guard: if a pre-existing "PushDelivery" lacks `type`, add it
-- (nullable, so a populated table can never fail this migration). Unreachable
-- in practice, but this migration must not be able to break a deploy.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PushDelivery' AND column_name = 'type'
    ) THEN
        ALTER TABLE "PushDelivery" ADD COLUMN "type" TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'PushDelivery_userId_fkey'
          AND conrelid = '"public"."PushDelivery"'::regclass
    ) THEN
        ALTER TABLE "PushDelivery"
            ADD CONSTRAINT "PushDelivery_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CallSession" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VOICE',
    "status" TEXT NOT NULL DEFAULT 'RINGING',
    "offerSdp" TEXT,
    "iceCandidates" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

-- Last-resort guard: if a pre-existing "CallSession" lacks `expiresAt` (a
-- state this migration must never fail on), add it as nullable so the index
-- below can always be created. Never rewrites or backfills existing rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'CallSession' AND column_name = 'expiresAt'
    ) THEN
        ALTER TABLE "CallSession" ADD COLUMN "expiresAt" TIMESTAMP(3);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CallSession_callId_key" ON "CallSession"("callId");
CREATE INDEX IF NOT EXISTS "CallSession_calleeId_status_idx" ON "CallSession"("calleeId", "status");
CREATE INDEX IF NOT EXISTS "CallSession_callerId_status_idx" ON "CallSession"("callerId", "status");
CREATE INDEX IF NOT EXISTS "CallSession_conversationId_createdAt_idx" ON "CallSession"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallSession_status_expiresAt_idx" ON "CallSession"("status", "expiresAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'CallSession_callerId_fkey'
          AND conrelid = '"public"."CallSession"'::regclass
    ) THEN
        ALTER TABLE "CallSession"
            ADD CONSTRAINT "CallSession_callerId_fkey"
            FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'CallSession_calleeId_fkey'
          AND conrelid = '"public"."CallSession"'::regclass
    ) THEN
        ALTER TABLE "CallSession"
            ADD CONSTRAINT "CallSession_calleeId_fkey"
            FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 20261009000000_add_password_reset_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_usedAt_idx" ON "PasswordResetToken"("usedAt");

-- ---------------------------------------------------------------------------
-- 20261014000000_account_moderation_appeals
-- THE MIGRATION BEHIND THE P2022 OUTAGE. Nullable moderation metadata on
-- "User" (null while the account is ACTIVE) plus the AccountAppeal table
-- backing the suspended/banned appeal lifecycle.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'suspendedAt'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'suspendedReason'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'suspendedUntil'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "suspendedUntil" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'bannedAt'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'bannedReason'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "bannedReason" TEXT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AccountAppeal" (
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

    CONSTRAINT "AccountAppeal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountAppeal_status_createdAt_idx" ON "AccountAppeal"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AccountAppeal_userId_status_idx" ON "AccountAppeal"("userId", "status");
CREATE INDEX IF NOT EXISTS "AccountAppeal_userId_createdAt_idx" ON "AccountAppeal"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AccountAppeal_accountStatus_status_idx" ON "AccountAppeal"("accountStatus", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'AccountAppeal_userId_fkey'
          AND conrelid = '"public"."AccountAppeal"'::regclass
    ) THEN
        ALTER TABLE "AccountAppeal"
            ADD CONSTRAINT "AccountAppeal_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
