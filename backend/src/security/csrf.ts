/**
 * CSRF Protection for VANTA.
 * Protects against Cross-Site Request Forgery attacks using
 * a combination of SameSite cookies, custom headers, and token validation.
 */
import { Request, Response, NextFunction } from 'express';
import { CryptoUtils } from './crypto';
import { config } from './config';

// Store CSRF tokens (in production, use Redis)
const tokenStore = new Map<string, { token: string; expiresAt: number }>();

const TOKEN_EXPIRY = 3600000; // 1 hour
const CLEANUP_INTERVAL = 300000; // 5 min

// Periodic cleanup of expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenStore) {
    if (value.expiresAt < now) {
      tokenStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export class CSRFProtection {
  /**
   * Generate a CSRF token for a user session
   */
  static generateToken(sessionId: string): string {
    const token = CryptoUtils.generateCSRFToken();
    tokenStore.set(sessionId, {
      token,
      expiresAt: Date.now() + TOKEN_EXPIRY,
    });
    return token;
  }

  /**
   * Validate a CSRF token
   */
  static validateToken(sessionId: string, token: string): boolean {
    const stored = tokenStore.get(sessionId);
    if (!stored) return false;
    
    if (stored.expiresAt < Date.now()) {
      tokenStore.delete(sessionId);
      return false;
    }

    // Constant-time comparison
    if (!CryptoUtils.constantTimeCompare(stored.token, token)) {
      return false;
    }

    // Token is single-use - remove after validation
    tokenStore.delete(sessionId);
    return true;
  }

  /**
   * Middleware to protect state-changing operations
   */
  static middleware(allowedMethods: string[] = ['POST', 'PUT', 'PATCH', 'DELETE']) {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Skip CSRF check for safe methods
      if (!allowedMethods.includes(req.method)) {
        return next();
      }

      // Skip if not using session-based auth (e.g., API requests with Bearer token)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        // For API clients with Bearer tokens, CSRF is mitigated by the token itself
        return next();
      }

      const sessionId = (req as any).session?.id || (req as any).user?.sessionId;
      if (!sessionId) {
        return next();
      }

      // Get CSRF token from header
      const csrfToken = req.headers['x-csrf-token'] as string;
      if (!csrfToken) {
        res.status(403).json({
          error: 'CSRF token missing',
          message: 'X-CSRF-Token header is required for this request',
        });
        return;
      }

      if (!this.validateToken(sessionId, csrfToken)) {
        res.status(403).json({
          error: 'CSRF token invalid or expired',
          message: 'Please refresh and try again',
        });
        return;
      }

      next();
    };
  }

  /**
   * Generate and return a CSRF token (used by endpoints like /api/csrf-token)
   */
  static getTokenHandler(req: Request, res: Response): void {
    const sessionId = (req as any).user?.sessionId;
    if (!sessionId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = CSRFProtection.generateToken(sessionId);
    res.json({ csrfToken: token });
  }
}

/**
 * Double Submit Cookie pattern middleware
 * Sets a CSRF token in a cookie and requires it in a header
 */
export function doubleSubmitCookie(req: Request, res: Response, next: NextFunction): void {
  // Only protect state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies?.['csrf-token'];
  const headerToken = req.headers['x-csrf-token'] as string;

  // If we have a cookie token, verify header matches
  if (cookieToken) {
    if (!headerToken || !CryptoUtils.constantTimeCompare(cookieToken, headerToken)) {
      res.status(403).json({
        error: 'CSRF validation failed',
        message: 'CSRF token mismatch',
      });
      return;
    }
  }

  next();
}