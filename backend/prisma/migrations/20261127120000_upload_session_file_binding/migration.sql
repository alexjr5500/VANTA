-- Additive exact-file binding. Historical COMPLETE sessions remain unbound.
ALTER TABLE "UploadSession" ADD COLUMN "completedFileId" TEXT;
