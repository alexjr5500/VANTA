# Isolated durable media worker staging

This worker is deliberately separate from the HTTP backend and must not be enabled in production as part of this PR.

## Staging prerequisites

- Deploy the PR branch `infra/phase6-6-to-6-12-readiness` in a **dedicated Railway service**; do not repoint the existing staging HTTP backend.
- Provision a dedicated staging PostgreSQL database with the QueueJob migration applied. Do not reuse the production database.
- Attach a persistent volume at `/data/uploads`; set `UPLOAD_STORAGE_DIR=/data/uploads`. The producer and worker must see the **same** storage bytes; separate Railway service volumes are not shared.
- Provide Node 22, FFmpeg with libx264 and AAC, and the Sharp native module in the worker image. Verify `ffmpeg -encoders` and `node -e "require('sharp')"` during build. CI tests FFmpeg but does not provision a production worker image.
- Set `DATABASE_URL` to the isolated staging database, `VANTA_DURABLE_WORKER_ENABLED=true`, and `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS=true`.
- Start with `node backend/dist/durable-worker.js` after `npm --prefix backend run build`. Do not start the HTTP server in this service.

## Acceptance checks

1. Enqueue an image and thumbnail job referencing a file within the mounted upload root. Verify real nonempty WebP files.
2. Enqueue a video transcode and verify master playlist, variant playlists and actual TS segments.
3. Retry each completed job and verify original files and completed outputs remain unchanged.
4. Interrupt a worker mid-job; verify lease recovery and that a stale worker cannot complete the job after its lease expires.
5. Enqueue invalid traversal and unsupported job types; verify no external file reads and terminal failure for unsupported types.
6. Check queue health and job errors, then stop the worker and confirm the HTTP backend remains healthy.

## Release gate

Do not merge based only on green GitHub CI. Record staging service ID, deployed commit, FFmpeg and Sharp versions, shared-storage evidence, job IDs, failure/retry results, and rollback procedure. If no shared persistent upload storage exists, media jobs cannot be marked staging-verified.
