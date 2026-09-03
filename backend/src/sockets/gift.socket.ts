import { Server, Socket } from 'socket.io';
import { prisma } from '../prisma';
import { giftService } from '../services/gift.service';

// Cache of active combo timers per stream
const streamCombos = new Map<string, Map<string, { count: number; timer: NodeJS.Timeout }>>();

export function handleGiftSocket(io: Server) {
  const giftNamespace = io.of('/gifts');

  giftNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    const jwt = require('jsonwebtoken');
    if (!process.env.JWT_SECRET) {
      return next(new Error('Server configuration error'));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err: any, decoded: any) => {
      if (err) return next(new Error('Invalid token'));
      socket.data.userId = decoded.userId;
      socket.data.username = decoded.username || 'Unknown';
      next();
    });
  });

  giftNamespace.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    const username = socket.data.username;

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
        const result = await giftService.sendGift(userId, receiverId, giftId, streamId, {
          isAnon: Boolean(isAnon),
          isSuper: Boolean(isSuper),
          requestId,
        });
        const { transaction, gift } = result;

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