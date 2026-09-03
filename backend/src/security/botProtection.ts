/**
 * Enterprise bot protection for VANTA.
 * Detects and mitigates automated abuse using behavioral analysis,
 * device fingerprinting, IP reputation, and brute-force protection.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { config } from './config';
import { auditLog } from './auditLog';
import { CryptoUtils } from './crypto';

interface BehaviorMetrics {
  requestFrequency: number;
  mouseMovements?: number;
  timeOnPage?: number;
  formCompletionTime?: number;
  browserFeatures?: Record<string, boolean>;
  screenResolution?: string;
  timezone?: string;
  language?: string;
  plugins?: string[];
}

export class BotProtection {
  /**
   * Analyze device fingerprint for suspicious characteristics
   */
  async analyzeDeviceFingerprint(req: Request): Promise<{
    fingerprint: string;
    isSuspicious: boolean;
    trustScore: number;
  }> {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    // Create fingerprint from available headers
    const fingerprint = CryptoUtils.createDeviceFingerprint(
      `${userAgent}|${acceptLanguage}|${acceptEncoding}`,
      ipAddress
    );

    // Check if we've seen this fingerprint before
    const existing = await prisma.deviceFingerprint.findUnique({
      where: { fingerprintId: fingerprint },
    });

    if (existing) {
      // Update last seen and visit count
      await prisma.deviceFingerprint.update({
        where: { fingerprintId: fingerprint },
        data: {
          lastSeen: new Date(),
          visitCount: existing.visitCount + 1,
        },
      });

      return {
        fingerprint,
        isSuspicious: existing.isSuspicious,
        trustScore: existing.trustScore,
      };
    }

    // Calculate initial trust score based on headers
    let trustScore = 0.5;
    const suspiciousSignals: string[] = [];

    // Check for missing/inconsistent headers (common in bots)
    if (!userAgent || userAgent === 'unknown') {
      trustScore -= 0.3;
      suspiciousSignals.push('Missing user-agent');
    }

    if (!acceptLanguage) {
      trustScore -= 0.1;
      suspiciousSignals.push('Missing accept-language');
    }

    // Check for headless browser indicators
    if (userAgent.includes('HeadlessChrome')) {
      trustScore -= 0.4;
      suspiciousSignals.push('Headless browser detected');
    }

    if (userAgent.includes('PhantomJS')) {
      trustScore -= 0.5;
      suspiciousSignals.push('PhantomJS detected');
    }

    // Check for bot user agents
    const botPatterns = [
      'bot', 'crawl', 'spider', 'scrape', 'curl', 'wget', 
      'python', 'java', 'ruby', 'perl', 'php', 'go-http-client',
      'axios', 'requests', 'httpclient', 'okhttp',
    ];

    const ua = userAgent.toLowerCase();
    for (const pattern of botPatterns) {
      if (ua.includes(pattern)) {
        trustScore -= 0.3;
        suspiciousSignals.push(`Bot pattern detected: ${pattern}`);
        break;
      }
    }

    const isSuspicious = trustScore < config.botProtection.suspiciousScoreThreshold;

    // Store fingerprint
    await prisma.deviceFingerprint.create({
      data: {
        fingerprintId: fingerprint,
        ipAddress,
        userAgent,
        trustScore: Math.max(0, trustScore),
        isSuspicious,
      },
    });

    if (isSuspicious) {
      auditLog.log({
        action: 'BOT_DETECTED',
        ipAddress,
        userAgent,
        metadata: { fingerprint, trustScore, signals: suspiciousSignals },
        severity: 'WARNING',
      });
    }

    return { fingerprint, isSuspicious, trustScore: Math.max(0, trustScore) };
  }

  /**
   * Check IP reputation
   */
  async checkIPReputation(req: Request): Promise<{
    isBlocked: boolean;
    riskScore: number;
    shouldChallenge: boolean;
  }> {
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

    const reputation = await prisma.iPReputation.findUnique({
      where: { ipAddress },
    });

    if (!reputation) {
      return { isBlocked: false, riskScore: 0, shouldChallenge: false };
    }

    // IP blocks are temporary. A permanent database flag caused legitimate
    // users behind shared/NAT addresses to receive "Access denied" forever.
    const blockExpired = reputation.isBlocked
      && Date.now() - reputation.lastActivity.getTime() >= config.botProtection.lockoutDuration;
    if (blockExpired) {
      await prisma.iPReputation.update({
        where: { ipAddress },
        data: { isBlocked: false, failedLogins: 0, riskScore: 0, lastActivity: new Date() },
      });
      return { isBlocked: false, riskScore: 0, shouldChallenge: false };
    }

    // Update request count and last activity
    await prisma.iPReputation.update({
      where: { ipAddress },
      data: {
        requestCount: reputation.requestCount + 1,
        lastActivity: new Date(),
      },
    });

    return {
      isBlocked: reputation.isBlocked,
      riskScore: reputation.riskScore,
      shouldChallenge: reputation.riskScore > config.botProtection.captchaThreshold,
    };
  }

  /**
   * Record failed login attempt for IP
   */
  async recordFailedLogin(req: Request): Promise<{ shouldLock: boolean }> {
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

    const reputation = await prisma.iPReputation.upsert({
      where: { ipAddress },
      update: {
        failedLogins: { increment: 1 },
        riskScore: { increment: 0.1 },
        lastActivity: new Date(),
      },
      create: {
        ipAddress,
        failedLogins: 1,
        riskScore: 0.1,
        requestCount: 1,
      },
    });

    const shouldLock = reputation.failedLogins >= config.botProtection.maxFailedLogins;
    
    if (shouldLock) {
      await prisma.iPReputation.update({
        where: { ipAddress },
        data: { isBlocked: true, lastActivity: new Date() },
      });

      auditLog.log({
        action: 'IP_BLOCKED',
        ipAddress,
        metadata: { failedLogins: reputation.failedLogins },
        severity: 'WARNING',
      });
    }

    return { shouldLock };
  }

  /**
   * Check for brute-force login attempts on a specific account
   */
  async checkAccountBruteForce(userId: string): Promise<{
    isLocked: boolean;
    remainingAttempts: number;
    lockoutDuration: number;
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
      return { isLocked: false, remainingAttempts: config.lockout.maxAttempts, lockoutDuration: 0 };
    }

    // Check if account is currently locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      return { isLocked: true, remainingAttempts: 0, lockoutDuration: remaining };
    }

    // Check if lockout should be cleared
    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      await prisma.user.update({
        where: { id: userId },
        data: { loginAttempts: 0, lockedUntil: null },
      });
    }

    const remainingAttempts = Math.max(0, config.lockout.maxAttempts - user.loginAttempts);
    
    return { isLocked: false, remainingAttempts, lockoutDuration: 0 };
  }

  /**
   * Record a login attempt (success or failure)
   */
  async recordLoginAttempt(userId: string, success: boolean, req: Request): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    if (success) {
      // Reset login attempts on success
      await prisma.user.update({
        where: { id: userId },
        data: {
          loginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      });

      // Improve IP reputation on successful login
      const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
      const reputation = await prisma.iPReputation.findUnique({ where: { ipAddress } });
      if (reputation && reputation.riskScore > 0) {
        await prisma.iPReputation.update({
          where: { ipAddress },
          data: { riskScore: Math.max(0, reputation.riskScore - 0.1) },
        });
      }
    } else {
      const newAttempts = user.loginAttempts + 1;
      
      // Check if we should lock the account
      if (newAttempts >= config.lockout.maxAttempts) {
        const isEscalated = newAttempts >= config.lockout.escalationThreshold;
        const lockDuration = isEscalated ? config.lockout.escalationDuration : config.lockout.duration;
        
        await prisma.user.update({
          where: { id: userId },
          data: {
            loginAttempts: newAttempts,
            lockedUntil: new Date(Date.now() + lockDuration),
          },
        });

        auditLog.log({
          userId,
          action: 'ACCOUNT_LOCKED',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: {
            attempts: newAttempts,
            lockDuration,
            isEscalated,
          },
          severity: 'WARNING',
        });
      } else {
        await prisma.user.update({
          where: { id: userId },
          data: { loginAttempts: newAttempts },
        });
      }

      await this.recordFailedLogin(req);
    }
  }

  /**
   * Detect suspicious login based on geographic inconsistencies
   */
  async detectSuspiciousLogin(userId: string, ipAddress: string): Promise<boolean> {
    // Get the user's previous login locations
    const previousLogins = await prisma.securityLog.findMany({
      where: {
        userId,
        action: 'LOGIN_SUCCESS',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // If no previous logins, not suspicious
    if (previousLogins.length < 2) return false;

    // In production, use geo-IP lookup to compare locations
    // For now, check if IP addresses are significantly different
    const previousIPs = new Set(previousLogins.map(l => l.ipAddress));
    
    // If this IP hasn't been seen before in recent logins
    if (!previousIPs.has(ipAddress) && previousIPs.size >= 3) {
      auditLog.log({
        userId,
        action: 'SUSPICIOUS_LOGIN',
        ipAddress,
        metadata: {
          previousIPs: Array.from(previousIPs),
          reason: 'New IP address from unknown location',
        },
        severity: 'WARNING',
      });
      return true;
    }

    return false;
  }

  /**
   * Middleware to protect routes from bots
   */
  middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!config.botProtection.enabled) {
      return next();
    }

    try {
      // Check IP reputation
      const ipCheck = await this.checkIPReputation(req);
      if (ipCheck.isBlocked) {
        if (process.env.NODE_ENV === 'development') {
          console.info('[Auth] Request blocked by IP reputation', { ipAddress: req.ip, path: req.path });
        }
        res.status(403).json({
          error: 'Request blocked',
          message: 'This network is temporarily blocked due to repeated suspicious activity. Please try again later.',
        });
        return;
      }

      // Analyze device fingerprint
      const deviceCheck = await this.analyzeDeviceFingerprint(req);

      // If highly suspicious, require additional verification
      if (deviceCheck.isSuspicious && config.botProtection.captchaEnabled) {
        // In production, this would trigger a CAPTCHA challenge
        res.setHeader('X-CAPTCHA-Required', 'true');
      }

      // Attach fingerprint to request for downstream use
      (req as any).deviceFingerprint = deviceCheck.fingerprint;
      (req as any).trustScore = deviceCheck.trustScore;

      next();
    } catch (error) {
      // Fail open - allow request if bot protection has issues
      console.error('Bot protection error:', error);
      next();
    }
  };

  /**
   * Record IP reputation for legitimate actions
   */
  async recordLegitimateActivity(ipAddress: string): Promise<void> {
    try {
      await prisma.iPReputation.upsert({
        where: { ipAddress },
        update: {
          riskScore: { decrement: 0.05 },
          lastActivity: new Date(),
        },
        create: {
          ipAddress,
          riskScore: 0,
          requestCount: 1,
        },
      });
    } catch (error) {
      // Non-critical - don't fail the request
      console.warn('Failed to record legitimate activity:', error);
    }
  }
}

export const botProtection = new BotProtection();