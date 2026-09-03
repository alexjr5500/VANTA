import { config } from '../security/config';

// In-memory cache fallback when Redis is unavailable
class MemoryCache {
  private store = new Map<string, { data: any; expiresAt: number }>();
  private readonly defaultTTL: number;

  constructor(defaultTTL: number = 60_000) {
    this.defaultTTL = defaultTTL;
    // Periodic cleanup of expired entries
    const cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    cleanupTimer.unref?.();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  async set(key: string, data: any, ttl?: number): Promise<void> {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttl || this.defaultTTL),
    });
  }

  async mset(entries: { key: string; data: any; ttl?: number }[]): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.data, entry.ttl);
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern.replace('*', '.*'));
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  async flush(): Promise<void> {
    this.store.clear();
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this.store.delete(key);
      return -2;
    }
    return remaining;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) {
      this.store.set(key, { data: amount, expiresAt: Date.now() + this.defaultTTL });
      return amount;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.store.set(key, { data: amount, expiresAt: Date.now() + this.defaultTTL });
      return amount;
    }
    entry.data = (entry.data as number) + amount;
    return entry.data as number;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}

// Redis cache adapter (requires ioredis)
let redisClient: any = null;
let redisAvailable = false;

// Cache event listeners for pub/sub invalidations
type CacheEventHandler = (key: string) => void;
const cacheEventHandlers = new Map<string, CacheEventHandler[]>();

function onCacheEvent(event: string, handler: CacheEventHandler): void {
  if (!cacheEventHandlers.has(event)) {
    cacheEventHandlers.set(event, []);
  }
  cacheEventHandlers.get(event)!.push(handler);
}

function emitCacheEvent(event: string, key: string): void {
  const handlers = cacheEventHandlers.get(event);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(key);
      } catch {
        // Ignore handler errors
      }
    }
  }
}

async function initRedis(): Promise<boolean> {
  try {
    const Redis = require('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableOfflineQueue: false,
      lazyConnect: true,
      enableReadyCheck: true,
      // Connection pool settings
      connectTimeout: 10000,
      disconnectTimeout: 5000,
      commandTimeout: 5000,
      keepAlive: 30000,
    });

    // Set up Redis event listeners
    redisClient.on('error', (err: Error) => {
      console.warn('[Cache] Redis error:', err.message);
      redisAvailable = false;
    });

    redisClient.on('reconnecting', () => {
      console.info('[Cache] Redis reconnecting...');
    });

    redisClient.on('connect', () => {
      console.info('[Cache] Redis connected');
      redisAvailable = true;
    });

    await redisClient.connect();
    redisAvailable = true;
    console.info('[Cache] Redis connected successfully');
    return true;
  } catch (error) {
    console.warn('[Cache] Redis unavailable, using in-memory cache fallback');
    redisAvailable = false;
    return false;
  }
}

// Cache warmer for pre-populating frequently accessed data
class CacheWarmer {
  private warmingJobs: Map<string, { interval: number; handler: () => Promise<void>; timer: any }> = new Map();
  private isRunning: boolean = false;

  register(key: string, handler: () => Promise<void>, intervalMs: number): void {
    if (this.warmingJobs.has(key)) {
      clearInterval(this.warmingJobs.get(key)!.timer);
    }
    const timer = setInterval(() => {
      if (this.isRunning) {
        handler().catch((err) => console.warn(`[CacheWarmer] ${key} failed:`, err));
      }
    }, intervalMs);
    this.warmingJobs.set(key, { interval: intervalMs, handler, timer });
  }

  unregister(key: string): void {
    const job = this.warmingJobs.get(key);
    if (job) {
      clearInterval(job.timer);
      this.warmingJobs.delete(key);
    }
  }

  start(): void {
    this.isRunning = true;
  }

  stop(): void {
    this.isRunning = false;
  }

  get jobs(): number {
    return this.warmingJobs.size;
  }
}

