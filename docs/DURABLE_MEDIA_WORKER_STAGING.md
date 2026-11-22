# Isolated durable media worker staging

This worker is deliberately separate from the HTTP backend and must not be enabled in production as part of this PR.

## Staging prerequisites

- Deploy the PR branch `infra/phase6-6-to-6-12-readiness` in a **dedicated Railway service**; do not repoint the existing staging HTTP backend.
- Provision a dedicated staging PostgreSQL database with the QueueJob migration applied. Do not reuse the production database.
- Provide a storage architecture where both the HTTP producer and media worker can read the same uploaded bytes. Railway volumes attached to separate services **are not shared**; a worker-only volume at `/data/uploads` is insufficient. Do not move/detach existing volumes as a workaround.
- For the current **local-only** durable media handlers, set `UPLOAD_STORAGE_DIR` to the shared local upload path. The worker now checks up to 25 recent non-Cloudinary backend upload records and refuses to start media processing unless at least one matching real file can be read with the expected byte size. This is a startup smoke test, **not** full proof of durability or all-uploads access.
- VANTA's HTTP upload service already supports Cloudinary when configured. However, the durable media handlers do **not** yet download Cloudinary sources or publish their outputs there. Cloudinary-backed media jobs must remain disabled until a supported worker pipeline exists; setting Cloudinary variables alone does not make local worker outputs shareable.
- Provide Node 22, FFmpeg with libx264 and AAC, and the Sharp native module in the worker image. Verify `ffmpeg -encoders` and `node -e "require('sharp')"` during build. CI tests FFmpeg but does not provision a production worker image.
- Ensure `/data/uploads` exists, is not a symlink, and is readable and writable before starting the worker. The entrypoint now refuses unsafe or missing storage. Set `DATABASE_URL` to the isolated staging database, `VANTA_DURABLE_WORKER_ENABLED=true`, and `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS=true`.
- Start with `node backend/dist/durable-worker.js` after `npm --prefix backend run build`. Do not start the HTTP server in this service.

## Acceptance checks

1. Upload a fresh representative image and video through the **staging HTTP backend**, then verify the worker reads those exact backend-produced bytes; a worker-local fixture alone is insufficient. Enqueue an image and thumbnail job referencing the shared upload. Verify real nonempty WebP files.
2. Enqueue a video transcode and verify master playlist, variant playlists and actual TS segments.
3. Retry each completed job and verify original files and completed outputs remain unchanged.
4. Interrupt a worker mid-job; verify lease recovery and that a stale worker cannot complete the job after its lease expires.
5. Enqueue invalid traversal and unsupported job types; verify no external file reads and terminal failure for unsupported types.
6. Check queue health and job errors, then stop the worker and confirm the HTTP backend remains healthy.

## Release gate

Do not merge based only on green GitHub CI. The staging backend currently uses a different branch from this worker and has no mounted upload volume; the worker's private `/data/uploads` volume cannot access its files. Media handlers must remain disabled until the producer/worker storage boundary has been solved and tested.  Record staging service ID, deployed commit, FFmpeg and Sharp versions, shared-storage evidence, job IDs, failure/retry results, and rollback procedure. If no shared persistent upload storage exists, media jobs cannot be marked staging-verified.
