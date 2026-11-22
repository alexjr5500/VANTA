-- Persist reposts of normal (non-reel) posts so they show on the Reposts tab.
CREATE TABLE IF NOT EXISTS "PostRepost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostRepost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PostRepost_userId_postId_key" ON "PostRepost"("userId", "postId");
CREATE INDEX IF NOT EXISTS "PostRepost_postId_createdAt_idx" ON "PostRepost"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "PostRepost_userId_createdAt_idx" ON "PostRepost"("userId", "createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostRepost_userId_fkey') THEN
    ALTER TABLE "PostRepost" ADD CONSTRAINT "PostRepost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostRepost_postId_fkey') THEN
    ALTER TABLE "PostRepost" ADD CONSTRAINT "PostRepost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
