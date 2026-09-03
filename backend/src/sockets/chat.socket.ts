import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { chatService } from '../services/chat.service';
import { notificationService } from '../services/notification.service';
import { prisma } from '../prisma';

const connectedUsers = new Map<string, Set<string>>();
let chatIO: Server | null = null;

function addConnection(userId: string, socketId: string) {
  const sockets = connectedUsers.get(userId) || new Set<string>();
  sockets.add(socketId);
  connectedUsers.set(userId, sockets);
  return sockets.size;
}

function removeConnection(userId: string, socketId: string) {
  const sockets = connectedUsers.get(userId);
  if (!sockets) return 0;
  sockets.delete(socketId);
  if (!sockets.size) connectedUsers.delete(userId);
  return sockets.size;
}

/**
 * Resolve the OTHER participant id of a private 1-to-1 conversation, or null
 * when the conversation is missing, the caller is not a participant, or the
 * conversation is a group/channel. Calling is intentionally limited to private
 * direct chats only.
 */
async function getDirectCallPeer(conversationId: string, userId: string): Promise<string | null> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { select: { userId: true } } },
    });
    if (!conversation || conversation.isGroup || conversation.type === "GROUP" || conversation.type === "CHANNEL") {
      return null;
    }
    const ids = conversation.participants.map(p => p.userId);
    if (!ids.includes(userId)) return null;
    return ids.find(id => id !== userId) || null;
  } catch {
    return null;
  }
}

export async function broadcastMessageEvent(conversationId: string, event: string, payload: unknown) {
  if (!chatIO) return;
  for (const participantId of await chatService.getParticipantIds(conversationId)) {
    chatIO.to(`user_${participantId}`).emit(event, payload);
    chatIO.to(`user_${participantId}`).emit('conversations:refresh', { conversationId });
  }
  // Keep every participant's Chat unread badge authoritative and realtime.
  await emitChatUnreadCounts(conversationId);
}

/**
 * Emits the authoritative total-unread-message count to a conversation's
 * participants. Single realtime source of truth for the Chat badge; clients
 * apply the value directly so duplicate events can never double-count.
 */
export async function emitChatUnreadCounts(conversationId: string) {
  if (!chatIO) return;
  try {
    const participantIds = await chatService.getParticipantIds(conversationId);
    await Promise.all(participantIds.map(async participantId => {
      const count = await chatService.getUnreadCount(participantId);
      chatIO.to(`user_${participantId}`).emit('chat_unread_count', { count });
    }));
  } catch (error) {
    console.error('[chat] emitChatUnreadCounts failed:', error);
  }
}

