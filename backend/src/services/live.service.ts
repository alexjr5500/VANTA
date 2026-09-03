import { prisma } from "../prisma";
import { cacheService, CACHE_KEYS, CACHE_TTL } from "./cache.service";
import { dbPerformanceTracker } from "./monitoring.service";
import { liveKitService } from "./livekit.service";
import { notificationService } from "./notification.service";

export class LiveService {
  async getActiveStreams(cursor?: string, limit: number = 20) {
    return cacheService.getOrSet(CACHE_KEYS.LIVE_STREAMS, async () => {
      const queryStart = Date.now();
      
      const streams = await prisma.liveStream.findMany({
        where: { active: true, status: "LIVE" },
        orderBy: { viewerCount: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
          category: { select: { name: true } },
          _count: { select: { viewers: true, giftEvents: true } },
        },
      });

      dbPerformanceTracker.trackQuery('LiveStream', Date.now() - queryStart, 'findManyActive');

      const nextCursor = streams.length > limit ? streams.pop()?.id : undefined;
      return { items: streams, nextCursor };
    }, CACHE_TTL.SHORT);
  }

  async getStream(streamId: string) {
    return cacheService.getOrSet(CACHE_KEYS.LIVE_STREAM(streamId), async () => {
      const queryStart = Date.now();
      
      const stream = await prisma.liveStream.findUnique({
        where: { id: streamId },
        include: {
          host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, bio: true } },
          category: { select: { name: true } },
          coHost: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
          _count: { select: { viewers: true, giftEvents: true, reactions: true } },
        },
      });

      dbPerformanceTracker.trackQuery('LiveStream', Date.now() - queryStart, 'findUnique');
      
      return stream;
    }, CACHE_TTL.SHORT);
  }

  async startStream(
    hostId: string, 
    title: string, 
    categoryName?: string, 
    description?: string, 
    thumbnailUrl?: string, 
    allowGifts?: boolean, 
    allowPK?: boolean,
    language?: string,
    country?: string,
    recordingEnabled?: boolean
  ) {
    const existing = await prisma.liveStream.findFirst({
      where: { hostId, active: true, status: 'LIVE' },
      select: { id: true },
    });
    if (existing) throw new Error('You already have an active livestream');

    // Create LiveKit room
    const roomName = liveKitService.generateRoomName(hostId);
    await liveKitService.createRoom(roomName);

    // Get host info for token
    const host = await prisma.user.findUnique({
      where: { id: hostId },
      select: { id: true, username: true, fullName: true, avatar: true },
    });

    let stream;
    try {
      // Ensure the StreamCategory row exists before the create, because
      // `categoryName` is a foreign key to StreamCategory. Without this, going
      // live with a category that isn't in the table yet fails the FK (400).
      const cleanedCategory = categoryName?.trim();
      if (cleanedCategory) {
        await prisma.streamCategory.upsert({
          where: { name: cleanedCategory },
          update: {},
          create: { name: cleanedCategory },
        });
      }

      stream = await prisma.liveStream.create({
        data: {
        hostId, 
        title, 
        description: description || '', 
        categoryName: cleanedCategory || undefined,
        thumbnailUrl,
        allowGifts: allowGifts ?? true,
        allowPK: allowPK ?? false,
        language: language || 'en',
        country,
        recordingEnabled: recordingEnabled ?? false,
        liveKitRoom: roomName,
        status: 'LIVE',
        active: true,
        startedAt: new Date(),
        viewerCount: 0,
        peakViewers: 0,
        totalViewers: 0,
        },
        include: {
          host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
          category: { select: { name: true } },
        },
      });
    } catch (error) {
      await liveKitService.closeRoom(roomName).catch(() => undefined);
      throw error;
    }

    // Invalidate streams cache
    await cacheService.del(CACHE_KEYS.LIVE_STREAMS);

    const followers = await prisma.streamFollower.findMany({
      where: { streamerId: hostId },
      select: { followerId: true },
    });
    notificationService.notifyLiveStarted(
      followers.map(({ followerId }) => followerId),
      host?.username || hostId,
      stream.id,
      stream.title,
    ).catch((error) => console.error('Failed to notify livestream followers:', error));
    
    return stream;
  }

  async endStream(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream) throw new Error("Stream not found");
    if (stream.hostId !== hostId) throw new Error("Unauthorized");

    // Calculate duration
    const duration = stream.startedAt 
      ? Math.floor((Date.now() - stream.startedAt.getTime()) / 1000) 
      : 0;

    // Close LiveKit room
    if (stream.liveKitRoom) {
      await liveKitService.closeRoom(stream.liveKitRoom);
    }

    const updated = await prisma.liveStream.update({
      where: { id: streamId },
      data: { 
        active: false, 
        status: 'ENDED',
        endedAt: new Date(),
        duration,
      },
    });

    // Invalidate caches
    await cacheService.del(CACHE_KEYS.LIVE_STREAMS);
    await cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId));
    
    return updated;
  }

  async joinStream(streamId: string, userId: string) {
    const target = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { active: true, status: true, bannedUsers: true, peakViewers: true },
    });
    if (!target || !target.active || target.status !== 'LIVE') {
      throw new Error('Stream is not live');
    }
    const bannedUsers: string[] = target.bannedUsers ? JSON.parse(target.bannedUsers) : [];
    if (bannedUsers.includes(userId)) throw new Error('You are banned from this stream');

    // Check if already joined
    const existing = await prisma.streamViewer.findUnique({
      where: { streamId_userId: { streamId, userId } },
    });

    if (!existing) {
      await prisma.streamViewer.create({
        data: { streamId, userId },
      });

      // Update viewer counts
      const count = await prisma.streamViewer.count({ where: { streamId } });
      await prisma.liveStream.update({
        where: { id: streamId },
        data: { 
          viewerCount: count,
          totalViewers: { increment: 1 },
          peakViewers: Math.max(count, target.peakViewers),
        },
      });
    }

    return this.countViewers(streamId);
  }

  async leaveStream(streamId: string, userId: string) {
    await prisma.streamViewer.deleteMany({
      where: { streamId, userId },
    });

    const count = await prisma.streamViewer.count({ where: { streamId } });
    await prisma.liveStream.updateMany({
      where: { id: streamId, active: true },
      data: { viewerCount: count },
    });

    return count;
  }

  async countViewers(streamId: string): Promise<number> {
    return prisma.streamViewer.count({ where: { streamId } });
  }

  async updateViewerCount(streamId: string, delta: number) {
    const stream = await prisma.liveStream.update({
      where: { id: streamId },
      data: { viewerCount: { increment: delta } },
    });

    // Update cache in background
    cacheService.del(CACHE_KEYS.LIVE_STREAMS).catch(() => {});
    cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId)).catch(() => {});
    
    return stream;
  }

  async getStreamChat(streamId: string, cursor?: string, limit: number = 50) {
    const messages = await prisma.liveChatMessage.findMany({
      where: { streamId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, username: true, avatar: true, verified: true } },
      },
    });

    const nextCursor = messages.length > limit ? messages.pop()?.id : undefined;
    return { items: messages.reverse(), nextCursor };
  }

  async postChatMessage(streamId: string, userId: string, message: string) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || normalizedMessage.length > 500) {
      throw new Error('Messages must be between 1 and 500 characters');
    }
    // Check if stream has chat paused
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { chatPaused: true, slowMode: true, slowModeInterval: true, bannedUsers: true, mutedUsers: true },
    });

    if (!stream) throw new Error("Stream not found");
    if (stream.chatPaused) throw new Error("Chat is paused");
    
    // Check if user is banned
    const bannedUsers: string[] = stream.bannedUsers ? JSON.parse(stream.bannedUsers) : [];
    if (bannedUsers.includes(userId)) throw new Error("You are banned from this stream");

    // Check if user is muted
    const mutedUsers: string[] = stream.mutedUsers ? JSON.parse(stream.mutedUsers) : [];
    if (mutedUsers.includes(userId)) throw new Error("You are muted in this stream");

    // Slow mode check
    if (stream.slowMode) {
      const lastMessage = await prisma.liveChatMessage.findFirst({
        where: { streamId, userId },
        orderBy: { createdAt: 'desc' },
      });
      if (lastMessage) {
        const elapsed = (Date.now() - lastMessage.createdAt.getTime()) / 1000;
        if (elapsed < (stream.slowModeInterval || 3)) {
          throw new Error(`Please wait ${stream.slowModeInterval} seconds between messages`);
        }
      }
    }

    const chatMessage = await prisma.liveChatMessage.create({
      data: { streamId, userId, message: normalizedMessage },
      include: {
        user: { select: { id: true, username: true, avatar: true, verified: true } },
      },
    });

    return chatMessage;
  }

  async addReaction(streamId: string, userId: string, emoji: string) {
    const allowedReactions = new Set(['❤️', '🔥', '👏', '😂', '😍', '🎉']);
    if (!allowedReactions.has(emoji)) throw new Error('Unsupported reaction');
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { active: true, status: true },
    });
    if (!stream?.active || stream.status !== 'LIVE') throw new Error('Stream is not live');

    // Aggregated like analytics instead of a row-per-tap flood:
    //  - A LiveReaction row is kept only as a deduped identity marker (first time
    //    this user reacts with this emoji on this stream) so analytics can answer
    //    "how many distinct users reacted" cheaply.
    //  - Every tap atomically increments the stream's `likes` aggregate counter,
    //    which is what trending + stream analytics read for total like volume.
    // Rapid taps therefore produce at most ONE row per user+emoji+stream instead
    // of thousands of duplicate records.
    const existing = await prisma.liveReaction.findFirst({
      where: { streamId, userId, emoji },
      select: { id: true },
    });
    if (!existing) {
      await prisma.liveReaction.create({ data: { streamId, userId, emoji } });
    }

    const updated = await prisma.liveStream.update({
      where: { id: streamId },
      data: { likes: { increment: 1 } },
      select: { likes: true },
    });

    return { totalLikes: updated.likes };
  }

  async getCategories() {
    return cacheService.getOrSet('stream_categories', async () => {
      return prisma.streamCategory.findMany({
        orderBy: { name: 'asc' },
      });
    }, CACHE_TTL.MEDIUM);
  }

  async getDiscoveryStreams(limit: number = 20, category?: string, search?: string, sort: string = 'trending', cursor?: string) {
    const where: any = { active: true, status: 'LIVE' };
    if (category && category !== 'all') {
      where.categoryName = category;
    }
    if (search?.trim()) {
      where.OR = [
        { title: { contains: search.trim() } },
        { description: { contains: search.trim() } },
        { host: { username: { contains: search.trim() } } },
      ];
    }

    const orderBy: any = sort === 'newest'
      ? [{ startedAt: 'desc' }]
      : sort === 'popular'
        ? [{ totalViewers: 'desc' }, { viewerCount: 'desc' }]
        : [{ viewerCount: 'desc' }, { createdAt: 'desc' }];

    const streams = await prisma.liveStream.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });

    const nextCursor = streams.length > limit ? streams.pop()?.id : undefined;
    return { items: streams, nextCursor };
  }

  async updateStream(streamId: string, hostId: string, input: Record<string, unknown>) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId }, select: { hostId: true } });
    if (!stream) throw new Error('Stream not found');
    if (stream.hostId !== hostId) throw new Error('Unauthorized');
    const data: Record<string, unknown> = {};
    if (typeof input.title === 'string') data.title = input.title.trim().slice(0, 120);
    if (typeof input.description === 'string') data.description = input.description.trim().slice(0, 2000);
    if (typeof input.category === 'string') data.categoryName = input.category.trim().slice(0, 60);
    if (typeof input.thumbnailUrl === 'string') data.thumbnailUrl = input.thumbnailUrl;
    if (typeof input.language === 'string') data.language = input.language.trim().slice(0, 16);
    if (typeof input.country === 'string') data.country = input.country.trim().slice(0, 80);
    for (const key of ['allowGifts', 'allowPK', 'recordingEnabled'] as const) {
      if (typeof input[key] === 'boolean') data[key] = input[key];
    }
    const updated = await prisma.liveStream.update({ where: { id: streamId }, data });
    await Promise.all([cacheService.del(CACHE_KEYS.LIVE_STREAMS), cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId))]);
    return updated;
  }

  async deleteStream(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream) throw new Error('Stream not found');
    if (stream.hostId !== hostId) throw new Error('Unauthorized');
    if (stream.active || stream.status === 'LIVE') throw new Error('End the livestream before deleting it');
    await prisma.liveStream.delete({ where: { id: streamId } });
    await Promise.all([cacheService.del(CACHE_KEYS.LIVE_STREAMS), cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId))]);
  }

  async getFollowingStreams(userId: string) {
    const follows = await prisma.streamFollower.findMany({
      where: { followerId: userId },
      select: { streamerId: true },
    });

    const streamerIds = follows.map(f => f.streamerId);

    if (streamerIds.length === 0) return [];

    return prisma.liveStream.findMany({
      where: { 
        hostId: { in: streamerIds },
        active: true,
        status: 'LIVE',
      },
      orderBy: { viewerCount: 'desc' },
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        category: { select: { name: true } },
        _count: { select: { viewers: true } },
      },
    });
  }

  async getStreamHistory(hostId: string, limit: number = 10) {
    return prisma.liveStream.findMany({
      where: { hostId, status: 'ENDED' },
      orderBy: { endedAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });
  }

  async getHostStats(hostId: string) {
    const [totalStreams, totalViewers, totalGifts, totalDuration] = await Promise.all([
      prisma.liveStream.count({ where: { hostId } }),
      prisma.liveStream.aggregate({ where: { hostId }, _sum: { totalViewers: true } }),
      prisma.liveStream.aggregate({ where: { hostId }, _sum: { gifts: true } }),
      prisma.liveStream.aggregate({ where: { hostId, status: 'ENDED' }, _sum: { duration: true } }),
    ]);

    return {
      totalStreams,
      totalViewers: totalViewers._sum.totalViewers || 0,
      totalGifts: totalGifts._sum.gifts || 0,
      totalDuration: totalDuration._sum.duration || 0,
    };
  }

  async followStreamer(streamerId: string, followerId: string) {
    const existing = await prisma.streamFollower.findUnique({
      where: { streamerId_followerId: { streamerId, followerId } },
    });

    if (existing) {
      await prisma.streamFollower.delete({
        where: { streamerId_followerId: { streamerId, followerId } },
      });
      return { following: false };
    }

    await prisma.streamFollower.create({
      data: { streamerId, followerId },
    });

    // Notify the streamer about the new follower
    const follower = await prisma.user.findUnique({
      where: { id: followerId },
      select: { username: true },
    });
    if (follower) {
      notificationService.notifyFollow(streamerId, follower.username, followerId)
        .catch((error) => console.error('Failed to notify follow:', error));
    }

    return { following: true };
  }

  // Host moderation methods
  async muteViewer(streamId: string, hostId: string, targetUserId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    const mutedUsers: string[] = stream.mutedUsers ? JSON.parse(stream.mutedUsers) : [];
    if (!mutedUsers.includes(targetUserId)) {
      mutedUsers.push(targetUserId);
      await prisma.liveStream.update({
        where: { id: streamId },
        data: { mutedUsers: JSON.stringify(mutedUsers) },
      });
    }
  }

  async unmuteViewer(streamId: string, hostId: string, targetUserId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    const mutedUsers: string[] = stream.mutedUsers ? JSON.parse(stream.mutedUsers) : [];
    const filtered = mutedUsers.filter(id => id !== targetUserId);
    await prisma.liveStream.update({
      where: { id: streamId },
      data: { mutedUsers: JSON.stringify(filtered) },
    });
  }

  async banViewer(streamId: string, hostId: string, targetUserId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    const bannedUsers: string[] = stream.bannedUsers ? JSON.parse(stream.bannedUsers) : [];
    if (!bannedUsers.includes(targetUserId)) {
      bannedUsers.push(targetUserId);
      await prisma.liveStream.update({
        where: { id: streamId },
        data: { bannedUsers: JSON.stringify(bannedUsers) },
      });
    }

    // Also remove from viewers
    await prisma.streamViewer.deleteMany({
      where: { streamId, userId: targetUserId },
    });
  }

  async unbanViewer(streamId: string, hostId: string, targetUserId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    const bannedUsers: string[] = stream.bannedUsers ? JSON.parse(stream.bannedUsers) : [];
    const filtered = bannedUsers.filter(id => id !== targetUserId);
    await prisma.liveStream.update({
      where: { id: streamId },
      data: { bannedUsers: JSON.stringify(filtered) },
    });
  }

  async toggleChatPause(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    return prisma.liveStream.update({
      where: { id: streamId },
      data: { chatPaused: !stream.chatPaused },
    });
  }

  async toggleSlowMode(streamId: string, hostId: string, interval?: number) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    return prisma.liveStream.update({
      where: { id: streamId },
      data: { 
        slowMode: !stream.slowMode,
        ...(interval ? { slowModeInterval: interval } : {}),
      },
    });
  }

  async updateStreamSettings(streamId: string, hostId: string, settings: any) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream || stream.hostId !== hostId) throw new Error("Unauthorized");

    return prisma.liveStream.update({
      where: { id: streamId },
      data: settings,
    });
  }

  async getViewerToken(streamId: string, userId: string) {
    const stream = await prisma.liveStream.findUnique({ 
      where: { id: streamId },
      select: { liveKitRoom: true, active: true, status: true, bannedUsers: true },
    });
    if (!stream || !stream.liveKitRoom || !stream.active || stream.status !== 'LIVE') {
      throw new Error("Stream not found or no longer live");
    }
    const bannedUsers: string[] = stream.bannedUsers ? JSON.parse(stream.bannedUsers) : [];
    if (bannedUsers.includes(userId)) throw new Error('You are banned from this stream');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    return liveKitService.generateViewerToken(stream.liveKitRoom, userId, user?.username || userId);
  }

  async getHostToken(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({ 
      where: { id: streamId },
      select: { liveKitRoom: true, hostId: true },
    });
    if (!stream || !stream.liveKitRoom) throw new Error("Stream not found");
    if (stream.hostId !== hostId) throw new Error("Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: hostId },
      select: { username: true },
    });

    return liveKitService.generateHostToken(stream.liveKitRoom, hostId, user?.username || hostId);
  }

  async likeStream(streamId: string) {
    return prisma.liveStream.update({
      where: { id: streamId },
      data: { likes: { increment: 1 } },
    });
  }

  async getTrendingStreams(limit: number = 10) {
    return prisma.liveStream.findMany({
      where: { active: true, status: 'LIVE' },
      orderBy: [
        { viewerCount: 'desc' },
        { gifts: 'desc' },
        { likes: 'desc' },
      ],
      take: limit,
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });
  }

  async getRecentlyEnded(limit: number = 10) {
    return prisma.liveStream.findMany({
      where: { status: 'ENDED' },
      orderBy: { endedAt: 'desc' },
      take: limit,
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });
  }

  async getPopularCreators(limit: number = 10) {
    const creators = await prisma.user.findMany({
      where: {
        liveStreams: { some: { status: 'LIVE', active: true } },
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        verified: true,
        _count: { select: { streamerFollowers: true, liveStreams: true } },
      },
      orderBy: { streamerFollowers: { _count: 'desc' } },
      take: limit,
    });
    return creators;
  }

  async getStreamAnalytics(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true, chatMessages: true, reactions: true } },
      },
    });
    if (!stream) throw new Error('Stream not found');
    if (stream.hostId !== hostId) throw new Error('Unauthorized');

    const [giftTotal, chatCount, distinctReactions, newFollowers] = await Promise.all([
      prisma.liveGiftEvent.aggregate({ where: { streamId }, _sum: { amount: true } }),
      prisma.liveChatMessage.count({ where: { streamId } }),
      prisma.liveReaction.count({ where: { streamId } }),
      prisma.streamFollower.count({ where: { streamerId: hostId, createdAt: { gte: stream.startedAt || new Date(0) } } }),
    ]);

    return {
      stream,
      duration: stream.duration,
      peakViewers: stream.peakViewers,
      totalViewers: stream.totalViewers,
      avgViewers: stream.duration > 0 ? Math.round(stream.totalViewers / Math.max(1, Math.floor(stream.duration / 60))) : 0,
      newFollowers,
      messages: chatCount,
      // `reactions` = aggregate total likes (every tap counted once by the
      // stream's `likes` counter). `distinctReactions` = deduped LiveReaction
      // markers (unique reactor+emoji combos) kept for cheap analytics.
      reactions: stream.likes,
      distinctReactions,
      gifts: giftTotal._sum.amount || 0,
      giftCount: stream._count.giftEvents,
      coinRevenue: giftTotal._sum.amount || 0,
      estimatedEarnings: Math.round((giftTotal._sum.amount || 0) * 0.7),
    };
  }

  async reportStream(streamId: string, reporterId: string, reason: string, description?: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, hostId: true, title: true },
    });
    if (!stream) throw new Error('Stream not found');

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetId: stream.hostId,
        type: 'LIVE_STREAM',
        reason,
        description: description || `Reported stream: ${stream.title} (${stream.id})`,
      },
    });

    // Also create a moderation queue entry
    await prisma.moderationQueue.create({
      data: {
        targetType: 'LIVE_STREAM',
        targetId: streamId,
        reportedBy: reporterId,
        reason,
        status: 'PENDING',
      },
    }).catch(() => undefined);

    return report;
  }

  async getStreamReplay(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, hostId: true, recordingUrl: true, recordingEnabled: true, status: true },
    });
    if (!stream) throw new Error('Stream not found');
    if (stream.hostId !== hostId) throw new Error('Unauthorized');
    if (!stream.recordingEnabled || !stream.recordingUrl) {
      return { available: false, message: 'Recording was not enabled for this stream' };
    }
    return { available: true, recordingUrl: stream.recordingUrl };
  }

  async getStreamShare(streamId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, title: true, active: true, status: true },
    });
    if (!stream) throw new Error('Stream not found');
    return {
      url: `/live/${stream.id}`,
      title: stream.title,
      isLive: stream.active && stream.status === 'LIVE',
    };
  }

  async getStreamModeration(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, hostId: true, moderators: true, mutedUsers: true, bannedUsers: true, chatPaused: true, slowMode: true, slowModeInterval: true },
    });
    if (!stream) throw new Error('Stream not found');
    if (stream.hostId !== hostId) throw new Error('Unauthorized');

    return {
      moderators: stream.moderators ? JSON.parse(stream.moderators) : [],
      mutedUsers: stream.mutedUsers ? JSON.parse(stream.mutedUsers) : [],
      bannedUsers: stream.bannedUsers ? JSON.parse(stream.bannedUsers) : [],
      chatPaused: stream.chatPaused,
      slowMode: stream.slowMode,
      slowModeInterval: stream.slowModeInterval,
    };
  }

  async getStreamBlocked(streamId: string, userId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { hostId: true },
    });
    if (!stream) throw new Error('Stream not found');

    const blocked = await prisma.blockedUser.findUnique({
      where: { userId_targetId: { userId, targetId: stream.hostId } },
    });
    return { blocked: Boolean(blocked) };
  }

  async getStreamFollowing(streamId: string, userId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { hostId: true },
    });
    if (!stream) throw new Error('Stream not found');

    const follow = await prisma.streamFollower.findUnique({
      where: { streamerId_followerId: { streamerId: stream.hostId, followerId: userId } },
    });
    return { following: Boolean(follow) };
  }

  async getStreamCategories() {
    return this.getCategories();
  }

  // ---- Host chat moderation: delete / pin / clear (no schema change) ----

  /** Verify the caller is the stream host before a destructive chat action. */
  private async assertHost(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream) throw new Error('Stream not found');
    if (stream.hostId !== hostId) throw new Error('Unauthorized');
    return stream;
  }

  async deleteMessage(streamId: string, hostId: string, messageId: string) {
    await this.assertHost(streamId, hostId);
    const message = await prisma.liveChatMessage.findFirst({ where: { id: messageId, streamId } });
    if (!message) throw new Error('Message not found');
    await prisma.liveChatMessage.delete({ where: { id: messageId } });
    return { streamId, messageId };
  }

  async clearChat(streamId: string, hostId: string) {
    await this.assertHost(streamId, hostId);
    await prisma.liveChatMessage.deleteMany({ where: { streamId } });
    livePins.set(streamId, null);
    return { streamId };
  }

  async pinMessage(streamId: string, hostId: string, messageId: string) {
    await this.assertHost(streamId, hostId);
    const message = await prisma.liveChatMessage.findFirst({
      where: { id: messageId, streamId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    if (!message) throw new Error('Message not found');
    const pinned = {
      id: message.id,
      streamId,
      userId: message.userId,
      username: message.user.username,
      avatar: message.user.avatar,
      message: message.message,
      createdAt: message.createdAt.toISOString(),
    };
    livePins.set(streamId, pinned);
    return pinned;
  }

  async unpinMessage(streamId: string, hostId: string) {
    await this.assertHost(streamId, hostId);
    livePins.set(streamId, null);
    return null;
  }

  getPinnedMessage(streamId: string) {
    return livePins.get(streamId) || null;
  }

  // ---------------------------------------------------------------------------
  // MULTI-GUEST LIVE STAGE
  // Maximum total participants on the live guest stage is 5: the host + up to 4
  // guests. Guest requests are stored in the existing `guests` JSON column and
  // approved (on-stage) guests in `approvedGuests`. All validation happens here
  // on the server — the client never decides capacity or authorization.
  // ---------------------------------------------------------------------------
  private static readonly MAX_GUESTS = 4;
  private static readonly MAX_TOTAL_PARTICIPANTS = 5;

  private parseJsonList(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private async getLiveIdOwner(streamId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, hostId: true, liveKitRoom: true, active: true, status: true, guests: true, approvedGuests: true },
    });
    return stream;
  }

  /** Number of guests currently on the stage (host occupies one of the 5 slots). */
  async countGuests(streamId: string): Promise<number> {
    const stream = await this.getLiveIdOwner(streamId);
    return stream ? this.parseJsonList(stream.approvedGuests).length : 0;
  }

  /** A viewer requests to join the live guest stage. */
  async requestJoinGuest(streamId: string, userId: string) {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream || !stream.active || stream.status !== 'LIVE') throw new Error('Stream is not live');
    if (stream.hostId === userId) throw new Error('You are the host');
    const pending = this.parseJsonList(stream.guests);
    const approved = this.parseJsonList(stream.approvedGuests);
    if (approved.includes(userId)) throw new Error('You are already on stage');
    if (pending.includes(userId)) throw new Error('You already requested to join');

    const updated = [...pending, userId];
    await prisma.liveStream.update({ where: { id: streamId }, data: { guests: JSON.stringify(updated) } });
    return { pending: updated };
  }

  /** Remove a pending request (viewer withdraws, or host rejects). */
  async cancelGuestRequest(streamId: string, userId: string) {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream) throw new Error('Stream not found');
    const pending = this.parseJsonList(stream.guests).filter((id) => id !== userId);
    await prisma.liveStream.update({ where: { id: streamId }, data: { guests: JSON.stringify(pending) } });
    return { pending };
  }

  /**
   * Host accepts a viewer's request to join the stage. Enforces the 5-total cap
   * (host + up to 4 guests) and returns the LiveKit guest token so the requester
   * can publish camera/mic as a guest.
   */
  async acceptGuestRequest(streamId: string, hostId: string, viewerId: string): Promise<{ token: string; roomName: string }> {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream || stream.hostId !== hostId) throw new Error('Unauthorized');
    const pending = this.parseJsonList(stream.guests);
    if (!pending.includes(viewerId)) throw new Error('No pending request from this user');
    const approved = this.parseJsonList(stream.approvedGuests);
    if (approved.includes(viewerId)) throw new Error('User is already on stage');
    if (approved.length >= LiveService.MAX_GUESTS) throw new Error('The guest stage is full');

    const user = await prisma.user.findUnique({ where: { id: viewerId }, select: { id: true, username: true } });
    if (!user) throw new Error('User not found');

    const nextApproved = [...approved, viewerId];
    const nextPending = pending.filter((id) => id !== viewerId);
    await prisma.liveStream.update({
      where: { id: streamId },
      data: { approvedGuests: JSON.stringify(nextApproved), guests: JSON.stringify(nextPending) },
    });

    if (!stream.liveKitRoom) throw new Error('Stream has no live room');
    const token = await liveKitService.generateGuestToken(stream.liveKitRoom, user.id, user.username || user.id);
    return { token, roomName: stream.liveKitRoom };
  }

  /** Host rejects a viewer's guest request. */
  async rejectGuestRequest(streamId: string, hostId: string, viewerId: string) {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream || stream.hostId !== hostId) throw new Error('Unauthorized');
    const pending = this.parseJsonList(stream.guests).filter((id) => id !== viewerId);
    await prisma.liveStream.update({ where: { id: streamId }, data: { guests: JSON.stringify(pending) } });
    return { pending };
  }

  /** Host removes a guest from the stage (or a guest leaves). Kicks from LiveKit. */
  async removeGuest(streamId: string, actorId: string, guestId: string, isHost: boolean) {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream) throw new Error('Stream not found');
    if (isHost && stream.hostId !== actorId) throw new Error('Unauthorized');
    const approved = this.parseJsonList(stream.approvedGuests).filter((id) => id !== guestId);
    const pending = this.parseJsonList(stream.guests).filter((id) => id !== guestId);
    await prisma.liveStream.update({
      where: { id: streamId },
      data: { approvedGuests: JSON.stringify(approved), guests: JSON.stringify(pending) },
    });

    if (stream.liveKitRoom) {
      liveKitService.removeParticipant(stream.liveKitRoom, guestId).catch(() => undefined);
    }
    return { removed: guestId };
  }

  /** Host ends a guest's stage-session (shortcut for removeGuest). */
  async endGuestSession(streamId: string, hostId: string, guestId: string) {
    return this.removeGuest(streamId, hostId, guestId, true);
  }

  /** Full snapshot of the guest stage: pending requests + on-stage guests + capacity. */
  async getGuestState(streamId: string) {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream) throw new Error('Stream not found');
    const pendingIds = this.parseJsonList(stream.guests);
    const approvedIds = this.parseJsonList(stream.approvedGuests);

    const [pendingUsers, approvedUsers] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: pendingIds } }, select: { id: true, username: true, fullName: true, avatar: true, verified: true } }),
      prisma.user.findMany({ where: { id: { in: approvedIds } }, select: { id: true, username: true, fullName: true, avatar: true, verified: true } }),
    ]);

    const order = (ids: string[], users: Array<{ id: string }>) => ids.map((id) => users.find((u) => u.id === id)).filter(Boolean);

    return {
      streamId,
      hostId: stream.hostId,
      guests: order(approvedIds, approvedUsers),
      pending: order(pendingIds, pendingUsers),
      guestCount: approvedIds.length,
      guestLimit: LiveService.MAX_GUESTS,
      totalSlots: 5,
    };
  }

  /** Whether the current user is a live stage participant (host or approved guest). */
  async isStageParticipant(streamId: string, userId: string): Promise<'host' | 'guest' | null> {
    const stream = await this.getLiveIdOwner(streamId);
    if (!stream) return null;
    if (stream.hostId === userId) return 'host';
    if (this.parseJsonList(stream.approvedGuests).includes(userId)) return 'guest';
    return null;
  }
}

/** In-process pins. Ephemeral per host instance — acceptable for a live pin. */
interface PinnedMessage {
  id: string;
  streamId: string;
  userId: string;
  username: string | null;
  avatar?: string | null;
  message: string;
  createdAt: string;
}
const livePins = new Map<string, PinnedMessage | null>();

export const liveService = new LiveService();