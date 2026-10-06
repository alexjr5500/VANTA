/**
 * Session Manager security tests — refresh-token rotation and reuse detection.
 *
 * Requirement (Phase 1): refresh tokens must rotate, and reuse of a
 * rotated-out token must be detectable and fail closed.
 */
import { sessionManager } from '../security/sessionManager';
import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import jwt from 'jsonwebtoken';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => ({
  prisma: {
    session: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('../security/config', () => ({
  config: {
    jwt: {
      accessToken: { secret: () => 'test-access-secret', expiresIn: '15m' },
      refreshToken: { secret: () => 'test-refresh-secret', expiresIn: '7d' },
      rememberMe: { expiresIn: '30d' },
    },
    session: { maxSessionsPerUser: 10, cleanupInterval: 3600000 },
  },
}));

jest.mock('../security/auditLog', () => ({
  auditLog: {
    log: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('rotated-jwt-token'),
  verify: jest.fn(),
}));

jest.mock('../security/crypto', () => ({
  CryptoUtils: { generateSecureToken: jest.fn().mockReturnValue('token') },
}));

beforeEach(() => {
  jest.clearAllMocks();
  (jwt.verify as jest.Mock).mockResolvedValue({});
  (prisma.session.update as jest.Mock).mockResolvedValue({ id: 'sess1' });
});

describe('SessionManager.refreshTokens', () => {
  test('rotates both tokens and persists the new pair', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 'user1',
      sessionId: 'sess1',
      type: 'refresh',
    });
    (prisma.session.findFirst as jest.Mock).mockResolvedValue({
      id: 'sess1',
      userId: 'user1',
      refreshToken: 'old-refresh-token',
      refreshExpiresAt: new Date(Date.now() + 60_000),
      user: { role: 'USER', status: 'ACTIVE' },
    });

    const result = await sessionManager.refreshTokens('old-refresh-token');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    // Rotation: the session row now carries the NEW tokens.
    const updateCall = (prisma.session.update as jest.Mock).mock.calls[0];
    expect(updateCall[0]).toEqual(expect.objectContaining({ where: { id: 'sess1' } }));
    expect(updateCall[0].data.token).toBe('rotated-jwt-token');
    expect(updateCall[0].data.refreshToken).toBe('rotated-jwt-token');
  });

  test('detects reuse of a rotated-out refresh token and severs the session', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 'user1',
      sessionId: 'sess1',
      type: 'refresh',
    });
    // The rotated-out token no longer matches any live session row.
    (prisma.session.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.session.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(sessionManager.refreshTokens('stolen-rotated-token')).rejects.toThrow('Invalid refresh token');

    // The referenced session is severed so the stale token can never refresh.
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess1', userId: 'user1' },
      data: { refreshToken: null },
    });
    // And the theft is audited.
    const auditCalls = (auditLog.log as jest.Mock).mock.calls;
    expect(auditCalls.some((c: any[]) => c[0].action === 'REFRESH_TOKEN_REUSE_DETECTED')).toBe(true);
  });

  test('rejects a wrong token type', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user1', type: 'access' });
    await expect(sessionManager.refreshTokens('access-token')).rejects.toThrow('Invalid refresh token');
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
  });
});