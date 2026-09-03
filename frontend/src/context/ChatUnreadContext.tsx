'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { createSocket } from '@/lib/socketClient';

type ChatUnreadContextValue = {
  chatUnreadCount: number;
  refreshChatUnread: () => Promise<void>;
  setChatUnread: (count: number) => void;
  clearChatUnread: () => void;
};

const ChatUnreadContext = createContext<ChatUnreadContextValue | null>(null);
const safeCount = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

/**
 * Single realtime source of truth for the global Chat unread badge (total
 * unread messages across all conversations). Reuses the existing Socket.IO
 * infrastructure and the backend's authoritative `chat_unread_count` events, so
 * duplicate realtime events can never double-count: every event is applied as a
 * value, never as an increment.
 */
export function ChatUnreadProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const fetchingRef = useRef(false);

  const refreshChatUnread = useCallback(async () => {
    if (!token || !user) { setChatUnreadCount(0); return; }
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const response = await apiGet<{ count?: number }>('/api/messages/unread/count', token, { skipCache: true });
      setChatUnreadCount(safeCount(response?.count));
    } catch {
      // Keep the last known value; the socket will reconcile it.
    } finally {
      fetchingRef.current = false;
    }
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) { setChatUnreadCount(0); return; }
    void refreshChatUnread();
    const onFocus = () => void refreshChatUnread();
    window.addEventListener('focus', onFocus);

    const socket = createSocket(token, 'chat-unread');
    const onChatUnreadCount = ({ count }: { count: number }) => setChatUnreadCount(safeCount(count));
    const onAnyRefresh = () => { /* conversations:refresh also signals unread may have changed */ };
    socket.on('connect', onFocus);
    socket.on('chat_unread_count', onChatUnreadCount);
    socket.on('message:new', onAnyRefresh);
    socket.on('conversations:refresh', onAnyRefresh);
    socket.connect();

    return () => {
      window.removeEventListener('focus', onFocus);
      socket.off('connect', onFocus);
      socket.off('chat_unread_count', onChatUnreadCount);
      socket.off('message:new', onAnyRefresh);
      socket.off('conversations:refresh', onAnyRefresh);
      socket.disconnect();
    };
  }, [refreshChatUnread, token, user]);

  const value = useMemo<ChatUnreadContextValue>(() => ({
    chatUnreadCount,
    refreshChatUnread,
    setChatUnread: count => setChatUnreadCount(safeCount(count)),
    clearChatUnread: () => setChatUnreadCount(0),
  }), [chatUnreadCount, refreshChatUnread]);

  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}

export function useChatUnread() {
  const context = useContext(ChatUnreadContext);
  if (!context) throw new Error('useChatUnread must be used within ChatUnreadProvider');
  return context;
}