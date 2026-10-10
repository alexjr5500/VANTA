/**
 * VANTA-001 regression tests — password recovery / email verification.
 *
 * Before the fix, `/api/auth/forgot-password`, `/verify-reset-token`,
 * `/reset-password` and `/verify-email` were non-functional stubs: the reset
 * endpoints always reported success, `verify-reset-token` answered `{valid:
 * true}` for ANY input, and `verify-email` always claimed success without
 * changing state. This suite proves the real server-side token flow:
 *   - reset tokens are signed, expiring and type-bound;
 *   - invalid/expired/wrong-type tokens are rejected (fail closed);
 *   - a successful reset updates the password hash and revokes ALL sessions;
 *   - email verification requires a real, typed token to mark emailVerified.
 */
import { describe, expect, test, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

jest.mock('../prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    session: {
      deleteMany: jest.fn(),
    },
  },
}));

// Import AFTER the mock above is registered.
import { prisma } from '../prisma';
import { authService } from '../services/auth.service';

const JWT_SECRET = 'auth-recovery-test-secret';

describe('AuthService recovery flows (VANTA-001)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('forgotPassword does not disclose account existence', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const missing = await authService.forgotPassword('ghost@example.com');
    expect(missing.message).toBe('Password reset link sent');

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'x@example.com' });
    const existing = await authService.forgotPassword('x@example.com');
    expect(existing.message).toBe('Password reset link sent');
  });

  test('verifyPasswordResetToken accepts a genuine reset token', async () => {
    const token = jwt.sign(
      { userId: 'user-1', type: 'password-reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    expect(await authService.verifyPasswordResetToken(token)).toBe(true);
  });

  test('verifyPasswordResetToken rejects an ACCESS token', async () => {
    const accessToken = jwt.sign(
      { userId: 'user-1', type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    expect(await authService.verifyPasswordResetToken(accessToken)).toBe(false);
  });

  test('verifyPasswordResetToken rejects tampered and malformed tokens', async () => {
    expect(await authService.verifyPasswordResetToken('garbage.token.here')).toBe(false);
    const tampered = jwt.sign(
      { userId: 'user-1', type: 'password-reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    ).slice(0, -4);
    expect(await authService.verifyPasswordResetToken(tampered)).toBe(false);
  });

  test('resetPassword updates the hash and revokes every session', async () => {
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-1', passwordHash: 'new-hash' });
    (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 4 });

    const token = jwt.sign(
      { userId: 'user-1', type: 'password-reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const result = await authService.resetPassword(token, 'Str0ng!NewPass1');

    expect(result.message).toBe('Password reset successfully');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    );
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  test('resetPassword rejects a non-reset token WITHOUT touching the database', async () => {
    const accessToken = jwt.sign(
      { userId: 'user-1', type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    await expect(authService.resetPassword(accessToken, 'Str0ng!NewPass1'))
      .rejects.toThrow('Invalid or expired token');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  test('verifyEmailToken marks the account verified with a real email-verification token', async () => {
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const token = await authService.issueEmailVerificationToken('user-1');
    const verified = await authService.verifyEmailToken(token);
    expect(verified).toBe(true);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: true },
    });
  });

  test('verifyEmailToken fails closed on a wrong-type token (never claims success)', async () => {
    const accessToken = jwt.sign(
      { userId: 'user-1', type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const verified = await authService.verifyEmailToken(accessToken);
    expect(verified).toBe(false);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});