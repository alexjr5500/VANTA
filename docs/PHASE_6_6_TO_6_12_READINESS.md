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
- [x] Add opt-in PostgreSQL pooled reachability, Redis PING and realtime connection-state monitoring with bounded probes and recovery alerts. Live staging validation, pool occupancy and central routing remain pending.
- [x] Add opt-in fixed-window HTTP histogram, true error ratio, aborted/active counts and sustained structured alert logs; centralized collection and routing remain pending.
- [x] Declare Redis runtime dependency, add opt-in connection readiness, bounded TTL and counter fixes, and real-Redis CI coverage (staging acceptance and CI result still required).
- [ ] Alerts with tested notification routing, on-call owner and runbook links.
- [x] Add opt-in bounded authenticated HTTPS alert delivery for HTTP, dependency and queue signals; receiver provisioning, actual notification delivery and incident ownership remain gated.

## 6.10 — Capacity
- [ ] Baseline and load-test reels playback/upload, feeds, chat, notification delivery and DB.
- [x] Add bounded staging-only read-only HTTP smoke benchmark harness with safety regression tests; actual staging traffic, replica distribution and representative authenticated workload tests remain pending.
- [x] Add optional staging readiness instance markers, shared database probe deadline and two-server loopback traffic/drain tests; actual Railway load balancer remains unverified.
- [ ] Set latency/error budgets, concurrency caps and backpressure limits.
- [x] Implement lightweight liveness/readiness, bounded single-flight database probes and opt-in graceful shutdown; staging routing and active Socket.IO session tests remain required.
- [x] Add opt-in per-process connection pool bounds, connection budget calculation and read-only replica readiness probe; actual replica provisioning, lag baselines and routing remain gated.
- [x] Require matching physical PostgreSQL cluster/database identity for standby readiness; add disposable CI streaming replication and fenced promotion exercise. Managed staging topology, failover RTO/RPO and application read routing remain unverified.
- [x] Add read-only catalog sharding/partition assessment with PostgreSQL integration fixtures; actual workload, key skew, cross-shard semantics and migration design remain gated.
- [ ] Verify mobile bandwidth and video rendition switching.
- [x] Add opt-in shared-only Redis cache mode and cross-client regression tests; live staging and distributed tag invalidation/call-site review remain required.
- [x] Add opt-in Socket.IO Redis room adapter and two-server integration coverage; distributed presence, authorization state, sticky routing and real client acceptance remain gated.
- [x] Consolidate socket presence writes and check cluster room membership before offline transitions; crash recovery, partition detection and concurrent cross-server transition reconciliation remain gated.
- [x] Add opt-in PostgreSQL advisory-lock coordination for five maintenance sweeps and track periodic live sweep during drain; verify actual multi-replica scheduling and lock-loss recovery before activation.
- [ ] Performance optimization and competitive benchmarking (Phase 6.13); see `docs/PERFORMANCE_BENCHMARKING.md`.

## 6.11 — Security and recovery
- [ ] Review upload access, path traversal, MIME verification, ffmpeg command execution and resource exhaustion.
- [ ] Verify wallet/ledger/payment idempotency, authorization, audit logging and secret handling.
- [ ] Restore DB and uploaded media from backups in staging; document RPO/RTO.
- [x] Add disposable CI logical backup/restore exercise using active Prisma schema, synthetic linked records, media checksums and constraint checks; provider backup, migration history and real staging restore remain gated.

## 6.12 — Release gate
- [ ] Full backend/frontend/Android CI, security scan and staging end-to-end regression.
- [ ] Confirm database migrations, monitoring, rollback, operational ownership and user-visible flows.
- [ ] Review each gate and merge only after CI passes and human approval; enable production workers only with separate approval.

## Current known production findings (2026-11-22)
- Backend deployment succeeded and /health returned 200.
- Redis fell back to in-memory caching; root cause unverified.
- Startup diagnostics reported 2 missing files out of 114 uploaded-file rows.
- Phase 6.5 durable push retries are opt-in and not activated.

## 6.13 — Performance optimization and competitive benchmarking
- [ ] Record baseline p50/p95/p99 API latency, errors, throughput and cost under controlled load.
- [ ] Optimize hot database queries/indexes, frontend rendering, startup, media payloads, pagination and redundant requests.
- [ ] Measure real Android production builds on low-end devices and constrained Nigerian mobile networks (cold/warm start, scroll, Reels startup, chat, upload resume, data use).
- [ ] Compare equivalent flows against competing apps on the same device/network; record methodology, versions, sample size and variance. Never claim superiority without comparable measurements.
- [ ] Verify performance and reliability budgets in staging before release; repeat against a controlled post-release baseline only after approval.
