import { LiveRateLimiter } from '../security/liveRateLimiter';

describe('LiveRateLimiter', () => {
  let clock: { now: () => number; advance: (ms: number) => void };
  let limiter: LiveRateLimiter;

  beforeEach(() => {
    let t = 1_000_000;
    clock = {
      now: () => t,
      advance: (ms: number) => { t += ms; },
    };
    // Narrow windows so tests are fast and deterministic.
    limiter = new LiveRateLimiter(
      {
        comment: { limit: 3, windowMs: 30_000 },
        reaction: { limit: 5, windowMs: 10_000 },
        gift: { limit: 2, windowMs: 15_000 },
        guest_request: { limit: 2, windowMs: 60_000 },
        guest_action: { limit: 2, windowMs: 60_000 },
        host_action: { limit: 2, windowMs: 60_000 },
        heartbeat: { limit: 3, windowMs: 30_000 },
        join: { limit: 2, windowMs: 60_000 },
      },
      clock.now,
    );
  });

  test('allows events up to the window limit', () => {
    const r1 = limiter.check('user1', 'comment');
    const r2 = limiter.check('user1', 'comment');
    const r3 = limiter.check('user1', 'comment');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
  });

  test('rejects once the window is full and reports a retry delay', () => {
    limiter.check('user1', 'comment');
    limiter.check('user1', 'comment');
    limiter.check('user1', 'comment');
    const rejected = limiter.check('user1', 'comment');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.retryAfterMs).toBeGreaterThanOrEqual(1);
    }
  });

  test('windows slide: old hits expire and new events are allowed', () => {
    limiter.check('user1', 'comment');
    limiter.check('user1', 'comment');
    limiter.check('user1', 'comment');
    expect(limiter.check('user1', 'comment').ok).toBe(false);

    clock.advance(30_001); // entire window elapses
    expect(limiter.check('user1', 'comment').ok).toBe(true);
  });

  test('buckets are per-user: one user cannot exhaust another user quota', () => {
    for (let i = 0; i < 5; i++) limiter.check('flooder', 'reaction');
    expect(limiter.check('flooder', 'reaction').ok).toBe(false);
    // A second user on the same action is unaffected.
    expect(limiter.check('normal', 'reaction').ok).toBe(true);
  });

  test('limits are per-action: gifting does not consume the comment budget', () => {
    limiter.check('user1', 'comment');
    limiter.check('user1', 'comment');
    limiter.check('user1', 'comment');
    expect(limiter.check('user1', 'comment').ok).toBe(false);
    // Different action → different bucket, still allowed.
    expect(limiter.check('user1', 'gift').ok).toBe(true);
  });

  test('a rejected flood stays blocked until the oldest hit ages out', () => {
    for (let i = 0; i < 2; i++) limiter.check('user1', 'gift');
    expect(limiter.check('user1', 'gift').ok).toBe(false);

    // Half the window elapses: still blocked because the oldest hit is inside.
    clock.advance(7_000);
    expect(limiter.check('user1', 'gift').ok).toBe(false);
  });

  test('reset clears a user buckets entirely', () => {
    for (let i = 0; i < 3; i++) limiter.check('user1', 'comment');
    expect(limiter.check('user1', 'comment').ok).toBe(false);
    limiter.reset('user1');
    expect(limiter.check('user1', 'comment').ok).toBe(true);
  });

  test('sweep drops expired buckets so the map never grows without bound', () => {
    for (let i = 0; i < 3; i++) limiter.check('u1', 'comment');
    for (let i = 0; i < 3; i++) limiter.check('u2', 'heartbeat');
    expect(limiter.bucketCount()).toBe(2);

    clock.advance(60_001); // all configured windows have elapsed
    limiter.sweep();
    expect(limiter.bucketCount()).toBe(0);
  });
});