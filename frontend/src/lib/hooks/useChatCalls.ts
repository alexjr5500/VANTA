'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { apiPost } from '@/lib/apiClient';
import type { AuthUser } from '@/lib/authApi';

// ============================================================================
// VANTA private 1-to-1 voice/video calling
// ============================================================================
// The WebRTC PeerConnection is established directly between the two browsers.
// Socket.IO is used purely for signaling (offer/answer/ICE) and call control,
// relayed through the existing chat socket backend. The server verifies that
// the conversation is a PRIVATE direct chat, so groups/channels can never be
// called.

export type CallType = 'voice' | 'video';
export type CallStatus = 'idle' | 'outgoing' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ended';

export interface IncomingCallPayload {
  callId: string;
  conversationId: string;
  type: CallType;
  from: string;
  fromName: string;
  avatar?: string | null;
  signal: RTCSessionDescriptionInit;
}

export interface CallSignalPayload {
  callId: string;
  conversationId: string;
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
  from: string;
}

interface UseChatCallsOptions {
  socket: Socket | null;
  token: string | null;
  currentUser: AuthUser | null;
  activeConversationId: string | null;
  isDirect: boolean;
  peerPartnerId?: string;
  peerName?: string;
  peerAvatar?: string;
}

export interface UseChatCallsReturn {
  status: CallStatus;
  callType: CallType;
  peerId: string | null;
  peerName: string;
  peerAvatar: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicOn: boolean;
  isCamOn: boolean;
  durationSeconds: number;
  error: string | null;
  permissionError: string | null;
  endedReason: string | null;
  startCall: (type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  cancelCall: () => void;
  toggleMicrophone: () => void;
  toggleCamera: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

const RING_TIMEOUT_MS = 45_000;

const makeCallId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `vanta-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const readPermissionError = (error: unknown): string => {
  const name = error instanceof DOMException ? error.name : (error as any)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone/camera access was blocked. Allow access in your browser settings to use calling.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone or camera was found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'Your microphone or camera is in use by another application.';
  }
  return error instanceof Error ? error.message : 'Could not access your microphone or camera.';
};

/**
 * A looping "ringback" tone (the sound the CALLER hears while waiting for the
 * callee to answer), synthesized with the Web Audio API so no audio asset is
 * required. It plays a classic 1s-on / 2s-off ring cadence and keeps looping
 * until stop() is called.
 */
class RingbackTone {
  private ctx: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;
      // The call was started from a user gesture, but resume() makes the audio
      // context robust across browsers that start contexts suspended.
      void ctx.resume().catch(() => undefined);

      const master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);

      const playRing = () => {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        for (const freq of [425, 480]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
          gain.gain.setValueAtTime(0.25, now + 0.9);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
          osc.connect(gain);
          gain.connect(master);
          osc.start(now);
          osc.stop(now + 1.0);
        }
      };

      playRing();
      this.interval = setInterval(playRing, 3000);
    } catch {
      this.stop();
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // ignore
      }
      this.ctx = null;
    }
  }
}

export function useChatCalls(options: UseChatCallsOptions): UseChatCallsReturn {
  const { socket, token, currentUser, activeConversationId, isDirect, peerPartnerId, peerName, peerAvatar } = options;

  const [status, setStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<CallType>('voice');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerLabel, setPeerLabel] = useState('');
  const [peerAvatarUrl, setPeerAvatarUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  // Refs hold mutable call state so socket callbacks never read stale values.
  const statusRef = useRef<CallStatus>('idle');
  const sessionRef = useRef<{
    callId: string;
    conversationId: string;
    type: CallType;
    peerId: string;   // the OTHER participant
    callerId: string; // the call initiator
  } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const activeAtRef = useRef(0);
  const ringingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringbackRef = useRef<RingbackTone | null>(null);
  const loggedRef = useRef(false);
  const tokenRef = useRef(token);
  const userRef = useRef(currentUser);
  const socketRef = useRef(socket);

  tokenRef.current = token;
  userRef.current = currentUser;
  socketRef.current = socket;

  const updateStatus = useCallback((next: CallStatus) => {
    const prev = statusRef.current;
    statusRef.current = next;
    setStatus(next);
    // The ringback tone must stop the moment the call stops ringing: when the
    // callee answers, declines, cancels, when the timeout fires, or on hangup.
    // The tone is shared by the caller (ringback) and the callee (incoming ring).
    if (
      (prev === 'outgoing' || prev === 'ringing' || prev === 'incoming') &&
      next !== 'outgoing' && next !== 'ringing' && next !== 'incoming'
    ) {
      ringbackRef.current?.stop();
    }
  }, []);

  // A periodic timer shows elapsed time while a call is active.
  useEffect(() => {
    if (status !== 'active') return;
    const started = activeAtRef.current || Date.now();
    activeAtRef.current = started;
    setDurationSeconds(0);
    const interval = setInterval(() => {
      setDurationSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

const logCall = useCallback(
    async (callStatus: 'MISSED' | 'DECLINED' | 'ENDED' | 'CANCELLED', duration: number) => {
      const session = sessionRef.current;
      const currentToken = tokenRef.current;
      if (!session || !currentToken || loggedRef.current) return;
      loggedRef.current = true;
      try {
        await apiPost<any>(`/api/messages/${session.conversationId}/call`, {
          callId: session.callId,
          callType: session.type.toUpperCase(),
          status: callStatus,
          durationSeconds: duration,
          callerId: session.callerId,
        }, currentToken);
      } catch {
        // Call history is best-effort; never fail the call flow because of it.
      }
    },
    []
  );

  const teardownPeerConnection = useCallback(() => {
    if (ringingTimerRef.current) {
      clearTimeout(ringingTimerRef.current);
      ringingTimerRef.current = null;
    }
    if (incomingTimerRef.current) {
      clearTimeout(incomingTimerRef.current);
      incomingTimerRef.current = null;
    }
    ringbackRef.current?.stop();
    try {
      pcRef.current?.close();
    } catch {
      // ignore
    }
    pcRef.current = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    incomingOfferRef.current = null;
    activeAtRef.current = 0;
  }, []);

  const cleanupCall = useCallback(() => {
    teardownPeerConnection();
    sessionRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setPeerId(null);
    setPeerLabel('');
    setPeerAvatarUrl(null);
    setDurationSeconds(0);
    setIsMicOn(true);
    setIsCamOn(true);
    setError(null);
    setPermissionError(null);
    setEndedReason(null);
    updateStatus('idle');
  }, [teardownPeerConnection, updateStatus]);

  const attachPeerConnection = useCallback((stream: MediaStream) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      const socketNow = socketRef.current;
      const session = sessionRef.current;
      if (!event.candidate || !socketNow || !session) return;
      socketNow.emit('call:signal', {
        conversationId: session.conversationId,
        callId: session.callId,
        data: event.candidate.toJSON(),
        to: session.peerId,
      });
    };

    pc.ontrack = (event) => {
      if (!event.track) return;
      const merged = new MediaStream();
      if (event.streams && event.streams.length > 0) {
        event.streams[0].getTracks().forEach(track => !merged.getTracks().includes(track) && merged.addTrack(track));
      }
      if (!merged.getTracks().includes(event.track)) merged.addTrack(event.track);
      setRemoteStream((previous) => {
        if (!previous) return merged;
        const combined = new MediaStream();
        [...previous.getTracks(), ...merged.getTracks()].forEach(track => {
          if (!combined.getTracks().includes(track)) combined.addTrack(track);
        });
        return combined;
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        if (statusRef.current === 'connecting' || statusRef.current === 'active') {
          activeAtRef.current = Date.now();
          updateStatus('active');
        }
      } else if (state === 'failed' || state === 'closed') {
        const wasActive = statusRef.current === 'active' || statusRef.current === 'connecting';
        const wasRingingOut = statusRef.current === 'outgoing' || statusRef.current === 'ringing';
        if (wasActive) void logCall('ENDED', Math.max(0, Math.floor((Date.now() - activeAtRef.current) / 1000)));
        if (wasActive || wasRingingOut) {
          setError('The call could not be connected.');
          setEndedReason('Call ended');
        }
        updateStatus('ended');
        // Allow the overlay to settle then fully reset.
        setTimeout(() => cleanupCall(), 1500);
      }
    };

    return pc;
  }, [cleanupCall, logCall, updateStatus]);

  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || pc.remoteDescription === null) return;
    const pending = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // A candidate can race the remote description; ignore late arrivals.
      }
    }
  }, []);

const startCall = useCallback(async (type: CallType) => {
    const socketNow = socketRef.current;
    const userNow = userRef.current;
    if (!socketNow || !userNow || !activeConversationId || !isDirect) return;
    if (statusRef.current !== 'idle') return;

    const targetPeerId = peerPartnerId;
    if (!targetPeerId) {
      setError('This conversation has no callable recipient.');
      updateStatus('idle');
      return;
    }

    setError(null);
    setPermissionError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
    } catch (mediaError) {
      setPermissionError(readPermissionError(mediaError));
      updateStatus('idle');
      return;
    }

    const callId = makeCallId();
    loggedRef.current = false;
    sessionRef.current = {
      callId,
      conversationId: activeConversationId,
      type,
      peerId: targetPeerId,
      callerId: userNow.id,
    };
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsMicOn(true);
    setIsCamOn(type === 'video');
    setCallType(type);
    setPeerId(targetPeerId);
    setPeerLabel(peerName || '');
    setPeerAvatarUrl(peerAvatar || null);
    setEndedReason(null);
    updateStatus('outgoing');
    // Start the ringback tone the caller hears while the callee is ringing.
    if (!ringbackRef.current) ringbackRef.current = new RingbackTone();
    ringbackRef.current.start();

    const pc = attachPeerConnection(stream);
    let offer: RTCSessionDescriptionInit;
    try {
      offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch {
      setError('Could not start the call. Please try again.');
      cleanupCall();
      return;
    }

    socketNow.emit('call:user', {
      conversationId: activeConversationId,
      callId,
      type,
      signalData: pc.localDescription,
    });

    // Auto-cancel after the callee does not answer (40–60s safety net so an
    // unanswered call can never ring forever).
    if (ringingTimerRef.current) clearTimeout(ringingTimerRef.current);
    ringingTimerRef.current = setTimeout(() => {
      if (statusRef.current === 'outgoing' || statusRef.current === 'ringing') {
        const session = sessionRef.current;
        if (!session || !socketRef.current) return;
        socketRef.current.emit('call:cancel', {
          conversationId: session.conversationId,
          callId: session.callId,
          to: session.peerId,
        });
        void logCall('CANCELLED', 0);
        setError(null);
        setEndedReason('No answer. The call was automatically ended.');
        updateStatus('ended');
        // Show the "No answer" state briefly, then fully reset resources.
        setTimeout(() => cleanupCall(), 1500);
      }
    }, RING_TIMEOUT_MS);
  }, [activeConversationId, isDirect, peerPartnerId, peerName, peerAvatar, attachPeerConnection, cleanupCall, logCall, updateStatus]);

  const acceptCall = useCallback(async () => {
    const socketNow = socketRef.current;
    const session = sessionRef.current;
    if (!socketNow || !session || statusRef.current !== 'incoming') return;
    setError(null);
    setPermissionError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: session.type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
    } catch (mediaError) {
      setPermissionError(readPermissionError(mediaError));
      return;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsMicOn(true);
    setIsCamOn(session.type === 'video');
    setEndedReason(null);
    updateStatus('connecting');
    activeAtRef.current = Date.now();
    if (incomingTimerRef.current) {
      clearTimeout(incomingTimerRef.current);
      incomingTimerRef.current = null;
    }

    const pc = attachPeerConnection(stream);
    const offer = incomingOfferRef.current;
    if (!offer) {
      setError('The call offer expired. Please ask to call again.');
      cleanupCall();
      return;
    }
    try {
      await pc.setRemoteDescription(offer);
    } catch (remoteDescriptionError) {
      setError('Could not connect to the caller.');
      cleanupCall();
      return;
    }
    await flushPendingCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketNow.emit('call:accept', {
      conversationId: session.conversationId,
      callId: session.callId,
      signal: pc.localDescription,
      to: session.peerId,
    });
  }, [attachPeerConnection, cleanupCall, flushPendingCandidates, updateStatus]);

const declineCall = useCallback(() => {
    const socketNow = socketRef.current;
    const session = sessionRef.current;
    if (!socketNow || !session || statusRef.current !== 'incoming') return;
    socketNow.emit('call:decline', {
      conversationId: session.conversationId,
      callId: session.callId,
      to: session.peerId,
    });
    void logCall('DECLINED', 0);
    cleanupCall();
  }, [cleanupCall, logCall]);

  const endCall = useCallback(() => {
    const socketNow = socketRef.current;
    const session = sessionRef.current;
    const currentStatus = statusRef.current;
    if (!session) return;
    if (socketNow) {
      if (currentStatus === 'active' || currentStatus === 'connecting') {
        socketNow.emit('call:end', {
          conversationId: session.conversationId,
          callId: session.callId,
          to: session.peerId,
        });
        const duration = Math.max(0, Math.floor((Date.now() - activeAtRef.current) / 1000));
        void logCall('ENDED', duration);
      } else if (currentStatus === 'outgoing' || currentStatus === 'ringing') {
        socketNow.emit('call:cancel', {
          conversationId: session.conversationId,
          callId: session.callId,
          to: session.peerId,
        });
        void logCall('CANCELLED', 0);
      }
    }
    setEndedReason(currentStatus === 'outgoing' || currentStatus === 'ringing' ? 'Call cancelled' : 'Call ended');
    cleanupCall();
  }, [cleanupCall, logCall]);

  const cancelCall = useCallback(() => {
    endCall();
  }, [endCall]);

  const toggleMicrophone = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    if (!tracks.length) return;
    const next = !tracks[0].enabled;
    tracks.forEach(track => { track.enabled = next; });
    setIsMicOn(next);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    if (!tracks.length) return;
    const next = !tracks[0].enabled;
    tracks.forEach(track => { track.enabled = next; });
    setIsCamOn(next);
  }, []);

// --------------------------------------------------------------------------
  // Socket signaling listeners
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = (payload: IncomingCallPayload) => {
      // Already in a call: politely decline so the caller sees a clear outcome.
      if (statusRef.current !== 'idle') {
        socket.emit('call:decline', {
          conversationId: payload.conversationId,
          callId: payload.callId,
          to: payload.from,
        });
        return;
      }
      loggedRef.current = false;
      sessionRef.current = {
        callId: payload.callId,
        conversationId: payload.conversationId,
        type: payload.type === 'video' ? 'video' : 'voice',
        peerId: payload.from,
        callerId: payload.from,
      };
      incomingOfferRef.current = payload.signal;
      setCallType(payload.type === 'video' ? 'video' : 'voice');
      setPeerId(payload.from);
      setPeerLabel(payload.fromName || '');
      setPeerAvatarUrl(payload.avatar || null);
      setError(null);
      setPermissionError(null);
      setEndedReason(null);
      updateStatus('incoming');

      // Audible ring on the receiving side so the recipient hears the call no
      // matter which page they are on. Best-effort: some browsers require a
      // user gesture before an AudioContext can start, so the banner remains
      // the primary notification surface.
      if (!ringbackRef.current) ringbackRef.current = new RingbackTone();
      ringbackRef.current.start();

      // Safety net on the receiving side too: if the caller never answers or
      // the signaling is lost, an unanswered incoming call must not linger.
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
      incomingTimerRef.current = setTimeout(() => {
        if (statusRef.current !== 'incoming') return;
        const session = sessionRef.current;
        if (!session || !socketRef.current) return;
        socketRef.current.emit('call:decline', {
          conversationId: session.conversationId,
          callId: session.callId,
          to: session.peerId,
        });
        void logCall('MISSED', 0);
        setEndedReason('Missed call');
        updateStatus('ended');
        setTimeout(() => cleanupCall(), 1200);
      }, RING_TIMEOUT_MS);
    };

    const onCallSignal = (payload: CallSignalPayload) => {
      const session = sessionRef.current;
      if (!session || session.callId !== payload.callId) return;
      const signal = payload.data as RTCSessionDescriptionInit | RTCIceCandidateInit;
      // Remote-side answer (caller receives it after callee accepts).
      if ((signal as RTCSessionDescriptionInit).type === 'answer') {
        const pc = pcRef.current;
        if (!pc) return;
        pc.setRemoteDescription(signal as RTCSessionDescriptionInit)
          .then(() => flushPendingCandidates())
          .catch(() => undefined);
        if (statusRef.current === 'outgoing' || statusRef.current === 'ringing') {
          updateStatus('connecting');
          activeAtRef.current = Date.now();
        }
        return;
      }
      // ICE candidates.
      if ((signal as RTCIceCandidateInit).candidate) {
        const pc = pcRef.current;
        if (!pc) return;
        if (pc.remoteDescription === null) {
          pendingCandidatesRef.current.push(signal as RTCIceCandidateInit);
        } else {
          pc.addIceCandidate(signal as RTCIceCandidateInit).catch(() => undefined);
        }
      }
    };

    const onCallAccepted = (payload: { callId: string; signal: RTCSessionDescriptionInit }) => {
      const session = sessionRef.current;
      if (!session || session.callId !== payload.callId) return;
      const pc = pcRef.current;
      if (!pc) return;
      pc.setRemoteDescription(payload.signal)
        .then(() => flushPendingCandidates())
        .catch(() => undefined);
      if (statusRef.current === 'outgoing' || statusRef.current === 'ringing') {
        updateStatus('connecting');
        activeAtRef.current = Date.now();
      }
    };

    const onCallEndedByPeer = (payload: { callId: string }) => {
      if (sessionRef.current?.callId !== payload.callId) return;
      const wasActive = statusRef.current === 'active' || statusRef.current === 'connecting';
      if (wasActive) void logCall('ENDED', Math.max(0, Math.floor((Date.now() - activeAtRef.current) / 1000)));
      setEndedReason('Call ended');
      updateStatus('ended');
      setTimeout(() => cleanupCall(), 1500);
    };

    const onCallDeclinedByPeer = (payload: { callId: string }) => {
      if (sessionRef.current?.callId !== payload.callId) return;
      const wasRinging = statusRef.current === 'outgoing' || statusRef.current === 'ringing';
      if (wasRinging) void logCall('DECLINED', 0);
      setEndedReason('Call declined');
      updateStatus('ended');
      setTimeout(() => cleanupCall(), 1500);
    };

    const onCallCancelledByPeer = (payload: { callId: string }) => {
      if (sessionRef.current?.callId !== payload.callId) return;
      const wasIncoming = statusRef.current === 'incoming';
      setPermissionError(null);
      // If the caller hung up before we answered, clear the incoming banner
      // immediately — do not flash an "ended" screen for a call we never saw.
      if (wasIncoming) {
        cleanupCall();
        return;
      }
      setEndedReason('Call cancelled');
      updateStatus('ended');
      setTimeout(() => cleanupCall(), 1500);
    };

    const onCallUnreachable = (payload: { callId: string }) => {
      if (sessionRef.current?.callId !== payload.callId) return;
      setError('The person you called is offline right now.');
      setEndedReason('The person you called is offline right now.');
      updateStatus('ended');
      setTimeout(() => cleanupCall(), 1500);
    };

    socket.on('incoming_call', onIncomingCall);
    socket.on('call_signal', onCallSignal);
    socket.on('call_accepted', onCallAccepted);
    socket.on('call_ended', onCallEndedByPeer);
    socket.on('call_declined', onCallDeclinedByPeer);
    socket.on('call_cancelled', onCallCancelledByPeer);
    socket.on('call_unreachable', onCallUnreachable);

    return () => {
      socket.off('incoming_call', onIncomingCall);
      socket.off('call_signal', onCallSignal);
      socket.off('call_accepted', onCallAccepted);
      socket.off('call_ended', onCallEndedByPeer);
      socket.off('call_declined', onCallDeclinedByPeer);
      socket.off('call_cancelled', onCallCancelledByPeer);
      socket.off('call_unreachable', onCallUnreachable);
    };
  }, [socket, cleanupCall, flushPendingCandidates, logCall, updateStatus]);

// Abort any active call when the chat screen unmounts or the socket
  // disconnects, and write the call-history line the same way manual hangup does.
  useEffect(() => {
    return () => {
      const currentStatus = statusRef.current;
      if (currentStatus === 'active' || currentStatus === 'connecting') {
        const session = sessionRef.current;
        if (!session) return;
        socketRef.current?.emit('call:end', {
          conversationId: session.conversationId,
          callId: session.callId,
          to: session.peerId,
        });
        const duration = Math.max(0, Math.floor((Date.now() - activeAtRef.current) / 1000));
        void logCall('ENDED', duration);
      } else if (currentStatus === 'outgoing' || currentStatus === 'ringing') {
        const session = sessionRef.current;
        if (!session) return;
        socketRef.current?.emit('call:cancel', {
          conversationId: session.conversationId,
          callId: session.callId,
          to: session.peerId,
        });
        void logCall('CANCELLED', 0);
      }
      teardownPeerConnection();
      sessionRef.current = null;
    };
  }, [teardownPeerConnection, logCall]);

  return {
    status,
    callType,
    peerId,
    peerName: peerLabel,
    peerAvatar: peerAvatarUrl,
    localStream,
    remoteStream,
    isMicOn,
    isCamOn,
    durationSeconds,
    error,
    permissionError,
    endedReason,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    cancelCall,
    toggleMicrophone,
    toggleCamera,
  };
}