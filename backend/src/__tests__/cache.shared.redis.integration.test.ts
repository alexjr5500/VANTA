import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { cacheService } from '../services/cache.service';

const url = process.env.VANTA_CI_REDIS_URL;
const enabled = url && process.env.VANTA_REDIS_CACHE_SHARED_ONLY === 'true';
const suite = enabled ? describe : describe.skip;

suite('shared-only Redis cache across independent clients', () => {
  let peer: Redis;
  const prefix = 'vanta:shared-ci:' + randomUUID();
  const key = prefix + ':value';
  const other = prefix + ':other';
  beforeAll(async () => {
    expect(await cacheService.waitForRedis()).toBe(true);
    peer = new Redis(url!, { lazyConnect: true });
    await peer.connect();
  });
  afterAll(async () => {
    if (peer) {
      try { await peer.del(key, other); } finally { peer.disconnect(); }
    }
    await cacheService.closeRedisConnection();
  });
  it('observes external writes and deletes even after a local write', async () => {
    await cacheService.set(key, 'first');
    expect(await cacheService.get(key)).toBe('first');
    await peer.set(key, JSON.stringify('second'), 'PX', 10000);
    expect(await cacheService.get(key)).toBe('second');
    await peer.del(key);
    expect(await cacheService.get(key)).toBeNull();
    expect(await cacheService.exists(key)).toBe(false);
    expect(cacheService.statsData.memorySize).toBe(0);
    expect(cacheService.statsData.hotCacheSize).toBe(0);
  });
  it('invalidates a prefix across clients and refuses a database-wide flush', async () => {
    await peer.set(key, '1');
    await peer.set(other, '2');
    await cacheService.delPattern(prefix + ':*');
    expect(await peer.exists(key, other)).toBe(0);
    await expect(cacheService.flush()).rejects.toThrow('Global flush is disabled');
  });
  it('returns a cache miss on disconnect instead of stale local data or counters', async () => {
    await cacheService.set(key, 'cached');
    await cacheService.closeRedisConnection();
    expect(await cacheService.get(key)).toBeNull();
    expect(await cacheService.exists(key)).toBe(false);
    await expect(cacheService.getOrSet(key, async () => 'authoritative')).resolves.toBe('authoritative');
    await expect(cacheService.increment(key)).rejects.toThrow('Shared cache counter unavailable');
  });
});
