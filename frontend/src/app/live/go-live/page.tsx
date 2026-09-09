'use client';

/**
 * VANTA GO LIVE â€” full-screen capture + live room
 * ----------------------------------------------
 * The Go-Live and LIVE-room experience rebuilt to match the product references:
 *
 *   IDLE â†’ REQUESTING_PERMISSIONS â†’ CAMERA_PREVIEW â†’ CONFIGURING_LIVE
 *        â†’ CONNECTING_TO_LIVE (start stream â†’ host token â†’ LiveKit publish)
 *        â†’ LIVE â†’ ENDING_LIVE â†’ LIVE_ENDED
 *
 * The real device camera fills the entire viewport under every control layer.
 * The stream is only marked LIVE after the backend created the session, the
 * LiveKit host token was issued, the room connected and camera/mic tracks were
 * actually published and verified.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  Clock,
  Coins,
  Crown,
  Ellipsis,
  Eye,
  Flag,
  FlipVertical2,
  Gamepad2,
  Gift,
  Heart,
  Languages,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  Radio,
  RefreshCw,
  Repeat2,
  Send,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
  Video,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { ConnectionState } from 'livekit-client';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut } from '@/lib/apiClient';
import { API_BASE_URL, authHeaders } from '@/lib/api';
import { createSocket, type Socket } from '@/lib/socketClient';
import { useLiveKit, getLiveKitToken } from '@/lib/hooks/useLiveKit';
import { useLiveCamera, type LiveCameraError } from '@/lib/hooks/useLiveCamera';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';
import { cn, formatNumber } from '@/lib/utils';
import GiftAnimationOverlay from '@/components/gifts/GiftAnimationOverlay';
import { useGiftAnimationQueue } from '@/components/gifts/useGiftAnimationQueue';

type Phase =
  | 'IDLE'
  | 'REQUESTING_PERMISSIONS'
  | 'CAMERA_PREVIEW'
  | 'CONFIGURING_LIVE'
  | 'CONNECTING_TO_LIVE'
  | 'LIVE'
  | 'ENDING_LIVE'
  | 'LIVE_ENDED'
  | 'ERROR';

type LiveMode = 'voice' | 'camera' | 'gaming';
type GoalChoice = 'none' | 'followers' | 'gifts' | 'duration';
type SheetId =
  | 'none'
  | 'settings'
  | 'effects'
  | 'beauty'
  | 'service'
  | 'rewards'
  | 'goal'
  | 'fanclub'
  | 'more'
  | 'end';

const MAX_TITLE = 60;

interface StreamDetail {
  id: string;
  title?: string;
  liveKitRoom?: string | null;
  viewerCount?: number;
  status?: string;
  active?: boolean;
}

interface ChatLine {
  id: string;
  message: string;
  createdAt?: string;
  kind?: 'comment' | 'system';
  meta?: { icon?: string; type?: string };
  user?: { id: string; username: string; avatar?: string | null; verified?: boolean } | null;
}

interface LiveSummary {
  duration: number;
  peakViewers: number;
  totalViewers: number;
  newFollowers: number;
  messages: number;
  reactions: number;
  giftCount: number;
  estimatedEarnings: number;
}

const MODES: { id: LiveMode; label: string; sub: string; icon: typeof Mic }[] = [
  { id: 'voice', label: 'Voice chat', sub: 'Live audio room', icon: Mic },
  { id: 'camera', label: 'Device camera', sub: 'Camera + mic', icon: Camera },
  { id: 'gaming', label: 'Mobile gaming', sub: 'Gameplay broadcast', icon: Gamepad2 },
];

const FILTERS: { id: string; label: string; css: string }[] = [
  { id: 'none', label: 'Original', css: '' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.28) saturate(1.3) contrast(1.04) brightness(1.04)' },
  { id: 'cool', label: 'Cool', css: 'hue-rotate(14deg) saturate(0.95) brightness(1.03)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.55) contrast(1.1)' },
  { id: 'dream', label: 'Dream', css: 'saturate(1.25) brightness(1.12) contrast(0.92) blur(0.3px)' },
  { id: 'neon', label: 'Neon', css: 'saturate(1.8) contrast(1.3) hue-rotate(-12deg)' },
  { id: 'sunset', label: 'Sunset', css: 'sepia(0.5) saturate(1.6) hue-rotate(-18deg)' },
  { id: 'mono', label: 'B&W', css: 'grayscale(1) contrast(1.12)' },
];

const REACT_EMOJIS = ['â¤ï¸', 'ðŸ”¥', 'ðŸ‘', 'ðŸ˜‚', 'ðŸ˜', 'ðŸŽ‰'];

/** Minimal live_event â†’ system chat line (keeps chat free of junk). */
function liveEventLine(d: any): string | null {
  const u = d?.user;
  const name = u?.username ? `@${u.username}` : 'Someone';
  switch (d?.type) {
    case 'joined': return `${name} joined the live`;
    case 'left': return `${name} left the live`;
    case 'liked': return '';
    case 'shared': return `${name} shared your live`;
    case 'followed': return `${name} started following you`;
    case 'gift': return `${name} sent ${d.giftName || 'a gift'}${d.quantity && d.quantity > 1 ? ` Ã— ${d.quantity}` : ''}`;
    default: return '';
  }
}

/** Convert a server/new-room message into a chat line. */
function toChatLine(raw: any): ChatLine {
  const user = raw?.user
    ? { id: raw.user.id || String(raw.user._id), username: raw.user.username || 'user', avatar: raw.user.avatar, verified: !!raw.user.verified }
    : { id: raw?.userId || 'user', username: raw?.username || 'user', avatar: raw?.avatar, verified: false };
  return {
    id: raw?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message: raw?.message || raw?.text || '',
    createdAt: raw?.createdAt,
    kind: 'comment',
    user,
  };
}

/** Camera <video> that attaches the real device MediaStream. */
function CameraFeed({ stream, mirror, filterCss, muted, ariaLabel }: { stream: MediaStream | null; mirror?: boolean; filterCss?: string; muted?: boolean; ariaLabel?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!stream) {
      video.pause();
      video.srcObject = null;
      return;
    }
    video.srcObject = stream;
    video.play().catch(() => undefined);
  }, [stream]);
  if (!stream) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-[#050505]">
        <div className="flex flex-col items-center gap-2 text-white/35">
          <Camera size={44} strokeWidth={1.4} />
          <span className="text-xs font-medium">No device feed</span>
        </div>
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      playsInline
      autoPlay
      muted={muted ?? true}
      aria-label={ariaLabel || 'Live camera'}
      className="absolute inset-0 h-full w-full object-cover"
      style={{
        transform: mirror ? 'scaleX(-1)' : undefined,
        filter: filterCss || undefined,
      }}
    />
  );
}

