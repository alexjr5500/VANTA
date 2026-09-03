'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { createSocket } from '@/lib/socketClient';
import { emitProfileMediaUpdate, ProfileMediaUpdate, versionMediaUrl } from '@/lib/profileMedia';

export type VantaNotification = {
  id: string;
  type: string;
  title?: string | null;
  message?: string | null;
  read: boolean;
  readAt?: string | null;
  createdAt: string;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  data?: Record<string, unknown> | string | null;
  actor?: { id: string; username: string; fullName?: string | null; avatar?: string | null; verified?: boolean } | null;
};

type NotificationContextValue = {
  unreadCount: number;
  latestNotification: VantaNotification | null;
  notificationRevision: number;
  reconcileUnreadCount: () => Promise<void>;
  setAuthoritativeUnreadCount: (_count: number) => void;
  decrementUnreadCount: () => void;
  clearUnreadCount: () => void;
  dismissLatestNotification: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);
const safeCount = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestNotification, setLatestNotification] = useState<VantaNotification | null>(null);
  const [notificationRevision, setNotificationRevision] = useState(0);

  const reconcileUnreadCount = useCallback(async () => {
    if (!token || !user) { setUnreadCount(0); return; }
    const response = await apiGet<{ unreadCount?: number; count?: number }>('/api/notifications/unread-count', token, { skipCache: true });
    setUnreadCount(safeCount(response.unreadCount ?? response.count));
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) { setUnreadCount(0); setLatestNotification(null); return; }
    void reconcileUnreadCount();
    const refresh = () => void reconcileUnreadCount();
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 60_000);
    const socket = createSocket(token, 'notifications');
    const onNotification = (notification: VantaNotification) => {
      setLatestNotification(notification);
      setUnreadCount(count => count + (notification.read ? 0 : 1));
    };
    const onCount = ({ count }: { count: number }) => setUnreadCount(safeCount(count));
    const onRead = () => setNotificationRevision(revision => revision + 1);
    const onDeleted = () => setNotificationRevision(revision => revision + 1);
    const onProfileUpdated = (update: ProfileMediaUpdate) => {
      const version = Number(update.updatedAt) || Date.now();
      emitProfileMediaUpdate({
        ...update,
        avatar: versionMediaUrl(update.avatar, version),
        bannerUrl: versionMediaUrl(update.bannerUrl, version),
        updatedAt: version,
      });
    };
    socket.on('connect', refresh);
    socket.on('new_notification', onNotification);
    socket.on('unread_count', onCount);
    socket.on('notifications_read', onRead);
    socket.on('notification_deleted', onDeleted);
    socket.on('profile_updated', onProfileUpdated);
    socket.connect();
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(interval);
      socket.off('connect', refresh);
      socket.off('new_notification', onNotification);
      socket.off('unread_count', onCount);
      socket.off('notifications_read', onRead);
      socket.off('notification_deleted', onDeleted);
      socket.off('profile_updated', onProfileUpdated);
      socket.disconnect();
    };
  }, [reconcileUnreadCount, token, user]);

  const value = useMemo<NotificationContextValue>(() => ({
    unreadCount,
    latestNotification,
    notificationRevision,
    reconcileUnreadCount,
    setAuthoritativeUnreadCount: count => setUnreadCount(safeCount(count)),
    decrementUnreadCount: () => setUnreadCount(count => Math.max(0, count - 1)),
    clearUnreadCount: () => setUnreadCount(0),
    dismissLatestNotification: () => setLatestNotification(null),
  }), [latestNotification, notificationRevision, reconcileUnreadCount, unreadCount]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}