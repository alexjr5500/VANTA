import { prisma } from "../prisma";
import { cacheService, CACHE_KEYS, CACHE_TTL } from "./cache.service";
import { dbPerformanceTracker } from "./monitoring.service";
import { liveKitService } from "./livekit.service";
import { notificationService } from "./notification.service";
import { BADGE_USER_SELECT, enrichPublicUser, enrichItemAuthors } from "./public-verification";

// ---------------------------------------------------------------------------
// Live session heartbeat / stale-session timeout
// ---------------------------------------------------------------------------
// The BACKEND is the source of truth for "is this Live actually alive". While a
// host is broadcasting they must refresh `lastHostHeartbeat` at least every
// 30 seconds. If the server sees no heartbeat for this long the session is
// treated as abandoned (browser closed, laptop shut down, network lost,
// process killed) and automatically ended:
//   * the session is marked ENDED / inactive
//   * the LiveKit room is closed
//   * the host can immediately start a new Live afterwards
export const LIVE_HEARTBEAT_TIMEOUT_MS = 30_000;
/** How often the server-side sweeper looks for expired sessions. */
export const LIVE_SESSION_SWEEP_INTERVAL_MS = 10_000;

export class LiveService {
  /** Enrich a live stream's host/co-host with public verification info. */
  private serializeStream<T extends Record<string, any>>(stream: T | null): T | null {
    if (!stream || typeof stream !== "object") return stream;
    return enrichItemAuthors(stream) as T;
  }

  async getActiveStreams(cursor?: string, limit: number = 20) {
    return cacheService.getOrSet(CACHE_KEYS.LIVE_STREAMS, async () => {
      const queryStart = Date.now();
      
      const streams = await prisma.liveStream.findMany({
        where: { active: true, status: "LIVE" },
        orderBy: { viewerCount: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
          category: { select: { name: true } },
          _count: { select: { viewers: true, giftEvents: true } },
        },
      });

      dbPerformanceTracker.trackQuery('LiveStream', Date.now() - queryStart, 'findManyActive');

      const nextCursor = streams.length > limit ? streams.pop()?.id : undefined;
      return { items: streams.map((s) => this.serializeStream(s)), nextCursor };
    }, CACHE_TTL.SHORT);
  }