// Cache service with multi-tier support (Redis + in-memory fallback)
class CacheService {
  private memoryCache: MemoryCache;
  private warmer: CacheWarmer;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    redisHits: 0,
    memoryHits: 0,
  };
  private readonly DEFAULT_TTL: number = 60_000;
  private readonly MAX_CACHE_KEY_LENGTH: number = 256;

  // L1 cache (in-memory) for hot data
  private hotCache: MemoryCache;
  private readonly HOT_CACHE_TTL: number = 10_000; // 10 seconds

  constructor() {
    this.memoryCache = new MemoryCache();
    this.hotCache = new MemoryCache(this.HOT_CACHE_TTL);
    this.warmer = new CacheWarmer();
    this.init();
  }

  private async init(): Promise<void> {
    if (process.env.REDIS_URL) {
      await initRedis();
    }
  }

  get isRedisAvailable(): boolean {
    return redisAvailable;
  }

  get hitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return this.stats.hits / total;
  }

  get statsData() {
    return { 
      ...this.stats, 
      memorySize: this.memoryCache.size, 
      hotCacheSize: this.hotCache.size,
      redisAvailable,
      warmerJobs: this.warmer.jobs,
    };
  }

  get warmerInstance(): CacheWarmer {
    return this.warmer;
  }

  private sanitizeKey(key: string): string {
    if (key.length > this.MAX_CACHE_KEY_LENGTH) {
      return key.substring(0, this.MAX_CACHE_KEY_LENGTH);
    }
    return key;
  }

  async get<T>(key: string): Promise<T | null> {
    const sanitizedKey = this.sanitizeKey(key);

    // Try L1 hot cache first (fastest)
    const hotData = await this.hotCache.get<T>(sanitizedKey);
    if (hotData !== null) {
      this.stats.hits++;
      this.stats.memoryHits++;
      return hotData;
    }

    // Try Redis if available (L2)
    if (redisAvailable && redisClient) {
      try {
        const data = await redisClient.get(sanitizedKey);
        if (data) {
          this.stats.hits++;
          this.stats.redisHits++;
          // Promote to hot cache
          const parsed = JSON.parse(data) as T;
          await this.hotCache.set(sanitizedKey, parsed);
          return parsed;
        }
      } catch {
        // Redis error, fall through to memory cache
      }
    }

    // Fallback to memory cache (L3)
    const data = await this.memoryCache.get<T>(sanitizedKey);
    if (data) {
      this.stats.hits++;
      this.stats.memoryHits++;
      return data;
    }

    this.stats.misses++;
    return null;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  async set(key: string, data: any, ttl?: number): Promise<void> {
    const sanitizedKey = this.sanitizeKey(key);
    this.stats.sets++;

    // Set in hot cache
    await this.hotCache.set(sanitizedKey, data, ttl);

    // Set in memory cache
    await this.memoryCache.set(sanitizedKey, data, ttl);

    // Set in Redis if available
    if (redisAvailable && redisClient) {
      try {
        const serialized = JSON.stringify(data);
        if (ttl) {
          await redisClient.set(sanitizedKey, serialized, 'PX', ttl);
        } else {
          await redisClient.set(sanitizedKey, serialized);
        }
      } catch {
        // Redis error, data already in memory cache
      }
    }
  }

  async mset(entries: { key: string; data: any; ttl?: number }[]): Promise<void> {
    const sanitized = entries.map(e => ({ ...e, key: this.sanitizeKey(e.key) }));
    await this.hotCache.mset(sanitized);
    await this.memoryCache.mset(sanitized);
    if (redisAvailable && redisClient) {
      try {
        const pipeline = redisClient.pipeline();
        for (const entry of sanitized) {
          const serialized = JSON.stringify(entry.data);
          if (entry.ttl) {
            pipeline.set(entry.key, serialized, 'PX', entry.ttl);
          } else {
            pipeline.set(entry.key, serialized);
          }
        }
        await pipeline.exec();
      } catch {
        // Ignore Redis errors
      }
    }
  }

  async del(key: string): Promise<void> {
    const sanitizedKey = this.sanitizeKey(key);
    this.stats.deletes++;
    await this.hotCache.del(sanitizedKey);
    await this.memoryCache.del(sanitizedKey);
    if (redisAvailable && redisClient) {
      try {
        await redisClient.del(sanitizedKey);
      } catch {
        // Ignore Redis errors
      }
    }
    emitCacheEvent('del', sanitizedKey);
  }

  async delPattern(pattern: string): Promise<void> {
    this.stats.deletes++;
    await this.hotCache.delPattern(pattern);
    await this.memoryCache.delPattern(pattern);
    if (redisAvailable && redisClient) {
      try {
        const stream = redisClient.scanStream({ match: pattern });
        const pipeline = redisClient.pipeline();
        stream.on('data', (keys: string[]) => {
          for (const key of keys) {
            pipeline.del(key);
          }
        });
        await new Promise<void>((resolve) => {
          stream.on('end', async () => {
            await pipeline.exec();
            resolve();
          });
        });
      } catch {
        // Ignore Redis errors
      }
    }
    emitCacheEvent('delPattern', pattern);
  }

  async flush(): Promise<void> {
    await this.hotCache.flush();
    await this.memoryCache.flush();
    if (redisAvailable && redisClient) {
      try {
        await redisClient.flushdb();
      } catch {
        // Ignore Redis errors
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const sanitizedKey = this.sanitizeKey(key);
    const hotExists = await this.hotCache.exists(sanitizedKey);
    if (hotExists) return true;
    const memExists = await this.memoryCache.exists(sanitizedKey);
    if (memExists) return true;
    if (redisAvailable && redisClient) {
      try {
        return await redisClient.exists(sanitizedKey) > 0;
      } catch {
        return false;
      }
    }
    return false;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    const sanitizedKey = this.sanitizeKey(key);
    await this.hotCache.increment(sanitizedKey, amount);
    await this.memoryCache.increment(sanitizedKey, amount);
    if (redisAvailable && redisClient) {
      try {
        return await redisClient.incrby(sanitizedKey, amount);
      } catch {
        return this.memoryCache.increment(sanitizedKey, amount);
      }
    }
    return this.memoryCache.increment(sanitizedKey, amount);
  }

  // Get or set cache with factory function
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const data = await factory();
    await this.set(key, data, ttl);
    return data;
  }

  // Get or set with stale-while-revalidate pattern
  async getOrSetAsync<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = 60_000,
    staleTtl: number = 300_000
  ): Promise<T> {
    // Try to get fresh data
    const cached = await this.memoryCache.get<{ data: T; staleAt: number }>(key);
    if (cached) {
      if (Date.now() < cached.staleAt) {
        // Data is still fresh
        this.stats.hits++;
        return cached.data;
      }
      // Data is stale but still usable - revalidate in background
      this.stats.hits++;
      factory().then((freshData) => {
        this.set(key, { data: freshData, staleAt: Date.now() + staleTtl }, ttl);
      }).catch(() => {
        // Keep stale data on revalidation failure
      });
      return cached.data;
    }

    // No cache entry - fetch fresh data
    const data = await factory();
    await this.set(key, { data, staleAt: Date.now() + staleTtl }, ttl);
    return data;
  }

  // Wrap a function with cache
  wrap<T>(
    fn: (...args: any[]) => Promise<T>,
    keyPrefix: string,
    ttl?: number
  ): (...args: any[]) => Promise<T> {
    return async (...args: any[]): Promise<T> => {
      const key = `${keyPrefix}:${JSON.stringify(args)}`;
      return this.getOrSet(key, () => fn(...args), ttl);
    };
  }

  // Cache-aside pattern with write-through
  async writeThrough<T>(
    key: string,
    data: T,
    writeFn: () => Promise<void>,
    ttl?: number
  ): Promise<void> {
    await writeFn();
    await this.set(key, data, ttl);
  }

  // Subscribe to cache invalidation events for cross-instance sync
  onInvalidate(handler: (key: string) => void): void {
    onCacheEvent('del', handler);
  }

  // Bulk invalidate by prefix
  async invalidateByPrefix(prefix: string): Promise<void> {
    await this.delPattern(`${prefix}:*`);
  }

  // Cache tags for group invalidation
  private tagIndex = new Map<string, Set<string>>();

  async setWithTags(key: string, data: any, tags: string[], ttl?: number): Promise<void> {
    await this.set(key, data, ttl);
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    }
  }

  async invalidateByTag(tag: string): Promise<void> {
    const keys = this.tagIndex.get(tag);
    if (keys) {
      for (const key of keys) {
        await this.del(key);
      }
      this.tagIndex.delete(tag);
    }
  }
}

