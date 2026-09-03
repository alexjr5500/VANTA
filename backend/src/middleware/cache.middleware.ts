import { Request, Response, NextFunction } from 'express';
import { cacheService, CACHE_TTL } from '../services/cache.service';

// Cache middleware for API responses
export const apiCache = (ttl: number = CACHE_TTL.SHORT) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip cache if request has no-cache header
    if (req.headers['cache-control']?.includes('no-cache')) {
      return next();
    }

    const cacheKey = `api:${req.originalUrl}`;

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached !== null) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-TTL', `${ttl}ms`);
        return res.json(cached);
      }
    } catch {
      // Cache miss, proceed to handler
    }

    // Override res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheService.set(cacheKey, body, ttl).catch(() => {});
        res.setHeader('X-Cache', 'MISS');
      }
      return originalJson(body);
    };

    next();
  };
};

// Invalidate cache for a specific pattern
export const invalidateCache = (pattern: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store original end to invalidate cache after response
    const originalEnd = res.end.bind(res);
    
    res.end = function (...args: any[]) {
      // Invalidate cache after response is sent
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheService.delPattern(pattern).catch(() => {});
      }
      return originalEnd(...args);
    };

    next();
  };
};