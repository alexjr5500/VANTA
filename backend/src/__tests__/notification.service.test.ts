import { NotificationService } from '../services/notification.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationPreferences: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const notificationService = new NotificationService();

describe('NotificationService', () => {
  const mockNotification = {
    id: 'notif1',
    userId: 'user1',
    type: 'follow',
    title: 'New Follower',
    message: 'user2 started following you',
    body: 'user2 started following you',
    metadata: '{"followerId":"user2","followerUsername":"user2"}',
    read: false,
    createdAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  describe('getNotifications', () => {
    test('should return notifications with cursor pagination', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([mockNotification]);
      const result = await notificationService.getNotifications('user1');
      expect(result.items).toHaveLength(1);
    });
  });

  describe('getUnreadCount', () => {
    test('should return unread count', async () => {
      (prisma.notification.count as jest.Mock).mockResolvedValue(3);
      const result = await notificationService.getUnreadCount('user1');
      expect(result).toBe(3);
    });
  });

  describe('markAsRead', () => {
    test('should mark notification as read', async () => {
      (prisma.notification.findUnique as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.update as jest.Mock).mockResolvedValue({ ...mockNotification, read: true });

      const result = await notificationService.markAsRead('notif1', 'user1');
      expect(result.read).toBe(true);
    });

    test('should throw for unauthorized user', async () => {
      (prisma.notification.findUnique as jest.Mock).mockResolvedValue(mockNotification);

      await expect(notificationService.markAsRead('notif1', 'user2')).rejects.toThrow('Notification not found or unauthorized');
    });
  });

  describe('markAllAsRead', () => {
    test('should mark all notifications as read', async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 5 });

      const result = await notificationService.markAllAsRead('user1');
      expect(result.message).toBe('All notifications marked as read');
    });
  });

  describe('deleteNotification', () => {
    test('should delete notification', async () => {
      (prisma.notification.findUnique as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.delete as jest.Mock).mockResolvedValue(mockNotification);

      const result = await notificationService.deleteNotification('notif1', 'user1');
      expect(result.message).toBe('Notification deleted');
    });
  });

  describe('createNotification', () => {
    test('should create notification with metadata', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.count as jest.Mock).mockResolvedValue(3);

      const result = await notificationService.createNotification('user1', 'follow', 'New Follower', 'Someone followed you', { followerId: 'user2' });
      expect(result.type).toBe('follow');
    });

    test('should skip notification when user has disabled push alerts', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue({ pushAlerts: false });

      const result = await notificationService.createNotification('user1', 'follow', 'New Follower', 'Someone followed you', { followerId: 'user2' });
      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('shouldDeliver', () => {
    test('should allow delivery by default when no preferences exist', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await notificationService.shouldDeliver('user1', 'follow');
      expect(result).toBe(true);
    });

    test('should respect disabled push alerts', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue({ pushAlerts: false });

      const result = await notificationService.shouldDeliver('user1', 'follow');
      expect(result).toBe(false);
    });

    test('should respect chat alerts for message notifications', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue({ chatAlerts: false });

      const result = await notificationService.shouldDeliver('user1', 'message');
      expect(result).toBe(false);
    });

    test('should allow unknown notification types', async () => {
      const result = await notificationService.shouldDeliver('user1', 'custom_type');
      expect(result).toBe(true);
    });
  });

  describe('notifyFollow', () => {
    test('should create follow notification', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      const result = await notificationService.notifyFollow('user1', 'user2', 'user2');
      expect(result?.message).toContain('started following you');
    });

    test('should not create follow notification when push alerts disabled', async () => {
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue({ pushAlerts: false });

      const result = await notificationService.notifyFollow('user1', 'user2', 'user2');
      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyLiveStarted', () => {
    test('should notify all followers about live stream', async () => {
      const followers = ['f1', 'f2', 'f3'];
      (prisma.notificationPreferences.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      const result = await notificationService.notifyLiveStarted(followers, 'host1', 'stream1', 'Live Now');
      expect(result).toHaveLength(3);
    });

    test('should skip followers who disabled live alerts', async () => {
      const followers = ['f1', 'f2', 'f3'];
      (prisma.notificationPreferences.findMany as jest.Mock).mockResolvedValue([
        { userId: 'f2', liveAlerts: false },
        { userId: 'f3', liveAlerts: false },
      ]);
      (prisma.notificationPreferences.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      const result = await notificationService.notifyLiveStarted(followers, 'host1', 'stream1', 'Live Now');
      expect(result).toHaveLength(1);
    });
  });
});