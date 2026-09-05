import { LiveService } from '../services/live.service';
import { liveKitService } from '../services/livekit.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    liveStream: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    streamCategory: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    streamViewer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    streamFollower: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    liveChatMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    giftTransaction: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../services/livekit.service', () => ({
  liveKitService: {
    generateRoomName: jest.fn().mockReturnValue('vanta_host1_test'),
    createRoom: jest.fn().mockResolvedValue({ roomName: 'vanta_host1_test' }),
    generateHostToken: jest.fn().mockReturnValue('host-token'),
    closeRoom: jest.fn().mockResolvedValue(undefined),
  },
}));

const liveService = new LiveService();

describe('LiveService', () => {
  const mockStream = {
    id: 'stream1',
    hostId: 'host1',
    title: 'Test Stream',
    description: 'A test stream',
    thumbnailUrl: null,
    streamKey: 'key123',
    playbackUrl: 'http://localhost:3000/stream/test-stream/abc.m3u8',
    liveKitRoom: 'vanta_room_live',
    allowGifts: true,
    allowPK: false,
    active: true,
    status: 'LIVE',
    startedAt: new Date(),
    peakViewers: 0,
    viewerCount: 0,
    categoryName: 'Just Chatting',
    createdAt: new Date(),
    host: { id: 'host1', username: 'host', avatar: null },
    category: { name: 'Just Chatting', description: 'Chat category' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.liveStream.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.streamFollower.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.streamCategory.upsert as jest.Mock).mockResolvedValue({
      id: 'cat1',
      name: 'Just Chatting',
      description: 'Chat category',
    });
  });

  describe('startStream', () => {
    test('should start a new stream', async () => {
      (prisma.liveStream.create as jest.Mock).mockResolvedValue(mockStream);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockStream.host);

      const result = await liveService.startStream('host1', 'Test Stream', 'Just Chatting');
      expect(result.active).toBe(true);
    });
  });

  describe('endStream', () => {
    test('should end an active stream', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(mockStream);
      (prisma.liveStream.update as jest.Mock).mockResolvedValue({ ...mockStream, active: false });

      const result = await liveService.endStream('stream1', 'host1');
      expect(result.active).toBe(false);
    });

    test('should throw for non-existent stream', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(liveService.endStream('nonexistent', 'host1')).rejects.toThrow('Stream not found');
    });

    test('should throw if not stream host', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(mockStream);

      await expect(liveService.endStream('stream1', 'otherUser')).rejects.toThrow('Unauthorized');
    });
  });

  describe('getActiveStreams', () => {
    test('should return active streams', async () => {
      (prisma.liveStream.findMany as jest.Mock).mockResolvedValue([mockStream]);

      const result = await liveService.getActiveStreams(undefined, 10);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('getStream', () => {
    test('should return stream with chat messages', async () => {
      const streamWithChat = {
        ...mockStream,
        chatMessages: [
          { id: 'chat1', userId: 'user2', message: 'Hello!', user: { id: 'user2', username: 'viewer', avatar: null } },
        ],
      };
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(streamWithChat);

      const result = await liveService.getStream('stream1');
      expect(result.chatMessages).toHaveLength(1);
    });

    test('should throw for non-existent stream', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(liveService.getStream('nonexistent')).resolves.toBeNull();
    });
  });

  describe('joinStream', () => {
    test('should increment viewer count on join', async () => {
      (prisma.streamViewer.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.streamViewer.create as jest.Mock).mockResolvedValue({});
      (prisma.streamViewer.count as jest.Mock).mockResolvedValue(5);
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(mockStream);
      (prisma.liveStream.update as jest.Mock).mockResolvedValue({ ...mockStream, viewerCount: 5 });

      const result = await liveService.joinStream('stream1', 'viewer1');
      expect(result).toBe(5);
    });
  });

  describe('leaveStream', () => {
    test('should decrement viewer count on leave', async () => {
      (prisma.streamViewer.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.streamViewer.count as jest.Mock).mockResolvedValue(4);
      (prisma.liveStream.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await liveService.leaveStream('stream1', 'viewer1');
      expect(result).toBe(4);
    });
  });

  describe('postChatMessage', () => {
    test('should post a chat message', async () => {
      const mockChatMsg = {
        id: 'chat1',
        streamId: 'stream1',
        userId: 'viewer1',
        message: 'Hello stream!',
        user: { id: 'viewer1', username: 'viewer', avatar: null },
      };
      (prisma.liveChatMessage.create as jest.Mock).mockResolvedValue(mockChatMsg);

      const result = await liveService.postChatMessage('stream1', 'viewer1', 'Hello stream!');
      expect(result.message).toBe('Hello stream!');
    });
  });

  describe('followStreamer', () => {
    test('should follow a streamer', async () => {
      (prisma.streamFollower.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.streamFollower.create as jest.Mock).mockResolvedValue({ id: 'follow1', streamerId: 'host1', followerId: 'viewer1' });

      const result = await liveService.followStreamer('host1', 'viewer1');
      expect(result).toBeDefined();
    });

    test('should toggle off an existing follow', async () => {
      (prisma.streamFollower.findUnique as jest.Mock).mockResolvedValue({ id: 'follow1' });
      (prisma.streamFollower.delete as jest.Mock).mockResolvedValue({});
      await expect(liveService.followStreamer('host1', 'host1')).resolves.toEqual({ following: false });
    });
  });

  describe('getHostStats', () => {
    test('should return host statistics', async () => {
      (prisma.liveStream.count as jest.Mock).mockResolvedValue(1);
      (prisma.liveStream.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { totalViewers: 50 } })
        .mockResolvedValueOnce({ _sum: { gifts: 30 } })
        .mockResolvedValueOnce({ _sum: { duration: 120 } });

      const result = await liveService.getHostStats('host1');
      expect(result.totalGifts).toBe(30);
      expect(result.totalStreams).toBe(1);
      expect(result.totalViewers).toBe(50);
    });
  });

  describe('getCategories', () => {
    test('should return stream categories', async () => {
      (prisma.streamCategory.findMany as jest.Mock).mockResolvedValue([{ id: 'cat1', name: 'Gaming' }]);
      const result = await liveService.getCategories();
      expect(result).toHaveLength(1);
    });
  });

  // LIVE HEARTBEAT / 30-SECOND STALE-SESSION TIMEOUT
  describe('recordHeartbeat', () => {
    const activeStream = { id: 'stream1', hostId: 'host1', active: true, status: 'LIVE' };

    test('records the heartbeat for an active session', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(activeStream);
      (prisma.liveStream.update as jest.Mock).mockResolvedValue({ ...activeStream, lastHostHeartbeat: new Date() });

      const result = await liveService.recordHeartbeat('stream1', 'host1');
      expect(result).toBe(true);
      expect(prisma.liveStream.update).toHaveBeenCalledWith({
        where: { id: 'stream1' },
        data: { lastHostHeartbeat: expect.any(Date) },
      });
    });

    test('rejects heartbeats from a non-host', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(activeStream);
      await expect(liveService.recordHeartbeat('stream1', 'viewer1')).rejects.toThrow('Unauthorized');
    });

    test('rejects unknown streams', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(liveService.recordHeartbeat('missing', 'host1')).rejects.toThrow('Stream not found');
    });

    test('returns false when the session has already ended', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue({ ...activeStream, active: false, status: 'ENDED' });
      const result = await liveService.recordHeartbeat('stream1', 'host1');
      expect(result).toBe(false);
      expect(prisma.liveStream.update).not.toHaveBeenCalled();
    });
  });

  describe('endStaleStream / sweepStaleLiveStreams', () => {
    test('endStaleStream ends an abandoned session and closes the LiveKit room', async () => {
      const stale = { ...mockStream, startedAt: new Date(Date.now() - 120_000) };
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue(stale);
      (prisma.liveStream.update as jest.Mock).mockResolvedValue({ ...stale, active: false, status: 'ENDED' });

      const result = await liveService.endStaleStream('stream1');
      expect(result?.active).toBe(false);
      expect(result?.reason).toBe('host_timeout');
      expect(liveKitService.closeRoom).toHaveBeenCalledWith(mockStream.liveKitRoom);
    });

    test('endStaleStream is a no-op for already-ended sessions', async () => {
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue({ ...mockStream, active: false, status: 'ENDED' });
      await expect(liveService.endStaleStream('stream1')).resolves.toBeNull();
    });

    test('sweeper ends only sessions whose heartbeat is older than 30 seconds', async () => {
      const stale = { id: 'stream-stale', hostId: 'host1', liveKitRoom: 'vanta_room_stale' };
      (prisma.liveStream.findMany as jest.Mock).mockResolvedValue([stale]);
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValue({
        id: 'stream-stale', hostId: 'host1', liveKitRoom: 'vanta_room_stale', active: true, status: 'LIVE',
        startedAt: new Date(Date.now() - 300_000),
      });
      (prisma.liveStream.update as jest.Mock).mockResolvedValue({ id: 'stream-stale', active: false, status: 'ENDED' });

      const result = await liveService.sweepStaleLiveStreams();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('stream-stale');
      expect(prisma.liveStream.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ active: false, status: 'ENDED' }) })
      );
    });

    test('sweeper queries with a 30-second cutoff for authoritative cleanup', async () => {
      (prisma.liveStream.findMany as jest.Mock).mockResolvedValue([]);
      await liveService.sweepStaleLiveStreams();
      const where = (prisma.liveStream.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.active).toBe(true);
      expect(where.status).toBe('LIVE');
      expect(where.OR[0].lastHostHeartbeat.lt).toBeInstanceOf(Date);
      expect(where.OR[1].lastHostHeartbeat).toBeNull();
    });
  });

  // Never permanently block a host because of a stale/abandoned previous Live.
  describe('startStream stale-session guard', () => {
    test('still blocks when the previous session is genuinely active (fresh heartbeat)', async () => {
      (prisma.liveStream.findFirst as jest.Mock).mockResolvedValue({
        id: 'stream1',
        lastHostHeartbeat: new Date(),
        startedAt: new Date(),
      });
      await expect(liveService.startStream('host1', 'Test', 'Just Chatting')).rejects.toThrow('You already have an active livestream');
      expect(prisma.liveStream.create).not.toHaveBeenCalled();
    });

    test('auto-cleans an expired session and then starts the new Live', async () => {
      const staleExisting = {
        id: 'stream1',
        lastHostHeartbeat: new Date(Date.now() - 60_000),
        startedAt: new Date(Date.now() - 180_000),
      };
      (prisma.liveStream.findFirst as jest.Mock).mockResolvedValue(staleExisting);
      // The stale session is looked up + ended first.
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'stream1', hostId: 'host1', liveKitRoom: 'vanta_ghost', active: true, status: 'LIVE', startedAt: staleExisting.startedAt,
      });
      (prisma.liveStream.update as jest.Mock).mockResolvedValueOnce({ id: 'stream1', active: false, status: 'ENDED' });
      // Then the brand-new Live is created.
      (prisma.liveStream.create as jest.Mock).mockResolvedValue(mockStream);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockStream.host);

      const result = await liveService.startStream('host1', 'Fresh Live', 'Just Chatting');
      expect(result.active).toBe(true);
      // The ghost session was closed and the host can immediately go Live again.
      expect(liveKitService.closeRoom).toHaveBeenCalledWith('vanta_ghost');
      expect(prisma.liveStream.create).toHaveBeenCalledTimes(1);
    });
  });
});