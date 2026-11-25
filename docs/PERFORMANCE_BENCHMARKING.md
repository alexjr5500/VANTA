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