function RoundChip({ onPress, active, label, children, className }: { onPress: () => void; active?: boolean; label?: string; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className={cn(
        'grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md transition active:scale-95',
        active ? 'border-[#D6A83F]/70 bg-[#D6A83F]/30 text-[#F2C75C]' : 'border-white/15 bg-black/40 text-white/90 hover:bg-black/60',
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function GoLivePage() {
  const router = useRouter();
  const toast = useToast();
  const { user, token } = useAuth();
  const cam = useLiveCamera();
  const lk = useLiveKit();
  const { giftAnimations, enqueueGiftAnimation } = useGiftAnimationQueue();

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<LiveMode>('camera');
  const [goal, setGoal] = useState<GoalChoice>('followers');
  const [filter, setFilter] = useState('none');
  const [streamData, setStreamData] = useState<StreamDetail | null>(null);
  const [viewers, setViewers] = useState(0);
  const [duration, setDuration] = useState(0);
  const [roomVideo, setRoomVideo] = useState<MediaStream | null>(null);
  const [sheet, setSheet] = useState<SheetId>('none');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatPaused, setChatPaused] = useState(false);
  const [reactions, setReactions] = useState<{ id: string; emoji: string }[]>([]);
  const [liveGiftCount, setLiveGiftCount] = useState(0);
  const [endedSummary, setEndedSummary] = useState<LiveSummary | null>(null);
  const [connectError, setConnectError] = useState<LiveCameraError | null>(null);
  const [busy, setBusy] = useState(false);

  const phaseRef = useRef<Phase>('IDLE');
  const streamIdRef = useRef<string | null>(null);
  const hostSocketRef = useRef<Socket | null>(null);
  const giftSocketRef = useRef<Socket | null>(null);
  const endLiveRef = useRef<() => void>(() => undefined);
  const endedRef = useRef(false);
  const liveAttemptRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { streamIdRef.current = streamData?.id ?? null; }, [streamData?.id]);

  const isPreLive = phase === 'IDLE' || phase === 'REQUESTING_PERMISSIONS' || phase === 'CAMERA_PREVIEW' || phase === 'CONFIGURING_LIVE';
  const isLiveRoom = phase === 'LIVE';
  const isEnding = phase === 'ENDING_LIVE';
  const isEnded = phase === 'LIVE_ENDED';
  const isError = phase === 'ERROR';

  // ---------------------------------------------------------------------------
  // Mount: request camera permission immediately and show a full-screen preview.
  // If the browser requires a user gesture (iOS Safari / conservative Chrome),
  // fall back to IDLE so the user can tap "Enable camera".
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    const request = async () => {
      setPhase('REQUESTING_PERMISSIONS');
      try {
        await cam.startPreview(false);
        if (mounted) setPhase('CAMERA_PREVIEW');
      } catch (err) {
        if (!mounted) return;
        setConnectError(err as LiveCameraError);
        setPhase('ERROR');
      }
    };
    void request();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down everything on unmount / page-hide (best effort; the backend
  // heartbeat timeout always catches an abandoned session even if this misses).
  useEffect(() => {
    const onPageHide = () => {
      const sid = streamIdRef.current;
      if (phaseRef.current === 'LIVE' && sid && !endedRef.current) {
        try { hostSocketRef.current?.emit('end_stream', { streamId: sid }); } catch { /* noop */ }
        try {
          void fetch(`${API_BASE_URL}/api/live/${sid}/end`, {
            method: 'PUT', headers: authHeaders(token), credentials: 'include', keepalive: true,
          });
        } catch { /* noop */ }
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      lk.disconnect();
      cam.stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
// ---------------------------------------------------------------------------
  // Reactions (floating hearts) â€” ephemeral interaction, never a chat line.
  // ---------------------------------------------------------------------------
  const burstReaction = useCallback((emoji: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((prev) => [...prev.slice(-14), { id, emoji }]);
    window.setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2600);
  }, []);

  const sendReaction = useCallback(async (emoji: string) => {
    burstReaction(emoji);
    const sid = streamIdRef.current;
    const sock = hostSocketRef.current;
    if (!sock || !sid) return;
    sock.emit('reaction', { streamId: sid, emoji });
  }, [burstReaction]);

  /** Share the live across the platform share sheet / clipboard. */
  const shareLive = useCallback(async () => {
    const sid = streamIdRef.current;
    if (!sid) return;
    const url = `${window.location.origin}/live/${sid}`;
    const body = `Join my VANTA live â€” ${title.trim() || 'Live now'}!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'VANTA Live', text: body, url });
        hostSocketRef.current?.emit('live_share', { streamId: sid });
        return;
      } catch { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', 'Share the link with your fans.');
    } catch {
      toast.error('Could not share', 'Copy the link manually.');
    }
  }, [title, toast]);

  /** GO LIVE: start the real stream only after camera/mic + LiveKit verify. */
  const startLive = useCallback(async () => {
    if (!token) return;
    if (phaseRef.current !== 'CAMERA_PREVIEW' && phaseRef.current !== 'CONFIGURING_LIVE') return;
    if (!cam.stream) {
      toast.error('Camera not ready', 'Enable your camera before going live.');
      return;
    }
    if (!title.trim()) {
      toast.error('Add a title', 'Give your live stream a title before going live.');
      return;
    }

    setPhase('CONNECTING_TO_LIVE');
    setConnectError(null);
    setBusy(true);
    liveAttemptRef.current = true;
    try {
      // Ensure a live audio track exists (requests mic permission inside this
      // user gesture when the browser has not granted it yet).
      if (!cam.getStream()?.getAudioTracks().length) {
        try { await cam.addMicrophone(); } catch { /* surfaced via error below */ }
      }

      const state = cam.getStream();
      const videoTrack = state?.getVideoTracks()[0];
      const audioTrack = state?.getAudioTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        const e: LiveCameraError = { code: 'CAMERA_INITIALIZATION_FAILED', message: 'The camera track is not live. Check that no other app is using the camera.' };
        throw e;
      }

      const { stream: created } = await apiPost<{ stream: StreamDetail }>(
        '/api/live/start',
        { title: title.trim(), category: 'Just Chatting', description: `${mode} live`, allowGifts: true, audience: 'everyone' },
        token,
      );
      if (!created?.id || !created?.liveKitRoom) {
        throw new Error('The live room could not be created. Try again.');
      }
      setStreamData(created);
      streamIdRef.current = created.id;

      const hostToken = await getLiveKitToken(created.id, token, 'host');

      // LiveKit acquires the same hardware the preview used and stops the
      // preview tracks, so the on-screen source becomes the published room feed.
      // `connect` resolves only after the room connected AND (if requested) the
      // camera/mic channels were verified as published â€” a failed connection or
      // a missing track throws inside the hook.
      await lk.connect(hostToken, created.liveKitRoom, {
        camera: cam.isVideoOn,
        microphone: !!audioTrack && cam.isAudioOn,
        mediaStream: state || undefined,
      });

      setPhase('LIVE');
      toast.success('You are live!');
    } catch (err: any) {
      console.error('Start live failed:', err);
      const mapped: LiveCameraError = err?.code
        ? (err as LiveCameraError)
        : { code: 'LIVE_CONNECTION_FAILED', message: err?.message || 'The stream could not be started. Check your connection and retry.' };
      setConnectError(mapped);
      setPhase('ERROR');
      toast.error('Unable to go live', mapped.message);
    } finally {
      setBusy(false);
    }
  }, [token, title, mode, cam, lk, toast]);
/** End the live: notify the backend + viewers, then tear down media. */
  const endLive = useCallback(async () => {
    const sid = streamIdRef.current;
    if (!token || !sid) return;
    const current = phaseRef.current;
    if (current !== 'LIVE' && current !== 'CONNECTING_TO_LIVE') return;
    endedRef.current = true;

    try { hostSocketRef.current?.emit('end_stream', { streamId: sid }); } catch { /* noop */ }
    setPhase('ENDING_LIVE');
    setSheet('none');
    try {
      await apiPut<any>(`/api/live/${sid}/end`, {}, token).catch(async () => {
        await apiPost<any>(`/api/live/${sid}/end`, {}, token).catch(() => undefined);
      });
      await new Promise((r) => window.setTimeout(r, 400));
    } catch { /* already ended */ }

    try { hostSocketRef.current?.emit('leave_stream', sid); } catch { /* noop */ }
    try { giftSocketRef.current?.emit('leave:stream', sid); } catch { /* noop */ }
    try { giftSocketRef.current?.disconnect(); } catch { /* noop */ }
    try { hostSocketRef.current?.disconnect(); } catch { /* noop */ }
    lk.disconnect();
    cam.stopAll();
    setPhase('LIVE_ENDED');
    void loadSummary(sid);
    toast.success('Live ended');
  }, [token, lk, cam, toast]);

  useEffect(() => { endLiveRef.current = endLive; }, [endLive]);

  /** Load the post-live analytics summary for the ended screen. */
  const loadSummary = useCallback(async (sid: string) => {
    if (!token) return;
    try {
      const d = await apiGet<any>(`/api/live/${sid}/analytics`, token, { skipCache: true });
      if (!d) return;
      setEndedSummary({
        duration: Number(d.duration) || 0,
        peakViewers: Number(d.peakViewers) || 0,
        totalViewers: Number(d.totalViewers) || 0,
        newFollowers: Number(d.newFollowers) || 0,
        messages: Number(d.messages) || 0,
        reactions: Number(d.reactions) || 0,
        giftCount: Number(d.giftCount) || 0,
        estimatedEarnings: Number(d.estimatedEarnings) || 0,
      });
    } catch { /* optional summary */ }
  }, [token]);
// ---------------------------------------------------------------------------
  // Host room socket: real-time chat, viewer counts, joins, reactions, gifts,
  // lifecycle. Created only once the stream is actually LIVE.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'LIVE' || !streamData?.id || !token) return;
    const rid = streamData.id;
    let alive = true;

    const sock = createSocket(token);
    sock.connect();
    hostSocketRef.current = sock;

    sock.on('connect', () => {
      if (alive) sock.emit('host_room', rid);
    });
    sock.on('reconnect', () => {
      if (alive) sock.emit('host_room', rid);
    });
    sock.on('host_chat_history', (d: any) => {
      if (alive && d?.streamId === rid && Array.isArray(d?.messages)) {
        setChatLines(d.messages.map(toChatLine).slice(-80));
      }
    });
    sock.on('new_comment', (d: any) => {
      if (alive && d?.streamId === rid && d?.message) {
        setChatLines((prev) => [...prev.slice(-79), toChatLine(d.message)]);
      }
    });
    sock.on('viewer_count', (d: any) => {
      if (alive && d?.streamId === rid && Number.isFinite(Number(d?.viewers))) {
        setViewers(Number(d.viewers));
      }
    });
    sock.on('viewer_joined', (d: any) => {
      if (alive && d?.streamId === rid && Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
    });
    sock.on('viewer_left', (d: any) => {
      if (alive && d?.streamId === rid && Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
    });
    sock.on('reaction', (d: any) => {
      if (alive && d?.streamId === rid && d?.emoji) burstReaction(d.emoji);
    });
    sock.on('message_deleted', (d: any) => {
      if (alive && d?.streamId === rid && d?.messageId) setChatLines((prev) => prev.filter((m) => m.id !== d.messageId));
    });
    sock.on('chat_cleared', (d: any) => {
      if (alive && d?.streamId === rid) setChatLines([]);
    });
    sock.on('chat_paused', (d: any) => {
      if (alive && d?.streamId === rid) setChatPaused(Boolean(d?.paused));
    });
    sock.on('live_event', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      const line = liveEventLine(d);
      if (!line) return;
      setChatLines((prev) => [...prev.slice(-79), { id: `ev-${d.at}-${d.type}-${Math.random().toString(36).slice(2, 6)}`, message: line, kind: 'system', meta: { type: d.type }, createdAt: d.at }]);
    });
    // Gift events published on the main socket room by the economy service.
    sock.on('gift_received', (giftPayload: any) => {
      if (!alive || giftPayload?.streamId !== rid) return;
      const tx = giftPayload?.transaction || giftPayload;
      setLiveGiftCount((c) => c + 1);
      enqueueGiftAnimation({
        ...tx,
        senderId: tx?.senderId || giftPayload?.senderId, senderName: tx?.senderName || giftPayload?.senderName,
        giftId: tx?.giftId || giftPayload?.giftId, giftName: tx?.giftName || giftPayload?.giftName,
        amount: giftPayload?.amount ?? tx?.amount, quantity: tx?.quantity || giftPayload?.quantity || 1,
        thumbnailUrl: tx?.thumbnailUrl, animationUrl: tx?.animationUrl, animationType: tx?.animationType,
        glowColor: tx?.glowColor, particleColor: tx?.particleColor, animationDuration: tx?.animationDuration,
        isLegendary: tx?.isLegendary, tier: tx?.tier, rarity: tx?.rarity, impactLevel: tx?.impactLevel,
        artworkType: tx?.artworkType, id: tx?.id,
      });
    });
    sock.on('stream_ended', (d: any) => {
      if (alive && d?.streamId === rid) endLiveRef.current();
    });

    // Secondary gift namespace â€” the dedicated /gifts socket also surfaces
    // `gift:received`. The queue de-dupes by transaction id, so both channels
    // can coexist without double-playing an animation.
    try {
      const gsock = createSocket(token, '/gifts');
      gsock.connect();
      giftSocketRef.current = gsock;
      gsock.on('connect', () => gsock.emit('join:stream', rid));
      gsock.on('gift:received', (giftPayload: any) => {
        if (!alive) return;
        if (giftPayload?.receiverId || giftPayload?.streamId) {
          setLiveGiftCount((c) => c + 1);
          enqueueGiftAnimation({
            ...giftPayload, senderId: giftPayload.senderId, senderName: giftPayload.senderName,
            giftId: giftPayload.giftId, giftName: giftPayload.giftName, amount: giftPayload.amount,
            quantity: giftPayload.comboCount || 1,
          });
        }
      });
    } catch { /* gift channel is optional */ }

    return () => {
      alive = false;
      try { giftSocketRef.current?.emit('leave:stream', rid); } catch { /* noop */ }
      try { giftSocketRef.current?.disconnect(); } catch { /* noop */ }
      giftSocketRef.current = null;
      try { sock.emit('leave_stream', rid); } catch { /* noop */ }
      sock.disconnect();
      hostSocketRef.current = null;
    };
  }, [phase, streamData?.id, token, burstReaction, enqueueGiftAnimation]);

// ---------------------------------------------------------------------------
  // Host heartbeat (10s cadence) â€” the backend enforces a 30s timeout.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'LIVE' || !streamData?.id || !token) return;
    const sid = streamData.id;
    let lastAck = Date.now();
    const beat = async () => {
      try {
        const res = await apiPost<any>(`/api/live/${sid}/heartbeat`, {}, token);
        if (res && res.ended === true) {
          endLiveRef.current();
          return;
        }
        lastAck = Date.now();
      } catch (err: any) {
        const status = err?.statusCode ?? err?.response?.status;
        if (status === 410) {
          endLiveRef.current();
          return;
        }
        // Transient blip â€” the server allows up to 30s to recover.
        lastAck = lastAck;
      }
    };
    void beat();
    const hbTimer = window.setInterval(() => void beat(), 10_000);
    const durTimer = window.setInterval(() => setDuration((d) => d + 1), 1000);
    return () => {
      window.clearInterval(hbTimer);
      window.clearInterval(durTimer);
    };
  }, [phase, streamData?.id, token]);

  // Send a chat message from the streamer without leaving the live.
  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    const sid = streamIdRef.current;
    if (!text || !sid || !hostSocketRef.current || chatPaused) return;
    hostSocketRef.current.emit('send_comment', { streamId: sid, comment: text });
    setChatInput('');
  }, [chatInput, chatPaused]);

  // Reset per-live stats when a new session goes LIVE.
  useEffect(() => {
    if (phase !== 'LIVE') return;
    setChatLines([]);
    setViewers(0);
    setDuration(0);
    setLiveGiftCount(0);
    setChatPaused(false);
  }, [phase, streamData?.id]);

// ---------------------------------------------------------------------------
  // Watch the published local video track and surface it as a MediaStream so
  // the LIVE room keeps showing real video after LiveKit takes over the camera.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const local = lk.localParticipant;
    if (phase !== 'LIVE' || !local) return;
    let cancelled = false;
    const pick = () => {
      if (cancelled) return;
      const pubs = local.videoTrackPublications;
      let found: MediaStream | null = null;
      pubs.forEach((pub) => {
        if (found || !pub.track || pub.track.kind !== 'video') return;
        const mt = pub.track.mediaStreamTrack;
        if (mt) found = new MediaStream([mt]);
      });
      if (found) setRoomVideo(found);
      else window.setTimeout(pick, 250);
    };
    pick();
    const onSub = () => { if (!cancelled) pick(); };
    lk.room?.on('trackSubscribed', onSub as any);
    return () => {
      cancelled = true;
      lk.room?.off('trackSubscribed', onSub as any);
    };
  }, [phase, lk.localParticipant, lk.room]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const displayName = user?.username || user?.fullName || 'Streamer';
  const avatar = user?.avatar || user?.avatarUrl || null;
  const feedMirror = isPreLive || isLiveRoom ? !cam.isFrontCamera : false;
  const filterCss = FILTERS.find((f) => f.id === filter)?.css || '';
  const lkReconnecting = phase === 'LIVE' && lk.connectionState === ConnectionState.Reconnecting;
  const secs = duration % 60;
  const mins = Math.floor(duration / 60) % 60;
  const hrs = Math.floor(duration / 3600);
  const clock = `${hrs > 0 ? `${hrs}:` : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const goalLabel = goal === 'gifts' ? 'Gifts' : goal === 'duration' ? 'Watch time' : 'Followers';

  return (
    <main className="fixed inset-0 z-40 overflow-hidden bg-black text-white">
      {/* The real device camera fills the entire screen under every control. */}
      <CameraFeed stream={isLiveRoom ? roomVideo || cam.stream : cam.stream} mirror={feedMirror} filterCss={filterCss} ariaLabel={isLiveRoom ? 'Live broadcast' : 'Camera preview'} />

      {/* Screen-edge glow so overlay controls stay legible over bright video. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/60" />

      {/* Floating reactions */}
      <div className="pointer-events-none absolute inset-0 z-[70]">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.span
              key={r.id}
              initial={{ opacity: 0, y: 0, scale: 0.5 }}
              animate={{ opacity: [0, 1, 1, 0], y: -180, scale: [0.5, 1.2, 1.4, 1.2] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.2, times: [0, 0.15, 0.7, 1] }}
              className="absolute bottom-[38%] left-1/2 -ml-4 text-4xl drop-shadow-lg"
              aria-hidden
            >
              {r.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {/* Gift animations from any viewer */}
      <GiftAnimationOverlay events={giftAnimations} />

      {/* *********************************************************************
          GO LIVE / PRE-LIVE SURFACE
          ********************************************************************* */}
      {isPreLive && (
        <>
        <div className="absolute inset-0 flex flex-col" aria-label="Go Live">
          {/* Top controls */}
          <div className="flex shrink-0 items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
            <button
              type="button"
              onClick={() => router.replace('/live')}
              aria-label="Close Go Live"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white/90 backdrop-blur-md transition active:scale-95 hover:bg-black/60"
            >
              <X size={19} />
            </button>
            <button
              type="button"
              onClick={() => setSheet('rewards')}
              aria-label="LIVE Rewards"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#D6A83F]/50 bg-black/40 px-4 text-xs font-bold text-[#F2C75C] backdrop-blur-md transition active:scale-95 hover:bg-black/60"
            >
              <Coins size={16} />
              LIVE Rewards
            </button>
            <div className="flex items-center gap-2">
              <RoundChip onPress={() => setSheet('fanclub')} label="Fan club" active>
                <Crown size={18} />
              </RoundChip>
              <RoundChip onPress={() => setSheet('more')} label="More">
                <EllipsisH />
              </RoundChip>
            </div>
          </div>

          {/* Camera control row â€” floats over the preview above the config panel */}
          <div className="flex shrink-0 items-center justify-center gap-2.5 pt-4">
            <CameraControl onPress={() => void cam.flipCamera()} label="Flip camera" active={!cam.isFrontCamera}>
              <FlipIc />
            </CameraControl>
            <CameraControl onPress={() => setSheet('beauty')} label="Beautify" active={filter !== 'none'}>
              <Sparkles size={18} />
            </CameraControl>
            <CameraControl onPress={() => setSheet('effects')} label="Effects" active={false}>
              <SlidersHorizontal size={18} />
            </CameraControl>
            <CameraControl onPress={() => setSheet('settings')} label="Settings" active={false}>
              <Settings size={18} />
            </CameraControl>
            <CameraControl onPress={() => setSheet('service')} label="Service+" active={false}>
              <Plus size={18} />
            </CameraControl>
          </div>

          {/* Spacer */}
          <div className="min-h-0 flex-1" />
        </div>

        {/* Config panel â€” floating translucent panel over the camera */}
        <div className="absolute inset-x-3 bottom-[58px] rounded-3xl border border-white/10 bg-black/55 px-4 pt-3 pb-2 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Avatar src={avatar} alt={displayName} size="lg" wrapperClassName="ring-2 ring-[#D6A83F]/60" />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-[#D6A83F] text-black">
                <Check size={12} strokeWidth={3} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="truncate text-[10px] text-white/50">@{user?.username || displayName} Â· Device camera</p>
            </div>
            <button
              type="button"
              onClick={() => setSheet('settings')}
              aria-label="Stream settings"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.07] text-white/80 transition active:scale-95 hover:bg-white/[0.12]"
            >
              <ChevronRight size={17} />
            </button>
          </div>

          {/* Title input */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            placeholder="Add a title"
            aria-label="Livestream title"
            className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-white outline-none placeholder:text-white/45 focus:border-[#D6A83F]/60"
          />

          {/* LIVE goal */}
          <button
            type="button"
            onClick={() => setSheet('goal')}
            aria-label="LIVE goal"
            className="mt-2 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 transition active:scale-[0.99] hover:bg-white/[0.08]"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Trophy size={15} className="text-[#F2C75C]" />
              LIVE goal
            </span>
            <span className="flex items-center gap-1.5 text-xs font-bold text-white">
              {goal === 'none' ? 'Goal off' : `+${goalLabel}`}
              {goal !== 'none' && <Zap size={13} className="text-[#F2C75C]" />}
              <ChevronRight size={15} className="text-white/40" />
            </span>
          </button>

          {/* Prominent GO LIVE button */}
          <button
            type="button"
            onClick={() => void startLive()}
            aria-label="Go live"
            className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#D6A83F] py-3.5 text-base font-extrabold text-black shadow-[0_8px_28px_rgba(214,168,63,0.45)] transition active:scale-[0.98] hover:bg-[#E4B64C]"
          >
            <Radio size={20} fill="currentColor" />
            GO LIVE
          </button>

          {/* Mode selector */}
          <div className="mt-3 flex items-center justify-around border-t border-white/[0.08] pt-2.5 pb-1">
            {MODES.map((m) => {
              const Icon = m.icon;
              const selected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 transition active:scale-95',
                    selected ? 'bg-white/[0.14]' : 'opacity-60 hover:opacity-90',
                  )}
                >
                  <span className={cn('grid h-8 w-8 place-items-center rounded-full', selected ? 'bg-[#D6A83F] text-black' : 'bg-white/10 text-white/80')}>
                    <Icon size={16} />
                  </span>
                  <span className={cn('text-[10px] font-semibold', selected ? 'text-white' : 'text-white/70')}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom creation navigation */}
        <div className="absolute inset-x-0 bottom-0 mx-auto flex items-center justify-center gap-1 pb-[calc(env(safe-area-inset-bottom)+8px)]">
          <BottomNavTab active label="LIVE" onClick={() => router.replace('/live')}>
            <Video size={16} />
          </BottomNavTab>
          <BottomNavTab label="CAMERA" onClick={() => undefined}>
            <Camera size={16} />
          </BottomNavTab>
          <BottomNavTab label="CREATE" onClick={() => router.replace('/')}>
            <Plus size={16} />
          </BottomNavTab>
        </div>
        </>
      )}
{/* *********************************************************************
          LIVE ROOM SURFACE â€” the video is the primary interface.
          ********************************************************************* */}
      {isLiveRoom && (
        <div className="absolute inset-0 flex flex-col" aria-label="Live room">
          {/* Top-left: streamer identity + engagement + Fan Club */}
          <div className="flex shrink-0 items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
            <button type="button" onClick={() => router.replace(`/profile/${user?.username || ''}`)} aria-label="Your profile">
              <Avatar src={avatar} alt={displayName} size="md" wrapperClassName="ring-2 ring-white/20" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="max-w-[110px] truncate text-sm font-bold text-white drop-shadow">{displayName}</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#D6A83F]/90 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-black">
                  <Radio size={9} fill="currentColor" /> LIVE
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <EngineIcon badge={Math.max(60, 1000 - liveGiftCount)} />
                <span className="text-[10px] font-semibold text-white/80">{formatNumber(Math.max(0, 1000 - liveGiftCount))} fans</span>
                <span className="text-white/35">Â·</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-white/70">
                  <Clock size={10} /> {clock}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSheet('fanclub')}
                aria-label="Your Fan Club"
                className="mt-1 inline-flex h-6 items-center gap-1 rounded-full bg-gradient-to-r from-[#D6A83F] to-[#F2C75C] px-2.5 text-[10px] font-extrabold text-black shadow transition active:scale-95"
              >
                <Crown size={11} fill="currentColor" /> Your Fan Club
              </button>
            </div>
          </div>

          {/* Top-right: viewers, cam/mic status, end live */}
          <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+8px)] flex flex-col items-end gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3 text-xs font-bold text-white backdrop-blur-md tabular-nums">
              <Eye size={13} className="text-[#F2C75C]" /> {formatNumber(viewers)}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className={cn('grid h-8 w-8 place-items-center rounded-full border border-white/15 backdrop-blur-md',
                  lk.isMicrophoneOn ? 'bg-black/45 text-white' : 'bg-rose-500/30 text-rose-200')}
                aria-label={lk.isMicrophoneOn ? 'Microphone on' : 'Microphone muted'}
              >
                {lk.isMicrophoneOn ? <Mic size={14} /> : <MicOff size={14} />}
              </span>
              <span
                className={cn('grid h-8 w-8 place-items-center rounded-full border border-white/15 backdrop-blur-md',
                  lk.isCameraOn ? 'bg-black/45 text-white' : 'bg-rose-500/30 text-rose-200')}
                aria-label={lk.isCameraOn ? 'Camera on' : 'Camera off'}
              >
                {lk.isCameraOn ? <Camera size={14} /> : <CameraOff size={14} />}
              </span>
              <button
                type="button"
                onClick={endLiveRef.current}
                aria-label="End live"
                className="grid h-9 w-9 place-items-center rounded-full border border-rose-400/40 bg-rose-600/80 text-white shadow-lg transition active:scale-95 hover:bg-rose-600"
              >
                <X size={17} strokeWidth={2.6} />
              </button>
            </span>
            {lkReconnecting && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-300 backdrop-blur-md">
                <Loader2 size={11} className="animate-spin" /> Reconnectingâ€¦
              </span>
            )}
          </div>

          {/* Bottom-left: host chat layer (over the video) */}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
            {chatLines.length > 0 && (
              <div className="mb-2 space-y-1 overflow-hidden">
                {chatLines.slice(-4).map((line) =>
                  line.kind === 'system' ? (
                    <p key={line.id} className="text-[11px] font-medium text-white/60 drop-shadow">{line.message}</p>
                  ) : (
                    <p key={line.id} className="truncate text-[12px] leading-snug text-white/95 drop-shadow-md">
                      <span className="font-bold text-[#F2C75C]">{line.user?.username || 'Viewer'}: </span>
                      <span className="text-white/90">{line.message}</span>
                    </p>
                  ),
                )}
              </div>
            )}
            {chatOpen ? (
              <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 py-1 pl-3 pr-1 backdrop-blur-xl">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                  placeholder={chatPaused ? 'Chat is paused' : 'Say somethingâ€¦'}
                  disabled={chatPaused}
                  autoFocus
                  aria-label="Chat message"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                />
                <button
                  type="button"
                  onClick={sendChat}
                  disabled={!chatInput.trim() || chatPaused}
                  aria-label="Send message"
                  className="grid h-8 w-8 place-items-center rounded-full bg-[#D6A83F] text-black transition active:scale-95 disabled:opacity-40"
                >
                  <SendIc />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                aria-label="Open chat"
                className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-black/45 px-3.5 text-xs font-medium text-white/85 backdrop-blur-md transition active:scale-95 hover:bg-black/60"
              >
                <MessageSquare size={15} />
                {chatPaused ? 'Chat paused' : 'Chat with your viewersâ€¦'}
              </button>
            )}
          </div>

          {/* Bottom-right: circular control rail */}
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] right-3 z-10 flex flex-col items-center gap-3">
            <LiveAction onPress={() => setChatOpen((v) => !v)} label="Chat" badge={chatLines.length}>
              <MessageCircle size={20} />
            </LiveAction>
            <LiveAction onPress={() => void shareLive()} label="Share" active>
              <Share2 size={20} />
            </LiveAction>
            <LiveAction onPress={() => setSheet('beauty')} label="Beautify" active={filter !== 'none'}>
              <Wand2 size={20} />
            </LiveAction>
            <LiveAction onPress={() => setSheet('more')} label="More">
              <EllipsisH />
            </LiveAction>
          </div>
        </div>
      )}
{/* *********************************************************************
          CONNECTING TO LIVE â€” spinner over the camera
          ********************************************************************* */}
      {phase === 'CONNECTING_TO_LIVE' && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-black/55 px-8 py-6">
            <span className="relative flex h-14 w-14 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#D6A83F]/25" />
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#D6A83F] text-black shadow-[0_0_30px_rgba(214,168,63,0.5)]">
                <Radio size={22} fill="currentColor" />
              </span>
            </span>
            <p className="text-sm font-bold text-white">Connecting to liveâ€¦</p>
            <p className="max-w-[220px] text-center text-[11px] leading-snug text-white/55">
              Starting the stream room and publishing your camera &amp; microphone.
            </p>
            <Loader2 size={16} className="animate-spin text-[#F2C75C]" />
          </div>
        </div>
      )}

      {/* *********************************************************************
          ENDING LIVE â€” brief transition, camera still visible
          ********************************************************************* */}
      {isEnding && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-white/10 bg-black/55 px-8 py-6">
            <Loader2 size={22} className="animate-spin text-[#F2C75C]" />
            <p className="text-sm font-bold text-white">Ending liveâ€¦</p>
            <p className="text-[11px] text-white/55">Thanks for streaming!</p>
          </div>
        </div>
      )}

      {/* *********************************************************************
          LIVE ENDED â€” post-live summary over a dark screen
          ********************************************************************* */}
      {isEnded && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 px-6 backdrop-blur-md">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
            <Check size={26} className="text-emerald-400" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold text-white">Stream ended</h2>
          <p className="mt-1 text-sm text-white/50">Thanks for going live!</p>

          <div className="mt-5 grid w-full max-w-[340px] grid-cols-3 gap-2">
            <SummaryCell label="Duration" value={clock} icon={<Clock size={14} />} />
            <SummaryCell label="Peak viewers" value={formatNumber(endedSummary?.peakViewers || 0)} icon={<Users size={14} />} />
            <SummaryCell label="Gifts" value={formatNumber(endedSummary?.giftCount ?? liveGiftCount)} icon={<Gift size={14} />} />
            <SummaryCell label="Messages" value={formatNumber(endedSummary?.messages || 0)} icon={<MessageSquare size={14} />} />
            <SummaryCell label="New fans" value={formatNumber(endedSummary?.newFollowers || 0)} icon={<Heart size={14} />} />
            <SummaryCell label="Coins" value={formatNumber(endedSummary?.estimatedEarnings || 0)} icon={<Coins size={14} />} />
          </div>

          <div className="mt-6 flex w-full max-w-[340px] gap-2">
            <button
              type="button"
              onClick={() => router.replace('/live')}
              className="flex-1 rounded-2xl border border-white/12 bg-white/[0.05] py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
            >
              Browse Live
            </button>
            <button
              type="button"
              onClick={() => { setPhase('CAMERA_PREVIEW'); setTitle(''); setStreamData(null); setChatLines([]); endedRef.current = false; void cam.startPreview(false); }}
              className="flex-1 rounded-2xl bg-[#D6A83F] py-3 text-sm font-extrabold text-black transition hover:bg-[#E4B64C]"
            >
              Go Live again
            </button>
          </div>
        </div>
      )}
{/* *********************************************************************
          ERROR + RECOVERY
          ********************************************************************* */}
      {isError && connectError && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/70 px-6 backdrop-blur-md">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-rose-500/15">
            <AlertTriangle size={26} className="text-rose-400" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-white">
            {connectError.code === 'CAMERA_PERMISSION_DENIED' ? 'Camera permission needed' :
             connectError.code === 'MIC_PERMISSION_DENIED' ? 'Microphone permission needed' :
             connectError.code === 'LIVE_CONNECTION_FAILED' ? 'Could not start your live' :
             'Camera unavailable'}
          </h2>
          <p className="mt-2 max-w-[300px] text-center text-sm leading-snug text-white/60">{connectError.message}</p>

          <div className="mt-6 flex w-full max-w-[320px] flex-col gap-2">
            {connectError.code === 'CAMERA_PERMISSION_DENIED' || connectError.code === 'MIC_PERMISSION_DENIED' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    cam.clearError();
                    setConnectError(null);
                    liveAttemptRef.current = false;
                    setPhase('REQUESTING_PERMISSIONS');
                    cam.startPreview(false)
                      .then(() => setPhase('CAMERA_PREVIEW'))
                      .catch((e) => { setConnectError(e as LiveCameraError); setPhase('ERROR'); });
                  }}
                  className="w-full rounded-2xl bg-[#D6A83F] py-3 text-sm font-extrabold text-black transition hover:bg-[#E4B64C]"
                >
                  <RefreshCw size={15} className="mr-1.5 inline" /> Allow &amp; retry
                </button>
                <button
                  type="button"
                  onClick={() => router.replace('/live')}
                  className="w-full rounded-2xl border border-white/12 bg-white/[0.05] py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                >
                  Back to Live
                </button>
              </>
            ) : (
              <>
                {liveAttemptRef.current ? (
                  <button
                    type="button"
                    onClick={() => {
                      cam.clearError();
                      void startLive();
                    }}
                    disabled={busy}
                    className="w-full rounded-2xl bg-[#D6A83F] py-3 text-sm font-extrabold text-black transition hover:bg-[#E4B64C] disabled:opacity-60"
                  >
                    {busy ? <Loader2 size={15} className="mr-1.5 inline animate-spin" /> : <RefreshCw size={15} className="mr-1.5 inline" />}
                    Retry
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      cam.clearError();
                      setConnectError(null);
                      setPhase('REQUESTING_PERMISSIONS');
                      cam.startPreview(false)
                        .then(() => setPhase('CAMERA_PREVIEW'))
                        .catch((e) => { setConnectError(e as LiveCameraError); setPhase('ERROR'); });
                    }}
                    className="w-full rounded-2xl bg-[#D6A83F] py-3 text-sm font-extrabold text-black transition hover:bg-[#E4B64C]"
                  >
                    <RefreshCw size={15} className="mr-1.5 inline" /> Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => router.replace('/live')}
                  className="w-full rounded-2xl border border-white/12 bg-white/[0.05] py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                >
                  Back to Live
                </button>
              </>
            )}
          </div>

          <p className="mt-4 text-center text-[10px] leading-relaxed text-white/35">
            VANTA Live needs camera &amp; microphone access over a secure connection.
          </p>
        </div>
      )}
{/* *********************************************************************
          BOTTOM SHEETS
          ********************************************************************* */}
      <AnimatePresence>
        {sheet !== 'none' && (
          <div className="absolute inset-0 z-[80] flex items-end" onClick={() => setSheet('none')}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: 60, opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full rounded-t-3xl border-t border-white/10 bg-[#101013]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 text-white shadow-2xl backdrop-blur-2xl"
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">{sheetTitle(sheet)}</h2>
                <button type="button" onClick={() => setSheet('none')} aria-label="Close panel" className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-white/70 hover:bg-white/[0.12]">
                  <X size={15} />
                </button>
              </div>

              {sheet === 'settings' && (
                <div className="mt-3 space-y-1.5">
                  <SettingRow
                    icon={cam.isVideoOn ? <Camera size={16} /> : <CameraOff size={16} />}
                    label="Camera"
                    value={cam.isVideoOn ? 'On' : 'Off'}
                    onToggle={() => cam.toggleVideo()}
                    active={cam.isVideoOn}
                  />
                  <SettingRow
                    icon={cam.isAudioOn ? <Mic size={16} /> : <MicOff size={16} />}
                    label="Microphone"
                    value={cam.isAudioOn ? 'On' : 'Off'}
                    onToggle={async () => { if (!cam.getStream()?.getAudioTracks().length) { try { await cam.addMicrophone(); } catch { return; } } cam.toggleAudio(); }}
                    active={cam.isAudioOn}
                  />
                  <SettingRow icon={<RepeatIc size={16} />} label="Camera flip" value={cam.isFrontCamera ? 'Front' : 'Back'} onToggle={() => void cam.flipCamera()} active={!cam.isFrontCamera} />
                  <button type="button" onClick={() => { setSheet('beauty'); }} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm">
                    <Sparkles size={16} className="text-[#F2C75C]" /> Beauty &amp; filters<span className="ml-auto text-white/40"><ChevronRight size={15} /></span>
                  </button>
                </div>
              )}

              {sheet === 'beauty' || sheet === 'effects' ? (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      aria-pressed={filter === f.id}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[11px] font-semibold transition active:scale-95',
                        filter === f.id ? 'border-[#D6A83F]/70 bg-[#D6A83F]/15 text-[#F2C75C]' : 'border-white/[0.06] bg-white/[0.04] text-white/70 hover:bg-white/[0.08]',
                      )}
                    >
                      <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-[#222]">
                        <img src={avatar || '/branding/vanta-icon-192.png'} alt="" className="h-full w-full object-cover" style={{ filter: f.css || undefined }} />
                      </span>
                      {f.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {sheet === 'goal' && (
                <div className="mt-3 space-y-1.5">
                  {([
                    { id: 'followers', label: 'Followers', sub: '+100 followers during this live' },
                    { id: 'gifts', label: 'Gifts', sub: '+500 VANTA Coins from gifts' },
                    { id: 'duration', label: 'Watch time', sub: 'Keep fans watching 30 min' },
                    { id: 'none', label: 'No goal', sub: 'Go live without a goal' },
                  ] as { id: GoalChoice; label: string; sub: string }[]).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGoal(g.id)}
                      className={cn('flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition', goal === g.id ? 'border-[#D6A83F]/70 bg-[#D6A83F]/10' : 'border-white/[0.06] bg-white/[0.04]')}
                    >
                      <Trophy size={16} className={goal === g.id ? 'text-[#F2C75C]' : 'text-white/40'} />
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{g.label}</span>
                        <span className="block text-[11px] text-white/50">{g.sub}</span>
                      </span>
                      {goal === g.id && <Check size={16} className="text-[#F2C75C]" />}
                    </button>
                  ))}
                </div>
              )}

              {sheet === 'rewards' && (
                <div className="mt-3 space-y-2">
                  {[
                    { icon: <Zap size={16} />, title: 'Reach 100 fans', desc: 'Earn 50 VANTA Coins instantly' },
                    { icon: <Gift size={16} />, title: 'First live gift', desc: '2Ã— coins on your first gift of the day' },
                    { icon: <Trophy size={16} />, title: '60 min milestone', desc: 'Unlock the Gold Streak badge' },
                  ].map((r) => (
                    <div key={r.title} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-[#D6A83F]/15 text-[#F2C75C]">{r.icon}</span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{r.title}</span>
                        <span className="block text-[11px] text-white/50">{r.desc}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {sheet === 'fanclub' && (
                <div className="mt-3">
                  <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#D6A83F]/20 to-transparent px-3 py-3">
                    <Avatar src={avatar} alt={displayName} size="lg" />
                    <div className="flex-1">
                      <p className="text-sm font-bold">{displayName}â€™s Fan Club</p>
                      <p className="text-[11px] text-white/55">{formatNumber(Math.max(0, 1000 - liveGiftCount))} members Â· Join free</p>
                    </div>
                    <button type="button" onClick={() => toast.success('Fan Club', 'You are already a member.')} className="rounded-full bg-[#D6A83F] px-4 py-2 text-xs font-extrabold text-black">Joined âœ“</button>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-white/50">
                    Your Fan Club sees exclusive LIVE emojis, early access to your streams and a special badge next to their name.
                  </p>
                </div>
              )}

              {sheet === 'service' && (
                <div className="mt-3 space-y-1.5">
                  {[
                    { icon: <MessageSquare size={16} />, label: 'Auto subtitles', desc: 'Live captions for your viewers' },
                    { icon: <LanguagesIc size={16} />, label: 'Translate chat', desc: 'Viewers see comments in their language' },
                    { icon: <Sparkles size={16} />, label: 'Smart highlights', desc: 'Auto-clip your best moments' },
                  ].map((s) => (
                    <button key={s.label} type="button" onClick={() => toast.info('Service+', `${s.label} is coming soon.`)} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-left">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-[#F2C75C]">{s.icon}</span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{s.label}</span>
                        <span className="block text-[11px] text-white/50">{s.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {sheet === 'more' && (
                <div className="mt-3 space-y-1.5">
                  <MoreRow icon={<RepeatIc size={16} />} label="Flip camera" onPress={() => void cam.flipCamera()} />
                  <MoreRow icon={cam.isAudioOn ? <MicOff size={16} /> : <Mic size={16} />} label={cam.isAudioOn ? 'Mute microphone' : 'Unmute microphone'} onPress={() => void cam.toggleAudio()} />
                  <MoreRow icon={cam.isVideoOn ? <CameraOff size={16} /> : <Camera size={16} />} label={cam.isVideoOn ? 'Turn camera off' : 'Turn camera on'} onPress={() => cam.toggleVideo()} />
                  {isLiveRoom && <MoreRow icon={<Flag size={16} />} label="Report a problem" onPress={() => toast.info('Report', 'Thanks â€” our team will review it.')} />}
                  {isLiveRoom && (
                    <button type="button" onClick={endLiveRef.current} className="flex w-full items-center gap-3 rounded-2xl bg-rose-500/10 px-3 py-2.5 text-sm font-bold text-rose-300">
                      <X size={16} /> End live<span className="ml-auto text-xs font-medium text-rose-300/60">Tap to stop</span>
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
/* -------------------------------------------------------------------------
 * Small presentational helpers (defined after the page component; function
 * declarations are hoisted, so the light component tree above can use them).
 * ------------------------------------------------------------------------- */
function sheetTitle(id: SheetId): string {
  switch (id) {
    case 'settings': return 'Live settings';
    case 'effects': return 'Live effects';
    case 'beauty': return 'Beautify';
    case 'service': return 'Service+';
    case 'rewards': return 'LIVE Rewards';
    case 'goal': return 'Set a LIVE goal';
    case 'fanclub': return 'Fan Club';
    case 'more': return 'More options';
    default: return '';
  }
}

function CameraControl({ onPress, label, active, children }: { onPress: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className={cn(
        'flex flex-col items-center gap-1 transition active:scale-95',
      )}
    >
      <span className={cn(
        'grid h-11 w-11 place-items-center rounded-full border backdrop-blur-md shadow-lg',
        active ? 'border-[#D6A83F]/70 bg-[#D6A83F]/30 text-[#F2C75C]' : 'border-white/20 bg-black/45 text-white/95 hover:bg-black/65',
      )}>
        {children}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-white/80 drop-shadow">{label}</span>
    </button>
  );
}

function BottomNavTab({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-9 flex-col items-center justify-center gap-0.5 rounded-xl px-4 text-[10px] font-bold uppercase tracking-widest transition active:scale-95',
        active ? 'text-[#F2C75C]' : 'text-white/55 hover:text-white/80',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** Tiny engagement/fan gauge that mirrors the LIVE reference look. */
function EngineIcon({ badge }: { badge: number }) {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="25" height="13" rx="6.5" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.25)" />
      <g className="animate-pulse">
        <rect x="3" y="7" width="5" height="4" rx="1" fill="#F2C75C" />
        <rect x="9" y="5" width="5" height="6" rx="1" fill="#D6A83F" />
        <rect x="15" y="3.5" width="5" height="7.5" rx="1" fill="#F2C75C" />
        <rect x="21" y="4.5" width="2.5" height="6.5" rx="1" fill="#D6A83F" opacity="0.7" />
      </g>
    </svg>
  );
}

function EllipsisH() { return <Ellipsis size={18} />; }
function FlipIc({ size = 18 }: { size?: number } = {}) { return <FlipVertical2 size={size} />; }
function RepeatIc({ size = 18 }: { size?: number }) { return <Repeat2 size={size} />; }
function SendIc() { return <Send size={15} />; }
function LanguagesIc({ size = 16 }: { size?: number }) { return <Languages size={size} />; }

function LiveAction({ onPress, label, badge, active, children }: { onPress: () => void; label: string; badge?: number; active?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onPress}
        aria-label={label}
        className={cn(
          'relative grid h-12 w-12 place-items-center rounded-full border shadow-lg backdrop-blur-md transition active:scale-95',
          active ? 'border-white/30 bg-black/50 text-white' : 'border-white/15 bg-black/40 text-white/90 hover:bg-black/60',
        )}
      >
        {children}
        {!!badge && badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[18px] place-items-center rounded-full bg-[#D6A83F] px-1 text-[9px] font-extrabold text-black tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-white/75 drop-shadow">{label}</span>
    </div>
  );
}

function SummaryCell({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.045] px-2 py-3 text-center">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">{icon}{label}</span>
      <span className="text-base font-extrabold tabular-nums text-white">{value}</span>
    </div>
  );
}

function SettingRow({ icon, label, value, onToggle, active }: { icon: React.ReactNode; label: string; value: string; onToggle: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99]">
      <span className={cn('grid h-9 w-9 place-items-center rounded-full', active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.06] text-white/70')}>{icon}</span>
      <span className="flex-1 text-left text-sm font-semibold">{label}</span>
      <span className="text-[11px] font-bold text-white/45">{value}</span>
    </button>
  );
}

function MoreRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99] hover:bg-white/[0.08]">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70">{icon}</span>
      <span className="flex-1 text-left text-sm font-semibold">{label}</span>
    </button>
  );
}
