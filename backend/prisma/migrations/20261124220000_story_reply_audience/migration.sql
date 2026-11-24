-- Story already declares replyAudience in Prisma; reconcile deployed databases.
-- Preserve existing statuses and default their reply visibility to everyone.
ALTER TABLE "Story" ADD COLUMN IF NOT EXISTS "replyAudience" TEXT NOT NULL DEFAULT 'EVERYONE';
