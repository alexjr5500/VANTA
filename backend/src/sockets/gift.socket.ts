import { Server, Socket } from 'socket.io';
import { prisma } from '../prisma';
import { giftService } from '../services/gift.service';
import { liveRateLimiter } from '../security/liveRateLimiter';
import { authenticateSocket } from '../security/webSocketSecurity';

// Cache of active combo timers per stream
const streamCombos = new Map<string, Map<string, { count: number; timer: NodeJS.Timeout }>>();

export function handleGiftSocket(io: Server) {
  const giftNamespace = io.of('/gifts');

  // VANTA-003 (security audit): this namespace previously authenticated with a
  // bare `jwt.verify` — the signature was checked but the session was never
  // validated against the database, the user's account status was not checked,
  // and the token type claim was not verified. Because `gift:send` executes a
  // REAL financial transaction (vanta.coin moves), a revoked session or
  // suspended account could keep sending gifts over the socket for the full
  // access-token lifetime. The canonical session-aware middleware now runs on
  // every /gifts connection: revoked sessions, rotated tokens, expired tokens
  // and suspended/banned accounts are rejected at the handshake, exactly like
  // the REST API.
  giftNamespace.use(authenticateSocket);

  giftNamespace.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId || socket.data.userId;
    if (!userId) {
      socket.disconnect();
      return;
    }

    // Resolve the verified user's public identity for gift event attribution
    // (authenticateSocket binds the id; the username is looked up server-side,
    // never taken from a client claim).
    const usernamePromise = prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, fullName: true },
    }).then((u) => (u && u.username) || 'Unknown').catch(() => 'Unknown');

    // Personal room for real-time gift delivery wherever the user is in the app.
    socket.join(`user_${userId}`);

    // Join stream room for live gift events
    socket.on('join:stream', (streamId: string) => {
      socket.join(`stream:${streamId}`);
      socket.data.currentStream = streamId;
    });

    socket.on('leave:stream', (streamId: string) => {
      socket.leave(`stream:${streamId}`);
      socket.data.currentStream = null;
    });

    // Send a gift during a live stream
    socket.on('gift:send', async (data: {
      receiverId: string;
      giftId: string;
      streamId: string;
      requestId: string;
      isAnon?: boolean;
      isSuper?: boolean;
    }) => {
      try {
        const { receiverId, giftId, streamId, isAnon, isSuper, requestId } = data;
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error('A valid requestId is required');
        // Same per-user gift throttle as the live namespace: wallet transactions
        // are expensive and must not be scriptable at arbitrary rate.
        const limited = liveRateLimiter.check(userId, 'gift');
        if (!limited.ok) {
          socket.emit('gift:error', { message: 'Sending gifts too fast. Please slow down.', retryAfterMs: limited.retryAfterMs });
          return;
        }
        const result = await giftService.sendGift(userId, receiverId, giftId, streamId, {
          isAnon: Boolean(isAnon),
          isSuper: Boolean(isSuper),
          requestId,
        });
        const { transaction, gift } = result;
        const username = await usernamePromise;

        // `sendGift` is the single publisher of the canonical `gift_received`
        // event (stream room + recipient/sender user rooms). Reuse that rich
        // payload on the /gifts namespace so every consumer animates the actual
        // gift artwork with tier-specific effects — never a degraded,
        // message-only form. Fall back to a basic payload for replayed requests.
        const giftEvent: any = (result as any).giftEvent || {
          id: transaction.id,
          streamId,
          senderId: userId,
          senderName: isAnon ? 'Anonymous' : username,
          receiverId,
          giftId: gift.id,
          giftName: gift.name,
          amount: transaction.amount,
          comboCount: result.quantity || 1,
          isAnon: Boolean(isAnon),
          isSuper: Boolean(isSuper),
          isLegendary: Boolean(gift.isLegendary),
          giftSlug: gift.slug,
          thumbnailUrl: gift.thumbnailUrl,
          animationUrl: gift.animationUrl,
          animationType: gift.animationType,
          glowColor: gift.glowColor,
          particleColor: gift.particleColor,
          animationDuration: gift.animationDuration,
          timestamp: new Date().toISOString(),
        };

        if (giftEvent?.id) {
          // Send to all users in stream
          giftNamespace.to(`stream:${streamId}`).emit('gift:received', giftEvent);

          // Also surface the animation to the sender + recipient user rooms
          // (the global overlay host picks this up on any page).
          giftNamespace.to(`user_${userId}`).emit('gift:received', giftEvent);
          giftNamespace.to(`user_${receiverId}`).emit('gift:received', giftEvent);

          // Also send to the streamer specifically
          giftNamespace.to(`user_${receiverId}`).emit('gift:notification', {
            ...giftEvent,
            message: `${isAnon ? 'Someone' : username} sent ${gift.name}!`,
          });

          // If legendary, also trigger the cinematic event
          if (gift.isLegendary) {
            giftNamespace.to(`stream:${streamId}`).emit('gift:legendary', {
              ...giftEvent,
              duration: gift.animationDuration || 8,
              cinematic: true,
            });
          }
        }

        // Emit updated leaderboard
        const { monetizationService } = require('../services');
        const leaderboard = await monetizationService.getTopSupporters(receiverId, 5);
        giftNamespace.to(`stream:${streamId}`).emit('leaderboard:update', leaderboard);

        // Return success to sender
        socket.emit('gift:sent', {
          success: true,
          transaction: transaction,
          remainingBalance: result.remainingBalance,
        });

      } catch (error: any) {
        socket.emit('gift:error', {
          message: error.message || 'Failed to send gift',
        });
      }
    });

    // Get recent gifts for stream
    socket.on('gifts:recent', async (streamId: string) => {
      try {
        const recentGifts = await prisma.liveGiftEvent.findMany({
          where: { streamId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            sender: { select: { id: true, username: true, avatar: true } },
          },
        });

        socket.emit('gifts:recent:list', recentGifts);
      } catch (error) {
        socket.emit('gift:error', { message: 'Failed to load recent gifts' });
      }
    });

    // Top supporters for stream
    socket.on('supporters:top', async (data: { receiverId: string; limit?: number }) => {
      try {
        const { monetizationService } = require('../services');
        const supporters = await monetizationService.getTopSupporters(data.receiverId, data.limit || 10);
        socket.emit('supporters:top:list', supporters);
      } catch (error) {
        socket.emit('gift:error', { message: 'Failed to load supporters' });
      }
    });

    socket.on('disconnect', () => {
      // Clean up any combo timers
      if (socket.data.currentStream) {
        const combos = streamCombos.get(socket.data.currentStream);
        if (combos) {
          const userCombo = combos.get(userId);
          if (userCombo) {
            clearTimeout(userCombo.timer);
            combos.delete(userId);
          }
        }
      }
    });
  });

  return giftNamespace;
}