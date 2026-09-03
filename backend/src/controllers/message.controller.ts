import { Request, Response } from 'express';
import { chatService, notificationService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';
import { broadcastMessageEvent, emitChatUnreadCounts } from '../sockets/chat.socket';

const statusFor = (message: string) => message.includes('unauthorized') ? 403 : message.includes('not found') ? 404 : 400;

export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt((req.query.limit as string) || '25', 10);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const conversations = await chatService.getConversations(userId, limit, cursor);
    res.status(200).json(conversations);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamString(req.params.conversationId);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const messages = await chatService.getMessages(conversationId, userId, limit, cursor);
    res.status(200).json(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const startConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { participantIds, name, type, avatar, description, handle, visibility } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      res.status(400).json({ error: 'participantIds is required' });
      return;
    }

    const normalizedType = type === 'GROUP' || type === 'CHANNEL' ? type : 'DIRECT';
    const conversation = await chatService.createConversation([userId, ...participantIds], name, normalizedType !== 'DIRECT', { type: normalizedType, avatar, description, handle, visibility, createdById: userId });
    res.status(201).json({ conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const senderId = req.user?.userId;
    const { conversationId, content = '', type, attachments, replyToId } = req.body;

    if (!senderId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!conversationId || (typeof content !== 'string') || (!content.trim() && !Array.isArray(attachments))) {
      res.status(400).json({ error: 'conversationId and message content or attachments are required' });
      return;
    }

    const message = await chatService.sendMessage(conversationId, senderId, content, type, Array.isArray(attachments) ? attachments : [], typeof replyToId === 'string' ? replyToId : undefined);
    await broadcastMessageEvent(conversationId, 'message:new', message);
    // One unread "New Message" notification per recipient → Notification badge.
    await chatService.dispatchRecipientNotifications(message);
    res.status(201).json({ message: 'Message sent', data: message });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const reactToMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const message = await chatService.reactToMessage(getParamString(req.params.messageId), req.user.userId, req.body.reaction);
    if (!message) { res.status(404).json({ error: 'Message not found' }); return; }
    await broadcastMessageEvent(message.conversationId, 'message:updated', message);
    res.json({ data: message });
  } catch (error) { const message = error instanceof Error ? error.message : 'Request failed'; res.status(statusFor(message)).json({ error: message }); }
};

/**
 * Records a call status/history line in a PRIVATE 1-to-1 conversation
 * (e.g. "Voice call · 3:05"). Both callers send this when a call reaches a
 * terminal state; the service de-duplicates by callId so only one message is
 * persisted and it is broadcast to both participants via `message:new`.
 */
export const recordCallMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamString(req.params.conversationId);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const body = (req.body || {}) as { callId?: string; callType?: string; status?: string; durationSeconds?: number; callerId?: string };
    const message = await chatService.createCallMessage(conversationId, userId, {
      callId: typeof body.callId === 'string' ? body.callId.slice(0, 100) : undefined,
      callType: typeof body.callType === 'string' ? body.callType : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      durationSeconds: Number(body.durationSeconds) || 0,
      callerId: typeof body.callerId === 'string' ? body.callerId : undefined,
    });
    if (message) await broadcastMessageEvent(message.conversationId, 'message:new', message);
    res.status(201).json({ message: 'Call recorded', data: message });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    res.status(statusFor(message)).json({ error: message });
  }
};

export const setMessagePinned = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const message = await chatService.setMessagePinned(getParamString(req.params.messageId), req.user.userId, Boolean(req.body.pinned));
    await broadcastMessageEvent(message.conversationId, 'message:updated', message);
    res.json({ data: message });
  } catch (error) { const message = error instanceof Error ? error.message : 'Request failed'; res.status(statusFor(message)).json({ error: message }); }
};

export const setConversationMuted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await chatService.setConversationMuted(getParamString(req.params.conversationId), req.user.userId, Boolean(req.body.muted));
    res.json(result);
  } catch (error) { const message = error instanceof Error ? error.message : 'Request failed'; res.status(statusFor(message)).json({ error: message }); }
};

export const editMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const message = await chatService.editMessage(getParamString(req.params.messageId), req.user.userId, req.body.content);
    await broadcastMessageEvent(message.conversationId, 'message:updated', message);
    res.json({ data: message });
  } catch (error) { const message = error instanceof Error ? error.message : 'Request failed'; res.status(statusFor(message)).json({ error: message }); }
};

export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const message = await chatService.deleteMessage(getParamString(req.params.messageId), req.user.userId, req.query.forEveryone === 'true');
    await broadcastMessageEvent(message.conversationId, 'message:deleted', message);
    res.json({ data: message });
  } catch (error) { const message = error instanceof Error ? error.message : 'Request failed'; res.status(statusFor(message)).json({ error: message }); }
};

export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.json({ count: await chatService.getUnreadCount(req.user.userId) });
};

export const markMessagesRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamString(req.params.conversationId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await chatService.markMessagesAsRead(conversationId, userId);
    await broadcastMessageEvent(conversationId, 'messages:read', { conversationId, readerId: userId, count: result.count });
    // Keep the Notifications badge in sync: reading a chat clears its message notifications.
    await notificationService.markConversationNotificationsRead(userId, conversationId);
    await emitChatUnreadCounts(conversationId);
    res.status(200).json({ success: true, count: result.count });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const searchMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamString(req.params.conversationId);
    const { query } = req.query;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const messages = await chatService.searchMessages(conversationId, userId, query);
    res.status(200).json(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
