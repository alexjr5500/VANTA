-- Cloudinary derivatives are optional. Preserve original URLs and historical uploads.
ALTER TABLE "UploadedFile"
  ADD COLUMN IF NOT EXISTS "optimizedUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "hlsUrl" TEXT;
