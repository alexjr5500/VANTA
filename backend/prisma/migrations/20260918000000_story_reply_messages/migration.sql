-- Story replies: private "reply to story" messages that flow through the
-- existing messaging system. The Story reference is denormalized on purpose
-- (no FK): Stories expire after 24h / can be deleted, so snapshot fields keep
-- the reply readable in the inbox after the original Story is gone.

ALTER TABLE "Message" ADD COLUMN "storyReplyStoryId"  TEXT;
ALTER TABLE "Message" ADD COLUMN "storyReplyMediaUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN "storyReplyCaption"  TEXT;
ALTER TABLE "Message" ADD COLUMN "storyReplyAuthor"   TEXT;

CREATE INDEX "Message_storyReplyStoryId_idx" ON "Message"("storyReplyStoryId");