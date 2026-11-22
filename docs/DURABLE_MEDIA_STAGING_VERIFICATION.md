# Durable media worker staging verification

**Do not enable media handlers in production until this checklist is signed off.**

## Preconditions

1. Use a separate Railway staging service with a staging-only database and persistent upload volume. Never reuse production DATABASE_URL or production upload files.
2. Verify the runtime image contains executable `ffmpeg`, `ffprobe`, and the Node `sharp` module. Backend TypeScript compilation alone does not establish that these binaries exist.
3. Confirm the worker sees the same `UPLOAD_STORAGE_DIR` volume as the staging API. A private isolated worker filesystem cannot read files uploaded by the API.
4. Confirm Prisma migration `20261121000000_durable_queue` is applied.
5. Keep `VANTA_DURABLE_QUEUE_PUSH_RETRIES=false` and production worker startup disabled.

## Staging tests

- [ ] Run an isolated staging worker with `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS=true` and explicit startup.
- [ ] Upload an image and enqueue `image:optimize`; verify WebP magic bytes and an HTTP 200 with `image/webp`.
- [ ] Enqueue `thumbnail:generate`; verify 320×180 or aspect-preserving smaller image and HTTP playback.
- [ ] Upload a short sample MP4 and enqueue `video:transcode`; verify the master playlist, variant playlists and actual MPEG-TS segments, then play them in a browser/mobile player.
- [ ] Enqueue `cleanup:temp` against an expired file under `.media-temp`; verify permanent upload files are untouched.
- [ ] Repeat the same jobs; ensure no output corruption or duplicate processing effects.
- [ ] Kill worker mid-encode and restart; verify lease expiry/retry and cleanup of incomplete staging directories.
- [ ] Run two workers against one queue; verify lease ownership and no output overwrite.
- [ ] Reject traversal, symlinks, invalid payloads, unknown qualities and missing input.
- [ ] Test ffmpeg missing, encoder crash, resource limits and disk-full failure.
- [ ] Observe queue health metrics, failure alerts and backup/restore procedures.
- [ ] Record exact commit SHA, CI run IDs, staging deployment IDs, test evidence and rollback owner.

## Operational constraints

The media job handlers are registered only when `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS=true`. Registering handlers does **not** start the worker or migrate legacy producers. Existing upload endpoints continue to use their current behavior. The worker must be started separately, and production activation requires explicit approval.

Known existing code paths still use the legacy in-memory queue and/or synchronous upload processing. They are not automatically durable. Do not claim that media migration is complete until the producers and storage contracts are audited.

## Release blockers

- Missing production uploaded assets must be diagnosed and recovered from verified sources; never silently delete DB references.
- Redis fallback and volume persistence must be understood before high-volume rollout.
- Security, load, alert-routing, rollback and backup restore tests must be evidenced, not just documented.
