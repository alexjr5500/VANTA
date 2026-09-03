/**
 * Enterprise session management for VANTA.
 * Handles session lifecycle, refresh token rotation, device management,
 * and remember-me functionality.
 */
import { prisma } from '../prisma';
import { config } from './config';
import { CryptoUtils } from './crypto';
import { auditLog } from './auditLog';
import jwt from 'jsonwebtoken';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class SessionManager {
  /**
   * Generate an access token (short-lived)
   */
  generateAccessToken(userId: string, role: string, sessionId: string): string {
    return jwt.sign(
      { userId, role, sessionId, type: 'access' },
      config.jwt.accessToken.secret(),
      { expiresIn: config.jwt.accessToken.expiresIn as any }
    );
  }

  /**
   * Generate a refresh token (longer-lived, with rotation)
   */
  generateRefreshToken(userId: string, sessionId: string): string {
    return jwt.sign(
      { userId, sessionId, type: 'refresh' },
      config.jwt.refreshToken.secret(),
      { expiresIn: config.jwt.refreshToken.expiresIn as any }
    );
  }

  /**
   * Generate token pair for a new session
   */
  generateTokenPair(userId: string, role: string, sessionId: string): TokenPair {
    const accessToken = this.generateAccessToken(userId, role, sessionId);
    const refreshToken = this.generateRefreshToken(userId, sessionId);
    
    // Parse expiry from config
    const expiresInMatch = (config.jwt.accessToken.expiresIn as string).match(/^(\d+)([dhms])$/);
    let expiresIn = 900; // default 15 min in seconds
    
    if (expiresInMatch) {
      const value = parseInt(expiresInMatch[1]);
      const unit = expiresInMatch[2];
      switch (unit) {
        case 'd': expiresIn = value * 86400; break;
        case 'h': expiresIn = value * 3600; break;
        case 'm': expiresIn = value * 60; break;
        case 's': expiresIn = value; break;
      }
    }

    return { accessToken, refreshToken, expiresIn };
  }

  /**
   * Create a new session in the database
   */
  async createSession(
    userId: string,
    accessToken: string,
    refreshToken: string,
    userAgent?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
    isTrusted: boolean = false
  ): Promise<any> {
    const now = new Date();
    
    // Parse access token expiry
    const accessExpiryMatch = (config.jwt.accessToken.expiresIn as string).match(/^(\d+)([dhms])$/);
    let accessExpiryMs = 900000; // 15 min default
    if (accessExpiryMatch) {
      const value = parseInt(accessExpiryMatch[1]);
      const unit = accessExpiryMatch[2];
      switch (unit) {
        case 'd': accessExpiryMs = value * 86400000; break;
        case 'h': accessExpiryMs = value * 3600000; break;
        case 'm': accessExpiryMs = value * 60000; break;
        case 's': accessExpiryMs = value * 1000; break;
      }
    }

    // Parse refresh token expiry
    const refreshExpiryMatch = (config.jwt.refreshToken.expiresIn as string).match(/^(\d+)([dhms])$/);
    let refreshExpiryMs = 604800000; // 7 days default
    if (refreshExpiryMatch) {
      const value = parseInt(refreshExpiryMatch[1]);
      const unit = refreshExpiryMatch[2];
      switch (unit) {
        case 'd': refreshExpiryMs = value * 86400000; break;
        case 'h': refreshExpiryMs = value * 3600000; break;
        case 'm': refreshExpiryMs = value * 60000; break;
        case 's': refreshExpiryMs = value * 1000; break;
      }
    }

    // Check max sessions per user - enforce limit
    const sessionCount = await prisma.session.count({ where: { userId } });
    if (sessionCount >= config.session.maxSessionsPerUser) {
      // Remove oldest session
      const oldestSession = await prisma.session.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      if (oldestSession) {
        await prisma.session.delete({ where: { id: oldestSession.id } });
        auditLog.log({
          userId,
          action: 'SESSION_REMOVED_OLDEST',
          metadata: { reason: 'Max sessions reached' },
        });
      }
    }

    const session = await prisma.session.create({
      data: {
        userId,
        token: accessToken,
        refreshToken,
        deviceFingerprint: deviceFingerprint || null,
        isTrusted,
        expiresAt: new Date(now.getTime() + accessExpiryMs),
        refreshExpiresAt: new Date(now.getTime() + refreshExpiryMs),
        userAgent: userAgent || null,
        ipAddress: ipAddress || null,
        lastActiveAt: now,
      },
    });

    auditLog.log({
      userId,
      action: 'SESSION_CREATED',
      ipAddress,
      userAgent,
      metadata: { sessionId: session.id, isTrusted },
    });

    return session;
  }

  /**
   * Refresh token with rotation - invalidates old refresh token
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair & { userId: string }> {
    // Verify the refresh token
    const decoded = jwt.verify(refreshToken, config.jwt.refreshToken.secret()) as any;
    
    if (!decoded || decoded.type !== 'refresh') {
      throw new Error('Invalid refresh token');
    }

    // Find the session
    const session = await prisma.session.findFirst({
      where: { refreshToken, userId: decoded.userId },
      include: { user: { select: { role: true, status: true } } },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.refreshExpiresAt && session.refreshExpiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } });
      throw new Error('Refresh token expired');
    }

    if (session.user.status !== 'ACTIVE') {
      throw new Error('Account restricted');
    }

    // Generate new token pair (rotation)
    const newAccessToken = this.generateAccessToken(
      decoded.userId,
      session.user.role,
      session.id
    );
    const newRefreshToken = this.generateRefreshToken(decoded.userId, session.id);

    // Parse expiry for return value
    const expiresInMatch = (config.jwt.accessToken.expiresIn as string).match(/^(\d+)([dhms])$/);
    let expiresIn = 900;
    if (expiresInMatch) {
      const value = parseInt(expiresInMatch[1]);
      const unit = expiresInMatch[2];
      switch (unit) {
        case 'd': expiresIn = value * 86400; break;
        case 'h': expiresIn = value * 3600; break;
        case 'm': expiresIn = value * 60; break;
        case 's': expiresIn = value; break;
      }
    }

    // Update session with new tokens (rotation)
    const now = new Date();
    const accessExpiryMatch = (config.jwt.accessToken.expiresIn as string).match(/^(\d+)([dhms])$/);
    let accessExpiryMs = 900000;
    if (accessExpiryMatch) {
      const value = parseInt(accessExpiryMatch[1]);
      const unit = accessExpiryMatch[2];
      switch (unit) {
        case 'd': accessExpiryMs = value * 86400000; break;
        case 'h': accessExpiryMs = value * 3600000; break;
        case 'm': accessExpiryMs = value * 60000; break;
        case 's': accessExpiryMs = value * 1000; break;
      }
    }

    await prisma.session.update({
      where: { id: session.id },
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: new Date(now.getTime() + accessExpiryMs),
        lastActiveAt: now,
      },
    });

    auditLog.log({
      userId: decoded.userId,
      action: 'TOKEN_REFRESHED',
      metadata: { sessionId: session.id },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn,
      userId: decoded.userId,
    };
  }

  /**
   * Logout - invalidate specific session
   */
  async logout(userId: string, accessToken: string): Promise<void> {
    await prisma.session.deleteMany({
      where: { userId, token: accessToken },
    });

    auditLog.log({
      userId,
      action: 'LOGOUT',
      metadata: { method: 'token' },
    });
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId: string): Promise<void> {
    const count = await prisma.session.deleteMany({ where: { userId } });

    auditLog.log({
      userId,
      action: 'LOGOUT_ALL_DEVICES',
      metadata: { sessionsRevoked: count.count },
      severity: 'INFO',
    });
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string) {
    return prisma.session.findMany({
      where: {
        userId,
        OR: [
          { refreshExpiresAt: { gt: new Date() } },
          { refreshExpiresAt: null, expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        deviceFingerprint: true,
        isTrusted: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error('Session not found or unauthorized');
    }

    await prisma.session.delete({ where: { id: sessionId } });

    auditLog.log({
      userId,
      action: 'SESSION_REVOKED',
      metadata: { sessionId },
    });
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: {
        OR: [
          { refreshExpiresAt: { lt: new Date() } },
          { refreshExpiresAt: null, expiresAt: { lt: new Date() } },
        ],
      },
    });
    return result.count;
  }

  /**
   * Handle "Remember Me" - creates longer-lived session
   */
  async createRememberMeSession(
    userId: string,
    role: string,
    userAgent?: string,
    ipAddress?: string,
    deviceFingerprint?: string
  ): Promise<TokenPair> {
    const session = await prisma.session.create({
      data: {
        userId,
        token: '', // Will be updated
        userAgent: userAgent || null,
        ipAddress: ipAddress || null,
        deviceFingerprint: deviceFingerprint || null,
        isTrusted: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const rememberMeExpiry = config.jwt.rememberMe.expiresIn;
    const accessToken = jwt.sign(
      { userId, role, sessionId: session.id, type: 'access' },
      config.jwt.accessToken.secret(),
      { expiresIn: rememberMeExpiry as any }
    );
    const refreshToken = jwt.sign(
      { userId, sessionId: session.id, type: 'refresh' },
      config.jwt.refreshToken.secret(),
      { expiresIn: rememberMeExpiry as any }
    );
    const expiryMatch = rememberMeExpiry.match(/^(\d+)([dhms])$/);
    const expiryValue = expiryMatch ? Number(expiryMatch[1]) : 30;
    const expiryUnit = expiryMatch?.[2] || 'd';
    const multipliers: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
    const tokenPair: TokenPair = { accessToken, refreshToken, expiresIn: expiryValue * multipliers[expiryUnit] };
    
    await prisma.session.update({
      where: { id: session.id },
      data: {
        token: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
      },
    });

    auditLog.log({
      userId,
      action: 'REMEMBER_ME_SESSION_CREATED',
      ipAddress,
      userAgent,
      metadata: { sessionId: session.id },
    });

    return tokenPair;
  }

  /**
   * Devive-specific session management
   */
  async getSessionsByDevice(userId: string, deviceFingerprint: string) {
    return prisma.session.findMany({
      where: { userId, deviceFingerprint },
    });
  }
}

export const sessionManager = new SessionManager();