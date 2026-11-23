# Durable media staging acceptance plan (PR #282)

**Status: blocked on isolated staging configuration and real-provider tests.**
Green GitHub CI proves code-level regressions, not Cloudinary account access, successful public playback, or operational recovery. Do not merge this PR or enable production media flags solely because CI passes.

## Current staging evidence (2026-11-23)

- GitHub PR branch: `infra/phase6-6-to-6-12-readiness`. The dedicated durable worker follows this branch.
- The existing `VANTA-Backend-Staging` HTTP service still follows `audit/production-stability-admin-safety`. Do **not** repoint it just to test PR #282: it also supports other staging work.
- The worker has a volume at `/data/uploads`; the HTTP backend has no volume. Railway service volumes are **not shared**. This disqualifies the local-filesystem worker path from end-to-end verification with the existing backend.
- Neither the staging HTTP service nor the staging worker currently defines any `CLOUDINARY_*` variables. Do not add actual credentials to Git, CI logs, or documentation.
- Worker media processing is not enabled. The enabled/disabled value should be checked from the staging runtime before attempting acceptance.

## Preferred isolated staging topology

1. Create or reuse a **separately named staging-only HTTP test service** at the *exact PR #282 commit*, rather than changing the current staging backend. Confirm the test service uses a staging-only URL, JWT secrets, uploaded media, Cloudinary account/folder, and PostgreSQL database. Never use production credentials, volumes or database.
2. Ensure the staging database has the durable queue migration and nullable `UploadedFile.optimizedUrl`, `thumbnailUrl`, `hlsUrl` columns. Record the migration versions and verify them against that staging database before uploading.
3. Provision staging-only Cloudinary credentials in both isolated test HTTP and durable worker services: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. They must all be set. Check names/presence without printing values.
4. Confirm the worker is on the **same commit SHA and database** as the staging-only HTTP test service and configured with `VANTA_DURABLE_QUEUE_MEDIA_STORAGE=cloudinary`.
5. Keep `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS`, `VANTA_DURABLE_QUEUE_MEDIA_PRODUCER`, and `VANTA_DURABLE_QUEUE_MEDIA_DELIVERY` **unset/false** until the isolated services, migrations, Cloudinary account and rollback controls are independently verified. Then enable the required flags only in staging, in a controlled acceptance window.

## Cloudinary mode: end-to-end acceptance

- [ ] Confirm direct and resumable/chunked authenticated uploads use the expected staging Cloudinary account and create one `UploadedFile` record.
- [ ] Upload a staging-only public image; request `cloudinary:image:optimize` and `cloudinary:thumbnail:generate`; verify WebP MIME, actual response bytes, dimensions, HTTP status, and their persisted URLs.
- [ ] Upload a staging-only short MP4 as a Reel draft; finalize it and verify `UploadedFile.recordType=Video`, `recordId`, and the original MP4 URL remain correct.
- [ ] Verify `cloudinary:video:transcode` writes a source-bound `hlsUrl`, with a readable master playlist **and** working variant playlists/media segments. A returned `*.m3u8` URL alone is not proof of playable HLS.
- [ ] Enable staging-only HLS delivery; verify feed and detail responses expose HLS **only for the currently linked, non-deleted upload**. Confirm native HLS playback and automatic fallback to MP4 on unsupported browsers, errors and expired URLs.
- [ ] Confirm private message attachments, moderated/deleted media, replaced upload paths and unrelated Cloudinary accounts never receive public derivative URLs.
- [ ] Repeat jobs, interrupt the worker, exhaust retries, restart it, and run two workers against the queue. Verify idempotency, lease ownership, no cross-mode job claims, and no public asset leakage.
- [ ] Validate capacity: slow/rejected provider requests, rate limits, missing credentials, failed migrations, timeouts and costs. Record job IDs and redacted errors; do not expose secrets.
- [ ] Verify diagnostic output distinguishes local missing files from Cloudinary references. A healthy local-storage probe is **not** evidence of Cloudinary object availability.
- [ ] Record exact CI run IDs, staging deployed SHAs, test uploads, response status/content types, queue statuses, Cloudinary processing costs, rollback steps and responsible reviewer.
- [ ] Turn media flags off again when verification is complete, unless staging continuation is explicitly approved.

## Local media mode (separate path)

For `VANTA_DURABLE_QUEUE_MEDIA_STORAGE=local`, backend uploads and worker output must be readable through a **proven common storage path**; an isolated Railway worker volume is insufficient. Verify FFmpeg libx264/AAC, Sharp, image optimization, thumbnails, HLS segment integrity, temporary-file cleanup, crash recovery, path-traversal/symlink rejection, and storage persistence across deploy/restart. Do not assert this path is verified using only worker-local fixtures.

## Release gates

- PR #282 must have green frontend/backend/build/secret scans **at the final head commit**.
- Finish staging upload-to-worker-to-playback acceptance, plus monitoring, error alerts, backup restore, resource/cost baselines and rollback evidence. Do not claim system phases 6.6–6.12 are finished from CI alone.
- Investigate the previously reported missing production uploads using verified backups only; never silently remove their database references.
- Do not change production configuration or start production media workers without a separately approved rollout.
