/**
 * VANTA — Forgot/Reset Password: end-to-end security tests against the REAL
 * AuthService logic with realistic in-memory Prisma mocks.
 *
 * This suite models the PasswordResetToken table with an in-memory store so the
 * opaque-token flow is exercised exactly as it runs in production:
 *   - a cryptographically random token is generated and ONLY its SHA-256 hash
 *     is persisted (the raw token never touches the database);
 *   - the reset link is built from the TRUSTED app origin, never a Host header;
 *   - the token is single-use (atomic `updateMany ... where usedAt is null`);
 *   - issuing a new token supersedes outstanding ones;
 *   - a successful reset updates the bcrypt hash and revokes every session;
 *   - the response never discloses whether an account exists.
 */
import { describe, expect, test, jest, beforeAll, beforeEach } from '@jest/globals';
import crypto from 'crypto';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

type StoredToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
  ipAddress: string | null;
  createdAt: Date;
};

let tokenStore: StoredToken[];
let userStore: Array<{ id: string; email: string | null; passwordHash: string }>;
let sessionDeleteManyCalls: Array<{ userId: string }>;
let userUpdateCalls: Array<{ where: { id: string }; data: { passwordHash: string } }>;
let passwordResetEmails: Array<{ to: string; resetUrl: string; expiresInMinutes: number }>;
let passwordChangedEmails: Array<{ to: string; reset: boolean }>;
let emailDeliveryShouldFail = false;
let tokenSeq = 0;

const ORIGIN = 'https://vanta.example.com';

jest.mock('../prisma', () => {
  const findTokenByHash = (tokenHash: string) => tokenStore.find((t) => t.tokenHash === tokenHash) || null;

  return {
    prisma: {
      user: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.email !== undefined) return Promise.resolve(userStore.find((u) => u.email === where.email) || null);
          if (where.id !== undefined) return Promise.resolve(userStore.find((u) => u.id === where.id) || null);
          return Promise.resolve(null);
        }),
        update: jest.fn(({ where, data }: any) => {
          userUpdateCalls.push({ where, data });
          const user = userStore.find((u) => u.id === where.id);
          if (!user) return Promise.reject(new Error('user not found'));
          user.passwordHash = data.passwordHash;
          return Promise.resolve({ id: user.id, passwordHash: user.passwordHash });
        }),
        updateMany: jest.fn(({ where, data }: any) => {
          const targets = userStore.filter((u) => u.id === where.id);
          targets.forEach((u) => Object.assign(u, data));
          return Promise.resolve({ count: targets.length });
        }),
      },
      session: {
        deleteMany: jest.fn(({ where }: any) => {
          sessionDeleteManyCalls.push({ userId: where.userId });
          return Promise.resolve({ count: 1 });
        }),
      },
      passwordResetToken: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(findTokenByHash(where.tokenHash))),
        create: jest.fn(({ data }: any) => {
          const row: StoredToken = {
            id: `prt-${++tokenSeq}`,
            userId: data.userId,
            tokenHash: data.tokenHash,
            expiresAt: data.expiresAt,
            usedAt: null,
            attemptCount: 0,
            ipAddress: data.ipAddress ?? null,
            createdAt: new Date(),
          };
          tokenStore.push(row);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn(({ where, data }: any) => {
          let count = 0;
          tokenStore.forEach((t) => {
            const matchesUser = !where.userId || t.userId === where.userId;
            const matchesUsed =
              where.usedAt === null ? t.usedAt === null :
              where.usedAt && where.usedAt.not === null ? t.usedAt !== null :
              true;
            if (matchesUser && matchesUsed) {
              if (data.usedAt instanceof Date) t.usedAt = data.usedAt;
              if (data.attemptCount && typeof data.attemptCount === 'object' && data.attemptCount.increment) {
                t.attemptCount += data.attemptCount.increment;
              }
              count += 1;
            }
          });
          return Promise.resolve({ count });
        }),
        deleteMany: jest.fn(({ where }: any) => {
          const before = tokenStore.length;
          tokenStore = tokenStore.filter((t) => {
            const isUser = !where.userId || t.userId === where.userId;
            if (!isUser) return true;
            const expired = where.expiresAt && where.expiresAt.lt && t.expiresAt < where.expiresAt.lt;
            const used = where.usedAt && where.usedAt.not === null ? t.usedAt !== null : false;
            return !(expired || used);
          });
          return Promise.resolve({ count: before - tokenStore.length });
        }),
        delete: jest.fn(({ where }: any) => {
          const idx = tokenStore.findIndex((t) => t.id === where.id);
          if (idx === -1) return Promise.reject(new Error('not found'));
          const [row] = tokenStore.splice(idx, 1);
          return Promise.resolve(row);
        }),
      },
      $transaction: jest.fn((input: any) => {
        if (Array.isArray(input)) {
          // Batch form: an array of already-invoked query Promises
          // (prisma.x.updateMany(...), prisma.x.create(...)). The mock
          // operations run eagerly when the array literal is built, so await
          // each promise directly (never call it as a function).
          return (async () => {
            const results: any[] = [];
            for (const op of input) results.push(await op);
            return results;
          })();
        }
        return Promise.resolve(input(prismaMock));
      }),
    },
  };
});