export const handleChatSocket = (io: Server) => {
  chatIO = io;
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

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId;
    const connectionCount = addConnection(userId, socket.id);
    socket.join(`user_${userId}`);
    if (connectionCount === 1) {
      const lastActive = new Date();
      await prisma.userPresence.upsert({ where: { userId }, update: { isOnline: true, lastActive }, create: { userId, isOnline: true, lastActive } }).catch(() => undefined);
      io.emit('user_status', { userId, status: 'online' });
      io.emit('presence:changed', { userId, isOnline: true, lastActive });
    }

    socket.on('join_conversation', async (conversationId: string) => {
      if (await chatService.isParticipant(conversationId, userId)) socket.join(`conversation_${conversationId}`);
    });
    socket.on('conversation:join', async (conversationId: string, ack?: (value: unknown) => void) => {
      const ok = await chatService.isParticipant(conversationId, userId);
      if (ok) socket.join(`conversation_${conversationId}`);
      ack?.({ ok });
    });

    socket.on('leave_conversation', async (conversationId: string) => {
      if (await chatService.isParticipant(conversationId, userId)) socket.leave(`conversation_${conversationId}`);
    });

    socket.on('send_message', async (data) => {
      const { conversationId, content } = data;
      try {
        const message = await chatService.sendMessage(conversationId, userId, content);
        await broadcastMessageEvent(conversationId, 'message:new', message);
        await chatService.dispatchRecipientNotifications(message);
        io.to(`conversation_${conversationId}`).emit('receive_message', message);
        socket.emit('message_sent', message);
      } catch (error) {
        console.error('Error sending message via service:', error);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    socket.on('typing', async (data) => {
      const { conversationId } = data;
      if (await chatService.isParticipant(conversationId, userId)) socket.to(`conversation_${conversationId}`).emit('user_typing', { userId, conversationId });
    });
    socket.on('typing:start', async (data) => { if (await chatService.isParticipant(data?.conversationId, userId)) socket.to(`conversation_${data.conversationId}`).emit('typing:changed', { ...data, userId, typing: true }); });
    socket.on('typing:stop', async (data) => { if (await chatService.isParticipant(data?.conversationId, userId)) socket.to(`conversation_${data.conversationId}`).emit('typing:changed', { ...data, userId, typing: false }); });

    socket.on('read_messages', async (data) => {
      const { conversationId } = data;
      try {
        const result = await chatService.markMessagesAsRead(conversationId, userId);
        await broadcastMessageEvent(conversationId, 'messages:read', { conversationId, readerId: userId, count: result.count });
        socket.to(`conversation_${conversationId}`).emit('messages_read', { conversationId, readerId: userId, count: result.count });
        // Sync the recipient-side Notification badge with chat read state.
        await notificationService.markConversationNotificationsRead(userId, conversationId);
      } catch (error) {
        console.error('Error marking messages read via socket:', error);
      }
    });

    socket.on('call_user', (data) => {
      const { userToCall, signalData, from, name } = data;
      if (connectedUsers.has(userToCall)) io.to(`user_${userToCall}`).emit('incoming_call', { signal: signalData, from, name });
    });

    socket.on('answer_call', (data) => {
      if (connectedUsers.has(data.to)) io.to(`user_${data.to}`).emit('call_accepted', data.signal);
    });

    socket.on('end_call', (data) => {
      if (connectedUsers.has(data.to)) io.to(`user_${data.to}`).emit('call_ended');
    });

    // ============================================================================
    // PRIVATE 1-TO-1 VOICE / VIDEO CALLING (WebRTC signaling relay)
    // ============================================================================
    // The server verifies the conversation is a private DIRECT chat and both
    // parties are participants, then relays the WebRTC offer/answer/ICE between
    // the caller and callee rooms. Media never transits the server — this is a
    // pure signaling path over the existing Socket.IO infrastructure. Groups and
    // channels always reject these events.

    // Caller -> server -> callee. Carries the initial SDP offer.
    socket.on('call:user', async (data: any) => {
      const { conversationId, callId, type, signalData } = data || {};
      const calleeId = await getDirectCallPeer(conversationId, userId);
      if (!calleeId) return;
      if (!connectedUsers.has(calleeId)) {
        socket.emit('call:unreachable', { callId, conversationId, from: userId });
        return;
      }
      const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, fullName: true, avatar: true },
      }).catch(() => null);
      io.to(`user_${calleeId}`).emit('incoming_call', {
        callId,
        conversationId,
        type: type === 'video' ? 'video' : 'voice',
        from: userId,
        fromName: caller?.fullName || caller?.username || userId,
        avatar: caller?.avatar || null,
        signal: signalData,
      });
    });

    // Relay ICE candidates and SDP answers between the two call participants.
    socket.on('call:signal', async (data: any) => {
      const { conversationId, callId, to, data: signal } = data || {};
      if (!to || !conversationId || !callId) return;
      const peer = await getDirectCallPeer(conversationId, userId);
      if (!peer || peer !== to) return;
      io.to(`user_${to}`).emit('call_signal', { callId, conversationId, data: signal, from: userId });
    });

    // Callee accepted: relay the SDP answer back to the caller.
    socket.on('call:accept', async (data: any) => {
      const { conversationId, callId, to, signal } = data || {};
      if (!to || !conversationId || !callId) return;
      const peer = await getDirectCallPeer(conversationId, userId);
      if (!peer || peer !== to) return;
      io.to(`user_${to}`).emit('call_accepted', { callId, conversationId, signal, by: userId });
    });

    // Callee declined.
    socket.on('call:decline', async (data: any) => {
      const { conversationId, callId, to } = data || {};
      if (!to || !conversationId || !callId) return;
      const peer = await getDirectCallPeer(conversationId, userId);
      if (!peer || peer !== to) return;
      io.to(`user_${to}`).emit('call_declined', { callId, conversationId, by: userId });
    });

    // Caller cancelled before the callee answered.
    socket.on('call:cancel', async (data: any) => {
      const { conversationId, callId, to } = data || {};
      if (!to || !conversationId || !callId) return;
      const peer = await getDirectCallPeer(conversationId, userId);
      if (!peer || peer !== to) return;
      io.to(`user_${to}`).emit('call_cancelled', { callId, conversationId, by: userId });
    });

    // Either side ended an established call.
    socket.on('call:end', async (data: any) => {
      const { conversationId, callId, to } = data || {};
      if (!to || !conversationId || !callId) return;
      const peer = await getDirectCallPeer(conversationId, userId);
      if (!peer || peer !== to) return;
      io.to(`user_${to}`).emit('call_ended', { callId, conversationId, by: userId });
    });

    socket.on('disconnect', async () => {
      if (removeConnection(userId, socket.id) > 0) return;
      const lastActive = new Date();
      await prisma.userPresence.upsert({ where: { userId }, update: { isOnline: false, lastActive }, create: { userId, isOnline: false, lastActive } }).catch(() => undefined);
      io.emit('user_status', { userId, status: 'offline' });
      io.emit('presence:changed', { userId, isOnline: false, lastActive });
    });
  });
};
