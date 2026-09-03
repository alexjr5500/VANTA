-- Extend notifications in place so existing records remain available.
ALTER TABLE "Notification" ADD COLUMN "actorId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "entityType" TEXT;
ALTER TABLE "Notification" ADD COLUMN "entityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "referenceKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "readAt" DATETIME;

CREATE INDEX "Notification_type_idx" ON "Notification"("type");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE UNIQUE INDEX "Notification_userId_referenceKey_key" ON "Notification"("userId", "referenceKey");