// Cache key constants
export const CACHE_KEYS = {
  USER_PROFILE: (userId: string) => `user:profile:${userId}`,
  USER_SETTINGS: (userId: string) => `user:settings:${userId}`,
  USER_PRESENCE: (userId: string) => `user:presence:${userId}`,
  USER_FOLLOWERS: (userId: string) => `user:followers:${userId}`,
  USER_FOLLOWING: (userId: string) => `user:following:${userId}`,
  FEED: (userId: string, cursor?: string) => `feed:${userId}:${cursor || 'latest'}`,
  HOME_FEED: (userId: string, cursor?: string) => `homefeed:${userId}:${cursor || 'latest'}`,
  TRENDING: 'trending',
  TRENDING_CREATORS: 'trending:creators',
  EXPLORE: 'explore',
  EXPLORE_VIDEOS: 'explore:videos',
  LIVE_STREAMS: 'live:active',
  LIVE_STREAMS_BY_CATEGORY: (category: string) => `live:category:${category}`,
  LIVE_STREAM: (streamId: string) => `live:stream:${streamId}`,
  COMMUNITY: (communityId: string) => `community:${communityId}`,
  COMMUNITY_MEMBERS: (communityId: string) => `community:members:${communityId}`,
  COMMUNITY_POSTS: (communityId: string) => `community:posts:${communityId}`,
  CHANNEL: (channelId: string) => `channel:${channelId}`,
  CONVERSATION: (convId: string) => `conversation:${convId}`,
  MESSAGES: (convId: string, cursor?: string) => `messages:${convId}:${cursor || 'latest'}`,
  SEARCH: (query: string) => `search:${query}`,
  SEARCH_SUGGESTIONS: 'search:suggestions',
  TRENDING_SEARCHES: 'search:trending',
  NOTIFICATIONS: (userId: string) => `notifications:${userId}`,
  UNREAD_COUNT: (userId: string) => `unread:${userId}`,
  GIFT_CATALOG: 'gifts:catalog',
  GIFT_CATEGORIES: 'gifts:categories',
  COIN_PACKAGES: 'coins:packages',
  MATCHES: (userId: string) => `matches:${userId}`,
  STORIES: 'stories:active',
  STORIES_BY_USER: (userId: string) => `stories:user:${userId}`,
  LEADERBOARD: (period: string, category: string) => `leaderboard:${period}:${category}`,
  RECOMMENDATIONS: (userId: string) => `recommendations:${userId}`,
  WALLET_BALANCE: (userId: string) => `wallet:balance:${userId}`,
  RATE_LIMIT: (key: string) => `ratelimit:${key}`,
  SESSION: (token: string) => `session:${token}`,
};

// Default TTLs for different cache types
export const CACHE_TTL = {
  HOT: 10_000,         // 10 seconds - very hot data
  SHORT: 30_000,       // 30 seconds - feed, live streams
  MEDIUM: 300_000,     // 5 minutes - user profiles, communities
  LONG: 3_600_000,     // 1 hour - gift catalog, coin packages
  VERY_LONG: 86_400_000, // 24 hours - static data
  WEEK: 604_800_000,   // 7 days - reference data
  MONTH: 2_592_000_000, // 30 days - archival data
};

// Cache tags for group invalidation
export const CACHE_TAGS = {
  USER: (userId: string) => `tag:user:${userId}`,
  FEED: (userId: string) => `tag:feed:${userId}`,
  LIVE: 'tag:live',
  COMMUNITY: (communityId: string) => `tag:community:${communityId}`,
  GIFT: 'tag:gift',
  WALLET: (userId: string) => `tag:wallet:${userId}`,
  SEARCH: 'tag:search',
  NOTIFICATION: (userId: string) => `tag:notification:${userId}`,
  ADMIN: 'tag:admin',
};

export const cacheService = new CacheService();