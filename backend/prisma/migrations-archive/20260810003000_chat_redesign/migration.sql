-- Extend the existing messaging records in place. Existing direct conversations remain valid.
ALTER TABLE "Conversation" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "Conversation" ADD COLUMN "avatar" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "description" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "handle" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "Conversation" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "permissions" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "commentsEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Conversation" SET "type" = 'GROUP' WHERE "isGroup" = true;
CREATE UNIQUE INDEX "Conversation_handle_key" ON "Conversation"("handle");
CREATE INDEX "Conversation_type_updatedAt_idx" ON "Conversation"("type", "updatedAt");
CREATE INDEX "Conversation_createdById_type_idx" ON "Conversation"("createdById", "type");

ALTER TABLE "Participant" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'MEMBER';
ALTER TABLE "Participant" ADD COLUMN "mutedAt" DATETIME;
ALTER TABLE "Participant" ADD COLUMN "lastReadAt" DATETIME;
CREATE INDEX "Participant_conversationId_role_idx" ON "Participant"("conversationId", "role");

ALTER TABLE "Message" ADD COLUMN "replyToId" TEXT REFERENCES "Message"("id") ON DELETE SET NULL;
ALTER TABLE "Message" ADD COLUMN "pinnedAt" DATETIME;
ALTER TABLE "Message" ADD COLUMN "pinnedById" TEXT;
ALTER TABLE "Message" ADD COLUMN "deletedFor" TEXT;
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
CREATE INDEX "Message_conversationId_pinnedAt_idx" ON "Message"("conversationId", "pinnedAt");

ALTER TABLE "Group" ADD COLUMN "conversationId" TEXT;
CREATE UNIQUE INDEX "Group_conversationId_key" ON "Group"("conversationId");
ALTER TABLE "Channel" ADD COLUMN "conversationId" TEXT;
CREATE UNIQUE INDEX "Channel_conversationId_key" ON "Channel"("conversationId");