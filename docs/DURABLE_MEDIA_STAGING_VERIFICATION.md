# Durable media staging acceptance plan (PR #282)

**Status: blocked on isolated staging configuration and real-provider tests.**
Green GitHub CI proves code-level regressions, not Cloudinary account access, successful public playback, or operational recovery. Do not merge this PR or enable production media flags solely because CI passes.

## Current staging evidence (2026-11-25)

The pending patch has been applied. The dedicated PostgreSQL `Postgres-uh7w` is online with its own 5 GB volume. Acceptance HTTP is offline (deployment a422fa5a-fd12-4c4b-9ae7-b3451cc18a6c; startup error missing Cloudinary credentials). Acceptance worker is crashed (bea5f543-9374-41ee-b94e-e849205eb10b; startup flag disabled). Both are pinned to old commit 163b6e8. Neither has Cloudinary variables; HTTP also lacks JWT and encryption variables. Neither has a public domain. The regular staging durable worker is online, but is not proof of this separate acceptance stack. The other staging HTTP service remains on the admin safety branch. No pending Railway changes, no new deployment or production changes made during this inspection.

Railway OAuth returns variable names only: the resolved DATABASE_URL, flag values, and secret values cannot be independently checked through this connector. Verify the dedicated DB reference in the dashboard before migrations. Do not use production credentials or copy another service's secrets.

## Configuration preflight (new)

Before any acceptance migration, configure all missing Cloudinary credentials and HTTP authentication/encryption secrets directly in Railway, using separate staging credentials. Pin both services to the same reviewed SHA, set VANTA_ACCEPTANCE_PREFLIGHT=yes, VANTA_ACCEPTANCE_EXPECTED_SHA to that exact deployed SHA, VANTA_ACCEPTANCE_DATABASE_HOST to the independently confirmed private hostname of Postgres-uh7w, and DATABASE_URL to the dedicated DB reference. Set cloudinary storage mode and keep media producer/handler/delivery and worker startup flags false initially. Run `node backend/scripts/acceptance-preflight.mjs http` on the HTTP service before migration and `node backend/scripts/acceptance-preflight.mjs worker` in the worker's environment before activation. The script validates exact Railway project/environment/service IDs, staging name, commit, database private hostname, credential presence and disabled initial flags. It only prints fixed issue codes. It does not connect to a database, validate credentials, or prove account isolation: verify the host and references independently. Do not use this as a perpetual worker startup command once activation is approved. A passing check is not permission to enable production or a substitute for provider testing.

## Preferred isolated staging topology

1. Verify the provisioned **staging-only HTTP test service** is pinned to the *exact PR #282 commit*, rather than changing the current staging backend. Confirm the test service uses a staging-only URL, JWT secrets, uploaded media, Cloudinary account/folder, and PostgreSQL database. Never use production credentials, volumes or database.
2. Apply and confirm migrations **only on the new acceptance database** after it is provisioned: ensure it has the durable queue migration and nullable `UploadedFile.optimizedUrl`, `thumbnailUrl`, `hlsUrl` columns. Record the migration versions and verify them against that staging database before uploading.
3. Verify both services resolve `DATABASE_URL` to the *new* `Postgres-uh7w`, not the existing staging database. Before deployment provide isolated staging `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, and any other required startup variables through Railway's secure dashboard. Never reuse production credentials. Provision staging-only Cloudinary credentials in both isolated test HTTP and durable worker services: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. They must all be set. Check names/presence without printing values.
4. Verify the staged isolated worker uses the **same commit SHA and isolated database** as the staging-only HTTP test service and configured with `VANTA_DURABLE_QUEUE_MEDIA_STORAGE=cloudinary`.
5. Keep `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS`, `VANTA_DURABLE_QUEUE_MEDIA_PRODUCER`, and `VANTA_DURABLE_QUEUE_MEDIA_DELIVERY` **unset/false** until the isolated services, migrations, Cloudinary account and rollback controls are independently verified. Then enable the required flags only in staging, in a controlled acceptance window.

## Cloudinary mode: end-to-end acceptance

- [ ] Confirm direct and resumable/chunked authenticated uploads use the expected staging Cloudinary account and create one `UploadedFile` record.
- [ ] Upload a staging-only public image; request `cloudinary:image:optimize` and `cloudinary:thumbnail:generate`; verify WebP MIME, actual response bytes, dimensions, HTTP status, and their persisted URLs.
- [ ] Upload a staging-only short MP4 as a Reel draft; finalize it and verify `UploadedFile.recordType=Video`, `recordId`, and the original MP4 URL remain correct.
- [ ] Verify `cloudinary:video:transcode` writes a source-bound `hlsUrl`, with a readable master playlist **and** working variant playlists/media segments. A returned `*.m3u8` URL alone is not proof of playable HLS. Run the read-only HLS probe against a **public staging-only** URL and save its result (command below).
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
- An explicitly requested `VANTA_DURABLE_QUEUE_MEDIA_STORAGE=cloudinary` now fails startup if Cloudinary credentials are entirely absent, so the isolated test service cannot accidentally revert to disk storage. Partial credentials remain rejected. Do not change production configuration or start production media workers without a separately approved rollout.

## Read-only public HLS probe

After building the backend and obtaining the **staging** `UploadedFile.hlsUrl` (not a private message URL), run in an isolated staging shell:

```bash
VANTA_STAGING_MEDIA_ACCEPTANCE=yes \
  CLOUDINARY_CLOUD_NAME=<staging-cloud-name> \
  VANTA_STAGING_HLS_URL=<staging-public-hls-url> \
  npm --prefix backend run media:verify-hls
```

The probe only GETs the public Cloudinary master, each variant playlist, and a small byte range from one segment per variant. It checks the expected account, HTTPS, media responses, playlist completion, and nonempty transport-stream bytes. It **does not** authenticate Cloudinary, create uploads, start workers, validate a user session, or prove mobile playback. It rejects cross-account/external references and redirects. Test with staged assets only; keep test media URLs and account names out of public CI logs. Its result is an additional acceptance artifact, not a release approval.
