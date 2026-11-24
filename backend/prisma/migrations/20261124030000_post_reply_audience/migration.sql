-- Preserve existing posts/reels as open to everyone, while allowing
-- authors to restrict replies on content created after this migration.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "replyAudience" TEXT NOT NULL DEFAULT 'EVERYONE';
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "replyAudience" TEXT NOT NULL DEFAULT 'EVERYONE';
