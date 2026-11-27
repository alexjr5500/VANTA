# Phase 6 consolidated release handoff — 2026-11-27

Current prior verified revision: ba79a035a912ccd877e7f6173a2af8c295ad81d5. All four workflows passed; core PR checks 11/11. Native compile and debug APK checks are not a signed production APK or physical-device test.

| Phase | Evidence | Remaining release gate |
|---|---|---|
| 6.6 Media | Real Sharp/FFmpeg CI, safe path/playlist validation, HLS mapping, derivative and upload finalization tests | Physical Android playback, provider/resource limits, shared multipart storage/routing |
| 6.7 Worker | Durable queue/handler/lease/shutdown CI, isolated worker staging evidence | Live production activation only by separate approval |
| 6.8 Storage | Backup/restore and chunk finalization evidence; staged migration | Missing production originals reconciliation, cross-replica upload continuity, retention/restore verification |
| 6.9 Observability | Bounded HTTP/dependency/queue metrics; backup alert email received | External alert routing/on-call, Redis RDB persistence incident |
| 6.10 Capacity | Two staging replicas direct private address acceptance; Redis adapter CI; isolated PostgreSQL failover | Actual ingress balancing, managed HA decision, representative load and cost |
| 6.11 Security/recovery | Database and media restoration CI; dedicated staging 35 migration checksums, 3 replay triggers; backend tests | Release security review, provider activation remains gated; no further payment development in this workstream |
| 6.12 Release | Four CI workflows successful at prior revision | Exact candidate CI, staging deployment/HTTP and authenticated flows, signed APK/AAB verification, rollback/approval |
| 6.13 Mobile/performance | Home/Reels optimization, native shell/gallery memory fixes, viewport coalescing and offline benchmark evaluator | Physical Android, cold/warm startup, weak-network upload/chat/Reels, competitor measurements |

## Mobile acceptance batch
Test a release-signed candidate and separately test the matching staging web revision (production APK is hardwired to the production web origin). Use low-memory Android and current Android API 34–36 devices, Wi-Fi and constrained mobile data. Record build SHA, APK signer, versionCode, OS/WebView, network, pass/fail, logs and reproduction steps. Cover renderer loss/repeated crash native retry, cold/warm startup, background/foreground, permission grant/revoke, gallery/camera/file chooser including interrupted results, keyboard/system bars, session continuity, notifications/deep links, calls, feed/Reels playback quality and buffering, interrupted upload/resume. Do not claim mobile performance improvements without measured samples.

## Final staging and production release
1. Verify exact candidate CI and migration checksums; no migration rerun merely to check status.
2. Verify staging service SHA, health/readiness, dependency state, worker/queue backlog, two replicas, actual ingress and authenticated journeys. Redis persistence remains a blocker until authorized remediation and verified save; do not restart without approval.
3. Confirm backups and restore evidence, missing media disposition, rollback owner and deployment reversal plan. Never use an existing production database for destructive testing.
4. Generate signed release APK/AAB only via existing production release workflow after release approval; independently verify package, signer, non-debuggable APK, versionCode and artifact checksums. Do not distribute debug APK as production. Confirm production-hosted web/backend revision separately.
5. Merge/deploy only with explicit approval; monitor health, errors, latency, queues and mobile crashes after release. Existing payment and worker activation gates remain separate.

No claim of full release readiness. No production merge, deploy, distribution, restart, payout, or backup deletion performed in this handoff.

## Release candidate verification update
Candidate 66e51dfee5f37581494f1f59069ad160aee9e546: all four CI workflows passed after retry. Exact two-replica staging backend and private HTTP acceptance passed (four addresses, two instances, max readiness 62.75 ms); database 35 migrations and 84 free connections. Redis RDB persistence remains failing. Read-only inventory reported no populated databases, 9 changes since last save and AOF disabled; dashboard confirms no backups. This does not verify recoverability or authorize loss. Hold restart while continuing mobile work.

A new CI release-artifact acceptance job uses a disposable test key, assembles both release variants, exercises the shared signature and APK identity checker and rejects an incorrect version. It must not publish or install these artifacts; they are not production-signed. Production workflow shares the checker, including complete AAB payload signature coverage; APK package/version/non-debuggable checks do not independently decode the protobuf AAB manifest. Physical-device and authenticated staging tests, actual production signing, recovery point and release approval remain open. No production release or Redis restart performed.
