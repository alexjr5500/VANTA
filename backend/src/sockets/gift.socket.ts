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
        const result = await giftService.sendGift(userId, receiverId, giftId, streamId, { isAnon: Boolean(isAnon), requestId });
        const { transaction, gift } = result;

        // Emit gift event to all viewers in the stream
        const giftEvent = {
          id: transaction.id,
          senderId: userId,
          senderName: isAnon ? 'Anonymous' : username,
          receiverId,
          giftId: gift.id,
          giftName: gift.name,
          giftEmoji: gift.emoji,
          amount: transaction.amount,
          isLegendary: gift.isLegendary,
          isCombo: false,
          comboCount: result.quantity,
          isAnon: isAnon || false,
          isSuper: isSuper || false,
          glowColor: gift.glowColor,
          particleColor: gift.particleColor,
          animationDuration: gift.animationDuration,
          timestamp: new Date().toISOString(),
        };

        // Send to all users in stream
        giftNamespace.to(`stream:${streamId}`).emit('gift:received', giftEvent);

        // Also send to the streamer specifically
        giftNamespace.to(`user_${receiverId}`).emit('gift:notification', {
          ...giftEvent,
          message: `${isAnon ? 'Someone' : username} sent ${gift.name}!`,
        });

        // If legendary, trigger cinematic event
        if (gift.isLegendary) {
          giftNamespace.to(`stream:${streamId}`).emit('gift:legendary', {
            ...giftEvent,
            duration: gift.animationDuration || 8,
            cinematic: true,
          });
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