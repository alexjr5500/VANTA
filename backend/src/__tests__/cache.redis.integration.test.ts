import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { cacheService } from '../services/cache.service';

const url = process.env.VANTA_CI_REDIS_URL;
const describeWithRedis = url ? describe : describe.skip;

describeWithRedis('Redis cache adapter with isolated Redis', () => {
  let observer: Redis;
  const prefix = 'vanta:ci:' + randomUUID();
  const keys = ['default', 'short', 'batch', 'counter'].map(k => prefix + ':' + k);
  beforeAll(async () => {
    expect(await cacheService.waitForRedis()).toBe(true);
    observer = new Redis(url!, { lazyConnect: true });
    await observer.connect();
  });
  afterAll(async () => {
    if (observer) {
      try { await observer.del(...keys); } finally { observer.disconnect(); }
    }
    await cacheService.closeRedisConnection();
  });
  it('sets finite default TTLs and respects explicit expiry for single and bulk writes', async () => {
    await cacheService.set(keys[0], { ok: true });
    await cacheService.set(keys[1], false, 5000);
    await cacheService.mset([{ key: keys[2], data: 0 }]);
    expect(await observer.get(keys[0])).toBe('{"ok":true}');
    expect(await observer.get(keys[1])).toBe('false');
    expect(await observer.get(keys[2])).toBe('0');
    for (const [index, bound] of [[0, 60000], [1, 5000], [2, 60000]]) {
      const ttl = await observer.pttl(keys[index]);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(bound);
    }
  });
  it('increments atomically across two clients and assigns a bounded counter TTL', async () => {
    const increments = await Promise.all([
      cacheService.increment(keys[3]),
      observer.incrby(keys[3], 1),
      cacheService.increment(keys[3]),
    ]);
    expect(increments.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(await observer.get(keys[3])).toBe('3');
    expect(await cacheService.get<number>(keys[3])).toBe(3);
    const ttl = await observer.pttl(keys[3]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60000);
  });
});
