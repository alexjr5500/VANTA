/**
 * Enterprise-grade rate limiting for VANTA.
 * Protects against brute-force, DDoS, and API abuse.
 * Uses Prisma-based storage for persistence across restarts.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { config } from './config';
import { auditLog } from './auditLog';

interface RateLimitConfig {
  windowMs: number;
  max: number;
  message?: string;
  statusCode?: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

const defaultKeyGenerator = (req: Request): string => {
  const userId = (req as any).user?.userId;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return userId ? `user:${userId}` : `ip:${ip}`;
};

class RateLimiter {
  private configs: Map<string, RateLimitConfig> = new Map();

  /**
   * Create a rate limiter middleware
   */
  createLimiter(limiterConfig: RateLimitConfig) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!config.rateLimit.enabled) {
        return next();
      }

      if (limiterConfig.skip && limiterConfig.skip(req)) {
        return next();
      }

      const key = limiterConfig.keyGenerator ? limiterConfig.keyGenerator(req) : defaultKeyGenerator(req);
      const route = `${req.method}:${req.path}`;
      const identifier = `${route}:${key}`;

      try {
        // Clean up expired entries
        await prisma.rateLimit.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });

        // Find existing rate limit record
        const now = new Date();
        const windowStart = new Date(now.getTime() - limiterConfig.windowMs);
        
        // Get all entries for this identifier within the window
        const entries = await prisma.rateLimit.findMany({
          where: {
            key: identifier,
            createdAt: { gte: windowStart },
          },
        });

        const currentCount = entries.reduce((sum, e) => sum + e.points, 0);

        if (currentCount >= limiterConfig.max) {
          const retryAfter = Math.ceil(
            (entries[0]?.expiresAt.getTime() - now.getTime()) / 1000
          );

          res.setHeader('Retry-After', Math.max(1, retryAfter));
          res.status(limiterConfig.statusCode || 429).json({
            error: limiterConfig.message || 'Too many requests, please try again later',
            retryAfter: Math.max(1, retryAfter),
          });

          // Log rate limit hit for security monitoring
          await auditLog.log({
            userId: (req as any).user?.userId,
            action: 'RATE_LIMIT_HIT',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            metadata: {
              route,
              key: key.substring(0, 50),
              count: currentCount,
              limit: limiterConfig.max,
            },
          });

          return;
        }

        // Add new entry
        await prisma.rateLimit.create({
          data: {
            key: identifier,
            points: 1,
            expiresAt: new Date(now.getTime() + limiterConfig.windowMs),
          },
        });

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', limiterConfig.max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, limiterConfig.max - currentCount - 1));
        res.setHeader('X-RateLimit-Reset', Math.ceil(
          (now.getTime() + limiterConfig.windowMs) / 1000
        ));

        next();
      } catch (error) {
        // Fail open - allow request if rate limiter has issues
        console.error('Rate limiter error:', error);
        next();
      }
    };
  }

  /**
   * Standard rate limiters for different endpoints
   */
  login = this.createLimiter({
    windowMs: config.rateLimit.login.windowMs,
    max: config.rateLimit.login.max,
    message: 'Too many login attempts. Please try again later.',
    keyGenerator: (req) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const body = req.body as any;
      // Use email in key to prevent targeted attacks on specific accounts
      const identifier = body?.identifier || body?.email;
      return identifier ? `login:${String(identifier).trim().toLowerCase()}:${ip}` : `login:${ip}`;
    },
  });

  register = this.createLimiter({
    windowMs: config.rateLimit.register.windowMs,
    max: config.rateLimit.register.max,
    message: 'Too many registration attempts. Please try again later.',
    keyGenerator: (req) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      return `register:${ip}`;
    },
  });

  passwordReset = this.createLimiter({
    windowMs: config.rateLimit.passwordReset.windowMs,
    max: config.rateLimit.passwordReset.max,
    message: 'Too many password reset attempts. Please try again later.',
  });

  otp = this.createLimiter({
    windowMs: config.rateLimit.otp.windowMs,
    max: config.rateLimit.otp.max,
    message: 'Too many OTP requests. Please try again later.',
  });

  api = this.createLimiter({
    windowMs: config.rateLimit.api.windowMs,
    max: config.rateLimit.api.max,
    message: 'Too many API requests.',
  });

  messaging = this.createLimiter({
    windowMs: config.rateLimit.messaging.windowMs,
    max: config.rateLimit.messaging.max,
    message: 'Too many messages. Please slow down.',
    keyGenerator: (req) => {
      const userId = (req as any).user?.userId;
      return `messaging:${userId || 'unknown'}`;
    },
  });

  upload = this.createLimiter({
    windowMs: config.rateLimit.upload.windowMs,
    max: config.rateLimit.upload.max,
    message: 'Too many uploads. Please try again later.',
  });

  search = this.createLimiter({
    windowMs: config.rateLimit.search.windowMs,
    max: config.rateLimit.search.max,
    message: 'Too many search requests. Please slow down.',
  });
}

export const rateLimiter = new RateLimiter();