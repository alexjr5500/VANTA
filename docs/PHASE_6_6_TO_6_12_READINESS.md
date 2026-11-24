# Phase 6.6–6.12: system readiness gates

This checklist is **not** a claim of completion. The phases must be implemented and proven in staging before any production activation. Production remains unchanged by this branch.

## 6.6 — Media processing
- [ ] Real image and thumbnail handlers with Sharp; verify actual output bytes, MIME, atomic writes, idempotent retries and safe storage paths.
- [ ] Real FFmpeg HLS encoding, segments, playlist, probe, timeout, resource limits and cleanup. Never publish an empty playlist as success.
- [ ] Temporary-file cleanup with explicit delay and strict allow-listed temporary directories; never delete original uploaded assets.
- [ ] Use durable queue only after every handler is registered and covered by unit/integration tests.
- [x] Initial traversal/symlink validation helper and unit tests (not yet wired into handlers).

## 6.7 — Durable worker rollout
- [ ] Run migration and isolated worker in staging; keep feature flags disabled initially.
- [ ] Validate duplicate jobs, retries, lease expiry, graceful shutdown, worker crash and restart.
- [ ] Prove no unhandled job types can be silently acknowledged.
- [ ] Require explicit approval for production worker startup and producer flags.

## 6.8 — Media storage reliability
- [ ] Investigate the two missing production uploads; recover only from verified backups.
- [ ] Verify Railway volume mounting and uploads across restart/deploy.
- [ ] Define object-storage migration, private-media authorization, backup and restoration tests.
- [ ] Alert on missing files; do not infer all assets are healthy from a sample.
- [x] Add isolated, bounded, aggregate-only local original audit (CI and real restore evidence tracked separately). See `docs/MEDIA_STORAGE_RECOVERY_AUDIT.md`.

## 6.9 — Observability
- [ ] Queue backlog age, attempts, dead jobs, processing latency and worker liveness.
- [ ] API 5xx/latency, DB pool health, Redis connectivity and media-storage health.
- [ ] Alerts with tested notification routing, on-call owner and runbook links.

## 6.10 — Capacity
- [ ] Baseline and load-test reels playback/upload, feeds, chat, notification delivery and DB.
- [ ] Set latency/error budgets, concurrency caps and backpressure limits.
- [ ] Verify mobile bandwidth and video rendition switching.

## 6.11 — Security and recovery
- [ ] Review upload access, path traversal, MIME verification, ffmpeg command execution and resource exhaustion.
- [ ] Verify wallet/ledger/payment idempotency, authorization, audit logging and secret handling.
- [ ] Restore DB and uploaded media from backups in staging; document RPO/RTO.

## 6.12 — Release gate
- [ ] Full backend/frontend/Android CI, security scan and staging end-to-end regression.
- [ ] Confirm database migrations, monitoring, rollback, operational ownership and user-visible flows.
- [ ] Review each gate and merge only after CI passes and human approval; enable production workers only with separate approval.

## Current known production findings (2026-11-22)
- Backend deployment succeeded and /health returned 200.
- Redis fell back to in-memory caching; root cause unverified.
- Startup diagnostics reported 2 missing files out of 114 uploaded-file rows.
- Phase 6.5 durable push retries are opt-in and not activated.
