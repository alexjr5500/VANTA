# VANTA performance optimization and benchmarking — Phase 6.13

User-approved extension to the infrastructure blueprint. These are proposed budgets, not measured results. Define representative workloads and compare against a baseline before tuning.

| Metric | Initial objective |
| --- | --- |
| Cached API request | p95 < 100 ms |
| Feed API response | p95 < 300 ms |
| Chat delivery, sender to connected recipient | p95 < 200 ms |
| Reel first rendered frame | p95 < 1 s on defined good network |
| Initial usable app content | p95 < 2 s on defined good device/network |
| Monthly service availability | 99.99% aspirational, subject to validated dependencies and SLO review |

Record p50/p95/p99, error rates, throughput, CPU/memory and DB/Redis utilization. Establish sample sizes, warm-up, fixed content sizes and concurrency; record network latency/bandwidth, cold vs warm caches and app/build versions. Separate API round trip from backend execution and end-to-end mobile rendering. Run staged load tests only with explicit scope and caps, synthetic data and isolated dependencies. Include low-end Android, Nigerian mobile networks, constrained bandwidth, interrupted upload/resume, battery and data use; set realistic separate budgets for constrained networks after baseline. Compare user-visible equivalent flows with competitor apps using permitted ordinary client interactions, not load testing their services. Do not claim VANTA is faster unless reproducible comparable results support it.

Production telemetry observation on 2026-11-25: Railway backend reported 341 requests in a one-hour window, 0 HTTP 5xx; this is light observed traffic, not a capacity or availability benchmark. Use isolated staging for future load tests.

## Initial staging HTTP smoke benchmark

After verifying the exact isolated Railway staging service and its dependencies, set VANTA_STAGING_LOAD_TEST=yes, VANTA_LOAD_TEST_ORIGIN and VANTA_LOAD_TEST_ALLOWED_ORIGIN to its exact HTTPS Railway staging origin. These variables are guardrails, not a proof of environment identity. Run `npm --prefix backend run load:staging`. Default endpoint /health/ready, 100 measured requests, concurrency 2, 3-second timeout, p95 budget 300 ms. Optional path /health/live or /api/version; requests capped at 300, concurrency at 10, no redirects, no credentials and no writes. A preflight must pass; stop issuing requests after three failures (in-flight requests may finish). One 100 ms delay per worker limits request issue rate. Report successful-response p50/p95/p99, errors, status counts, elapsed time and achieved requests/sec. CI tests the harness with simulated responses only. This does not measure feed/chat/reels, identify replica distribution or prove capacity. No live benchmark until staging is healthy and explicitly verified. Do not run against production.

Replica sampling: on a separately verified Railway environment named exactly staging, VANTA_STAGING_INSTANCE_PROBE=yes enables an opaque per-process random UUID header only on /health/ready. Set VANTA_LOAD_TEST_MIN_INSTANCES=2 (or required count up to 10) with the readiness benchmark to require valid markers on every successful measured response and at least that many distinct process markers. Only aggregate counts are reported. A restart can introduce a new identifier; observations do not prove simultaneous replicas, fair balancing or stickiness. Verify actual topology and stable deployments independently; disable header afterward. No live load tests or scaling changes performed.

## Home/feed read path optimization

Seven independent discovery reads now run in three bounded stages (maximum three simultaneous reads per request), after the existing follow lookup. Ranking, bucket limits and fresh repost/gift enrichment are retained. The followed-post read now excludes moderation-removed posts. Personalized cache keys include a digest of cursor, page size and seed under the existing invalidation prefix. Global trending/explore cache only their canonical default first page to preserve existing exact-key invalidation. Nondefault requests bypass that cache. Basic and trending post cursor pages now return the last delivered row rather than discarded lookahead, with stable ID tie-breaking. Tests cover key separation, lookahead and concurrency/failure behavior. No measured latency improvement claimed: compare p95, DB pool pressure and correctness on isolated staging; three-way fanout may increase concurrent pool utilization. Existing TTL and invalidation limitations remain; no migration or production config change.
