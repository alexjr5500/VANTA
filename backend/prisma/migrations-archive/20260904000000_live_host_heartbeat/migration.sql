-- Live host heartbeat: while a host is actively broadcasting they send periodic
-- heartbeats. If the server sees no heartbeat for 30 seconds the session is
-- considered stale and automatically ended, so an abandoned/ crashed Live can
-- never stay marked "active" and block the host from starting a new one.
ALTER TABLE "LiveStream" ADD COLUMN "lastHostHeartbeat" DATETIME;
CREATE INDEX "LiveStream_active_status_lastHostHeartbeat_idx" ON "LiveStream"("active", "status", "lastHostHeartbeat");