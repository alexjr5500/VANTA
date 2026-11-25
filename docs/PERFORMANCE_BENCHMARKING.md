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
