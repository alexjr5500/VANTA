/**
 * Enterprise authentication and authorization middleware for VANTA.
 * Replaces the existing basic auth middleware with comprehensive security checks.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { config } from './config';
import { auditLog } from './auditLog';
import { Role, Permission, hasPermission, parseRole } from './rbac';
import { botProtection } from './botProtection';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: Role;
    sessionId: string;
    deviceFingerprint?: string;
  };
  token?: string;
}

/**
 * Authenticate JWT token with enhanced security checks
 */
export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required',
      message: 'Authorization header missing or invalid',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify token
    const jwtSecret = config.jwt.accessToken.secret();
    const decoded = jwt.verify(token, jwtSecret) as { userId?: string; role?: string; sessionId?: string; type?: string };

    if (!decoded || !decoded.userId || decoded.type !== 'access') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Verify session exists and is valid
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session) {
      res.status(401).json({ error: 'Session not found' });
      return;
    }

    if (session.userId !== decoded.userId || decoded.sessionId !== session.id) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }

    // Check session expiry
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } });
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    // Check if user is still active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, status: true, role: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      const statusMessages: Record<string, string> = {
        'SUSPENDED': 'Account suspended',
        'BANNED': 'Account banned',
        'DEACTIVATED': 'Account deactivated',
        'LOCKED': 'Account locked due to suspicious activity',
      };
      
      await auditLog.log({
        userId: user.id,
        action: 'BLOCKED_REQUEST',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { reason: `Account status: ${user.status}` },
        severity: 'WARNING',
      });

      res.status(403).json({
        error: statusMessages[user.status] || 'Account restricted',
      });
      return;
    }

    // Update session last activity
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    });

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      role: parseRole(user.role),
      sessionId: session.id,
      deviceFingerprint: (req as any).deviceFingerprint,
    };
    req.token = token;

    if (process.env.NODE_ENV === 'development') {
      console.info('[Auth] Request authenticated', { userId: user.id, role: user.role, path: req.path });
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'Token expired',
        message: 'Please refresh your token',
      });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      console.error('[Auth] Authentication middleware failed', error instanceof Error ? error.message : error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
}

/**
 * Optional authentication - doesn't fail if not authenticated
 */
export async function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    await authenticate(req, res, next);
  } catch {
    // Don't fail on optional auth
    next();
  }
}

/**
 * Authorization middleware using RBAC permissions
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasRequiredPermissions = permissions.every(permission =>
      hasPermission(req.user!.role, permission)
    );

    if (!hasRequiredPermissions) {
      auditLog.log({
        userId: req.user.userId,
        action: 'UNAUTHORIZED_ACCESS',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          required: permissions,
          role: req.user.role,
          path: req.path,
          method: req.method,
        },
        severity: 'WARNING',
      });

      res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have the required permissions for this action',
      });
      return;
    }

    next();
  };
}

/**
 * Require a specific role
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      if (process.env.NODE_ENV === 'development') {
        console.info('[Auth] Role authorization denied', { userId: req.user.userId, role: req.user.role, requiredRoles: roles, path: req.path });
      }
      res.status(403).json({
        error: 'Insufficient role',
        message: `This action requires one of: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Rate limiting and brute-force protection for login
 */
export async function checkLoginAttempts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const rawIdentifier = req.body?.identifier || req.body?.email;
  const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim().toLowerCase() : '';
  if (!identifier) return next();

  // Support login by email or username
  const isEmail = identifier.includes('@');
  const user = await prisma.user.findFirst({
    where: isEmail
      ? { email: identifier }
      : { username: identifier.replace(/^@/, '') },
  });
  if (!user) return next(); // Don't reveal if user exists

  // Check brute force
  const bruteForceCheck = await botProtection.checkAccountBruteForce(user.id);
  if (bruteForceCheck.isLocked) {
    await auditLog.log({
      userId: user.id,
      action: 'LOGIN_BLOCKED_LOCKED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { remainingLockout: bruteForceCheck.lockoutDuration },
      severity: 'WARNING',
    });

    res.status(429).json({
      error: 'Account temporarily locked',
      message: `Too many login attempts. Please try again in ${Math.ceil(bruteForceCheck.lockoutDuration / 60)} minutes.`,
      retryAfter: bruteForceCheck.lockoutDuration,
    });
    return;
  }

  next();
}

/**
 * Verify email is verified (for sensitive operations)
 */
export function requireEmailVerified(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Check email verification status from DB
  prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { emailVerified: true },
  }).then(user => {
    if (!user?.emailVerified) {
      res.status(403).json({
        error: 'Email not verified',
        message: 'Please verify your email address before performing this action',
      });
      return;
    }
    next();
  }).catch(() => next());
}

/**
 * Check if user has 2FA enabled (for 2FA-specific flows)
 */
export function requireTwoFactorEnabled(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { twoFactorEnabled: true },
  }).then(user => {
    if (!user?.twoFactorEnabled) {
      res.status(400).json({
        error: '2FA not enabled',
        message: 'Two-factor authentication is not enabled for this account',
      });
      return;
    }
    next();
  }).catch(() => next());
}

/**
 * Log security events automatically
 */
export function securityLog(action: string, severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const originalEnd = res.end;
    
    // @ts-ignore
    res.end = function (this: Response, ...args: any[]) {
      const statusCode = res.statusCode;
      
      if (statusCode >= 400) {
        auditLog.log({
          userId: req.user?.userId,
          action: `${action}_FAILED`,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: {
            method: req.method,
            path: req.path,
            statusCode,
          },
          severity: severity,
        });
      } else {
        auditLog.log({
          userId: req.user?.userId,
          action: `${action}_SUCCESS`,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: {
            method: req.method,
            path: req.path,
          },
        });
      }

      // @ts-ignore
      return originalEnd.apply(this, args);
    };

    next();
  };
}