  async getStream(streamId: string) {
    return cacheService.getOrSet(CACHE_KEYS.LIVE_STREAM(streamId), async () => {
      const queryStart = Date.now();
      
      const stream = await prisma.liveStream.findUnique({
        where: { id: streamId },
        include: {
          host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT, bio: true } },
          category: { select: { name: true } },
          coHost: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
          _count: { select: { viewers: true, giftEvents: true, reactions: true } },
        },
      });

      dbPerformanceTracker.trackQuery('LiveStream', Date.now() - queryStart, 'findUnique');
      
      return this.serializeStream(stream);
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
    allowGuests?: boolean,
    language?: string,
    country?: string,
    recordingEnabled?: boolean
  ) {
    // Create LiveKit room
    const roomName = liveKitService.generateRoomName(hostId);
    await liveKitService.createRoom(roomName);

    // Get host info for token
    const host = await prisma.user.findUnique({
      where: { id: hostId },
      select: { id: true, username: true, fullName: true, avatar: true },
    });

    let stream;
    // LiveKit rooms of stale sessions discovered inside the transaction get
    // closed AFTER it commits (interactive transactions on the SQLite dev
    // connection must not issue nested non-tx prisma calls).
    const staleRoomCleanups: string[] = [];
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

      stream = await prisma.$transaction(async (tx: any) => {
        // ATOMIC duplicate-start guard. The "does this host already have an
        // active Live?" check and the session creation now run inside the SAME
        // transaction, so two simultaneous "Go Live" taps serialize on the
        // database connection: the second request re-reads the row the first is
        // mid-writing, sees the fresh session and is rejected. Previously the
        // check ran BEFORE the create — two concurrent requests could both pass
        // it and create two active sessions for one host (only one heartbeat
        // would ever be sent, leaving an orphaned "active" session).
        const existing = await tx.liveStream.findFirst({
          where: { hostId, active: true, status: 'LIVE' },
          select: { id: true, lastHostHeartbeat: true, startedAt: true, liveKitRoom: true },
        });
        if (existing) {
          // Never trust a bare `active = true` flag: if the previous session's
          // heartbeat has expired it is a stale/abandoned session and must be
          // cleaned up first, otherwise the host would be permanently blocked
          // from going Live again after a crash / disconnect.
          const heartbeat = existing.lastHostHeartbeat || existing.startedAt || new Date(0);
          if (Date.now() - new Date(heartbeat).getTime() <= LIVE_HEARTBEAT_TIMEOUT_MS) {
            throw new Error('You already have an active livestream');
          }
          // Stale session: mark it ended inside the transaction (the viewer
          // roster cleanup + cache invalidation happen after commit).
          await tx.liveStream.update({
            where: { id: existing.id },
            data: { active: false, status: 'ENDED', endedAt: new Date(), lastHostHeartbeat: new Date() },
          });
          if (existing.liveKitRoom) staleRoomCleanups.push(existing.liveKitRoom);
        }

        try {
          return await tx.liveStream.create({
            data: {
              hostId,
              title,
              description: description || '',
              categoryName: cleanedCategory || undefined,
              thumbnailUrl,
              allowGifts: allowGifts ?? true,
              allowPK: allowPK ?? false,
              allowGuests: allowGuests ?? true,
              language: language || 'en',
              country,
              recordingEnabled: recordingEnabled ?? false,
              liveKitRoom: roomName,
              status: 'LIVE',
              active: true,
              startedAt: new Date(),
              lastHostHeartbeat: new Date(),
              viewerCount: 0,
              peakViewers: 0,
              totalViewers: 0,
            },
            include: {
              host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
              category: { select: { name: true } },
            },
          });
        } catch (err: any) {
          // Pre-migration fallback: if the `allowGuests` column does not exist
          // yet (database not pushed), degrade to the platform default (guests
          // allowed) instead of failing the entire Go Live flow.
          if (err?.meta?.column_name === 'allowGuests' || `${err?.meta?.message ?? err?.message ?? ''}`.includes('allowGuests')) {
            return tx.liveStream.create({
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
                lastHostHeartbeat: new Date(),
                viewerCount: 0,
                peakViewers: 0,
                totalViewers: 0,
              },
              include: {
                host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
                category: { select: { name: true } },
              },
            });
          }
          throw err;
        }
      });
    } catch (error) {
      await liveKitService.closeRoom(roomName).catch(() => undefined);
      throw error;
    }

    // A stale session was discovered inside the transaction: close its LiveKit
    // room and drop its viewer roster now that the commit has succeeded.
    if (staleRoomCleanups.length) {
      await Promise.allSettled(staleRoomCleanups.map((r) => liveKitService.closeRoom(r)));
    }

    // Invalidate streams cache (new session created, so the old cached copy for
    // any stale session is also obsolete).
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

    return this.finishStream(stream);
  }

  /**
   * Internal teardown shared by host-initiated ends and the server-side
   * stale-session sweeper. Marks the session ended, closes the LiveKit room
   * (if any) and invalidates the active-streams caches.
   */
  private async finishStream(stream: { id: string; startedAt?: Date | null; liveKitRoom?: string | null }) {
    // Calculate duration
    const duration = stream.startedAt
      ? Math.floor((Date.now() - stream.startedAt.getTime()) / 1000)
      : 0;

    // Close LiveKit room
    if (stream.liveKitRoom) {
      await liveKitService.closeRoom(stream.liveKitRoom).catch(() => undefined);
    }

    const updated = await prisma.liveStream.update({
      where: { id: stream.id },
      data: {
        active: false,
        status: 'ENDED',
        endedAt: new Date(),
        lastHostHeartbeat: new Date(),
        duration,
      },
    });

    // Tear down the viewer roster for the ended session: the per-viewer
    // membership rows served their purpose (unique join dedup + live counts)
    // and must not accumulate forever on ended streams, inflate later queries,
    // or let a stale socket's `leave` decrement a non-live session. The last
    // live viewerCount snapshot is preserved on the LiveStream row itself.
    await prisma.streamViewer.deleteMany({ where: { streamId: stream.id } });

    // Invalidate caches
    await cacheService.del(CACHE_KEYS.LIVE_STREAMS);
    await cacheService.del(CACHE_KEYS.LIVE_STREAM(stream.id));

    return updated;
  }

  /**
   * End a live session that is no longer heartbeating (host abandoned it).
   * Idempotent and safe to call from the periodic sweeper or from `startStream`
   * when the host is trying to go Live again.
   */
  async endStaleStream(streamId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
    });
    if (!stream || !stream.active || stream.status !== 'LIVE') return null;
    const ended = await this.finishStream(stream);
    return { ...ended, reason: 'host_timeout' as const };
  }

  /**
   * Admin moderation: end a live stream regardless of host. The caller must be
   * an authenticated administrator (enforced at the route layer). Audited by
   * the admin controller.
   */
  async adminEndStream(streamId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
    });
    if (!stream) throw new Error('Stream not found');
    if (!stream.active || stream.status !== 'LIVE') {
      return { ...stream, alreadyEnded: true };
    }
    return this.finishStream(stream);
  }

  /**
   * Admin moderation: end a live stream and mark it SUSPENDED (visible to the
   * host as a moderation action rather than a normal end). Audited by the
   * admin controller.
   */
  async adminSuspendStream(streamId: string, reason: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
    });
    if (!stream) throw new Error('Stream not found');

    if (stream.liveKitRoom) {
      await liveKitService.closeRoom(stream.liveKitRoom).catch(() => undefined);
    }

    const updated = await prisma.liveStream.update({
      where: { id: streamId },
      data: {
        active: false,
        status: 'SUSPENDED',
        endedAt: new Date(),
        lastHostHeartbeat: new Date(),
        duration: stream.startedAt ? Math.floor((Date.now() - stream.startedAt.getTime()) / 1000) : stream.duration,
      },
    });

    await cacheService.del(CACHE_KEYS.LIVE_STREAMS);
    await cacheService.del(CACHE_KEYS.LIVE_STREAM(stream.id));
    return { ...updated, reason };
  }

  /**
   * Record a host heartbeat for the given stream. Returns true when the
   * session is still genuinely active, false when it has already been ended.
   */
  async recordHeartbeat(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, hostId: true, active: true, status: true },
    });
    if (!stream) throw new Error("Stream not found");
    if (stream.hostId !== hostId) throw new Error("Unauthorized");
    if (!stream.active || stream.status !== 'LIVE') return false;

    await prisma.liveStream.update({
      where: { id: streamId },
      data: { lastHostHeartbeat: new Date() },
    });
    await cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId));
    return true;
  }

  /**
   * Server-side authoritative sweep. Finds every session that is still marked
   * active but whose host heartbeat is older than the 30-second timeout and
   * ends it. Used by the socket layer on a fixed interval and once at server
   * startup, so an abandoned Live can never stay "active" forever — even if
   * the client never told us it left.
   */
  async sweepStaleLiveStreams() {
    const cutoff = new Date(Date.now() - LIVE_HEARTBEAT_TIMEOUT_MS);
    const stale = await prisma.liveStream.findMany({
      where: {
        active: true,
        status: 'LIVE',
        OR: [
          { lastHostHeartbeat: { lt: cutoff } },
          { lastHostHeartbeat: null, startedAt: { lt: cutoff } },
        ],
      },
      select: { id: true, hostId: true, liveKitRoom: true },
      take: 200,
    });

    if (stale.length === 0) return [];

    const ended: Array<{ id: string; hostId: string; liveKitRoom?: string | null }> = [];
    for (const stream of stale) {
      try {
        const result = await this.endStaleStream(stream.id);
        if (result) ended.push(stream);
      } catch (error) {
        console.error(`[LiveSweep] Failed to end stale stream ${stream.id}:`, error);
      }
    }

    if (ended.length > 0) {
      console.info(`[LiveSweep] Automatically ended ${ended.length} stale live session(s) (no heartbeat for >30s)`);
    }
    return ended;
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

    cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId)).catch(() => undefined);

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

    cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId)).catch(() => undefined);

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
        user: { select: { id: true, username: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
      },
    });

    const nextCursor = messages.length > limit ? messages.pop()?.id : undefined;
    return { items: messages.reverse().map((m) => enrichItemAuthors(m)), nextCursor };
  }

  async postChatMessage(streamId: string, userId: string, message: string) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || normalizedMessage.length > 500) {
      throw new Error('Messages must be between 1 and 500 characters');
    }
    // Check if stream has chat paused
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { chatPaused: true, slowMode: true, slowModeInterval: true, bannedUsers: true, mutedUsers: true, active: true, status: true },
    });

    if (!stream) throw new Error("Stream not found");
    // A comment must only ever land on a genuinely live session. This also
    // rejects the REST `POST /:streamId/message` path against ended sessions.
    if (!stream.active || stream.status !== 'LIVE') throw new Error("Stream is not live");
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
        user: { select: { id: true, username: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
      },
    });

    return chatMessage;
  }

  async addReaction(streamId: string, userId: string, emoji: string) {
    const allowedReactions = new Set(['❤️', '🔥', '👏', '😂', '😍', '🎉']);
    if (!allowedReactions.has(emoji)) throw new Error('Unsupported reaction');
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { active: true, status: true, bannedUsers: true, mutedUsers: true },
    });
    if (!stream?.active || stream.status !== 'LIVE') throw new Error('Stream is not live');

    // Comments already reject banned/muted users in `postChatMessage`; reactions
    // must enforce the same stream-moderation rules or a banned user could keep
    // spamming floating hearts and the `likes` counter even after being removed.
    const bannedUsers: string[] = stream.bannedUsers ? JSON.parse(stream.bannedUsers) : [];
    if (bannedUsers.includes(userId)) throw new Error('You are banned from this stream');
    const mutedUsers: string[] = stream.mutedUsers ? JSON.parse(stream.mutedUsers) : [];
    if (mutedUsers.includes(userId)) throw new Error('You are muted in this stream');

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

    // The `likes` counter drives trending + stream detail; keep the cached
    // stream and discovery copy in sync (debounced via the cache layer).
    cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId)).catch(() => undefined);

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
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });

    const nextCursor = streams.length > limit ? streams.pop()?.id : undefined;
    return { items: streams.map((s) => this.serializeStream(s)), nextCursor };
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
    for (const key of ['allowGifts', 'allowPK', 'allowGuests', 'recordingEnabled'] as const) {
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

    return (await prisma.liveStream.findMany({
      where: { 
        hostId: { in: streamerIds },
        active: true,
        status: 'LIVE',
      },
      orderBy: { viewerCount: 'desc' },
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
        category: { select: { name: true } },
        _count: { select: { viewers: true } },
      },
    })).map((s) => this.serializeStream(s));
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
    // The REST like path is a fallback for legacy clients; it must never mutate
    // an ended session. The socket `reaction` path is the primary realtime way
    // to like a live stream and is already guarded by `addReaction`.
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, active: true, status: true },
    });
    if (!stream) throw new Error('Stream not found');
    if (!stream.active || stream.status !== 'LIVE') throw new Error('Stream is not live');

    const updated = await prisma.liveStream.update({
      where: { id: streamId },
      data: { likes: { increment: 1 } },
      select: { likes: true },
    });
    cacheService.del(CACHE_KEYS.LIVE_STREAM(streamId)).catch(() => undefined);
    return updated;
  }

  async getTrendingStreams(limit: number = 10) {
    const streams = await prisma.liveStream.findMany({
      where: { active: true, status: 'LIVE' },
      orderBy: [
        { viewerCount: 'desc' },
        { gifts: 'desc' },
        { likes: 'desc' },
      ],
      take: limit,
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });
    return streams.map((s) => this.serializeStream(s));
  }

  async getRecentlyEnded(limit: number = 10) {
    const streams = await prisma.liveStream.findMany({
      where: { status: 'ENDED' },
      orderBy: { endedAt: 'desc' },
      take: limit,
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
        category: { select: { name: true } },
        _count: { select: { viewers: true, giftEvents: true } },
      },
    });
    return streams.map((s) => this.serializeStream(s));
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
        ...BADGE_USER_SELECT,
        _count: { select: { streamerFollowers: true, liveStreams: true } },
      },
      orderBy: { streamerFollowers: { _count: 'desc' } },
      take: limit,
    });
    return creators.map(enrichPublicUser);
  }

  async getStreamAnalytics(streamId: string, hostId: string) {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      include: {
        host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
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
      select: { id: true, hostId: true, liveKitRoom: true, active: true, status: true, allowGuests: true, guests: true, approvedGuests: true },
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
    if (stream.allowGuests === false) throw new Error('Guests are not allowed for this stream');
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
      prisma.user.findMany({ where: { id: { in: pendingIds } }, select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } }),
      prisma.user.findMany({ where: { id: { in: approvedIds } }, select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } }),
    ]);

    const order = (ids: string[], users: Array<{ id: string }>) => ids.map((id) => users.find((u) => u.id === id)).filter(Boolean);

    return {
      streamId,
      hostId: stream.hostId,
      allowGuests: stream.allowGuests !== false,
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