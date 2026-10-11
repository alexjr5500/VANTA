import { AuthService } from '../services/auth.service';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { emailService } from '../services/email.service';
import { describe, expect, test, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';

// Mock the prisma client
jest.mock('../prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    session: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    phoneOTP: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    profile: {
      create: jest.fn(),
    },
    wallet: {
      create: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    securityLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/email.service', () => ({
  emailService: {
    sendPasswordResetEmail: jest.fn(),
    sendPasswordChangedEmail: jest.fn(),
  },
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt10'),
  hash: jest.fn().mockResolvedValue('hashed_password'),
  // default: comparisons fail unless a test explicitly allows them — this
  // matches the new hashed-OTP verification semantics (a plaintext match on
  // `otpRecord.otp` short-circuits for legacy behavior parity).
  compare: jest.fn().mockResolvedValue(false),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock_token'),
  verify: jest.fn(),
  decode: jest.fn(),
}));

const authService = new AuthService();

describe('AuthService', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  const mockUser = {
    id: 'user1',
    email: 'test@example.com',
    username: 'testuser',
    fullName: 'Test User',
    passwordHash: 'hashed_password',
    phoneNumber: null,
    bio: null,
    avatar: null,
    verified: false,
    premium: false,
    status: 'ACTIVE',
    googleId: null,
    appleId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    profile: {
      id: 'profile1',
      userId: 'user1',
      username: 'testuser',
      fullName: 'Test User',
      avatarUrl: null,
      bio: null,
    },
    wallet: {
      id: 'wallet1',
      userId: 'user1',
      coinBalance: 0,
      earningsBalance: 0,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (jwt.sign as jest.Mock).mockReturnValue('mock_token');
  });

  describe('register', () => {
    test('should register a new user successfully', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

      const result = await authService.register('test@example.com', 'testuser', 'password123');

      expect(result.user).toEqual(mockUser);
      expect(result.token).toBe('mock_token');
      expect(result.refreshToken).toBe('mock_token');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            username: 'testuser',
          }),
        })
      );
    });

    test('should throw error on duplicate email or username', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        authService.register('test@example.com', 'testuser', 'password123')
      ).rejects.toThrow('Email or username already exists');
    });

    test('should throw error for empty email', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      // Simulate Prisma create rejection for missing required fields
      (prisma.user.create as jest.Mock).mockRejectedValue(new Error('Missing required fields'));

      await expect(
        authService.register('', 'newuser', 'password123')
      ).rejects.toThrow();
    });

    test('should register user without optional fullName', async () => {
      const userWithoutFullName = { ...mockUser, fullName: null };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(userWithoutFullName);

      const result = await authService.register('test@example.com', 'testuser', 'password123');
      expect(result.user.fullName).toBeNull();
    });
  });

  describe('login', () => {
    test('should login successfully with valid credentials', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.login('test@example.com', 'password123');

      expect(result.user).toEqual(mockUser);
      expect(result.token).toBe('mock_token');
      expect(result.refreshToken).toBe('mock_token');
    });

    test('should throw error for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        authService.login('nonexistent@example.com', 'password123')
      ).rejects.toThrow('User not found');
    });

    test('should throw error for invalid password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.login('test@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid password');
    });

    test('should include user agent and IP in session creation', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session1' });

      await authService.login('test@example.com', 'password123', 'Mozilla/5.0', '127.0.0.1');
      expect(prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userAgent: 'Mozilla/5.0',
            ipAddress: '127.0.0.1',
          }),
        })
      );
    });
  });

  describe('verifyToken', () => {
    test('should return decoded token for valid token', async () => {
      const decoded = { userId: 'user1', iat: 1234567890 };
      (jwt.verify as jest.Mock).mockReturnValue(decoded);

      const result = await authService.verifyToken('valid_token');
      expect(result).toEqual(decoded);
    });

    test('should throw error for invalid token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(
        authService.verifyToken('invalid_token')
      ).rejects.toThrow('Invalid token');
    });

    test('should throw error for expired token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        authService.verifyToken('expired_token')
      ).rejects.toThrow('Invalid token');
    });
  });

  describe('refreshAccessToken', () => {
    test('should generate new tokens for valid refresh token', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user1' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await authService.refreshAccessToken('valid_refresh_token');
      expect(result.token).toBe('mock_token');
      expect(result.refreshToken).toBe('mock_token');
    });

    test('should throw error for user not found after refresh', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'nonexistent' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        authService.refreshAccessToken('valid_refresh_token')
      ).rejects.toThrow('Invalid refresh token');
    });

    test('should throw error for invalid refresh token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(
        authService.refreshAccessToken('invalid_refresh_token')
      ).rejects.toThrow('Invalid refresh token');
    });
  });

  describe('logout', () => {
    test('should delete user sessions on logout', async () => {
      (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await authService.logout('user1', 'token_to_delete');
      expect(result.message).toBe('Logged out successfully');
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user1', token: 'token_to_delete' },
      });
    });
  });

  describe('session management', () => {
    test('should get user sessions', async () => {
      const mockSessions = [
        { id: 'session1', userAgent: 'Chrome', ipAddress: '127.0.0.1', createdAt: new Date(), expiresAt: new Date() },
      ];
      (prisma.session.findMany as jest.Mock).mockResolvedValue(mockSessions);

      const result = await authService.getUserSessions('user1');
      expect(result).toEqual(mockSessions);
    });

    test('should revoke specific session', async () => {
      const mockSession = { id: 'session1', userId: 'user1', token: 'token' };
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(mockSession);
      (prisma.session.delete as jest.Mock).mockResolvedValue(mockSession);

      const result = await authService.revokeSession('user1', 'session1');
      expect(result.message).toBe('Session revoked');
    });

    test('should throw error when revoking non-existent session', async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        authService.revokeSession('user1', 'nonexistent')
      ).rejects.toThrow('Session not found or unauthorized');
    });

    test('should revoke all sessions', async () => {
      (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await authService.revokeAllSessions('user1');
      expect(result.message).toBe('All sessions revoked');
    });
  });

  describe('forgotPassword (opaque DB-stored recovery tokens)', () => {
    beforeEach(() => {
      // Support the batch $transaction([...]) form used by forgotPassword: the
      // mocked model methods are already invoked, so the array holds promises.
      (prisma.$transaction as jest.Mock).mockImplementation(async (input: any) =>
        Array.isArray(input) ? Promise.all(input) : input(prisma)
      );
      (prisma.passwordResetToken.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.passwordResetToken.delete as jest.Mock).mockResolvedValue({ id: 'reset-1' });
      (prisma.passwordResetToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.passwordResetToken.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
        id: 'reset-1',
        ...data,
      }));
      (emailService.sendPasswordResetEmail as jest.Mock).mockResolvedValue({ delivered: true });
    });

    test('issues a SHA-256-hashed (never raw) token and delivers the recovery email', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await authService.forgotPassword('Test@Example.com');
      expect(result.message).toBe('Password reset link sent');

      // Only a 64-char hex SHA-256 hash is persisted — never the raw token.
      const createArgs = (prisma.passwordResetToken.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(createArgs.data.userId).toBe('user1');
      expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Outstanding tokens were superseded in the same transaction.
      expect(prisma.passwordResetToken.updateMany as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user1', usedAt: null } })
      );

      // The email received the raw token via the trusted-origin reset URL.
      const emailArgs = (emailService.sendPasswordResetEmail as jest.Mock).mock.calls[0][0];
      expect(emailArgs.to).toBe(mockUser.email);
      expect(emailArgs.resetUrl).toContain('/reset-password?token=');
    });

    test('returns the same message and skips delivery for unknown accounts', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await authService.forgotPassword('nonexistent@example.com');
      expect(result.message).toBe('Password reset link sent');
      expect(prisma.passwordResetToken.create as jest.Mock).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail as jest.Mock).not.toHaveBeenCalled();
    });

    test('invalidates the issued token when email delivery fails', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (emailService.sendPasswordResetEmail as jest.Mock).mockResolvedValue({
        delivered: false,
        transport: 'none',
        reason: 'not-configured',
      });

      const result = await authService.forgotPassword('test@example.com');
      // Still the generic response — delivery failure never discloses state.
      expect(result.message).toBe('Password reset link sent');
      // The undeliverable token was deleted so it cannot linger valid.
      expect(prisma.passwordResetToken.delete as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'reset-1' },
      });
    });
  });

  describe('resetPassword (single-use opaque tokens)', () => {
    const validRecord = {
      id: 'reset-token-1',
      userId: 'user1',
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
      attemptCount: 0,
      ipAddress: null,
      createdAt: new Date(),
    };

    beforeEach(() => {
      // Support the interactive $transaction(async (tx) => ...) form.
      (prisma.$transaction as jest.Mock).mockImplementation(async (input: any) => {
        if (typeof input === 'function') {
          return input({
            passwordResetToken: prisma.passwordResetToken,
            user: prisma.user,
            session: prisma.session,
          });
        }
        return Array.isArray(input) ? Promise.all(input) : input;
      });
      (prisma.passwordResetToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.passwordResetToken.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      (emailService.sendPasswordChangedEmail as jest.Mock).mockResolvedValue({ delivered: true });
    });

    test('updates the password hash and revokes all sessions with a valid token', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(validRecord);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user1', email: 'test@example.com' });

      const result = await authService.resetPassword('a-valid-token-0123456789abcdef', 'NewStr0ng!Pass1');
      expect(result.message).toBe('Password reset successfully');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user1' } })
      );
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user1' } });
      // Confirmation email is only sent AFTER the transaction committed.
      expect(emailService.sendPasswordChangedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com', reset: true })
      );
    });

    test('rejects unknown / garbage tokens without touching the account', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        authService.resetPassword('unknown-token-0123456789abcdef', 'NewStr0ng!Pass1')
      ).rejects.toThrow('Invalid or expired token');
      expect(prisma.user.update as jest.Mock).not.toHaveBeenCalled();
      expect(prisma.session.deleteMany as jest.Mock).not.toHaveBeenCalled();
    });

    test('rejects previously used (consumed) tokens', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        ...validRecord,
        usedAt: new Date(),
      });

      await expect(
        authService.resetPassword('used-token-0123456789abcdef', 'NewStr0ng!Pass1')
      ).rejects.toThrow('Invalid or expired token');
      expect(prisma.user.update as jest.Mock).not.toHaveBeenCalled();
    });

    test('rejects expired tokens', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        ...validRecord,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        authService.resetPassword('expired-token-0123456789abcdef', 'NewStr0ng!Pass1')
      ).rejects.toThrow('Invalid or expired token');
      expect(prisma.user.update as jest.Mock).not.toHaveBeenCalled();
    });

    test('rejects concurrent consumption when the token is already claimed (count=0)', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(validRecord);
      // Simulates a race: another request consumed the token first.
      (prisma.passwordResetToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        authService.resetPassword('race-token-0123456789abcdef', 'NewStr0ng!Pass1')
      ).rejects.toThrow('Invalid or expired token');
      expect(prisma.user.update as jest.Mock).not.toHaveBeenCalled();
      expect(prisma.session.deleteMany as jest.Mock).not.toHaveBeenCalled();
    });

    test('stores only a bcrypt hash of the new password (never plaintext)', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(validRecord);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user1', email: 'test@example.com' });

      await authService.resetPassword('hash-check-token-0123456789ab', 'NewStr0ng!Pass1');

      const updateArgs = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateArgs.data.passwordHash).toBe('hashed_password');
      expect(updateArgs.data.passwordHash).not.toBe('NewStr0ng!Pass1');
    });
  });

  describe('phone OTP', () => {
    test('should send OTP successfully', async () => {
      (prisma.phoneOTP.create as jest.Mock).mockResolvedValue({
        id: 'otp1',
        phoneNumber: '+1234567890',
        otp: '123456',
        expiresAt: new Date(Date.now() + 600000),
        attempts: 0,
      });

      const result = await authService.sendPhoneOTP('+1234567890', '127.0.0.1');
      expect(result.message).toBe('OTP sent successfully');
      expect(result.expiresIn).toBe(600);
    });

    test('should verify valid OTP', async () => {
      const mockOTP = {
        id: 'otp1',
        phoneNumber: '+1234567890',
        otp: '123456',
        expiresAt: new Date(Date.now() + 600000),
        attempts: 0,
      };
      (prisma.phoneOTP.findFirst as jest.Mock).mockResolvedValue(mockOTP);
      (prisma.phoneOTP.delete as jest.Mock).mockResolvedValue(mockOTP);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session1' });

      const result = await authService.verifyPhoneOTP('+1234567890', '123456');
      expect(result.user).toBeDefined();
      expect(result.token).toBe('mock_token');
    });

    test('should throw error for expired OTP', async () => {
      const expiredOTP = {
        id: 'otp1',
        phoneNumber: '+1234567890',
        otp: '123456',
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      };
      (prisma.phoneOTP.findFirst as jest.Mock).mockResolvedValue(expiredOTP);

      await expect(
        authService.verifyPhoneOTP('+1234567890', '123456')
      ).rejects.toThrow('OTP has expired');
    });

    test('should throw error after too many failed attempts', async () => {
      const blockedOTP = {
        id: 'otp1',
        phoneNumber: '+1234567890',
        otp: '123456',
        expiresAt: new Date(Date.now() + 600000),
        attempts: 3,
      };
      (prisma.phoneOTP.findFirst as jest.Mock).mockResolvedValue(blockedOTP);

      await expect(
        authService.verifyPhoneOTP('+1234567890', '000000')
      ).rejects.toThrow('Too many failed attempts');
    });

    test('should throw error for invalid OTP', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false); // explicit: never inherited from earlier login tests
      const mockOTP = {
        id: 'otp1',
        phoneNumber: '+1234567890',
        otp: '123456',
        expiresAt: new Date(Date.now() + 600000),
        attempts: 0,
      };
      (prisma.phoneOTP.findFirst as jest.Mock).mockResolvedValue(mockOTP);
      (prisma.phoneOTP.update as jest.Mock).mockResolvedValue({ ...mockOTP, attempts: 1 });

      await expect(
        authService.verifyPhoneOTP('+1234567890', '000000')
      ).rejects.toThrow('Invalid OTP');
    });
  });

  describe('Google Auth', () => {
    test('should authenticate existing user via Google', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ sub: 'google123', email: 'google@example.com', name: 'Google User' });
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session1' });

      const result = await authService.googleAuth('google_id_token');
      expect(result.isNewUser).toBe(false);
      expect(result.user).toEqual(mockUser);
    });

    test('should create new user via Google', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ sub: 'newgoogle123', email: 'newgoogle@example.com', name: 'New User' });
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session1' });

      const result = await authService.googleAuth('google_id_token');
      expect(result.isNewUser).toBe(true);
    });

    test('should throw error with invalid Google token', async () => {
      (jwt.decode as jest.Mock).mockReturnValue(null);

      await expect(
        authService.googleAuth('invalid_token')
      ).rejects.toThrow('Could not extract email from Google token');
    });
  });

  describe('Apple Auth', () => {
    test('should authenticate existing user via Apple', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ sub: 'apple123', email: 'apple@example.com', name: 'Apple User' });
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session1' });

      const result = await authService.appleAuth('apple_id_token', 'apple_user_001');
      expect(result.isNewUser).toBe(false);
    });

    test('should create new user via Apple', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ sub: 'newapple123', email: 'newapple@example.com' });
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'session1' });

      const result = await authService.appleAuth('apple_id_token', 'apple_user_002');
      expect(result.isNewUser).toBe(true);
    });

    test('should throw error with invalid Apple token', async () => {
      (jwt.decode as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(
        authService.appleAuth('invalid', 'userid')
      ).rejects.toThrow('Invalid Apple token');
    });
  });

  describe('verifyPasswordResetToken (opaque DB tokens)', () => {
    const validRecord = {
      id: 'reset-token-1',
      userId: 'user1',
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
      attemptCount: 0,
      ipAddress: null,
      createdAt: new Date(),
    };

    test('returns true for a genuine, unexpired, unused token', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(validRecord);

      const result = await authService.verifyPasswordResetToken('a-genuine-token-0123456789abcdef');
      expect(result).toBe(true);
      // The lookup must be by HASH, never by raw token.
      const where = (prisma.passwordResetToken.findUnique as jest.Mock).mock.calls[0][0].where;
      expect(where.tokenHash).toBeDefined();
      expect(where.tokenHash).not.toBe('a-genuine-token-0123456789abcdef');
    });

    test('returns false for short/garbage tokens without a database lookup', async () => {
      const result = await authService.verifyPasswordResetToken('short');
      expect(result).toBe(false);
      expect(prisma.passwordResetToken.findUnique as jest.Mock).not.toHaveBeenCalled();
    });

    test('returns false for an unknown token', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await authService.verifyPasswordResetToken('unknown-token-0123456789abcdef');
      expect(result).toBe(false);
    });

    test('returns false for a consumed (used) token', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        ...validRecord,
        usedAt: new Date(),
      });

      const result = await authService.verifyPasswordResetToken('used-token-0123456789abcdef');
      expect(result).toBe(false);
    });

    test('returns false for an expired token', async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        ...validRecord,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await authService.verifyPasswordResetToken('expired-token-0123456789abcdef');
      expect(result).toBe(false);
    });
  });

  describe('getUserById', () => {
    test('should get user by ID', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await authService.getUserById('user1');
      expect(result).toEqual(mockUser);
    });

    test('should return null for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await authService.getUserById('nonexistent');
      expect(result).toBeNull();
    });
  });
});