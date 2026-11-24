# VANTA durable queue runbook

## Current scope

The PostgreSQL-backed queue is implemented with atomic claiming, worker leases,
retry state and recovery after lease expiry. The worker is explicitly started;
importing the worker or its handler registry does not start background work.

The first producer migration is limited to push delivery retries:

- Job type: `push:deliver`.
- Payload: device ID plus the existing push payload.
- Idempotency: deterministic queue-job ID derived from event ID + device ID,
  plus the existing unique `PushDelivery(eventId, deviceId)` ledger.
- Delay: 2 seconds before first retry.
- Attempts: at most 3 durable claims.
- The durable handler disables legacy re-enqueue; a transient failure is thrown
  back to the durable worker so PostgreSQL owns retry/backoff.

## Feature flag

`VANTA_DURABLE_QUEUE_PUSH_RETRIES` defaults to disabled when unset. Only set it
to `true` after the durable worker has been separately deployed, started,
monitored, and verified in the target environment. If it is unset or any other
value, push retries continue through the existing in-process queue.

**Do not enable this flag in production yet.** This PR adds the opt-in producer
path and handler factory but deliberately does not start the worker or change
production environment variables.

## Worker construction

Use `createDurableQueueWorker()` from
`backend/src/services/durable-queue.runtime.ts` and explicitly call
`.start()` only from a separately reviewed startup/operations change. Always
call `.stop()` during graceful shutdown. The factory itself has no startup
side effects.

## Media job readiness

Local Sharp/FFmpeg and Cloudinary durable media handlers now exist but remain
**opt-in**. Do not run local media jobs on a worker-only Railway volume: it
cannot read uploads written by a separate HTTP service. See
`docs/DURABLE_MEDIA_STAGING_VERIFICATION.md` for the isolated Cloudinary
acceptance tests and private-media safeguards. Green CI is not real-provider
or playback acceptance.

## Queue monitoring (Phase 6.9)

This PR includes a **read-only, explicit opt-in** queue monitor, suitable for
periodic staging/production checks **after** a separately approved rollout:

```bash
VANTA_DURABLE_QUEUE_MONITOR_ENABLED=true \
  npm --prefix backend run queue:monitor
```

Run this command in an environment with its own valid `DATABASE_URL` and
applied `QueueJob` migration. Do not put database passwords in CLI arguments,
GitHub Actions logs or documentation. The monitor exits `0` on `ok` and
`2` on a warning, critical state, query failure, or missing database.
It logs aggregate-only JSON and never loads/prints job payloads, user IDs,
device IDs, or error strings. It does **not** start or stop a worker, enqueue
jobs, change job states, or send paging notifications.

The snapshot excludes media job types this worker mode cannot claim; ensure
the monitor's `VANTA_DURABLE_QUEUE_MEDIA_HANDLERS` and
`VANTA_DURABLE_QUEUE_MEDIA_STORAGE` match the monitored worker, or it will
report misleading backlog. All snapshots include pending, active, completed,
failed, oldest **due** pending age, expired leases, and terminal failures
within the last **15 minutes**. Future-scheduled jobs do not contribute to
overdue age; historical failures alone do not trigger alerts.

The snapshot also reports due pending work, pending retries (including scheduled retries), successful completions in the last 15 minutes, and mean enqueue-to-completion time for those completions (null when there are none). This latency includes scheduling and retry delays; it is not handler execution time. Use these metrics to establish a staging throughput and retry-pressure baseline before choosing additional alert thresholds. CI exercises a bounded 64-job burst with eight concurrent claimers; this is a correctness test, not a production load benchmark.

Initial conservative thresholds (tune after staging baselines):
- Pending overdue: warning at 120 seconds, critical at 600 seconds.
- Expired worker leases: warning at 1, critical at 3.
- Failed jobs in 15 minutes: warning at 1, critical at 5.

An external Railway cron or alerting provider can treat a nonzero exit as an
alert, **but none has been provisioned or enabled**. An empty queue cannot prove
that workers are alive, and this check does not verify Cloudinary object
availability, a specific user's upload, or streaming playback. Include worker
deployment/liveness, retries, error budgets and backup restore testing in
the production release gate.

## Activation checklist

1. Run backend unit tests, TypeScript build and PostgreSQL queue integration tests.
2. Deploy to isolated staging with the flag disabled.
3. Start exactly one staging worker explicitly and verify health, backlog,
   retries, duplicate delivery and graceful shutdown.
4. Enable the push retry producer flag in staging and prove that new retries
   enter `QueueJob` and are delivered exactly once at the application level.
5. Verify worker restart and lease-expiry recovery.
6. Review production logs, alerting, and rollback procedure.
7. Obtain explicit approval before starting the production worker or enabling
   the production producer flag.
