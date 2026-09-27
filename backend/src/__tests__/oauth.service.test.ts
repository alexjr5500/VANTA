import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { jest, beforeAll, afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import { OAuthError } from '../services/oauth.service';
import type { OAuthProvider } from '../services/oauth.service';
import { prisma } from '../prisma';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    providerAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    securityLog: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    rateLimit: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    oAuthState: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

prisma.$transaction = jest.fn().mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));

jest.mock('../services/welcome-reward.service', () => ({
  welcomeRewardService: { claimWelcomeReward: jest.fn().mockResolvedValue({}) },
}));

// The full security module keeps a csrf token-cleanup setInterval alive, which
// would prevent Jest from exiting; mock the small surface oauth.service uses.
jest.mock('../security', () => ({
  config: { jwt: { accessToken: { expiresIn: '7d' } } },
  SecurityValidator: {
    isValidUsername: (value: string) => /^[a-zA-Z0-9_-]{3,30}$/.test(value),
    sanitizeText: (value: string) => value.replace(/<[^>]*>/g, '').trim(),
  },
  sessionManager: {
    generateTokenPair: jest.fn(() => ({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 })),
    createSession: jest.fn(async (_userId: string, accessToken: string, refreshToken: string, userAgent?: string, ipAddress?: string, deviceFingerprint?: string) => ({
      id: 'session-1', userId: _userId, token: accessToken, refreshToken, userAgent, ipAddress, deviceFingerprint,
    })),
  },
  auditLog: { log: jest.fn().mockResolvedValue(undefined) },
}));

// ---------------------------------------------------------------------------
// Test key material (real RS256 signing so verification is genuine)
// ---------------------------------------------------------------------------

const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const privateJwk = (crypto.createPrivateKey(privateKeyPem).export as (options: { format: string }) => unknown)({ format: 'jwk' }) as { kty: string; n: string; e: string };
const publicJwk = { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e, kid: 'test-key' };

const mockFetchJson = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
});

const signGoogleIdToken = (overrides: Record<string, unknown> = {}, expiresIn = 3600) => {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: 'https://accounts.google.com', aud: 'test-google-client', sub: 'google-sub-123', email: 'google@example.com', email_verified: true, name: 'Google User', exp: now + expiresIn, iat: now },
    privateKeyPem,
    { algorithm: 'RS256' }
  );
};

const signTelegramIdToken = (overrides: Record<string, unknown> = {}, expiresIn = 3600) => {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: 'https://oauth.telegram.org', aud: 'test-telegram-bot', sub: '123456789', name: 'Tele User', preferred_username: 'teluser', exp: now + expiresIn, iat: now },
    privateKeyPem,
    { algorithm: 'RS256' }
  );
};

const requestLike = () => ({
  headers: { 'user-agent': 'unit-test' },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  deviceFingerprint: 'fp',
});

const mockUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'google@example.com',
  username: 'googleuser',
  fullName: 'Google User',
  role: 'USER',
  status: 'ACTIVE',
  verified: false,
  emailVerified: false,
  premium: false,
  twoFactorEnabled: false,
  coins: 0,
  earnings: 0,
  createdAt: new Date('2024-01-01'),
  avatar: null,
  profile: { id: 'p1', avatarUrl: null },
  wallet: { coinBalance: 0, earningsBalance: 0 },
  userSettings: { privacyMessages: null },
  notificationPrefs: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.JWT_SECRET = 'unit-test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'unit-test-jwt-refresh';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:5000/api/auth/oauth/callback/google';
  process.env.TELEGRAM_BOT_ID = 'test-telegram-bot';
  process.env.TELEGRAM_BOT_SECRET = 'test-telegram-secret';
  process.env.TELEGRAM_OAUTH_REDIRECT_URI = 'http://localhost:5000/api/auth/oauth/callback/telegram';
  process.env.BACKEND_PUBLIC_URL = 'http://localhost:5000';
  process.env.FRONTEND_URL = 'http://localhost:3000';
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.JWT_REFRESH_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  delete process.env.TELEGRAM_BOT_ID;
  delete process.env.TELEGRAM_BOT_SECRET;
  delete process.env.TELEGRAM_OAUTH_REDIRECT_URI;
  delete process.env.BACKEND_PUBLIC_URL;
  delete process.env.FRONTEND_URL;
});

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn().mockResolvedValue(mockFetchJson({ keys: [publicJwk] }));
  (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session-1' });
  (prisma.session.update as jest.Mock).mockResolvedValue({ id: 'session-1' });
  (prisma.securityLog.create as jest.Mock).mockResolvedValue({});
  (prisma.providerAccount.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser());
  (prisma.user.create as jest.Mock).mockResolvedValue(mockUser());
  (prisma.user.update as jest.Mock).mockResolvedValue(mockUser());
  const futureExpiry = new Date(Date.now() + 300_000);
  (prisma.oAuthState.create as jest.Mock).mockImplementation(async (args: any) => ({
    ...args.data,
    createdAt: new Date(),
    consumedAt: null,
  }));
  (prisma.oAuthState.findUnique as jest.Mock).mockResolvedValue({
    id: 'A1b2C3d4E5f6G7h8I9j0K1',
    provider: 'google',
    nonce: 'nonce-1',
    redirect: '/reels',
    codeVerifier: null,
    linkingUserId: null,
    createdAt: new Date(),
    expiresAt: futureExpiry,
    consumedAt: null,
  });
  (prisma.oAuthState.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.oAuthState.delete as jest.Mock).mockResolvedValue({});
  (prisma.oAuthState.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
});
describe('OAuth service', () => {
  describe('verifyProviderIdToken (Google)', () => {
    test('accepts a token properly signed with the provider JWKS key and matching claims', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      const claims = await verifyProviderIdToken('google', signGoogleIdToken(), 'test-google-client', undefined);
      expect(claims.sub).toBe('google-sub-123');
      expect(claims.email).toBe('google@example.com');
    });

    test('rejects a token with the wrong audience', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      await expect(verifyProviderIdToken('google', signGoogleIdToken(), 'some-other-client', undefined))
        .rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects an expired token', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      const expired = jwt.sign(
        { iss: 'https://accounts.google.com', aud: 'test-google-client', sub: 'x', exp: Math.floor(Date.now() / 1000) - 3600 },
        privateKeyPem,
        { algorithm: 'RS256' }
      );
      await expect(verifyProviderIdToken('google', expired, 'test-google-client', undefined))
        .rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects a tampered token', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      const [header, , signature] = signGoogleIdToken().split('.');
      const forgedPayload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'test-google-client', sub: 'forged', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const tampered = `${header}.${forgedPayload}.${signature}`;
      await expect(verifyProviderIdToken('google', tampered, 'test-google-client', undefined))
        .rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects an HS256 token (algorithm confusion defence)', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      const hmacToken = jwt.sign(
        { iss: 'https://accounts.google.com', aud: 'test-google-client', sub: 'x', exp: Math.floor(Date.now() / 1000) + 3600 },
        'some-hmac-secret',
        { algorithm: 'HS256' }
      );
      await expect(verifyProviderIdToken('google', hmacToken, 'test-google-client', undefined))
        .rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects a token signed by a different key (wrong JWKS)', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      const otherPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const otherPem = otherPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const token = jwt.sign({ iss: 'https://accounts.google.com', aud: 'test-google-client', sub: 'x', exp: Math.floor(Date.now() / 1000) + 3600 }, otherPem, { algorithm: 'RS256' });
      await expect(verifyProviderIdToken('google', token, 'test-google-client', undefined))
        .rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects garbage that is not a JWT', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      await expect(verifyProviderIdToken('google', 'not-a-jwt', 'test-google-client', undefined))
        .rejects.toBeInstanceOf(OAuthError);
    });
  });

  describe('verifyProviderIdToken (Telegram)', () => {
    test('accepts a valid Telegram OIDC ID token', async () => {
      const { verifyProviderIdToken } = await import('../services/oauth.service');
      const claims = await verifyProviderIdToken('telegram', signTelegramIdToken(), 'test-telegram-bot', undefined);
      expect(claims.sub).toBe('123456789');
      expect(claims.preferred_username).toBe('teluser');
    });
  });
