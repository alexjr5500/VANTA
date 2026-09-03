import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { liveService, giftService } from '../services';
import { liveKitService } from '../services/livekit.service';

// In-process stream → hostId cache (set when a host opens the control room). Used
// for guaranteed real-time delivery to the host's `user_` room so comments/gift
// events always reach them even if their socket left a stream room on reconnect.
const streamHosts = new Map<string, string>();

/** Emit a lightweight typed activity event (system messages) to the room + host. */
function emitActivity(io: Server, streamId: string, type: string, payload: Record<string, unknown>) {
  const hostId = streamHosts.get(streamId);
  const event = { streamId, type, ...payload, at: new Date().toISOString() };
  io.to(`stream_${streamId}`).emit('live_event', event);
  if (hostId) io.to(`user_${hostId}`).emit('live_event', event);
}

/** Fetch a user's public identity for event payloads. */
async function getUserIdentity(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, fullName: true, avatar: true, verified: true } });
  return user
    ? { id: user.id, username: user.username, displayName: user.fullName || user.username, avatar: user.avatar, verified: !!user.verified }
    : { id: userId, username: userId.slice(0, 8), displayName: 'User', avatar: null, verified: false };
}

export const handleLiveSocket = (io: Server) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));

    if (!process.env.JWT_SECRET) {
      return next(new Error('Server configuration error'));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err: any, decoded: any) => {
      if (err) return next(new Error('Authentication error'));
      socket.data.userId = decoded.userId;
      next();
    });
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    socket.data.streamId = null;

    const leaveCurrentStream = async () => {
      const current = socket.data.streamId as string | null;
      if (!current) return;
      try {
        const count = await liveService.leaveStream(current, userId);
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, avatar: true } });
        io.to(`stream_${current}`).emit('viewer_count', { streamId: current, viewers: count });
        io.to(`stream_${current}`).emit('viewer_left', { streamId: current, userId, username: user?.username, avatar: user?.avatar });
        emitActivity(io, current, 'left', { user: { id: userId, username: user?.username || userId, avatar: user?.avatar } });
      } catch (err) {
        console.error('Error leaving stream on disconnect:', err);
      } finally {
        socket.leave(`stream_${current}`);
        socket.data.streamId = null;
      }
    };

    socket.on('join_stream', async (streamId: string) => {
      try {
        if (typeof streamId !== 'string' || streamId.length > 128) throw new Error('Invalid stream');
        if (socket.data.streamId === streamId) return;
        await leaveCurrentStream();
        await liveService.joinStream(streamId, userId);
        socket.join(`stream_${streamId}`);
        socket.data.streamId = streamId;
        const count = await liveService.countViewers(streamId);
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, avatar: true } });
        io.to(`stream_${streamId}`).emit('viewer_count', { streamId, viewers: count });
        io.to(`stream_${streamId}`).emit('viewer_joined', { streamId, userId, username: user?.username, avatar: user?.avatar });
        emitActivity(io, streamId, 'joined', { user: await getUserIdentity(userId) });
        // Send the current roster to the newly-joined viewer.
        const members = await prisma.streamViewer.findMany({
          where: { streamId },
          include: { user: { select: { id: true, username: true, avatar: true } } },
          take: 250,
        });
        socket.emit('viewers_list', {
          streamId,
          viewers: members.map((m) => ({ id: m.user.id, username: m.user.username, avatar: m.user.avatar })),
        });
      } catch (err) {
        console.error('Error joining stream:', err);
        socket.emit('stream_error', { error: err instanceof Error ? err.message : 'Unable to join the stream' });
      }
    });

    socket.on('leave_stream', async (streamId: string) => {
      try {
        if (socket.data.streamId === streamId) await leaveCurrentStream();
      } catch (err) {
        console.error('Error leaving stream:', err);
      }
    });

    socket.on('send_comment', async (data) => {
      const { streamId, comment } = data;
      try {
        if (socket.data.streamId !== streamId || typeof comment !== 'string') throw new Error('Invalid chat request');
        const chatMessage = await liveService.postChatMessage(streamId, userId, comment);
        // Broadcast to the whole room (viewers + host) AND to the host's personal
        // `user_` room so comments always reach the host even if their socket
        // failed to rejoin a stream room after a reconnect.
        io.to(`stream_${streamId}`).emit('new_comment', { streamId, message: chatMessage });
        const hostId = streamHosts.get(streamId);
        if (hostId) io.to(`user_${hostId}`).emit('new_comment', { streamId, message: chatMessage });
      } catch (err: any) {
        console.error('Error sending comment:', err);
        socket.emit('chat_error', { error: err.message || 'Unable to send comment' });
      }
    });

    socket.on('reaction', async (data) => {
      const { streamId, emoji } = data;
      try {
        if (socket.data.streamId !== streamId || typeof emoji !== 'string') throw new Error('Invalid reaction request');
        // A LIKE is an ephemeral live interaction — it is NOT a chat message.
        // addReaction aggregates the like into the stream's `likes` counter (and
        // persists at most one deduped LiveReaction marker per user+emoji), so
        // rapid taps never create per-tap chat rows or per-tap DB records.
        const reaction = await liveService.addReaction(streamId, userId, emoji);
        // Broadcast the lightweight floating-heart event to every viewer in the
        // room AND to the host's personal `user_` room so the streamer always
        // receives likes in realtime. No `live_event` is emitted for a like, so
        // it can never be rendered as a chat/activity line.
        const reactionEvent = { streamId, userId, emoji, totalLikes: reaction.totalLikes };
        io.to(`stream_${streamId}`).emit('reaction', reactionEvent);
        const hostId = streamHosts.get(streamId);
        if (hostId) io.to(`user_${hostId}`).emit('reaction', reactionEvent);
      } catch (err) {
        console.error('Error sending reaction:', err);
      }
    });

    socket.on('send_gift', async (data) => {
      const { streamId, giftId, quantity, requestId } = data;
      try {
        if (socket.data.streamId !== streamId || typeof giftId !== 'string') throw new Error('Invalid gift request');
        if (quantity !== undefined && quantity !== 1) throw new Error('Gift quantity is not supported');
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error('A valid requestId is required');
        const stream = await liveService.getStream(streamId);
        if (!stream) throw new Error('Stream not found');
        
        const tx = await giftService.sendGift(userId, stream.hostId, giftId, streamId, { requestId });
        // GiftService is the single publisher for normalized room events. Do
        // not emit a second, reduced payload here or viewers animate twice.
        socket.emit('gift_sent', tx);
        emitActivity(io, streamId, 'gift', { user: await getUserIdentity(userId), giftName: tx?.gift?.name || 'a gift', amount: tx?.amount, quantity: tx?.quantity || 1 });
      } catch (err) {
        console.error('Error sending gift:', err);
        socket.emit('gift_error', { error: err instanceof Error ? err.message : 'Failed to send gift' });
      }
    });

    // Host controls
    socket.on('end_stream', async (data) => {
      const { streamId } = data;
      try {
        await liveService.endStream(streamId, userId);
        io.to(`stream_${streamId}`).emit('stream_ended', { streamId });
        io.to(`stream_${streamId}`).emit('stream_state', { streamId, state: 'ENDED' });
        // Close LiveKit room in background
        const stream = await liveService.getStream(streamId);
        if (stream?.liveKitRoom) {
          liveKitService.closeRoom(stream.liveKitRoom).catch(() => {});
        }
      } catch (err) {
        console.error('Error ending stream:', err);
      }
    });

    socket.on('stream_state', async (data) => {
      const { streamId, state } = data;
      try {
        if (socket.data.streamId !== streamId) return;
        const validStates = ['STARTING', 'LIVE', 'RECONNECTING', 'ENDED', 'FAILED'];
        if (!validStates.includes(state)) throw new Error('Invalid stream state');
        io.to(`stream_${streamId}`).emit('stream_state', { streamId, state });
      } catch (err) {
        console.error('Error updating stream state:', err);
      }
    });

    socket.on('mute_viewer', async (data) => {
      const { streamId, targetUserId } = data;
      try {
        await liveService.muteViewer(streamId, userId, targetUserId);
        io.to(`stream_${streamId}`).emit('viewer_muted', { streamId, userId: targetUserId });
      } catch (err) {
        console.error('Error muting viewer:', err);
      }
    });

    socket.on('ban_viewer', async (data) => {
      const { streamId, targetUserId } = data;
      try {
        await liveService.banViewer(streamId, userId, targetUserId);
        io.to(`stream_${streamId}`).emit('viewer_banned', { streamId, userId: targetUserId });
        // Also disconnect their socket from the room
        const sockets = await io.in(`stream_${streamId}`).fetchSockets();
        sockets.forEach(s => {
          if (s.data.userId === targetUserId) {
            s.leave(`stream_${streamId}`);
            s.emit('banned_from_stream', { streamId });
          }
        });
      } catch (err) {
        console.error('Error banning viewer:', err);
      }
    });

    socket.on('toggle_chat_pause', async (data) => {
      const { streamId } = data;
      try {
        const stream = await liveService.toggleChatPause(streamId, userId);
        io.to(`stream_${streamId}`).emit('chat_paused', { 
          streamId, 
          paused: stream.chatPaused 
        });
      } catch (err) {
        console.error('Error toggling chat pause:', err);
      }
    });

    socket.on('toggle_slow_mode', async (data) => {
      const { streamId, interval } = data;
      try {
        const stream = await liveService.toggleSlowMode(streamId, userId, interval);
        io.to(`stream_${streamId}`).emit('slow_mode', { 
          streamId, 
          enabled: stream.slowMode,
          interval: stream.slowModeInterval 
        });
      } catch (err) {
        console.error('Error toggling slow mode:', err);
      }
    });

    socket.on('update_stream_settings', async (data) => {
      const { streamId, settings } = data;
      try {
        await liveService.updateStreamSettings(streamId, userId, settings);
        io.to(`stream_${streamId}`).emit('stream_settings_updated', { streamId, settings });
      } catch (err) {
        console.error('Error updating stream settings:', err);
      }
    });

    // Host joins the stream control room (no viewer-count impact) and receives
    // current chat history + moderation settings + pinned message.
    socket.on('host_room', async (streamId: string) => {
      try {
        if (typeof streamId !== 'string' || streamId.length > 128) throw new Error('Invalid stream');
        const stream = await liveService.getStream(streamId);
        if (!stream || stream.hostId !== userId) throw new Error('Not authorized');
        socket.join(`stream_${streamId}`);
        socket.data.streamId = streamId;
        streamHosts.set(streamId, userId);
        const chat = await liveService.getStreamChat(streamId, undefined, 100);
        const mod = await liveService.getStreamModeration(streamId, userId);
        const pinned = liveService.getPinnedMessage(streamId);
        socket.emit('host_chat_history', { streamId, messages: chat.items });
        socket.emit('host_settings', { streamId, settings: mod, pinned });
        const guestState = await liveService.getGuestState(streamId);
        socket.emit('guest_state', guestState);
      } catch (err) {
        console.error('Error joining host room:', err);
        socket.emit('stream_error', { error: err instanceof Error ? err.message : 'Unable to open studio chat' });
      }
    });

    // Viewer shared the live — real-time system event to host + other viewers.
    socket.on('live_share', async (data) => {
      const { streamId } = data || {};
      try {
        if (typeof streamId !== 'string' || socket.data.streamId !== streamId) throw new Error('Invalid share request');
        emitActivity(io, streamId, 'shared', { user: await getUserIdentity(userId) });
      } catch (err) {
        console.error('Error sharing stream:', err);
      }
    });

    // Viewer started following the host — real-time activity.
    socket.on('live_follow', async (data) => {
      const { streamId } = data || {};
      try {
        if (typeof streamId !== 'string' || socket.data.streamId !== streamId) throw new Error('Invalid follow request');
        emitActivity(io, streamId, 'followed', { user: await getUserIdentity(userId) });
      } catch (err) {
        console.error('Error following stream:', err);
      }
    });

    // --- Multi-guest stage -----------------------------------------------
    socket.on('request_join', async (data) => {
      const { streamId } = data || {};
      try {
        if (typeof streamId !== 'string' || socket.data.streamId !== streamId) throw new Error('Invalid request');
        const result = await liveService.requestJoinGuest(streamId, userId);
        const requester = await getUserIdentity(userId);
        emitActivity(io, streamId, 'guest_request', { user: requester });
        socket.emit('guest_request_sent', result);
        const hostId = streamHosts.get(streamId);
        if (hostId) io.to(`user_${hostId}`).emit('guest_request', { streamId, user: requester });
      } catch (err: any) {
        socket.emit('guest_error', { error: err.message || 'Unable to request to join' });
      }
    });

    socket.on('cancel_request', async (data) => {
      const { streamId } = data || {};
      try {
        if (typeof streamId !== 'string') throw new Error('Invalid request');
        const result = await liveService.cancelGuestRequest(streamId, userId);
        emitActivity(io, streamId, 'guest_cancelled', { user: { id: userId, username: (await getUserIdentity(userId)).username } });
        const hostId = streamHosts.get(streamId);
        if (hostId) io.to(`user_${hostId}`).emit('guest_pending', result);
      } catch (err) {
        console.error('Error cancelling guest request:', err);
      }
    });

    socket.on('guest_respond', async (data) => {
      const { streamId, viewerId, accept } = data || {};
      try {
        if (typeof streamId !== 'string' || typeof viewerId !== 'string') throw new Error('Invalid response');
        if (accept) {
          const { token, roomName } = await liveService.acceptGuestRequest(streamId, userId, viewerId);
          const guest = await getUserIdentity(viewerId);
          io.to(`user_${viewerId}`).emit('guest_accepted', { streamId, roomName, token, guest });
          emitActivity(io, streamId, 'guest_joined', { user: guest });
        } else {
          await liveService.rejectGuestRequest(streamId, userId, viewerId);
          io.to(`user_${viewerId}`).emit('guest_rejected', { streamId });
          emitActivity(io, streamId, 'guest_rejected', { user: { id: viewerId, username: (await getUserIdentity(viewerId)).username } });
        }
        const guestState = await liveService.getGuestState(streamId);
        io.to(`stream_${streamId}`).emit('guest_state', guestState);
        io.to(`user_${userId}`).emit('guest_state', guestState);
      } catch (err: any) {
        socket.emit('guest_error', { error: err.message || 'Unable to respond to request' });
      }
    });

    socket.on('guest_remove', async (data) => {
      const { streamId, guestId } = data || {};
      try {
        if (typeof streamId !== 'string' || typeof guestId !== 'string') throw new Error('Invalid removal');
        await liveService.removeGuest(streamId, userId, guestId, true);
        io.to(`user_${guestId}`).emit('guest_removed', { streamId });
        emitActivity(io, streamId, 'guest_removed', { user: { id: guestId, username: (await getUserIdentity(guestId)).username } });
        const guestState = await liveService.getGuestState(streamId);
        io.to(`stream_${streamId}`).emit('guest_state', guestState);
      } catch (err) {
        console.error('Error removing guest:', err);
      }
    });

    socket.on('guest_end_session', async (data) => {
      const { streamId, guestId } = data || {};
      try {
        if (typeof streamId !== 'string' || typeof guestId !== 'string') throw new Error('Invalid request');
        await liveService.endGuestSession(streamId, userId, guestId);
        io.to(`user_${guestId}`).emit('guest_removed', { streamId });
        emitActivity(io, streamId, 'guest_removed', { user: { id: guestId, username: (await getUserIdentity(guestId)).username } });
        const guestState = await liveService.getGuestState(streamId);
        io.to(`stream_${streamId}`).emit('guest_state', guestState);
      } catch (err) {
        console.error('Error ending guest session:', err);
      }
    });

    socket.on('guest_leave', async (data) => {
      const { streamId } = data || {};
      try {
        if (typeof streamId !== 'string') throw new Error('Invalid request');
        await liveService.removeGuest(streamId, userId, userId, false);
        emitActivity(io, streamId, 'guest_left', { user: { id: userId, username: (await getUserIdentity(userId)).username } });
        const guestState = await liveService.getGuestState(streamId);
        io.to(`stream_${streamId}`).emit('guest_state', guestState);
      } catch (err) {
        console.error('Error leaving stage:', err);
      }
    });

    socket.on('guest_state_request', async (data) => {
      const { streamId } = data || {};
      try {
        if (typeof streamId !== 'string') throw new Error('Invalid request');
        const state = await liveService.getGuestState(streamId);
        socket.emit('guest_state', state);
      } catch (err) {
        console.error('Error fetching guest state:', err);
      }
    });

    // Host-only chat moderation.
    socket.on('delete_message', async (data) => {
      const { streamId, messageId } = data;
      try {
        await liveService.deleteMessage(streamId, userId, messageId);
        io.to(`stream_${streamId}`).emit('message_deleted', { streamId, messageId });
      } catch (err) {
        console.error('Error deleting message:', err);
      }
    });

    socket.on('clear_chat', async (data) => {
      const { streamId } = data;
      try {
        await liveService.clearChat(streamId, userId);
        io.to(`stream_${streamId}`).emit('chat_cleared', { streamId });
      } catch (err) {
        console.error('Error clearing chat:', err);
      }
    });

    socket.on('pin_message', async (data) => {
      const { streamId, messageId } = data;
      try {
        const pinned = await liveService.pinMessage(streamId, userId, messageId);
        io.to(`stream_${streamId}`).emit('message_pinned', { streamId, pinned });
      } catch (err) {
        console.error('Error pinning message:', err);
      }
    });

    socket.on('unpin_message', async (data) => {
      const { streamId } = data;
      try {
        await liveService.unpinMessage(streamId, userId);
        io.to(`stream_${streamId}`).emit('message_unpinned', { streamId });
      } catch (err) {
        console.error('Error unpinning message:', err);
      }
    });

    socket.on('unmute_viewer', async (data) => {
      const { streamId, targetUserId } = data;
      try {
        await liveService.unmuteViewer(streamId, userId, targetUserId);
        io.to(`stream_${streamId}`).emit('viewer_unmuted', { streamId, userId: targetUserId });
      } catch (err) {
        console.error('Error unmuting viewer:', err);
      }
    });

    socket.on('unban_viewer', async (data) => {
      const { streamId, targetUserId } = data;
      try {
        await liveService.unbanViewer(streamId, userId, targetUserId);
        io.to(`stream_${streamId}`).emit('viewer_unbanned', { streamId, userId: targetUserId });
      } catch (err) {
        console.error('Error unbanning viewer:', err);
      }
    });

    socket.on('disconnect', async () => {
      await leaveCurrentStream();
    });
  });
};