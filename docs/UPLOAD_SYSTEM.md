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

## Shared video uploading + time trimming

Word the frontend upload flows: Reel, Post, Story, Chat attachment and Fundraiser cover all accept video.

Trimming is a **shared, reusable system** — no feature copies trimming code:

- `frontend/src/lib/videoTrim.ts` — the engine. Validation (`validateVideoFile`), real duration probing (`probeDuration`, `probeVideoFileDuration`), filmstrip generation (`generateFilmstrip`) and the actual trimmer (`trimVideoSegment`), which re-encodes the selected start→end segment into a brand-new WebM with `HTMLVideoElement.captureStream()` + `MediaRecorder`. It uploads **only the trimmed file** — never timestamps over the full original. `video/quicktime`-style timestamp faking is not used anywhere.
- `frontend/src/components/video/VideoTrimEditor.tsx` — the reusable component. Flow: file → preview → timeline trim (draggable start/end handles, filmstrip, playhead, mm:ss inputs, keyboard access, mouse + touch via pointer events) → processing → review → `onConfirm({ file, duration, trimStart, trimEnd, isTrimmed })`. Features inject their own metadata into the shared review step through `reviewExtras`; the video trimming UI itself is identical everywhere.
- `frontend/src/components/video/VideoTrimModal.tsx` — shared bottom-sheet chrome hosting the editor.
- `frontend/src/components/video/VideoTrimPlayer.tsx` and `VideoTrimTimeline.tsx` — shared preview player + timeline (reused internally by the editor).
- `frontend/src/lib/reelTrim.ts` and `frontend/src/components/create/ReelTimeline.tsx` remain as thin shims so legacy imports keep working.

### Feature integration

| Feature | Entry point |
|---|---|
| Reel | `frontend/src/components/create/ReelUploader.tsx` |
| Post / Story | `frontend/src/components/create/MediaUploader.tsx` (shared by `CreatePostModal`) |
| Chat attachment | `frontend/src/app/messages/page.tsx` |
| Fundraiser cover video | `frontend/src/app/give/start/page.tsx` |

To add trimming to a future video upload flow: render `<VideoTrimModal>` (or `<VideoTrimEditor>` directly) with the selected `File`, then upload `result.file` through the existing upload endpoint — the same way the flows above do.

### Video MIME normalization

Browsers/download managers occasionally tag real video files (usually `.mp4`) as `text/plain`, `application/octet-stream` or empty. The trimmer accepts those by filename extension so the user can still trim them, but uploading the raw part is rejected by the backend multer allow-list with `File type text/plain is not allowed`. `normalizeVideoFileForUpload()` re-tags any file to a clean base `video/mp4` / `video/webm` (and strips codec parameters like `video/webm;codecs=vp9,opus`) before it leaves `VideoTrimEditor`, so every flow uploads a valid video part. Regression coverage: `backend/src/__tests__/reel-upload-multer.test.ts`.

Fundraiser evidence videos are intentionally **not** passed through the trimmer so supporting review material cannot be silently altered.

## Verification

Run `npm --prefix backend run build`, `npm --prefix backend test -- --runInBand src/__tests__/upload.service.test.ts`, and `npx --prefix frontend tsc -p frontend/tsconfig.json --noEmit`. Manual smoke tests should cover profile avatar/banner replace/delete, post image/video, story, reel, live thumbnail, message attachment, group/channel/community images, verification documents, invalid MIME/signature, limits, unauthenticated requests, retry, and storage persistence after restart.