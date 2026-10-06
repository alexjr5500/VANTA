-- Background upload system (Stories + Reels).
--
-- 1. Story.mediaUrl becomes nullable so a Story draft can be created instantly
--    (UPLOADING) and receive its media URL only when the background/resumable
--    upload completes and the record is finalized (PUBLISHED).
-- 2. Story/Video gain a publish lifecycle column. Existing rows default to
--    'PUBLISHED' so no production data needs a backfill and old behaviour is
--    preserved exactly.
-- 3. UploadSession tracks resumable chunked transfers (owned by one user).

ALTER TABLE "Story" ALTER COLUMN "mediaUrl" DROP NOT NULL;

ALTER TABLE "Story" ADD COLUMN "publishStatus" TEXT NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE "Video" ADD COLUMN "publishStatus" TEXT NOT NULL DEFAULT 'PUBLISHED';

CREATE INDEX "Story_publishStatus_idx" ON "Story"("publishStatus");
CREATE INDEX "Video_publishStatus_idx" ON "Video"("publishStatus");

CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "receivedChunks" INTEGER NOT NULL DEFAULT 0,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "recordType" TEXT,
    "recordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadSession_userId_status_idx" ON "UploadSession"("userId", "status");
CREATE INDEX "UploadSession_recordType_recordId_idx" ON "UploadSession"("recordType", "recordId");
CREATE INDEX "UploadSession_expiresAt_idx" ON "UploadSession"("expiresAt");

ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;