const prismaMock = (jest.requireMock('../prisma') as any).prisma;

import { authService } from '../services/auth.service';
import { emailService } from '../services/email.service';

/** Extract the raw token from the reset URL the email service received. */
const rawTokenFromLastEmail = (): string => {
  const url = passwordResetEmails[passwordResetEmails.length - 1].resetUrl;
  return decodeURIComponent(new URL(url).searchParams.get('token') as string);
};



// ---------------------------------------------------------------------------
// Email delivery is intercepted with jest.spyOn on the real emailService
// singleton (installed in beforeEach) so tests capture exactly what the auth
// service hands to delivery: the trusted-origin link, the single-use raw
// token, and the post-commit confirmation. Using spies (rather than a
// hoisted jest.mock factory) keeps the mutable capture arrays in scope.
// ---------------------------------------------------------------------------

describe('Forgot/Reset Password security (opaque single-use token flow)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_PUBLIC_URL = ORIGIN;
    process.env.JWT_SECRET = 'password-recovery-test-secret-value-32chars';
    process.env.JWT_REFRESH_SECRET = 'password-recovery-test-refresh-secret-32ch';
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.PASSWORD_RESET_SIMULATED_LATENCY_MS = '0';
  });

  beforeEach(() => {
    tokenStore = [];
    userStore = [
      { id: 'user-1', email: 'owner@vanta.example.com', passwordHash: 'OLD_HASH' },
      { id: 'user-2', email: 'other@vanta.example.com', passwordHash: 'OTHER_HASH' },
    ];
    sessionDeleteManyCalls = [];
    userUpdateCalls = [];
    passwordResetEmails = [];
    passwordChangedEmails = [];
    emailDeliveryShouldFail = false;
    tokenSeq = 0;

    jest.spyOn(emailService, 'sendPasswordResetEmail').mockImplementation((async (ctx: any) => {
      if (emailDeliveryShouldFail) return { delivered: false, transport: 'none', reason: 'provider-error' };
      passwordResetEmails.push({ to: ctx.to, resetUrl: ctx.resetUrl, expiresInMinutes: ctx.expiresInMinutes });
      return { delivered: true, transport: 'sendgrid' };
    }) as any);
    jest.spyOn(emailService, 'sendPasswordChangedEmail').mockImplementation((async (ctx: any) => {
      passwordChangedEmails.push({ to: ctx.to, reset: !!ctx.reset });
      return { delivered: true, transport: 'sendgrid' };
    }) as any);
  });


  // --- Forgot password -----------------------------------------------------

  test('a registered email triggers a reset email and stores only a HASH', async () => {
    await authService.forgotPassword('owner@vanta.example.com', '203.0.113.7');

    expect(passwordResetEmails).toHaveLength(1);
    expect(passwordResetEmails[0].to).toBe('owner@vanta.example.com');

    expect(tokenStore).toHaveLength(1);
    expect(tokenStore[0].userId).toBe('user-1');

    const rawToken = rawTokenFromLastEmail();
    expect(rawToken.length).toBeGreaterThanOrEqual(32);

    // The RAW token is delivered ONLY inside the email link, never persisted.
    expect(JSON.stringify(tokenStore)).not.toContain(rawToken);
    expect(tokenStore[0].tokenHash).toBe(sha256(rawToken));
  });

  test('the reset link is built from the TRUSTED origin, never a Host header', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const url = new URL(passwordResetEmails[0].resetUrl);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('token')).toBeTruthy();
  });

  test('an unregistered email yields the SAME generic response and no email/token', async () => {
    const result = await authService.forgotPassword('ghost@vanta.example.com', '203.0.113.9');
    expect(result).toEqual({ message: 'Password reset link sent' });
    expect(passwordResetEmails).toHaveLength(0);
    expect(tokenStore).toHaveLength(0);
    expect(userUpdateCalls).toHaveLength(0);
  });

  test('registered and unregistered requests return an identical public message', async () => {
    const registered = await authService.forgotPassword('owner@vanta.example.com');
    const unregistered = await authService.forgotPassword('ghost@vanta.example.com');
    expect(registered).toEqual(unregistered);
  });

  test('a second request supersedes the earlier outstanding token', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const first = rawTokenFromLastEmail();
    await authService.forgotPassword('owner@vanta.example.com');
    const second = rawTokenFromLastEmail();

    expect(first).not.toBe(second);
    expect(await authService.verifyPasswordResetToken(first)).toBe(false);
    expect(await authService.verifyPasswordResetToken(second)).toBe(true);
  });

  test('an email-delivery failure leaves NO outstanding recovery token', async () => {
    emailDeliveryShouldFail = true;
    const result = await authService.forgotPassword('owner@vanta.example.com');
    expect(result).toEqual({ message: 'Password reset link sent' });
    expect(tokenStore).toHaveLength(0);
  });

  // --- Token verification --------------------------------------------------

  test('verifyPasswordResetToken accepts a freshly issued token', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    expect(await authService.verifyPasswordResetToken(rawTokenFromLastEmail())).toBe(true);
  });

  test('verifyPasswordResetToken rejects unknown, empty and tampered tokens', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    expect(await authService.verifyPasswordResetToken('deadbeef'.repeat(8))).toBe(false);
    expect(await authService.verifyPasswordResetToken('')).toBe(false);
    const good = rawTokenFromLastEmail();
    const tampered = (good[0] === 'a' ? 'b' : 'a') + good.slice(1);
    expect(await authService.verifyPasswordResetToken(tampered)).toBe(false);
  });

  test('verifyPasswordResetToken rejects an expired token', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const raw = rawTokenFromLastEmail();
    tokenStore[0].expiresAt = new Date(Date.now() - 1000);
    expect(await authService.verifyPasswordResetToken(raw)).toBe(false);
  });


  // --- Reset password ------------------------------------------------------

  test('a valid token resets the password (bcrypt), revokes sessions, and consumes the token', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const raw = rawTokenFromLastEmail();

    const result = await authService.resetPassword(raw, 'N3w!Str0ngPass', '203.0.113.7');
    expect(result.message).toBe('Password reset successfully');

    const updated = userUpdateCalls.find((c) => c.where.id === 'user-1');
    expect(updated).toBeTruthy();
    expect(updated!.data.passwordHash).not.toBe('N3w!Str0ngPass');
    expect(updated!.data.passwordHash).not.toBe('OLD_HASH');
    expect(updated!.data.passwordHash.startsWith('$2')).toBe(true);

    expect(sessionDeleteManyCalls).toContainEqual({ userId: 'user-1' });

    expect(passwordChangedEmails).toHaveLength(1);
    expect(passwordChangedEmails[0]).toEqual({ to: 'owner@vanta.example.com', reset: true });

    // Single-use: cannot be replayed.
    expect(await authService.verifyPasswordResetToken(raw)).toBe(false);
    await expect(authService.resetPassword(raw, 'An0ther!Pass1')).rejects.toThrow('Invalid or expired token');
  });

  test('resetPassword rejects an invalid token without touching the account', async () => {
    await expect(authService.resetPassword('f'.repeat(64), 'N3w!Str0ngPass'))
      .rejects.toThrow('Invalid or expired token');
    expect(userUpdateCalls).toHaveLength(0);
    expect(sessionDeleteManyCalls).toHaveLength(0);
  });

  test('resetPassword rejects an expired token', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const raw = rawTokenFromLastEmail();
    tokenStore[0].expiresAt = new Date(Date.now() - 1000);
    await expect(authService.resetPassword(raw, 'N3w!Str0ngPass')).rejects.toThrow('Invalid or expired token');
    expect(userUpdateCalls).toHaveLength(0);
  });

  test('resetPassword rejects a superseded token after a newer request', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const stale = rawTokenFromLastEmail();
    await authService.forgotPassword('owner@vanta.example.com'); // supersedes `stale`
    await expect(authService.resetPassword(stale, 'N3w!Str0ngPass')).rejects.toThrow('Invalid or expired token');
    expect(userUpdateCalls).toHaveLength(0);
  });

  test('resetPassword does not disclose which account a token belongs to', async () => {
    await expect(authService.resetPassword('a'.repeat(64), 'x')).rejects.toThrow('Invalid or expired token');
    await expect(authService.resetPassword('b'.repeat(64), 'x')).rejects.toThrow('Invalid or expired token');
  });

  test('a token only ever resets the account it was issued to', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    await authService.resetPassword(rawTokenFromLastEmail(), 'N3w!Str0ngPass');
    expect(userUpdateCalls.every((c) => c.where.id === 'user-1')).toBe(true);
  });

  test('concurrent reset submissions cannot both consume the same token', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    const raw = rawTokenFromLastEmail();

    const results = await Promise.allSettled([
      authService.resetPassword(raw, 'F1rst!Winner1'),
      authService.resetPassword(raw, 'S3cond!Loser2'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(userUpdateCalls).toHaveLength(1);
  });

  test('a successful reset keeps a different account completely untouched', async () => {
    await authService.forgotPassword('owner@vanta.example.com');
    await authService.resetPassword(rawTokenFromLastEmail(), 'N3w!Str0ngPass');
    expect(userUpdateCalls.some((c) => c.where.id === 'user-2')).toBe(false);
    expect(userStore.find((u) => u.id === 'user-2')!.passwordHash).toBe('OTHER_HASH');
  });
});

