/**
 * Live realtime rate limiter
 * ---------------------------
 * Lightweight, in-memory sliding-window rate limiter for the LIVE socket layer.
 *
 * Why in-memory and not the Prisma-backed `rateLimiter`? Live chat, reactions
 * and gift events are the hottest realtime path in the app: a per-event database
 * write (and per-request expired-entry sweep) would add a DB round-trip to every
 * comment/like/gift and become the bottleneck it is supposed to protect. An
 * in-memory sliding window is O(1)-amortized per event, works inside the Socket.IO
 * process (which already holds the authoritative room state) and protects the
 * two things that matter: the database write path (`postChatMessage`,
 * `addReaction`, wallet transactions) and the broadcast fan-out to viewers.
 *
 * It is per-USER (not per-socket): reconnects mint a new socket.id, so keying
 * on socket.id would let an attacker bypass limits by reconnecting. Keying on
 * authenticated userId still permits the honest multi-client case (the limits
 * are generous enough for a human on several devices) while stopping floods.
 *
 * Entries are pruned lazily on every check and capped by a hard bucket count so
 * a large user base can never grow this map without bound.
 */

export type LiveRateAction =
  | 'comment' // send_comment → liveService.postChatMessage (DB write)
  | 'reaction' // reaction → liveService.addReaction (DB write + broadcast)
  | 'gift' // send_gift / gift:send → wallet transaction
  | 'guest_request' // request_join / cancel_request
  | 'guest_action' // guest_respond / guest_remove / guest_end_session / guest_leave
  | 'host_action' // mute / ban / toggle pause / slow mode / clear / delete / pin / unpin
  | 'heartbeat' // live_heartbeat (deliberately generous — 10s cadence × ~3)
  | 'join'; // join_stream / leave_stream churn

export interface RateWindow {
  /** Max number of events allowed inside the window. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
}

/**
 * Default limits. They are tuned to be invisible to a real user (a rapidly
 * tapping viewer can legitimately hit 60 likes in 10s) while making scripted
 * floods expensive: 30 comments/30s = 1/sec sustained, 5 gifts/15s caps wallet
 * churn, 4 guest requests/minute caps join-request spam.
 */
export const LIVE_RATE_LIMITS: Record<LiveRateAction, RateWindow> = {
  comment: { limit: 30, windowMs: 30_000 },
  reaction: { limit: 60, windowMs: 10_000 },
  gift: { limit: 5, windowMs: 15_000 },
  guest_request: { limit: 4, windowMs: 60_000 },
  guest_action: { limit: 25, windowMs: 60_000 },
  host_action: { limit: 40, windowMs: 60_000 },
  heartbeat: { limit: 12, windowMs: 30_000 },
  join: { limit: 10, windowMs: 60_000 },
};

export interface LiveRateResult {
  ok: boolean;
  /** Remaining allowed events in the window (only when `ok`). */
  remaining?: number;
  /** Ms to wait before retrying (only when `!ok`). */
  retryAfterMs?: number;
}

export class LiveRateLimiter {
  /** userId → action → timestamps of accepted events inside the current window. */
  private readonly buckets = new Map<string, number[]>();

  /** Hard cap so an anomalous day of traffic can never exhaust memory. */
  private readonly maxBuckets = 25_000;

  constructor(
    private readonly limits: Record<LiveRateAction, RateWindow> = LIVE_RATE_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Attempt to record one event for (userId, action). When the window is full
   * the call is rejected with the number of ms the caller should wait, and the
   * bucket is left untouched so every rejected attempt still counts toward the
   * same window (a flood stays blocked until the first hit ages out).
   */
  check(userId: string, action: LiveRateAction): LiveRateResult {
    const { limit, windowMs } = this.limits[action];
    const key = `${userId}:${action}`;
    const now = this.now();
    const cutoff = now - windowMs;

    let hits = this.buckets.get(key) ?? [];
    // Prune hits that fell out of the sliding window.
    if (hits.length) {
      const cutoffIndex = hits.findIndex((t) => t > cutoff);
      if (cutoffIndex === -1) {
        // Every hit is older than the window → the bucket is empty again.
        hits = [];
      } else if (cutoffIndex > 0) {
        hits = hits.slice(cutoffIndex);
      }
    }

    if (hits.length >= limit) {
      // The window is full. Keep the bucket (pruned) so the rejection persists
      // until the oldest hit ages out, then recompute the wait time.
      this.buckets.set(key, hits);
      const oldest = hits[0] ?? now;
      return { ok: false, retryAfterMs: Math.max(1, oldest + windowMs - now) };
    }

    hits.push(now);
    this.buckets.set(key, hits);

    if (this.buckets.size > this.maxBuckets) {
      this.sweep(now);
    }

    return { ok: true, remaining: limit - hits.length };
  }

  /** Drop every bucket belonging to a user (unused today, handy for tests/admin). */
  reset(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) this.buckets.delete(key);
    }
  }

  /** Prune expired hits and drop empty buckets. Also enforces the size cap. */
  sweep(now = this.now()): void {
    const cutoff = now - Math.max(...Object.values(this.limits).map((w) => w.windowMs));
    for (const [key, hits] of this.buckets) {
      const alive = hits.filter((t) => t > cutoff);
      if (alive.length) this.buckets.set(key, alive);
      else this.buckets.delete(key);
    }
    // If pruning was not enough, evict oldest-inserted buckets to stay under the
    // hard cap (Map preserves insertion order, so the first key is the oldest).
    while (this.buckets.size > this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.buckets.delete(oldestKey);
    }
  }

  /** Exposed for tests to inspect state without reaching into the map. */
  bucketCount(): number {
    return this.buckets.size;
  }
}

export const liveRateLimiter = new LiveRateLimiter();