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

## Media job blockers

Do not route the following job types to the durable worker yet:

- `image:optimize`: upload flow currently calls the image optimizer
  synchronously; queued image optimization has no registered production handler.
- `thumbnail:generate`: image/video enqueue APIs exist, but no handler is
  registered or confirmed as a production call path.
- `video:transcode`: no real FFmpeg transcode implementation or declared
  FFmpeg dependency was found. The current HLS method writes a playlist file
  but does not generate encoded segments.
- `cleanup:temp`: no handler exists, and the current cleanup enqueue passes a
  delay inside payload data instead of scheduling options.

Implement and test real handlers, validate storage paths against the mounted
volume, and prove idempotent outputs before migrating any of these jobs.

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
