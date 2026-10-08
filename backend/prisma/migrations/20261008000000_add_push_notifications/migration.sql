-- ============================================================================
-- VANTA — OS-Level Push Notifications (PushDevice / PushDelivery / CallSession)
-- ============================================================================
-- Adds the device-token store required for production OS-level push
-- notifications (Web Push subscriptions for the PWA + Firebase Cloud Messaging
-- registration tokens for Android/iOS), a durable delivery ledger that is also
-- the idempotency guard (UNIQUE(eventId, deviceId) prevents duplicate pushes on
-- retries / multi-worker redelivery), and a server-side CallSession record so an
-- incoming call rings the callee even when the app is terminated, races resolve
-- authoritatively (cancel vs answer, answered on another device), and the push
-- "Answer" action can join the call from a cold start.
--
-- SAFETY: purely additive (three NEW tables + indexes + FKs). No existing
-- tables are modified, no data is touched — backward compatible.
--
-- Style note: mirrors the idempotent baseline migration (IF NOT EXISTS + DO $$
-- guarded ALTER TABLE) so `prisma migrate deploy` is safe on every environment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PushDevice
-- ----------------------------------------------------------------------------
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
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushDevice_userId_fkey') THEN
        ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- PushDelivery
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PushDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "deviceId" TEXT,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- Idempotency guard: the SAME event must never be pushed twice to the SAME device.
CREATE UNIQUE INDEX IF NOT EXISTS "PushDelivery_eventId_deviceId_key" ON "PushDelivery"("eventId", "deviceId");
CREATE INDEX IF NOT EXISTS "PushDelivery_userId_createdAt_idx" ON "PushDelivery"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PushDelivery_status_createdAt_idx" ON "PushDelivery"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PushDelivery_createdAt_idx" ON "PushDelivery"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushDelivery_userId_fkey') THEN
        ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- CallSession
-- ----------------------------------------------------------------------------
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

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallSession_callId_key" ON "CallSession"("callId");
CREATE INDEX IF NOT EXISTS "CallSession_calleeId_status_idx" ON "CallSession"("calleeId", "status");
CREATE INDEX IF NOT EXISTS "CallSession_callerId_status_idx" ON "CallSession"("callerId", "status");
CREATE INDEX IF NOT EXISTS "CallSession_conversationId_createdAt_idx" ON "CallSession"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallSession_status_expiresAt_idx" ON "CallSession"("status", "expiresAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallSession_callerId_fkey') THEN
        ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallSession_calleeId_fkey') THEN
        ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;