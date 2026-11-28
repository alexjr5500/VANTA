# Load balancing readiness

Readiness shares one timeout and completion handler per pending database operation. A timeout does not cancel the underlying operation, and new checks remain failed until it settles. A two-server loopback HTTP test exercises round-robin distribution, excludes draining replicas, finishes an accepted request and returns 503 when neither replica is ready. This test router is not the deployed Railway load balancer; database state is simulated.

The optional instance marker is a random per-process UUID only on readiness, gated by VANTA_STAGING_INSTANCE_PROBE=yes and RAILWAY_ENVIRONMENT_NAME=staging. The staging load harness can require multiple markers and reports aggregate counts. Environment labels are guardrails, not proof of isolation. Restart can introduce new markers; verify real simultaneous replicas independently.

Before staging acceptance: verify isolated HTTP service, credentials, shared storage and Redis, database connection budget, then configure provider readiness/drain and replicas with cost approval. Run bounded readiness checks and document distribution, health propagation, rolling deployments and WebSocket reconnect/stickiness separately. Do not automatically retry writes. No real capacity claim or production change.
