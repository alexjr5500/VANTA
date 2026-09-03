import { UserService } from '../services/user.service';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';

jest.mock('../prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    profile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    blockedUser: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    mutedUser: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    post: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    postComment: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    postLike: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    giftTransaction: {
      aggregate: jest.fn(),
    },
    liveStream: {
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    profileMedia: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    photo: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userSettings: {
      upsert: jest.fn(),
    },
    notificationPreferences: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    securityLog: {
      findMany: jest.fn(),
    },
    socialLink: {
      deleteMany: jest.fn(),
    },
    conversation: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// We need bcrypt to work properly for the changePassword test
// Mock bcrypt's async functions directly
(jest.mocked(bcrypt).compare as jest.Mock) = jest.fn();
(jest.mocked(bcrypt).genSalt as jest.Mock) = jest.fn();
(jest.mocked(bcrypt).hash as jest.Mock) = jest.fn();

const userService = new UserService();
const mockUser: any = {
  id: 'user1',
  username: 'testuser',
  fullName: 'Test User',
  email: 'test@example.com',
  passwordHash: 'hash',
  avatar: null,
  bio: null,
  verified: false,
  premium: false,
  status: 'ACTIVE',
  phoneNumber: null,
  age: null,
  gender: null,
  country: null,
  city: null,
  googleId: null,
  appleId: null,
  photos: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: {
    id: 'profile1',
    userId: 'user1',
    username: 'testuser',
    fullName: 'Test User',
    avatarUrl: null,
    bannerUrl: null,
    bio: null,
    website: null,
    country: null,
    city: null,
    interests: null,
    isOnline: false,
    socialLinks: [],
    media: [],
  },
  posts: [],
  followers: [],
  following: [],
  _count: { followers: 0, following: 0, posts: 0 },
};

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async callback => callback(prisma));
    (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.notification.create as jest.Mock).mockResolvedValue({ id: 'notification1' });
    (prisma.notification.count as jest.Mock).mockResolvedValue(1);
    (prisma.giftTransaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });
    (prisma.liveStream.aggregate as jest.Mock).mockResolvedValue({ _sum: { totalViewers: 0 } });
    (prisma.liveStream.count as jest.Mock).mockResolvedValue(0);
    (prisma.postLike.count as jest.Mock).mockResolvedValue(0);
    (prisma.postComment.count as jest.Mock).mockResolvedValue(0);
    // Set up default bcrypt mocks
    (bcrypt.compare as jest.Mock).mockResolvedValue(true as never);
    (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt' as never);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new_hash' as never);
  });

  describe('getUserProfile', () => {
    test('should return user profile for valid userId', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      const result = await userService.getUserProfile('user1');
      expect(result.id).toBe('user1');
      expect(result.username).toBe('testuser');
      expect(result.counts).toBeDefined();
    });

    test('should throw Error for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(userService.getUserProfile('nonexistent')).rejects.toThrow('User not found');
    });
  });

  describe('getPublicProfileByUsername', () => {
    test('should return public profile', async () => {
      const mockUserWithFollow = { ...mockUser, _count: { followers: 5, following: 3, posts: 2 } };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUserWithFollow);
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await userService.getPublicProfileByUsername('testuser', 'currentUser');
      expect(result.username).toBe('testuser');
      expect(result.isFollowing).toBe(false);
    });

    test('should throw Error if profile not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(userService.getPublicProfileByUsername('nonexistent')).rejects.toThrow('Profile not found');
    });
  });

  describe('updateProfile', () => {
    test('should update profile fields', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);
      (prisma.profile.upsert as jest.Mock).mockResolvedValue(mockUser.profile);

      const result = await userService.updateProfile('user1', { bio: 'New bio', city: 'New York' });
      expect(result).toBeDefined();
    });

    test('should throw for bio exceeding 260 chars', async () => {
      const longBio = 'x'.repeat(261);
      await expect(userService.updateProfile('user1', { bio: longBio })).rejects.toThrow('Bio must be 260 characters or less');
    });
  });

  describe('updateEmail', () => {
    test('should update email', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user1', email: 'new@example.com' });

      const result = await userService.updateEmail('user1', 'new@example.com');
      expect(result.email).toBe('new@example.com');
    });

    test('should throw for duplicate email', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user2', email: 'existing@example.com' });

      await expect(userService.updateEmail('user1', 'existing@example.com')).rejects.toThrow('Email already in use');
    });

    test('should throw for invalid email format', async () => {
      await expect(userService.updateEmail('user1', 'invalid-email')).rejects.toThrow('Invalid email address');
    });
  });

  describe('changePassword', () => {
    test('should change password with valid current password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true as never);
      (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt' as never);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new_hash' as never);
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUser);

      const result = await userService.changePassword('user1', 'currentPass', 'newPass123');
      expect(result.success).toBe(true);
    });

    test('should throw for incorrect current password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false as never);

      await expect(userService.changePassword('user1', 'wrongPass', 'newPass123')).rejects.toThrow('Current password is incorrect');
    });

    test('should throw for short new password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(userService.changePassword('user1', 'currentPass', 'short')).rejects.toThrow(
        'New password must be at least 8 characters long'
      );
    });
  });

  describe('followUser', () => {
    test('should follow a user', async () => {
      const targetUser = { ...mockUser, id: 'user2', username: 'targetuser' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(targetUser);
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.create as jest.Mock).mockResolvedValue({ id: 'follow1' });

      const result = await userService.followUser('user1', 'targetuser');
      expect(result).toBeDefined();
    });

    test('should throw when following yourself', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      await expect(userService.followUser('user1', 'testuser')).rejects.toThrow('Cannot follow yourself');
    });
  });

  describe('blockUser', () => {
    test('should block a user', async () => {
      const targetUser = { ...mockUser, id: 'user2', username: 'targetuser' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(targetUser);
      (prisma.blockedUser.upsert as jest.Mock).mockResolvedValue({ id: 'block1' });

      const result = await userService.blockUser('user1', 'targetuser');
      expect(result).toBeDefined();
    });

    test('should throw when blocking yourself', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      await expect(userService.blockUser('user1', 'testuser')).rejects.toThrow('Cannot block yourself');
    });
  });

  describe('searchUsers', () => {
    test('should search users by username or fullName', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([mockUser]);
      const result = await userService.searchUsers('test');
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteAccount', () => {
    test('should soft-delete account', async () => {
      (prisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser, status: 'DELETED' });

      const result = await userService.deleteAccount('user1');
      expect(result.message).toBe('Account deleted successfully');
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('getUserStats', () => {
    test('should return user stats', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.conversation.count as jest.Mock).mockResolvedValue(3);
      (prisma.follow.count as jest.Mock).mockResolvedValue(10);
      (prisma.photo.count as jest.Mock).mockResolvedValue(5);
      (prisma.giftTransaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 100 } });

      const result = await userService.getUserStats('user1');
      expect(result.matches).toBe(3);
      expect(result.totalEarnings).toBe(100);
    });
  });

  describe('updateOnlineStatus', () => {
    test('should update user online status', async () => {
      (prisma.profile.update as jest.Mock).mockResolvedValue({ ...mockUser.profile, isOnline: true });

      const result = await userService.updateOnlineStatus('user1', true);
      expect(result).toBeDefined();
    });
  });

  describe('muteUser', () => {
    test('should mute a user', async () => {
      const targetUser = { ...mockUser, id: 'user2', username: 'targetuser' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(targetUser);
      (prisma.mutedUser.upsert as jest.Mock).mockResolvedValue({ id: 'mute1' });

      const result = await userService.muteUser('user1', 'targetuser');
      expect(result).toBeDefined();
    });

    test('should throw when muting yourself', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      await expect(userService.muteUser('user1', 'testuser')).rejects.toThrow('Cannot mute yourself');
    });
  });

  describe('getBlockedUsers', () => {
    test('should return blocked users', async () => {
      (prisma.blockedUser.findMany as jest.Mock).mockResolvedValue([{ id: 'block1', target: { id: 'user2', username: 'target' } }]);
      const result = await userService.getBlockedUsers('user1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getUserSettings', () => {
    test('should upsert and return user settings', async () => {
      const mockSettings = { id: 'settings1', userId: 'user1', theme: 'dark' };
      (prisma.userSettings.upsert as jest.Mock).mockResolvedValue(mockSettings);

      const result = await userService.getUserSettings('user1');
      expect(result).toBeDefined();
    });
  });

  describe('updateUserSettings', () => {
    test('should validate theme value', async () => {
      await expect(userService.updateUserSettings('user1', { theme: 'red' })).rejects.toThrow('Theme must be dark or light');
    });

    test('should validate privacy settings', async () => {
      await expect(userService.updateUserSettings('user1', { privacyProfile: 'invalid' })).rejects.toThrow(
        'Profile privacy must be public or private'
      );
    });
  });
});