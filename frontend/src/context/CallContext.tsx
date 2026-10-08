'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
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

const ANSWER_FAILURE_MESSAGES: Record<string, string> = {
  'no-session': 'Your session expired. Open VANTA and try again.',
  busy: 'You are already in a call.',
  invalid: 'This call link is not valid.',
  unavailable: 'The call is no longer available.',
  network: 'Could not reach the call. Check your connection and try again.',
  permission: 'VANTA needs microphone access to answer the call.',
  rtc: 'Could not connect to the call. Please try again.',
};

export function CallProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [callTarget, setCallTarget] = useState<CallTarget>({
    activeConversationId: null,
    isDirect: false,
  });
  const handledPushIntent = useRef(false);

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

  // --------------------------------------------------------------------------
  // OS push intents: the app was opened by tapping Answer / Decline on a push
  // notification. Params: vantaCall, callId, conversation, caller, type, name.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!token || !user) return;
    const params = new URLSearchParams(window.location.search);
    const intent = params.get('vantaCall');
    if (intent !== 'answer' && intent !== 'decline') return;
    if (handledPushIntent.current) return;
    handledPushIntent.current = true;

    const callId = params.get('callId') || '';
    const conversationId = params.get('conversation') || '';
    const caller = params.get('caller') || '';
    const type: 'voice' | 'video' = params.get('type') === 'video' ? 'video' : 'voice';
    const name = params.get('name') || '';

    // Open the right conversation inside the chat shell.
    if (conversationId) {
      setCallTarget({
        activeConversationId: conversationId,
        isDirect: true,
        ...(caller ? { peerPartnerId: caller, peerName: name || undefined } : {}),
      });
      void router.push(`/chat?conversation=${encodeURIComponent(conversationId)}`, { scroll: false });
    }

    if (intent === 'answer' && callId && conversationId && caller) {
      void chatCalls.answerCallFromPush({ callId, conversationId, callerId: caller, callType: type, callerName: name || undefined })
        .then((result) => {
          if (!result.ok) {
            setCallTarget({ activeConversationId: null, isDirect: false });
            window.dispatchEvent(new CustomEvent('vanta-push-toast', {
              detail: { message: ANSWER_FAILURE_MESSAGES[result.reason || 'unavailable'] || 'Could not join the call.' },
            }));
          }
        });
    } else if (intent === 'decline' && callId && conversationId && caller) {
      socket?.emit('call:decline', { conversationId, callId, to: caller });
    }

    // Clean the intent params (keep ?conversation so the chat thread opens).
    const url = new URL(window.location.href);
    url.searchParams.delete('vantaCall');
    url.searchParams.delete('callId');
    url.searchParams.delete('caller');
    url.searchParams.delete('type');
    url.searchParams.delete('name');
    window.history.replaceState(null, '', url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user]);

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