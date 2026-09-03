'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { useAuth } from '@/context/AuthContext';
import { createSocket } from '@/lib/socketClient';
import { useChatCalls, type UseChatCallsReturn } from '@/lib/hooks/useChatCalls';

// ============================================================================
// Global call state
// ============================================================================
// Private 1-to-1 voice/video calling is owned by ONE app-level provider so the
// Socket.IO signaling listeners (incoming_call, call_accepted, call_declined,
// call_cancelled, call_ended, ...) stay connected on every authenticated page.
// Previously the listeners only lived inside the Chat page, so an incoming call
// was silently missed whenever the recipient was on Home / Reels / Discover /
// Profile / Stories / Notifications. Now the incoming-call banner and the full
// call overlay are rendered globally by AppLayout, and the Chat page merely
// tells the provider which conversation it is viewing so outgoing calls know
// the target.
// ============================================================================

export interface CallTarget {
  activeConversationId: string | null;
  isDirect: boolean;
  peerPartnerId?: string;
  peerName?: string;
  peerAvatar?: string;
}

interface CallContextValue {
  /** The single global call session (status, streams, accept/decline/end...). */
  chatCalls: UseChatCallsReturn;
  /** The Chat page reports the currently open conversation so startCall works. */
  setCallTarget: (target: CallTarget) => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

export function CallProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [callTarget, setCallTarget] = useState<CallTarget>({
    activeConversationId: null,
    isDirect: false,
  });

  // One persistent, authenticated socket for call signaling that outlives page
  // navigation. It connects as soon as the user is signed in and disconnects on
  // logout, exactly like the chat/notification sockets.
  useEffect(() => {
    if (!token || !user?.id) {
      setSocket(null);
      return;
    }
    const socket = createSocket(token, `vanta-calls-${user.id}`);
    socket.connect();
    setSocket(socket);
    return () => {
      socket.disconnect();
    };
  }, [token, user?.id]);

  const chatCalls = useChatCalls({
    socket,
    token,
    currentUser: user,
    activeConversationId: callTarget.activeConversationId,
    isDirect: callTarget.isDirect,
    peerPartnerId: callTarget.peerPartnerId,
    peerName: callTarget.peerName,
    peerAvatar: callTarget.peerAvatar,
  });

  const value = useMemo<CallContextValue>(
    () => ({ chatCalls, setCallTarget }),
    [chatCalls]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCalls must be used within CallProvider');
  }
  return context;
}