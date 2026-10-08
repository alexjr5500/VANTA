'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { apiPost } from '@/lib/apiClient';
import { API_BASE_URL, authHeaders } from '@/lib/api';
import type { AuthUser } from '@/lib/authApi';
import { applyContinuousAutofocus, pickPrimaryCamera, pickVideoConstraints } from '@/lib/cameraCapture';

// ============================================================================
// VANTA private 1-to-1 voice/video calling
// ============================================================================
// The WebRTC PeerConnection is established directly between the two browsers.
// Socket.IO is used purely for signaling (offer/answer/ICE) and call control,
// relayed through the existing chat socket backend. The server verifies that
// the conversation is a PRIVATE direct chat, so groups/channels can never be
// called.
//
// ---------------------------------------------------------------------------
// No-audio / one-way-audio debugging (production diagnostics behind a flag):
// Every state machine transition relevant to media transport is logged with
// `[vanta-call]` when `window.__VANTA_DEBUG = true` is set in the console.
// Verbose per-transition logs are additionally emitted in development builds.
// ---------------------------------------------------------------------------

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

export interface CallAnswerIntent {
  callId: string;
  conversationId: string;
  callerId: string;
  callType: CallType;
  callerName?: string;
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
  /** True when the active video track comes from the front (selfie) camera. */
  isFrontCamera: boolean;
  durationSeconds: number;
  error: string | null;
  permissionError: string | null;
  endedReason: string | null;
  startCall: (type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  /**
   * Answer a call from a cold start (push "Answer" on a terminated app). Fetches
   * and validates the call server-side, rebuilds the PeerConnection from the
   * stored offer + buffered ICE, and replies with the SDP answer.
   */
  answerCallFromPush: (intent: CallAnswerIntent) => Promise<{ ok: boolean; reason?: string }>;
  declineCall: () => void;
  endCall: () => void;
  cancelCall: () => void;
  toggleMicrophone: () => void;
  toggleCamera: () => void;
  /**
   * Upgrade a live VOICE call to VIDEO by adding the camera track to the
   * existing session (SDP renegotiation — the call is never restarted).
   * Returns true when the camera is now sending.
   */
  enableVideo: () => Promise<boolean>;
  /**
   * Downgrade a live VIDEO call to VOICE: video transmission stops, audio keeps
   * flowing, the session stays intact and both participants' UI flips to voice.
   */
  disableVideo: () => Promise<boolean>;
  /** Swap the video camera mid-call (front <-> rear) without renegotiation. */
  flipCamera: () => Promise<boolean>;
}

const RTC_CONFIG_DEFAULTS: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

// ICE server configuration is fetched from the backend once per page load. The
// backend serves the deployment's env-driven STUN/TURN list (see `RTC_ICE_SERVERS`
// in the backend .env). When the server is unreachable or unconfigured we keep
// the safe public-STUN default so calls still work on networks without TURN.
let rtcConfigCache: RTCConfiguration | null = null;

async function loadRtcConfig(): Promise<RTCConfiguration> {
  if (rtcConfigCache) return rtcConfigCache;
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${API_BASE_URL}/api/rtc/ice-config`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    window.clearTimeout(timeout);
    if (response.ok) {
      const data = (await response.json()) as { iceServers?: RTCIceServer[] };
      const servers = Array.isArray(data?.iceServers) ? data.iceServers : [];
      const valid = servers.filter(s => s && Array.isArray(s.urls) && s.urls.length > 0);
      if (valid.length > 0) {
        rtcConfigCache = { iceServers: valid };
        diag('ICE servers loaded from backend', valid.length);
        return rtcConfigCache;
      }
    }
  } catch {
    // Backend unreachable / timeout — fall back to the public STUN default.
  }
  rtcConfigCache = { ...RTC_CONFIG_DEFAULTS };
  return rtcConfigCache;
}

const isDebug = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { __VANTA_DEBUG?: boolean }).__VANTA_DEBUG);

/** Structured WebRTC diagnostics (no end-user-visible data). */
function diag(...args: unknown[]): void {
  if (isDebug() || process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.info('[vanta-call]', ...args);
  }
}

const RING_TIMEOUT_MS = 45_000;

const makeCallId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `vanta-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Best-effort push coordination with the VANTA service worker:
 *  - 'vanta-call-handled' tells the SW this page already surfaced an incoming
 *    call via the realtime socket, so it should not show a duplicate OS
 *    notification.
 *  - 'vanta-dismiss-call' asks the SW to close a visible incoming-call
 *    notification (declined / answered elsewhere / ended).
 */
function postToServiceWorker(message: Record<string, unknown>): void {
  try {
    navigator.serviceWorker.controller?.postMessage(message);
  } catch {
    // ignore
  }
  try {
    void navigator.serviceWorker.ready.then((registration) => {
      registration?.active?.postMessage?.(message);
    }).catch(() => undefined);
  } catch {
    // ignore
  }
}

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
  const [isFrontCamera, setIsFrontCamera] = useState(true);
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
    // It is only heard by the CALLER while waiting for an answer; the callee's
    // incoming-call ringtone is played by the global IncomingCallBanner.
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
    setIsFrontCamera(true);
    setError(null);
    setPermissionError(null);
    setEndedReason(null);
    updateStatus('idle');
  }, [teardownPeerConnection, updateStatus]);

  const attachPeerConnection = useCallback(async (stream: MediaStream): Promise<RTCPeerConnection> => {
    const config = await loadRtcConfig();
    const pc = new RTCPeerConnection(config);
    pcRef.current = pc;
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
      diag('local track added', track.kind, track.readyState);
    });

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
      diag('ICE candidate sent', event.candidate.candidate?.slice(0, 40));
    };

    pc.ontrack = (event) => {
      if (!event.track) return;
      diag('remote track received', event.track.kind, event.track.readyState, event.streams?.length ?? 0);
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
      diag('connectionState', state, { callId: sessionRef.current?.callId, ice: pc.iceConnectionState });
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

    pc.oniceconnectionstatechange = () => {
      diag('iceConnectionState', pc.iceConnectionState, { callId: sessionRef.current?.callId });
    };

    pc.onsignalingstatechange = () => {
      diag('signalingState', pc.signalingState, { callId: sessionRef.current?.callId });
    };

    pc.onicegatheringstatechange = () => {
      diag('iceGatheringState', pc.iceGatheringState, { callId: sessionRef.current?.callId });
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

const answerCallFromPush = useCallback(async (intent: CallAnswerIntent) => {
    const socketNow = socketRef.current;
    const userNow = userRef.current;
    const currentToken = tokenRef.current;
    if (!socketNow || !userNow || !currentToken) return { ok: false, reason: 'no-session' };
    if (statusRef.current !== 'idle') return { ok: false, reason: 'busy' };
    if (!intent.callId || !intent.conversationId || !intent.callerId) return { ok: false, reason: 'invalid' };

    // Never trust the push payload: validate the call with the SERVER and fetch
    // the stored offer + buffered ICE candidates for the cold-start join.
    let sessionData: any = null;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${API_BASE_URL}/api/calls/${encodeURIComponent(intent.callId)}`, {
        headers: { Accept: 'application/json', ...authHeaders(currentToken) },
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (response.ok) {
        const body = (await response.json()) as any;
        if (body?.success && body?.call) sessionData = body.call;
      }
    } catch {
      // fall through → network/parse failure below
    }
    if (!sessionData || !sessionData.offerSdp) {
      return { ok: false, reason: sessionData ? 'unavailable' : 'network' };
    }

    let stream: MediaStream;
    try {
      const devices = intent.callType === 'video' ? await navigator.mediaDevices.enumerateDevices().catch(() => []) : [];
      const videoInputs = devices.filter((d): d is MediaDeviceInfo => d.kind === 'videoinput');
      const input = pickPrimaryCamera(videoInputs);
      const videoConstraints = pickVideoConstraints(input, { deviceId: input?.deviceId, preferFront: true });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: intent.callType === 'video' ? videoConstraints : false,
      });
    } catch (mediaError) {
      return { ok: false, reason: 'permission', message: readPermissionError(mediaError) };
    }

    setError(null);
    setPermissionError(null);
    setEndedReason(null);
    loggedRef.current = false;
    sessionRef.current = {
      callId: intent.callId,
      conversationId: intent.conversationId,
      type: intent.callType,
      peerId: intent.callerId,
      callerId: intent.callerId,
    };
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsMicOn(true);
    setIsCamOn(intent.callType === 'video');
    setCallType(intent.callType);
    setPeerId(intent.callerId);
    setPeerLabel(intent.callerName || '');
    setPeerAvatarUrl(null);
    updateStatus('connecting');

    const pc = await attachPeerConnection(stream);
    try {
      const offer = typeof sessionData.offerSdp === 'string' ? JSON.parse(sessionData.offerSdp) : sessionData.offerSdp;
      await pc.setRemoteDescription(offer);
    } catch (remoteError) {
      cleanupCall();
      return { ok: false, reason: 'rtc' };
    }
    for (const candidate of sessionData.iceCandidates || []) {
      if (typeof candidate !== 'string') continue;
      try { await pc.addIceCandidate(JSON.parse(candidate)); } catch { /* late candidates re-emit live */ }
    }
    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('call:accept', {
        conversationId: intent.conversationId,
        callId: intent.callId,
        signal: pc.localDescription,
        to: intent.callerId,
      });
    } catch (answerError) {
      cleanupCall();
      return { ok: false, reason: 'rtc' };
    }
    return { ok: true };
  }, [attachPeerConnection, cleanupCall, updateStatus]);

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
      const devices = type === 'video'
        ? await navigator.mediaDevices.enumerateDevices().catch(() => [])
        : [];
      const videoInputs = devices.filter((d): d is MediaDeviceInfo => d.kind === 'videoinput');
      const input = pickPrimaryCamera(videoInputs);
      const videoConstraints = pickVideoConstraints(input, { deviceId: input?.deviceId, preferFront: true });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video' ? videoConstraints : false,
      });
      if (type === 'video') await applyContinuousAutofocus(stream.getVideoTracks()[0]);
    } catch (mediaError) {
      setPermissionError(readPermissionError(mediaError));
      updateStatus('idle');
      return;
    }

    // Track which camera (front/rear) is active so the self-preview can mirror
    // the front-facing camera exactly once and stay natural on the rear camera.
    if (type === 'video') {
      const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
      setIsFrontCamera(facing === 'user' || facing === 'front');
      diag('camera facing at call start', facing);
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

    const pc = await attachPeerConnection(stream);
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
      const devices = session.type === 'video'
        ? await navigator.mediaDevices.enumerateDevices().catch(() => [])
        : [];
      const videoInputs = devices.filter((d): d is MediaDeviceInfo => d.kind === 'videoinput');
      const input = pickPrimaryCamera(videoInputs);
      const videoConstraints = pickVideoConstraints(input, { deviceId: input?.deviceId, preferFront: true });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: session.type === 'video' ? videoConstraints : false,
      });
      if (session.type === 'video') await applyContinuousAutofocus(stream.getVideoTracks()[0]);
    } catch (mediaError) {
      setPermissionError(readPermissionError(mediaError));
      return;
    }

    if (session.type === 'video') {
      const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
      setIsFrontCamera(facing === 'user' || facing === 'front');
      diag('camera facing on accept', facing);
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

    const pc = await attachPeerConnection(stream);
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
    postToServiceWorker({ type: 'vanta-dismiss-call', callId: session.callId });
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
    postToServiceWorker({ type: 'vanta-dismiss-call', callId: session.callId });
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
      postToServiceWorker({ type: 'vanta-dismiss-call', callId: session.callId });
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

  const notifyCallMediaUpdate = useCallback((type: CallType) => {
    const socketNow = socketRef.current;
    const session = sessionRef.current;
    if (!socketNow || !session) return;
    socketNow.emit('call:media-update', {
      conversationId: session.conversationId,
      callId: session.callId,
      to: session.peerId,
      type,
    });
    diag('media-update sent', type);
  }, []);

  /** Re-negotiate the SDP so the peer learns about the added/dropped video. */
  const sendRenegotiation = useCallback(async (): Promise<boolean> => {
    const pc = pcRef.current;
    const session = sessionRef.current;
    const socketNow = socketRef.current;
    if (!pc || !session || !socketNow) return false;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch (offerError) {
      // The local description may already contain the new m-line; sending it
      // anyway lets the peer apply the renegotiated SDP.
      if (!pc.localDescription) return false;
    }
    if (!pc.localDescription) return false;
    socketNow.emit('call:renegotiate', {
      conversationId: session.conversationId,
      callId: session.callId,
      to: session.peerId,
      data: pc.localDescription,
      type: 'offer',
    });
    diag('renegotiation offer sent');
    return true;
  }, []);

  /**
   * Request camera access and return a live video track, or throw with a
   * user-friendly error. The audio track is intentionally NOT requested here so
   * an upgrade can never disturb the running voice stream.
   */
  const requestCameraTrack = useCallback(async (): Promise<MediaStreamTrack | null> => {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const videoInputs = devices.filter((d): d is MediaDeviceInfo => d.kind === 'videoinput');
    const input = pickPrimaryCamera(videoInputs);
    const constraints = pickVideoConstraints(input, { deviceId: input?.deviceId, preferFront: true });
    const media = await navigator.mediaDevices.getUserMedia({
      video: constraints,
      audio: false,
    });
    const videoTrack = media.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      media.getTracks().forEach(track => track.stop());
      return null;
    }
    await applyContinuousAutofocus(videoTrack);
    return videoTrack;
  }, []);

  /**
   * VOICE -> VIDEO mid-call upgrade. The existing PeerConnection and audio keep
   * running; only the camera track is added and the SDP is re-negotiated.
   */
  const enableVideo = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    if (!session || !stream || !pc) return false;
    if (statusRef.current !== 'active' && statusRef.current !== 'connecting') return false;

    // Camera already live for this call (e.g. re-enabling) — just agree on state.
    const liveTrack = stream.getVideoTracks().find(track => track.enabled);
    if (liveTrack) {
      if (session.type !== 'video') {
        sessionRef.current = { ...session, type: 'video' };
        setCallType('video');
      }
      setIsCamOn(true);
      notifyCallMediaUpdate('video');
      return true;
    }

    let videoTrack: MediaStreamTrack | null = null;
    try {
      videoTrack = await requestCameraTrack();
      if (!videoTrack) {
        setPermissionError('No camera was found on this device.');
        return false;
      }
    } catch (mediaError) {
      // Permission denied / device busy — keep the voice call alive untouched.
      setPermissionError(readPermissionError(mediaError));
      return false;
    }

    try {
      videoTrack.enabled = false;
      stream.addTrack(videoTrack);
      pc.addTrack(videoTrack, stream);
    } catch (trackError) {
      try { stream.removeTrack(videoTrack); } catch { /* noop */ }
      videoTrack.stop();
      setError('Could not turn on the camera during this call.');
      return false;
    }

    if (!(await sendRenegotiation())) {
      try {
        const sender = pc.getSenders().find(s => s.track === videoTrack);
        if (sender) await sender.replaceTrack(null).catch(() => undefined);
        stream.removeTrack(videoTrack);
      } catch { /* noop */ }
      videoTrack.stop();
      setError('Could not turn on the camera during this call.');
      return false;
    }

    videoTrack.enabled = true;
    sessionRef.current = { ...session, type: 'video' };
    setCallType('video');
    setIsCamOn(true);
    const facing = videoTrack.getSettings?.().facingMode;
    setIsFrontCamera(facing === 'user' || facing === 'front');
    setLocalStream(new MediaStream(stream.getTracks()));
    setError(null);
    setPermissionError(null);
    notifyCallMediaUpdate('video');
    diag('video enabled mid-call (voice -> video)');
    return true;
  }, [notifyCallMediaUpdate, requestCameraTrack, sendRenegotiation]);

  /**
   * VIDEO -> VOICE mid-call downgrade. Video transmission stops, audio keeps
   * flowing and the session stays intact on both ends.
   */
  const disableVideo = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    if (!session || !stream || !pc) return false;
    if (statusRef.current !== 'active' && statusRef.current !== 'connecting') return false;

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) {
      if (session.type !== 'voice') {
        sessionRef.current = { ...session, type: 'voice' };
        setCallType('voice');
      }
      setIsCamOn(false);
      notifyCallMediaUpdate('voice');
      return true;
    }

    // Stop the sender track first so the peer stops receiving video frames,
    // then hard-disable the local tracks. Audio keeps flowing untouched.
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    try {
      if (sender) await sender.replaceTrack(null).catch(() => undefined);
    } catch { /* best-effort — the track disable below still stops frames */ }
    videoTracks.forEach(track => { try { track.enabled = false; } catch { /* noop */ } });

    sessionRef.current = { ...session, type: 'voice' };
    setCallType('voice');
    setIsCamOn(false);
    setLocalStream(new MediaStream(stream.getTracks()));
    setError(null);
    setPermissionError(null);
    notifyCallMediaUpdate('voice');
    diag('video disabled mid-call (video -> voice)');
    return true;
  }, [notifyCallMediaUpdate]);

  const toggleCamera = useCallback(() => {
    const session = sessionRef.current;
    const stream = localStreamRef.current;
    if (!session || !stream) return;
    const videoActive = session.type === 'video' && stream.getVideoTracks().some(track => track.enabled);
    if (videoActive) void disableVideo();
    else void enableVideo();
  }, [disableVideo, enableVideo]);

  const flipCamera = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    if (!session || session.type !== 'video' || !stream || !pc) return false;
    const currentTrack = stream.getVideoTracks()[0];
    if (!currentTrack) return false;

    const videoInputs = (await navigator.mediaDevices.enumerateDevices().catch(() => []))
      .filter((d): d is MediaDeviceInfo => d.kind === 'videoinput');
    if (videoInputs.length < 2) return false;

    const currentDeviceId = currentTrack.getSettings?.().deviceId;
    const currentFacing = currentTrack.getSettings?.().facingMode;
    const wantFront = currentFacing === 'environment' || currentFacing === 'back';
    const next = videoInputs.find(d => d.deviceId && d.deviceId !== currentDeviceId)
      ?? videoInputs[videoInputs.length - 1];

    try {
      const constraints = pickVideoConstraints(next, {
        deviceId: next.deviceId,
        forceFacingMode: wantFront ? 'user' : 'environment',
      });
      const replacement = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      const newTrack = replacement.getVideoTracks()[0];
      if (!newTrack || newTrack.readyState !== 'live') {
        replacement.getTracks().forEach(t => t.stop());
        return false;
      }
      await applyContinuousAutofocus(newTrack);

      // Swap the track on the actual sender so the peer keeps receiving video
      // without a full SDP renegotiation.
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack).catch(() => {
          // Fallback: if replaceTrack failed, push the new track onto the local
          // stream and let the browser negotiate a replacement internally.
          stream.addTrack(newTrack);
        });
      } else {
        stream.addTrack(newTrack);
      }
      stream.removeTrack(currentTrack);
      currentTrack.stop();

      const facing = newTrack.getSettings?.().facingMode;
      const front = facing === 'user' || facing === 'front';
      setIsFrontCamera(front);
      setLocalStream(new MediaStream(stream.getTracks()));
      diag('camera flipped', front ? 'front' : 'rear', { track: newTrack.readyState });
      return true;
    } catch {
      return false;
    }
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

      // Tell the service worker this page already surfaced the incoming call via
      // its realtime socket — no duplicate OS notification while focused.
      postToServiceWorker({ type: 'vanta-call-handled', callId: payload.callId });

      // The callee's audible ring is now the VANTA ringtone played by the
      // global IncomingCallBanner (frontend/public/sounds/vanta-ringtone.mp3),
      // so no synthesized tone is started here. The caller's ringback below is
      // a separate, caller-side sound and is unchanged.

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
        applyRemoteAnswer(signal as RTCSessionDescriptionInit);
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
      applyRemoteAnswer(payload.signal);
    };

    // Apply the callee's SDP answer exactly once. The peer connection moves
    // have-local-offer -> stable, so any duplicate/late answer (the backend
    // relays the same answer over `call_accepted` and `call_signal`) is ignored
    // instead of throwing "Called in wrong state".
    const applyRemoteAnswer = (signal: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      if (!pc) return;
      if (pc.signalingState === 'stable' && pc.remoteDescription) {
        diag('duplicate SDP answer ignored', { callId: sessionRef.current?.callId });
        return;
      }
      if (pc.signalingState !== 'have-local-offer') {
        diag('SDP answer received in unexpected state', pc.signalingState, { callId: sessionRef.current?.callId });
        return;
      }
      pc.setRemoteDescription(signal)
        .then(() => {
          diag('remote SDP answer applied');
          return flushPendingCandidates();
        })
        .then(() => {
          if (statusRef.current === 'outgoing' || statusRef.current === 'ringing') {
            updateStatus('connecting');
            activeAtRef.current = Date.now();
          }
        })
        .catch(() => undefined);
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

    // The call was answered/declined/cancelled (possibly on ANOTHER device): a
    // still-ringing incoming call on THIS device must stop immediately.
    const onRingingStopped = (payload: { callId: string; reason?: string }) => {
      const session = sessionRef.current;
      if (!session || session.callId !== payload.callId) return;
      if (statusRef.current !== 'incoming') return;
      cleanupCall();
      postToServiceWorker({ type: 'vanta-call-handled', callId: payload.callId });
    };

    // The peer switched the call between voice and video WITHOUT ending it.
    // Keep the local session type in sync so both overlays agree on the mode.
    const onCallMediaUpdated = (payload: { callId: string; conversationId: string; from: string; type: CallType }) => {
      const session = sessionRef.current;
      if (!session || session.callId !== payload.callId) return;
      const nextType = payload.type === 'video' ? 'video' : 'voice';
      sessionRef.current = { ...session, type: nextType };
      setCallType(nextType);
      if (nextType === 'voice') setIsCamOn(false);
      diag('media-update received', nextType);
    };

    // SDP renegotiation relayed by the server. Used to add/remove video on a
    // live call without restarting it. The callee answers offers; the caller
    // applies answers.
    const onCallRenegotiate = (payload: { callId: string; conversationId: string; data: RTCSessionDescriptionInit; from: string }) => {
      const session = sessionRef.current;
      const pc = pcRef.current;
      if (!session || !pc || session.callId !== payload.callId) return;
      void (async () => {
        try {
          await pc.setRemoteDescription(payload.data);
          const amCaller = session.callerId === userRef.current?.id;
          if (!amCaller) {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (pc.localDescription) {
              socketRef.current?.emit('call:renegotiate', {
                conversationId: session.conversationId,
                callId: session.callId,
                to: session.peerId,
                data: pc.localDescription,
                type: 'answer',
              });
              diag('renegotiation answer sent');
            }
          }
        } catch (error) {
          // Renegotiation is best-effort: a failing video upgrade never kills the
          // running audio call.
          diag('renegotiation failed', error);
        }
      })();
    };

    socket.on('incoming_call', onIncomingCall);
    socket.on('call_signal', onCallSignal);
    socket.on('call_accepted', onCallAccepted);
    socket.on('call_ended', onCallEndedByPeer);
    socket.on('call_declined', onCallDeclinedByPeer);
    socket.on('call_cancelled', onCallCancelledByPeer);
    socket.on('call_unreachable', onCallUnreachable);
    socket.on('call_media_updated', onCallMediaUpdated);
    socket.on('call_renegotiate', onCallRenegotiate);
    socket.on('call_ringing_stopped', onRingingStopped);

    return () => {
      socket.off('incoming_call', onIncomingCall);
      socket.off('call_signal', onCallSignal);
      socket.off('call_accepted', onCallAccepted);
      socket.off('call_ended', onCallEndedByPeer);
      socket.off('call_declined', onCallDeclinedByPeer);
      socket.off('call_cancelled', onCallCancelledByPeer);
      socket.off('call_unreachable', onCallUnreachable);
      socket.off('call_media_updated', onCallMediaUpdated);
      socket.off('call_renegotiate', onCallRenegotiate);
      socket.off('call_ringing_stopped', onRingingStopped);
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
    isFrontCamera,
    durationSeconds,
    error,
    permissionError,
    endedReason,
    startCall,
    acceptCall,
    answerCallFromPush,
    declineCall,
    endCall,
    cancelCall,
    toggleMicrophone,
    toggleCamera,
    enableVideo,
    disableVideo,
    flipCamera,
  };
}