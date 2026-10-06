/**
 * Canonical authentication middleware tests (Phase 1).
 *
 * Proves protected endpoints reject: anonymous requests, revoked sessions,
 * expired sessions, session/token mismatches and suspended/banned accounts.
 * Also proves the legacy `authenticateJWT` identifiers are the canonical
 * `authenticate` (single auth path), so no route can silently bypass checks.
 */
import { authenticate, optionalAuth } from '../security/authMiddleware';
import { authenticateJWT, optionallyAuthenticateJWT } from '../middleware/auth.middleware';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { describe, expect, test, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => {
  const mock = {
    session: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  return { prisma: mock };
});

jest.mock('../security/config', () => ({
  config: {
    jwt: { accessToken: { secret: () => process.env.JWT_SECRET || 'test-secret', expiresIn: '15m' } },
    auth: { requireEmailVerification: false },
  },
}));

jest.mock('../security/auditLog', () => ({
  auditLog: { log: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../security/botProtection', () => ({
  botProtection: { checkAccountBruteForce: jest.fn() },
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
  TokenExpiredError: class extends Error {},
  JsonWebTokenError: class extends Error {},
}));

function mockReq() {
  return {
    headers: {},
    ip: '127.0.0.1',
    path: '/protected',
    method: 'GET',
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const activeSession = {
  id: 'sess1',
  userId: 'user1',
  token: 'valid.access.token',
  expiresAt: new Date(Date.now() + 60_000),
};
const activeUser = { id: 'user1', status: 'ACTIVE', role: 'USER' };

beforeEach(() => {
  jest.clearAllMocks();
  (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user1', sessionId: 'sess1', role: 'USER', type: 'access' });
  (prisma.session.findUnique as jest.Mock).mockResolvedValue(activeSession);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(activeUser);
});

describe('canonical authenticate', () => {
  test('rejects a request with no bearer token', async () => {
    const req = mockReq();
    const res = mockRes();
    await authenticate(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
  });

  test('rejects a revoked session (session row gone)', async () => {
    (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);
    const req = mockReq();
    req.headers.authorization = 'Bearer revoked.token';
    const res = mockRes();
    await authenticate(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects an expired session and deletes it', async () => {
    (prisma.session.findUnique as jest.Mock).mockResolvedValue({
      ...activeSession,
      expiresAt: new Date(Date.now() - 1),
    });
    const req = mockReq();
    req.headers.authorization = 'Bearer expired.token';
    const res = mockRes();
    await authenticate(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Session expired' }));
    expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: 'sess1' } });
  });

  test('rejects a token whose sessionId does not match the session row', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user1', sessionId: 'OTHER-SESSION', type: 'access' });
    const req = mockReq();
    req.headers.authorization = 'Bearer swapped.token';
    const res = mockRes();
    await authenticate(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects a suspended/banned account with 403', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...activeUser, status: 'SUSPENDED' });
    const req = mockReq();
    req.headers.authorization = 'Bearer suspended.token';
    const res = mockRes();
    await authenticate(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Account suspended' }));
  });

  test('accepts a valid session and attaches the user', async () => {
    const req = mockReq();
    req.headers.authorization = 'Bearer valid.token';
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({ userId: 'user1', sessionId: 'sess1' }));
  });
});

describe('canonical auth union (one code path)', () => {
  test('authenticateJWT IS the canonical authenticate', () => {
    expect(authenticateJWT).toBe(authenticate);
    expect(optionallyAuthenticateJWT).toBe(optionalAuth);
  });

  test('optionalAuth passes through anonymously for missing credentials', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();
    await optionalAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});