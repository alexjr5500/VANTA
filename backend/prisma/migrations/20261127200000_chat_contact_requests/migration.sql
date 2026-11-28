ALTER TABLE "UserSettings" ADD COLUMN "requireChatRequest" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ChatContactRequest" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatContactRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatContactRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatContactRequest_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatContactRequest_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','DECLINED'))
);
CREATE UNIQUE INDEX "ChatContactRequest_senderId_recipientId_key" ON "ChatContactRequest"("senderId","recipientId");
CREATE INDEX "ChatContactRequest_recipientId_status_createdAt_idx" ON "ChatContactRequest"("recipientId","status","createdAt");
CREATE INDEX "ChatContactRequest_senderId_createdAt_idx" ON "ChatContactRequest"("senderId","createdAt");
