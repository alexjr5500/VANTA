import { cacheService } from '../services/cache.service';

describe('process-local cache fallback', () => {
  it('increments exactly once per invocation and preserves falsy values', async () => {
    const key = 'ci:local:counter';
    await cacheService.del(key);
    await expect(cacheService.increment(key)).resolves.toBe(1);
    await expect(cacheService.increment(key, 2)).resolves.toBe(3);
    await expect(cacheService.get<number>(key)).resolves.toBe(3);
    await cacheService.set(key, false);
    await expect(cacheService.get<boolean>(key)).resolves.toBe(false);
    await cacheService.del(key);
  });
});
