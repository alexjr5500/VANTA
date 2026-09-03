# VANTA upload system

## Architecture

All protected media enters through authenticated multipart routes under `/api/upload` (or the story/profile compatibility routes). Multer applies category-specific byte and MIME limits, filenames are generated server-side, extensions are checked, and supported formats are magic-byte validated. Metadata is persisted in `UploadedFile` and linked to the owning user plus the domain record (`Post`, `Story`, `Message`, `Group`, `Channel`, `Community`, `LiveStream`, or `Video`). Replace and delete operations remove the storage object and soft-delete metadata.

Images are optimized to WebP by Sharp for local storage. Videos are duration-probed with `ffprobe` when installed. Cloudinary is selected automatically when all Cloudinary credentials are configured and provides CDN URLs and video thumbnails. Otherwise files use `backend/public/uploads`; production local deployments **must mount this directory on persistent storage**.

## Environment

- `UPLOAD_STORAGE_DIR=public/uploads` — local storage path relative to `backend` (or an absolute path).
- `UPLOAD_PUBLIC_BASE_URL=` — optional public API/CDN origin, without `/uploads`.
- `MAX_VIDEO_DURATION_SECONDS=600` and optional `FFPROBE_PATH`.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — enable Cloudinary only when all are set.
- `FRONTEND_URL` / `CORS_ORIGINS` — include every browser origin.

After pulling schema changes run `npx --prefix backend prisma generate --schema backend/prisma/schema.prisma` and the project's production migration/deploy command. Do not deploy local storage on an ephemeral filesystem.

## Limits and formats

| Purpose | Limit | Formats |
|---|---:|---|
| Avatar / thumbnail | 5 MB | JPEG, PNG, WebP, GIF, AVIF |
| Banner | 10 MB | JPEG, PNG, WebP, GIF, AVIF |
| Image/media | 15 MB | JPEG, PNG, WebP, GIF, AVIF |
| Video/reel | 100 MB / 10 min default | MP4, MOV, WebM |
| Document | 10 MB | PDF, DOC, DOCX, TXT |
| Audio | 25 MB | MP3, WAV, OGG, WebM audio |

The frontend uses XHR for real upload progress and provides local previews, drag/drop, mobile pickers, validation, remove and retry. API errors preserve actionable authentication, network, size, type and storage messages.

## Verification

Run `npm --prefix backend run build`, `npm --prefix backend test -- --runInBand src/__tests__/upload.service.test.ts`, and `npx --prefix frontend tsc -p frontend/tsconfig.json --noEmit`. Manual smoke tests should cover profile avatar/banner replace/delete, post image/video, story, reel, live thumbnail, message attachment, group/channel/community images, verification documents, invalid MIME/signature, limits, unauthenticated requests, retry, and storage persistence after restart.