import { Response } from 'express';
import { notificationService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';

export const getNotifications = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 25, 1), 100);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const unreadOnly = req.query.unread === 'true';
    const types = typeof req.query.types === 'string'
      ? req.query.types.split(',').map(type => type.trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : undefined;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const notifications = await notificationService.getNotifications(userId, limit, cursor, { unreadOnly, types });
    res.status(200).json(notifications);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getUnreadCount = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await notificationService.getUnreadCount(userId);
    res.status(200).json({ unreadCount: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const markAsRead = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const notificationId = getParamString(req.params.notificationId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await notificationService.markAsRead(notificationId, userId);
    res.status(200).json({ message: 'Notification marked as read', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const markAllAsRead = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await notificationService.markAllAsRead(userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const deleteNotification = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const notificationId = getParamString(req.params.notificationId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await notificationService.deleteNotification(notificationId, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};