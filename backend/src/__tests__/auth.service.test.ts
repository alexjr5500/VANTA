import { AuthService } from '../services/auth.service';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { describe, expect, test, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';

// Mock the prisma client
jest.mock('../prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
  },
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt10'),
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn(),
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

  describe('forgotPassword', () => {
    test('should generate reset token for existing user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (jwt.sign as jest.Mock).mockReturnValue('reset_token');

      const result = await authService.forgotPassword('test@example.com');
      expect(result.message).toBe('Password reset link sent');
    });

    test('should not reveal if user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await authService.forgotPassword('nonexistent@example.com');
      expect(result.message).toBe('Password reset link sent');
    });
  });

  describe('resetPassword', () => {
    test('should reset password with valid token', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user1', type: 'password-reset' });
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);
      (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await authService.resetPassword('valid_token', 'newpassword123');
      expect(result.message).toBe('Password reset successfully');
    });

    test('should throw error for invalid token type', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user1', type: 'wrong-type' });

      await expect(
        authService.resetPassword('invalid_token', 'newpassword123')
      ).rejects.toThrow('Invalid or expired token');
    });

    test('should throw error for expired token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        authService.resetPassword('expired_token', 'newpassword123')
      ).rejects.toThrow('Invalid or expired token');
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

  describe('verifyPasswordResetToken', () => {
    test('should return true for valid password reset token', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ type: 'password-reset' });

      const result = await authService.verifyPasswordResetToken('valid_token');
      expect(result).toBe(true);
    });

    test('should return false for invalid token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid');
      });

      const result = await authService.verifyPasswordResetToken('invalid');
      expect(result).toBe(false);
    });

    test('should return false for non-reset token type', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ type: 'other' });

      const result = await authService.verifyPasswordResetToken('valid_token');
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