describe('safeFrontendPath', () => {
    test('allows only same-app absolute paths', async () => {
      const { safeFrontendPath } = await import('../services/oauth.service');
      expect(safeFrontendPath('/reels')).toBe('/reels');
      expect(safeFrontendPath('//evil.io')).toBe('/reels');
      expect(safeFrontendPath('https://evil.io')).toBe('/reels');
      expect(safeFrontendPath('/reels\\evil')).toBe('/reels');
      expect(safeFrontendPath('')).toBe('/reels');
      expect(safeFrontendPath(undefined)).toBe('/reels');
    });
  });

  describe('buildAuthorizeRequest', () => {
    test('builds a Google authorize URL with state + nonce and no secret', async () => {
      const { buildAuthorizeRequest } = await import('../services/oauth.service');
      const { authorizeUrl } = await buildAuthorizeRequest('google', '/reels');
      expect(authorizeUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(authorizeUrl).toContain('client_id=test-google-client');
      expect(authorizeUrl).toContain('response_type=code');
      expect(authorizeUrl).toContain('scope=openid+email+profile');
      expect(authorizeUrl).toContain('state=');
      expect(authorizeUrl).toContain('nonce=');
      expect(authorizeUrl).not.toContain('test-google-secret');
    });

    test('builds a Telegram authorize URL with PKCE S256', async () => {
      const { buildAuthorizeRequest } = await import('../services/oauth.service');
      const { authorizeUrl } = await buildAuthorizeRequest('telegram', '/reels');
      expect(authorizeUrl).toContain('https://oauth.telegram.org/auth');
      expect(authorizeUrl).toContain('client_id=test-telegram-bot');
      expect(authorizeUrl).toContain('code_challenge=');
      expect(authorizeUrl).toContain('code_challenge_method=S256');
      expect(authorizeUrl).toContain('scope=openid+profile+phone');
      expect(authorizeUrl).not.toContain('test-telegram-secret');
    });

    test('falls back to the safe destination for an unsafe redirect', async () => {
      const { buildAuthorizeRequest, verifyOAuthState } = await import('../services/oauth.service');
      const { state } = await buildAuthorizeRequest('google', 'https://evil.io');
      const decoded = await verifyOAuthState(state, 'google');
      expect(decoded.redirect).toBe('/reels');
    });
  });
describe('OAuth state (server-side short state)', () => {
    test('issues a short opaque state id (well under Telegram limits) and stores the payload server-side', async () => {
      const { issueOAuthState } = await import('../services/oauth.service');
      const state = await issueOAuthState({
        nonce: 'nonce-1',
        provider: 'telegram' as OAuthProvider,
        redirect: '/reels',
        codeVerifier: 'abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNO',
      });
      expect(typeof state).toBe('string');
      // Telegram rejects long `state` values; the id must stay short.
      expect(state.length).toBeGreaterThanOrEqual(16);
      expect(state.length).toBeLessThanOrEqual(32);
      expect((prisma.oAuthState.create as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          provider: 'telegram',
          nonce: 'nonce-1',
          redirect: '/reels',
          codeVerifier: 'abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNO',
          expiresAt: expect.any(Date),
        }),
      }));
    });

    test('returns the stored payload for a valid state (existence/provider/expiry pass)', async () => {
      const { verifyOAuthState } = await import('../services/oauth.service');
      const decoded = await verifyOAuthState('A1b2C3d4E5f6G7h8I9j0K1', 'google' as OAuthProvider);
      expect(decoded.type).toBe('oauth-state');
      expect(decoded.nonce).toBe('nonce-1');
      expect(decoded.redirect).toBe('/reels');
      // Single-use: the row was marked consumed.
      expect(prisma.oAuthState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'A1b2C3d4E5f6G7h8I9j0K1', consumedAt: null }),
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }));
    });

    test('rejects a missing state record', async () => {
      const { verifyOAuthState } = await import('../services/oauth.service');
      (prisma.oAuthState.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(verifyOAuthState('A1b2C3d4E5f6G7h8I9j0K1', 'google' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects a malformed / oversized state value before touching the database', async () => {
      const { verifyOAuthState } = await import('../services/oauth.service');
      await expect(verifyOAuthState('', 'google' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
      await expect(verifyOAuthState('x'.repeat(65), 'google' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
      await expect(verifyOAuthState(undefined, 'google' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects a state issued for a different provider', async () => {
      const { verifyOAuthState } = await import('../services/oauth.service');
      await expect(verifyOAuthState('A1b2C3d4E5f6G7h8I9j0K1', 'telegram' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects an expired state and deletes the stale record', async () => {
      const { verifyOAuthState } = await import('../services/oauth.service');
      (prisma.oAuthState.findUnique as jest.Mock).mockResolvedValue({
        id: 'A1b2C3d4E5f6G7h8I9j0K1',
        provider: 'google',
        nonce: 'nonce-1',
        redirect: '/reels',
        codeVerifier: null,
        linkingUserId: null,
        createdAt: new Date(Date.now() - 1_800_000),
        expiresAt: new Date(Date.now() - 60_000),
        consumedAt: null,
      });
      await expect(verifyOAuthState('A1b2C3d4E5f6G7h8I9j0K1', 'google' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
      expect(prisma.oAuthState.delete).toHaveBeenCalledWith({ where: { id: 'A1b2C3d4E5f6G7h8I9j0K1' } });
    });

    test('rejects a replayed (already-consumed) state via the atomic single-use gate', async () => {
      const { verifyOAuthState } = await import('../services/oauth.service');
      (prisma.oAuthState.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(verifyOAuthState('A1b2C3d4E5f6G7h8I9j0K1', 'google' as OAuthProvider)).rejects.toBeInstanceOf(OAuthError);
    });

    test('sweeps expired state records', async () => {
      const { sweepExpiredOAuthStates } = await import('../services/oauth.service');
      await sweepExpiredOAuthStates();
      expect(prisma.oAuthState.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } });
    });
  });
describe('production backend URL resolution', () => {
    const prodBackend = 'https://carefree-luck-production-8298.up.railway.app';
    const prodFrontend = 'https://vanta-nu.vercel.app';

    afterEach(() => {
      // Restore the suite-default dev environment for the tests that follow.
      process.env.NODE_ENV = 'development';
      process.env.BACKEND_PUBLIC_URL = 'http://localhost:5000';
      process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:5000/api/auth/oauth/callback/google';
      delete process.env.RAILWAY_STATIC_URL;
      delete process.env.RAILWAY_PUBLIC_DOMAIN;
    });

    test('production with no env vars resolves the Google callback to the Railway deployment URL (never localhost)', async () => {
      const { providerClientConfig, backendPublicBaseUrl, frontendBaseUrl } = await import('../services/oauth.service');
      process.env.NODE_ENV = 'production';
      delete process.env.BACKEND_PUBLIC_URL;
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
      expect(backendPublicBaseUrl()).toBe(prodBackend);
      expect(frontendBaseUrl()).toBe(prodFrontend);
      expect(providerClientConfig('google').redirectUri).toBe(`${prodBackend}/api/auth/oauth/callback/google`);
      expect(providerClientConfig('telegram').redirectUri).toBe(`${prodBackend}/api/auth/oauth/callback/telegram`);
      expect(providerClientConfig('google').redirectUri).not.toContain('localhost');
    });

    test('production ignores loopback GOOGLE_OAUTH_REDIRECT_URI / BACKEND_PUBLIC_URL leftovers', async () => {
      const { providerClientConfig, backendPublicBaseUrl } = await import('../services/oauth.service');
      process.env.NODE_ENV = 'production';
      process.env.BACKEND_PUBLIC_URL = 'http://localhost:5000';
      process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:5000/api/auth/oauth/callback/google';
      expect(backendPublicBaseUrl()).toBe(prodBackend);
      expect(providerClientConfig('google').redirectUri).toBe(`${prodBackend}/api/auth/oauth/callback/google`);
    });

    test('production prefers an explicitly configured non-loopback BACKEND_PUBLIC_URL', async () => {
      const { providerClientConfig } = await import('../services/oauth.service');
      process.env.NODE_ENV = 'production';
      process.env.BACKEND_PUBLIC_URL = 'https://api.van.ta';
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
      expect(providerClientConfig('google').redirectUri).toBe('https://api.van.ta/api/auth/oauth/callback/google');
    });

    test('production derives the callback from Railway-injected domain env vars', async () => {
      const { providerClientConfig } = await import('../services/oauth.service');
      process.env.NODE_ENV = 'production';
      delete process.env.BACKEND_PUBLIC_URL;
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
      process.env.RAILWAY_PUBLIC_DOMAIN = 'carefree-luck-production-8298.up.railway.app';
      expect(providerClientConfig('google').redirectUri).toBe(`${prodBackend}/api/auth/oauth/callback/google`);
    });

    test('local development keeps resolving to localhost when nothing else is configured', async () => {
      const { backendPublicBaseUrl, frontendBaseUrl } = await import('../services/oauth.service');
      process.env.NODE_ENV = 'development';
      delete process.env.BACKEND_PUBLIC_URL;
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
      delete process.env.RAILWAY_STATIC_URL;
      delete process.env.RAILWAY_PUBLIC_DOMAIN;
      expect(backendPublicBaseUrl()).toBe('http://localhost:5000');
      expect(frontendBaseUrl()).toBe('http://localhost:3000');
    });
  });
describe('handleProviderCallback', () => {
    const issueState = async () => {
      const { issueOAuthState } = await import('../services/oauth.service');
      return issueOAuthState({ nonce: 'nonce-1', provider: 'google' as OAuthProvider, redirect: '/reels', codeVerifier: undefined });
    };

    beforeEach(() => {
      // The token endpoint returns an ID token; the JWKS endpoint returns the key.
      globalThis.fetch = jest.fn()
        .mockResolvedValueOnce(mockFetchJson({ id_token: signGoogleIdToken() })) // token exchange
        .mockResolvedValueOnce(mockFetchJson({ keys: [publicJwk] }));           // JWKS verify
    });

    test('logs in an existing linked account and issues an exchange code (Case B)', async () => {
      const { handleProviderCallback } = await import('../services/oauth.service');
      (prisma.providerAccount.findUnique as jest.Mock).mockResolvedValue({ id: 'pa-1', userId: 'user-1', provider: 'google', providerAccountId: 'google-sub-123' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser());
      const result = await handleProviderCallback('google', 'auth-code', await issueState(), requestLike() as any);
      expect(result.kind).toBe('linked');
      expect(result.exchangeCode).toBeTruthy();
      const securityMock = await import('../security');
      expect((securityMock as any).sessionManager.createSession).toHaveBeenCalled();
    });

    test('returns a registration ticket for a new provider identity (Case A)', async () => {
      const { handleProviderCallback } = await import('../services/oauth.service');
      const result = await handleProviderCallback('google', 'auth-code', await issueState(), requestLike() as any);
      expect(result.kind).toBe('new');
      expect(result.registrationTicket).toBeTruthy();
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    test('refuses to auto-merge when the verified email already belongs to a VANTA account (Case E)', async () => {
      const { handleProviderCallback } = await import('../services/oauth.service');
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-user', email: 'google@example.com' });
      const result = await handleProviderCallback('google', 'auth-code', await issueState(), requestLike() as any);
      expect(result.kind).toBe('existing-account');
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.providerAccount.create).not.toHaveBeenCalled();
    });

    test('rejects an invalid/forged state (CSRF defence)', async () => {
      const { handleProviderCallback } = await import('../services/oauth.service');
      await expect(handleProviderCallback('google', 'auth-code', 'forged-state', requestLike() as any))
        .rejects.toBeInstanceOf(OAuthError);
    });
  });

  describe('redeemExchangeCode', () => {
    test('returns the token pair and marks the code used (single use)', async () => {
      const { redeemExchangeCode } = await import('../services/oauth.service');
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        token: 'access-token',
        refreshToken: 'refresh-token',
        oauthExchangeCode: 'exchange-code',
        oauthExchangeExpiresAt: new Date(Date.now() + 60_000),
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser());
      const result = await redeemExchangeCode('exchange-code', requestLike() as any);
      expect(result.token).toBe('access-token');
      expect(result.user.id).toBe('user-1');
      const updateCall = (prisma.session.update as jest.Mock).mock.calls[0];
      expect(updateCall[0].data.oauthExchangeCode).toBeNull();
    });

    test('rejects an expired exchange code', async () => {
      const { redeemExchangeCode, OAuthError: OAuthErrorRef } = await import('../services/oauth.service');
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        token: 'access-token',
        oauthExchangeCode: 'exchange-code',
        oauthExchangeExpiresAt: new Date(Date.now() - 60_000),
      });
      await expect(redeemExchangeCode('exchange-code', requestLike() as any)).rejects.toBeInstanceOf(OAuthErrorRef);
    });

    test('rejects a missing code', async () => {
      const { redeemExchangeCode } = await import('../services/oauth.service');
      await expect(redeemExchangeCode('', requestLike() as any)).rejects.toBeInstanceOf(OAuthError);
    });
  });
describe('completeOAuthRegistration', () => {
    const makeTicket = () => jwt.sign(
      {
        type: 'oauth-register',
        provider: 'google',
        providerAccountId: 'google-sub-123',
        email: 'google@example.com',
        emailVerified: true,
        name: 'Google User',
        redirect: '/reels',
      },
      'unit-test-jwt-secret',
      { expiresIn: '15m' }
    );

    test('creates a full VANTA account, links the provider, and issues a session', async () => {
      const { completeOAuthRegistration } = await import('../services/oauth.service');
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser());
      const result = await completeOAuthRegistration({ ticket: makeTicket(), username: '@GoogleUser' }, requestLike() as any);
      expect(result.user.username).toBe('googleuser');
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          email: 'google@example.com',
          username: 'googleuser',
          profile: expect.anything(),
          wallet: expect.anything(),
          userSettings: expect.anything(),
          notificationPrefs: expect.anything(),
        }),
      }));
      expect(prisma.providerAccount.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ provider: 'google', providerAccountId: 'google-sub-123', userId: 'user-1' }),
      }));
      expect(result.token).toBeTruthy();
    });

    test('rejects an invalid/expired ticket', async () => {
      const { completeOAuthRegistration } = await import('../services/oauth.service');
      await expect(completeOAuthRegistration({ ticket: 'garbage', username: 'user1' }, requestLike() as any))
        .rejects.toBeInstanceOf(OAuthError);
    });

    test('rejects a taken username (Case G-adjacent)', async () => {
      const { completeOAuthRegistration } = await import('../services/oauth.service');
      (prisma.user.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)                       // email check
        .mockResolvedValueOnce({ id: 'x', username: 'taken' }); // username check
      await expect(completeOAuthRegistration({ ticket: makeTicket(), username: 'taken' }, requestLike() as any))
        .rejects.toMatchObject({ code: 'username-taken' });
    });

    test('refuses to create an account when the verified email is already registered (Case E)', async () => {
      const { completeOAuthRegistration } = await import('../services/oauth.service');
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'existing', email: 'google@example.com' });
      await expect(completeOAuthRegistration({ ticket: makeTicket(), username: 'newuser' }, requestLike() as any))
        .rejects.toMatchObject({ code: 'email-taken' });
    });

    test('refuses to re-link a provider identity that already belongs to a VANTA account (Case G)', async () => {
      const { completeOAuthRegistration } = await import('../services/oauth.service');
      (prisma.providerAccount.findUnique as jest.Mock).mockResolvedValue({ id: 'pa-x', userId: 'other-user' });
      await expect(completeOAuthRegistration({ ticket: makeTicket(), username: 'newuser' }, requestLike() as any))
        .rejects.toMatchObject({ code: 'already-linked' });
    });

    test('does not create incomplete users: wallet/settings/prefs/profile are always created', async () => {
      const { completeOAuthRegistration } = await import('../services/oauth.service');
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser());
      const result = await completeOAuthRegistration({ ticket: makeTicket(), username: 'completeuser' }, requestLike() as any);
      expect(result.user).toBeTruthy();
      const calls = (prisma.user.create as jest.Mock).mock.calls;
      const createdData = calls[0][0]?.data ?? {};
      for (const relation of ['profile', 'wallet', 'userSettings', 'notificationPrefs']) {
        expect(createdData[relation]).toBeTruthy();
      }
    });
  });
});
