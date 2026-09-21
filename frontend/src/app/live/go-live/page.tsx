'use client';

/**
 * VANTA GO LIVE — full-screen capture + live room
 * ----------------------------------------------
 * The Go-Live and LIVE-room experience rebuilt to match the product references:
 *
 *   IDLE → REQUESTING_PERMISSIONS → CAMERA_PREVIEW → CONFIGURING_LIVE
 *        → CONNECTING_TO_LIVE (start stream → host token → LiveKit publish)
 *        → LIVE → ENDING_LIVE → LIVE_ENDED
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
  LayoutGrid,
  Shield,
  Ban,
  Trash2,
  Timer,
  UserPlus,
  Users,
  Video,
  VideoOff,
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
import { useContentCreation } from '@/components/create/ContentCreationContext';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';
import { cn, formatNumber } from '@/lib/utils';
import GiftAnimationOverlay from '@/components/gifts/GiftAnimationOverlay';
import { useGiftAnimationQueue } from '@/components/gifts/useGiftAnimationQueue';
import type { StageParticipant } from '@/components/live/LiveParticipantGrid';
import { reconcileLiveChat } from '@/lib/liveChatDedupe';

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
  | 'category'
  | 'guests'
  | 'goal'
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

interface GuestUser {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

interface GuestStage {
  guests: GuestUser[];
  pending: GuestUser[];
  guestCount: number;
  guestLimit: number;
  allowGuests: boolean;
}

const FALLBACK_CATEGORIES = [
  'Just Chatting', 'Music', 'Gaming', 'Education', 'Technology',
  'Lifestyle', 'Sports', 'Art', 'Cooking', 'Other',
];

const QUALITY_PRESETS: { id: 'auto' | '480p' | '720p' | '1080p'; label: string }[] = [
  { id: 'auto', label: 'Auto (highest)' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: '480p', label: '480p' },
];

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

const REACT_EMOJIS = ['❤️', '🔥', '👏', '😂', '😍', '🎉'];

/** Minimal live_event → system chat line (keeps chat free of junk). */
function liveEventLine(d: any): string | null {
  const u = d?.user;
  const name = u?.username ? `@${u.username}` : 'Someone';
  switch (d?.type) {
    case 'joined': return `${name} joined the live`;
    case 'left': return `${name} left the live`;
    case 'liked': return '';
    case 'shared': return `${name} shared your live`;
    case 'followed': return `${name} started following you`;
    case 'gift': return `${name} sent ${d.giftName || 'a gift'}${d.quantity && d.quantity > 1 ? ` × ${d.quantity}` : ''}`;
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

/** Reconciler for the host chat overlay (dedups by stable server id). */
const HOST_CHAT_RECONCILE = {
  idOf: (l: any) => (l as ChatLine).id,
  fingerprintOf: (l: any) => {
    const m = l as ChatLine;
    return `${m.user?.id ?? ''}\u0000${m.kind ?? ''}\u0000${m.message}`;
  },
};

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
  // Stream setup state
  const { liveDraft, clearLiveDraft } = useContentCreation();
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [category, setCategory] = useState<string>('Just Chatting');
  const [allowGifts, setAllowGifts] = useState(true);
  const [allowGuests, setAllowGuests] = useState(true);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [slowMode, setSlowMode] = useState(false);
  // Guest stage (host side)
  const [guestStage, setGuestStage] = useState<GuestStage>({ guests: [], pending: [], guestCount: 0, guestLimit: 4, allowGuests: true });
  const [guestRequest, setGuestRequest] = useState<GuestUser | null>(null);

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

  // Prefill the setup from the "+" Go Live modal draft (title/category/thumbnail)
  // so nothing the user chose before arriving here is lost.
  useEffect(() => {
    if (!liveDraft) return;
    if (liveDraft.title) setTitle(liveDraft.title);
    if (liveDraft.category) setCategory(liveDraft.category);
    if (liveDraft.thumbnailUrl) setThumbnail(liveDraft.thumbnailUrl);
    clearLiveDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDraft]);

  // Load the real category list from the backend (falls back to a static list
  // only when the service is unreachable).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!token) return;
        const data = await apiGet<any>('/api/live/categories', token);
        const list = Array.isArray(data) ? data : data?.categories || data?.data || [];
        const names = list.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
        if (mounted && names.length) setCategories(names);
      } catch { /* keep fallback list */ }
    })();
    return () => { mounted = false; };
  }, [token]);

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
  // Reactions (floating hearts) — ephemeral interaction, never a chat line.
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
    const body = `Join my VANTA live — ${title.trim() || 'Live now'}!`;
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
        { title: title.trim(), category: category || 'Just Chatting', description: `${mode} live`, allowGifts, allowGuests },
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
      // camera/mic channels were verified as published � a failed connection or
      // a missing track throws inside the hook.
      const previewDeviceId = videoTrack?.getSettings?.().deviceId;
      await lk.connect(hostToken, created.liveKitRoom, {
        camera: cam.isVideoOn,
        microphone: !!audioTrack && cam.isAudioOn,
        // Pass the ACTUAL preview device so LiveKit re-acquires the same camera
        // (front/rear) the user selected instead of the default front camera.
        cameraDeviceId: previewDeviceId || undefined,
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
        setChatLines((prev) => reconcileLiveChat(prev, (d.messages as any[]).map(toChatLine), { maxVisible: 80, ...HOST_CHAT_RECONCILE }).visible as ChatLine[]);
      }
    });
    sock.on('new_comment', (d: any) => {
      if (alive && d?.streamId === rid && d?.message) {
        setChatLines((prev) => reconcileLiveChat(prev, [toChatLine(d.message)], { maxVisible: 80, ...HOST_CHAT_RECONCILE }).visible as ChatLine[]);
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
    sock.on('slow_mode', (d: any) => {
      if (alive && d?.streamId === rid) setSlowMode(Boolean(d?.enabled));
    });

    // ---- Guest stage (host side): requests → premium modal; roster → sheet ----
    sock.on('guest_request', (d: any) => {
      if (!alive || d?.streamId !== rid || !d?.user) return;
      setGuestRequest({ id: d.user.id, username: d.user.username, fullName: d.user.fullName, avatar: d.user.avatar, verified: !!d.user.verified });
      toast.info('Guest request', `@${d.user.username} wants to join your live`);
    });
    sock.on('guest_state', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      const list = (u: any[]) => (Array.isArray(u) ? u.map((g: any) => ({ id: g.id, username: g.username, fullName: g.fullName, avatar: g.avatar, verified: !!g.verified })) : []);
      setGuestStage((prev) => ({
        guests: list(d.guests),
        pending: list(d.pending),
        guestCount: Number(d.guestCount) ?? list(d.guests).length,
        guestLimit: Number(d.guestLimit) || prev.guestLimit || 4,
        allowGuests: d.allowGuests !== false,
      }));
    });
    sock.on('guest_pending', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      const list = (u: any[]) => (Array.isArray(u) ? u.map((g: any) => ({ id: g.id, username: g.username, fullName: g.fullName, avatar: g.avatar, verified: !!g.verified })) : []);
      setGuestStage((prev) => ({ ...prev, pending: list(d.pending) }));
    });
    sock.on('guest_error', (d: any) => {
      if (!alive) return;
      toast.error('Guest', d?.error || 'Could not manage the guest stage.');
    });
    sock.on('live_event', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      const line = liveEventLine(d);
      if (!line) return;
      const sys: ChatLine = { id: `ev-${d.at}-${d.type}-${Math.random().toString(36).slice(2, 6)}`, message: line, kind: 'system', meta: { type: d.type }, createdAt: d.at };
      setChatLines((prev) => reconcileLiveChat(prev, [sys], { maxVisible: 80, ...HOST_CHAT_RECONCILE }).visible as ChatLine[]);
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

    // Secondary gift namespace — the dedicated /gifts socket also surfaces
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
  // Host heartbeat (10s cadence) — the backend enforces a 30s timeout.
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
        // Transient blip — the server allows up to 30s to recover.
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

  // ---- Host guest-stage actions (backed by the real guest socket flow) ----
  const respondGuest = useCallback((viewerId: string, accept: boolean) => {
    const sid = streamIdRef.current;
    if (!sid || !hostSocketRef.current) return;
    hostSocketRef.current.emit('guest_respond', { streamId: sid, viewerId, accept });
    setGuestRequest(null);
    if (accept) {
      setGuestStage((prev) => ({
        ...prev,
        pending: prev.pending.filter((g) => g.id !== viewerId),
        guests: prev.guests.some((g) => g.id === viewerId) ? prev.guests : [...prev.guests, { id: viewerId, username: 'You', avatar: null }],
      }));
      toast.success('Guest added', 'They can now join your live with their camera & mic.');
    }
    // The authoritative roster arrives via `guest_state` right after.
  }, [toast]);

  const removeGuest = useCallback((guestId: string) => {
    const sid = streamIdRef.current;
    if (!sid || !hostSocketRef.current) return;
    hostSocketRef.current.emit('guest_remove', { streamId: sid, guestId });
    setGuestStage((prev) => ({ ...prev, guests: prev.guests.filter((g) => g.id !== guestId) }));
  }, []);

  // ---- Host chat moderation (real socket controls) ----
  const hostToggleChatPause = useCallback(() => {
    const sid = streamIdRef.current;
    if (!sid || !hostSocketRef.current) return;
    hostSocketRef.current.emit('toggle_chat_pause', { streamId: sid });
  }, []);

  const hostSetSlowMode = useCallback((interval: number) => {
    const sid = streamIdRef.current;
    if (!sid || !hostSocketRef.current) return;
    hostSocketRef.current.emit('toggle_slow_mode', { streamId: sid, interval });
  }, []);

  const hostClearChat = useCallback(() => {
    const sid = streamIdRef.current;
    if (!sid || !hostSocketRef.current) return;
    hostSocketRef.current.emit('clear_chat', { streamId: sid });
    setChatLines([]);
    toast.success('Chat cleared', 'The conversation has been reset.');
  }, [toast]);

  // Persist gifts/guests permission changes when already live (real PATCH).
  const applyStreamSettings = useCallback(async (patch: { allowGifts?: boolean; allowGuests?: boolean }) => {
    const sid = streamIdRef.current;
    if (!sid || !token) return;
    try {
      await apiPut<any>(`/api/live/${sid}`, patch, token);
    } catch {
      toast.error('Settings', 'Could not save live settings. Try again.');
    }
  }, [token, toast]);

  const updateAllowGifts = useCallback((value: boolean) => {
    setAllowGifts(value);
    if (streamIdRef.current) void applyStreamSettings({ allowGifts: value });
  }, [applyStreamSettings]);

  const updateAllowGuests = useCallback((value: boolean) => {
    setAllowGuests(value);
    setGuestStage((prev) => ({ ...prev, allowGuests: value }));
    if (streamIdRef.current) void applyStreamSettings({ allowGuests: value });
  }, [applyStreamSettings]);

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
  // Guest stage video — surface approved guests' published camera/mic into
  // compact tiles alongside the host's full-bleed feed (real LiveKit tracks).
  // ---------------------------------------------------------------------------
  const [, setGuestTick] = useState(0);
  useEffect(() => {
    if (phase !== 'LIVE' || !lk.room) return;
    const room = lk.room;
    const bump = () => setGuestTick((t) => t + 1);
    room.on('trackSubscribed', bump as any);
    room.on('trackUnsubscribed', bump as any);
    room.on('participantConnected', bump);
    room.on('participantDisconnected', bump);
    return () => {
      room.off('trackSubscribed', bump as any);
      room.off('trackUnsubscribed', bump as any);
      room.off('participantConnected', bump);
      room.off('participantDisconnected', bump);
    };
  }, [phase, lk.room]);

  const stageGuests = useMemo(() => {
    if (!lk.room || phase !== 'LIVE') return [] as StageParticipant[];
    const room = lk.room;
    const approved = new Set(guestStage.guests.map((g) => g.id));
    const byId = new Map(guestStage.guests.map((g) => [g.id, g]));
    const tiles: StageParticipant[] = [];
    room.remoteParticipants.forEach((p: any) => {
      if (!approved.has(p.identity)) return;
      const vids: MediaStreamTrack[] = [];
      p.videoTrackPublications?.forEach((pub: any) => { if (pub?.track?.mediaStreamTrack) vids.push(pub.track.mediaStreamTrack); });
      const hasAudio = p.audioTrackPublications?.size > 0;
      const guest = byId.get(p.identity);
      tiles.push({
        id: p.identity,
        username: guest?.username || p.identity,
        avatar: guest?.avatar || null,
        verified: guest?.verified,
        stream: vids.length ? new MediaStream(vids) : null,
        cameraOn: vids.length > 0,
        micOn: hasAudio,
      });
    });
    return tiles.slice(0, 4);
  }, [lk.room, phase, guestStage.guests, lk.participants]);

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
          {/* Top controls — back, VANTA branding, settings */}
          <div className="flex shrink-0 items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
            <button
              type="button"
              onClick={() => router.replace('/live')}
              aria-label="Close Go Live"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white/90 backdrop-blur-md transition active:scale-95 hover:bg-black/60"
            >
              <X size={19} />
            </button>
            <div className="flex min-w-0 flex-col items-center">
              <span className="inline-flex items-center gap-1.5 text-sm font-extrabold tracking-[0.08em] text-[#F2C75C] drop-shadow">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-[#D6A83F] to-[#F2C75C]">
                  <Radio size={13} fill="currentColor" className="text-black" />
                </span>
                VANTA
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">Go Live</span>
            </div>
            <button
              type="button"
              onClick={() => setSheet('settings')}
              aria-label="Stream settings"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white/90 backdrop-blur-md transition active:scale-95 hover:bg-black/60"
            >
              <Settings size={18} />
            </button>
          </div>

          {/* Camera control row — floats over the preview above the config panel */}
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
          </div>

          {/* Spacer */}
          <div className="min-h-0 flex-1" />
        </div>

        {/* Config panel — floating translucent panel over the camera */}
        <div className="absolute inset-x-3 bottom-[58px] rounded-3xl border border-white/10 bg-black/55 px-4 pt-3 pb-2 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Avatar src={avatar} alt={displayName} size="lg" wrapperClassName="rounded-full ring-2 ring-[#D6A83F]/60" />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-[#D6A83F] text-black">
                <Check size={12} strokeWidth={3} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="truncate text-[10px] text-white/50">@{user?.username || displayName} · Device camera</p>
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

          {/* Thumbnail from the "+" Go Live draft (when one was chosen) */}
          {thumbnail && (
            <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-[#18181b]">
                <img src={thumbnail} alt="Stream thumbnail" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1 text-[11px] leading-tight text-white/55">
                <span className="block font-semibold text-white/85">Stream thumbnail</span>
                Preview shown to viewers browsing Live
              </span>
            </div>
          )}

          {/* Title input */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            placeholder="What are you going live about?"
            aria-label="Livestream title"
            className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-white outline-none placeholder:text-white/45 focus:border-[#D6A83F]/60"
          />

          {/* Category */}
          <button
            type="button"
            onClick={() => setSheet('category')}
            aria-label="Stream category"
            className="mt-2 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 transition active:scale-[0.99] hover:bg-white/[0.08]"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <LayoutGrid size={15} className="text-[#F2C75C]" />
              Category
            </span>
            <span className="flex items-center gap-1.5 text-xs font-bold text-white">
              {category || 'Select'}
              <ChevronRight size={15} className="text-white/40" />
            </span>
          </button>

          {/* Guests permission */}
          <button
            type="button"
            onClick={() => updateAllowGuests(!allowGuests)}
            aria-label="Toggle allowing guests"
            aria-pressed={allowGuests}
            className="mt-2 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 transition active:scale-[0.99] hover:bg-white/[0.08]"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Users size={15} className="text-[#F2C75C]" />
              Guests
            </span>
            <span className="flex items-center gap-2">
              <span className={cn('text-xs font-bold', allowGuests ? 'text-[#F2C75C]' : 'text-white/40')}>
                {allowGuests ? 'Allow guests' : 'Guests off'}
              </span>
              <span className={cn('relative h-6 w-10 rounded-full border transition', allowGuests ? 'border-[#D6A83F]/60 bg-[#D6A83F]/30' : 'border-white/15 bg-white/10')}>
                <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', allowGuests ? 'left-[18px] bg-[#F2C75C]' : 'left-0.5 bg-white/50')} />
              </span>
            </span>
          </button>

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
          LIVE ROOM SURFACE — the video is the primary interface.
          ********************************************************************* */}
      {isLiveRoom && (
        <div className="absolute inset-0 flex flex-col" aria-label="Live room">
          {/* Top-left: streamer identity + engagement + Fan Club */}
          <div className="flex shrink-0 items-center gap-2.5 px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
            <button type="button" onClick={() => router.replace(`/profile/${user?.username || ''}`)} aria-label="Your profile" className="shrink-0">
              {/* Circular profile avatar — no square box around it */}
              <Avatar src={avatar} alt={displayName} size="md" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate text-sm font-bold leading-none text-white drop-shadow">{displayName}</p>
                <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full bg-[#D6A83F] px-2 text-[9px] font-extrabold uppercase tracking-wide text-black">
                  <Radio size={9} fill="currentColor" /> LIVE
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] leading-none">
                <span className="inline-flex items-center gap-1 font-semibold text-white/80">
                  <Eye size={10} className="text-[#F2C75C]" /> {formatNumber(viewers)} watching
                </span>
                <span className="text-white/35">·</span>
                <span className="inline-flex items-center gap-0.5 font-medium text-white/70">
                  <Clock size={10} /> {clock}
                </span>
                {liveGiftCount > 0 && (
                  <>
                    <span className="text-white/35">·</span>
                    <span className="inline-flex items-center gap-0.5 font-medium text-[#F2C75C]">
                      <Gift size={10} /> {formatNumber(liveGiftCount)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Top-right: viewers, cam/mic status, end live */}
          <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+8px)] flex flex-col items-end gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3 text-xs font-bold text-white backdrop-blur-md tabular-nums">
              <Eye size={13} className="text-[#F2C75C]" /> {formatNumber(viewers)}
            </span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void lk.toggleMicrophone()}
                className={cn('grid h-8 w-8 place-items-center rounded-full border border-white/15 backdrop-blur-md transition active:scale-95',
                  lk.isMicrophoneOn ? 'bg-black/45 text-white' : 'bg-rose-500/30 text-rose-200')}
                aria-label={lk.isMicrophoneOn ? 'Mute microphone' : 'Unmute microphone'}
              >
                {lk.isMicrophoneOn ? <Mic size={14} /> : <MicOff size={14} />}
              </button>
              <button
                type="button"
                onClick={() => void lk.toggleCamera()}
                className={cn('grid h-8 w-8 place-items-center rounded-full border border-white/15 backdrop-blur-md transition active:scale-95',
                  lk.isCameraOn ? 'bg-black/45 text-white' : 'bg-rose-500/30 text-rose-200')}
                aria-label={lk.isCameraOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {lk.isCameraOn ? <Camera size={14} /> : <CameraOff size={14} />}
              </button>
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
                <Loader2 size={11} className="animate-spin" /> Reconnecting…
              </span>
            )}
          </div>

          {/* Guest stage tiles — real LiveKit camera/mic video from approved guests */}
          {stageGuests.length > 0 && (
            <div className="absolute left-3 top-[calc(env(safe-area-inset-top)+70px)] z-10 flex flex-col gap-2">
              {stageGuests.map((g) => (
                <div key={g.id} className="w-32 overflow-hidden rounded-xl border border-white/15 bg-[#0D0D0F] shadow-xl backdrop-blur-sm">
                  <div className="relative aspect-video w-full">
                    {g.stream && g.cameraOn ? (
                      <video ref={(el) => { if (el) { el.srcObject = g.stream; void el.play().catch(() => undefined); } }} playsInline autoPlay muted className="h-full w-full object-cover" aria-label={`${g.username} camera`} />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center bg-[#0D0D0F]">
                        <Avatar src={g.avatar} alt={g.username} size="sm" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4">
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-white">
                        <span className="max-w-[64px] truncate">@{g.username}</span>
                        {!g.cameraOn && <VideoOff size={9} className="text-rose-300" />}
                        {!g.micOn && <MicOff size={9} className="text-white/60" />}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

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
                  placeholder={chatPaused ? 'Chat is paused' : 'Say something…'}
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
                {chatPaused ? 'Chat paused' : 'Chat with your viewers…'}
              </button>
            )}
          </div>

          {/* Bottom-right: circular control rail — Share lives in “More”; the rail is
              docked above the composer so the bottom chat composer is never covered */}
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+64px)] right-3 z-10 flex flex-col items-center gap-2.5">
            <LiveAction onPress={() => setChatOpen((v) => !v)} label="Chat" badge={chatLines.length} active={chatOpen}>
              <MessageCircle size={20} />
            </LiveAction>
            <LiveAction onPress={() => setSheet('guests')} label="Guests" badge={guestStage.guestCount + guestStage.pending.length}>
              <Users size={20} />
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
          CONNECTING TO LIVE — spinner over the camera
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
            <p className="text-sm font-bold text-white">Connecting to live…</p>
            <p className="max-w-[220px] text-center text-[11px] leading-snug text-white/55">
              Starting the stream room and publishing your camera &amp; microphone.
            </p>
            <Loader2 size={16} className="animate-spin text-[#F2C75C]" />
          </div>
        </div>
      )}

      {/* *********************************************************************
          ENDING LIVE — brief transition, camera still visible
          ********************************************************************* */}
      {isEnding && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-white/10 bg-black/55 px-8 py-6">
            <Loader2 size={22} className="animate-spin text-[#F2C75C]" />
            <p className="text-sm font-bold text-white">Ending live…</p>
            <p className="text-[11px] text-white/55">Thanks for streaming!</p>
          </div>
        </div>
      )}

      {/* *********************************************************************
          LIVE ENDED — post-live summary over a dark screen
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

      {/* Guest request — premium accept/decline modal (real socket flow) */}
      <AnimatePresence>
        {guestRequest && (
          <div className="absolute inset-0 z-[90] flex items-center justify-center px-6" onClick={() => setGuestRequest(null)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 340 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[320px] overflow-hidden rounded-3xl border border-white/10 bg-[#121216]/97 p-5 text-center shadow-2xl backdrop-blur-2xl"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#D6A83F]/15 to-transparent" />
              <div className="relative flex flex-col items-center">
                <div className="relative">
                  <Avatar src={guestRequest.avatar} alt={guestRequest.username} size="xl" wrapperClassName="rounded-full ring-2 ring-[#D6A83F]/60" />
                  <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-[#121216] bg-[#D6A83F] text-black">
                    <UserPlus size={12} strokeWidth={2.6} />
                  </span>
                </div>
                <h3 className="mt-3 text-base font-extrabold text-white">Guest request</h3>
                <p className="mt-1 text-sm text-white/60">
                  <span className="font-bold text-[#F2C75C]">@{guestRequest.username}</span> wants to join your live
                </p>
                <p className="mt-2 text-[11px] text-white/40">They&apos;ll join with their camera &amp; microphone.</p>

                <div className="mt-5 flex w-full gap-2.5">
                  <button
                    type="button"
                    onClick={() => respondGuest(guestRequest.id, false)}
                    className="flex-1 rounded-2xl border border-white/12 bg-white/[0.05] py-3 text-sm font-bold text-white/80 transition active:scale-[0.97] hover:bg-white/[0.1]"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => respondGuest(guestRequest.id, true)}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-[#D6A83F] to-[#F2C75C] py-3 text-sm font-extrabold text-black shadow-[0_8px_24px_rgba(214,168,63,0.35)] transition active:scale-[0.97]"
                  >
                    Accept
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                    icon={isLiveRoom ? (lk.isCameraOn ? <Camera size={16} /> : <CameraOff size={16} />) : (cam.isVideoOn ? <Camera size={16} /> : <CameraOff size={16} />)}
                    label="Camera"
                    value={isLiveRoom ? (lk.isCameraOn ? 'On' : 'Off') : (cam.isVideoOn ? 'On' : 'Off')}
                    onToggle={isLiveRoom ? () => void lk.toggleCamera() : () => cam.toggleVideo()}
                    active={isLiveRoom ? lk.isCameraOn : cam.isVideoOn}
                  />
                  <SettingRow
                    icon={isLiveRoom ? (lk.isMicrophoneOn ? <Mic size={16} /> : <MicOff size={16} />) : (cam.isAudioOn ? <Mic size={16} /> : <MicOff size={16} />)}
                    label="Microphone"
                    value={isLiveRoom ? (lk.isMicrophoneOn ? 'On' : 'Off') : (cam.isAudioOn ? 'On' : 'Off')}
                    onToggle={isLiveRoom ? () => void lk.toggleMicrophone() : async () => { if (!cam.getStream()?.getAudioTracks().length) { try { await cam.addMicrophone(); } catch { return; } } cam.toggleAudio(); }}
                    active={isLiveRoom ? lk.isMicrophoneOn : cam.isAudioOn}
                  />
                  {!isLiveRoom && <SettingRow icon={<RepeatIc size={16} />} label="Camera flip" value={cam.isFrontCamera ? 'Front' : 'Back'} onToggle={() => void cam.flipCamera()} active={!cam.isFrontCamera} />}

                  {/*
                    Real capture-quality preset — re-acquires the camera at the
                    requested resolution before broadcast (graceful fallback).
                    During the live the published bitstream is already running,
                    so it applies to the next session instead.
                  */}
                  <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70"><SlidersHorizontal size={16} /></span>
                    <span className="flex-1 text-left">
                      <span className="block text-sm font-semibold">Video quality</span>
                      {isLiveRoom && <span className="block text-[10px] text-white/40">Applied when you go live</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      {QUALITY_PRESETS.map((q) => {
                        const selected = cam.videoQuality === q.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            disabled={!cam.isVideoOn || isLiveRoom}
                            onClick={() => { void cam.setVideoQuality(q.id); }}
                            aria-pressed={selected}
                            className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold transition active:scale-95 disabled:opacity-40',
                              selected ? 'bg-[#D6A83F] text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12]')}
                          >
                            {q.id === 'auto' ? 'Auto' : q.id}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {cam.captureInfo && (
                    <p className="px-1 text-[10px] text-white/40">Capturing at {cam.captureInfo}</p>
                  )}

                  <SettingRow
                    icon={<Gift size={16} />}
                    label="Enable gifts"
                    value={allowGifts ? 'On' : 'Off'}
                    onToggle={() => updateAllowGifts(!allowGifts)}
                    active={allowGifts}
                  />
                  <SettingRow
                    icon={<Users size={16} />}
                    label="Allow guests"
                    value={allowGuests ? 'On' : 'Off'}
                    onToggle={() => updateAllowGuests(!allowGuests)}
                    active={allowGuests}
                  />
                  <button type="button" onClick={() => { setSheet('beauty'); }} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm">
                    <Sparkles size={16} className="text-[#F2C75C]" /> Beauty &amp; filters<span className="ml-auto text-white/40"><ChevronRight size={15} /></span>
                  </button>

                  {/* Chat moderation — only meaningful while the stream is live */}
                  {isLiveRoom && (
                    <div className="mt-1 border-t border-white/[0.08] pt-2">
                      <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                        <Shield size={12} /> Chat moderation
                      </p>
                      <div className="space-y-1.5">
                        <SettingRow
                          icon={<Ban size={16} />}
                          label="Pause chat"
                          value={chatPaused ? 'Paused' : 'Live'}
                          onToggle={hostToggleChatPause}
                          active={chatPaused}
                        />
                        <SettingRow
                          icon={<Timer size={16} />}
                          label="Slow mode"
                          value={slowMode ? 'On' : 'Off'}
                          onToggle={() => hostSetSlowMode(slowMode ? 0 : 5)}
                          active={slowMode}
                        />
                        <button type="button" onClick={hostClearChat} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99] hover:bg-white/[0.08]">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70"><Trash2 size={16} /></span>
                          <span className="flex-1 text-left text-sm font-semibold">Clear chat</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {sheet === 'category' && (
                <div className="mt-3 grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto pb-2">
                  {categories.map((cat) => {
                    const selected = category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setCategory(cat); setSheet('none'); }}
                        aria-pressed={selected}
                        className={cn('flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98]',
                          selected ? 'border-[#D6A83F]/70 bg-[#D6A83F]/15 text-[#F2C75C]' : 'border-white/[0.08] bg-white/[0.04] text-white/80 hover:bg-white/[0.08]')}
                      >
                        <LayoutGrid size={14} className={selected ? 'text-[#F2C75C]' : 'text-white/35'} />
                        <span className="truncate">{cat}</span>
                        {selected && <Check size={14} className="ml-auto text-[#F2C75C]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {sheet === 'guests' && (
                <div className="mt-3 max-h-[52vh] space-y-3 overflow-y-auto pb-2">
                  <div>
                    <p className="mb-1.5 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                      <span>On stage</span>
                      <span>{guestStage.guestCount}/{guestStage.guestLimit}</span>
                    </p>
                    {guestStage.guests.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-white/[0.1] px-3 py-4 text-center text-xs text-white/40">No guests on stage yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {guestStage.guests.map((g) => (
                          <div key={g.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2">
                            <Avatar src={g.avatar} alt={g.username} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">@{g.username}</span>
                            <button
                              type="button"
                              onClick={() => removeGuest(g.id)}
                              aria-label={`Remove ${g.username} from stage`}
                              className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-300 transition active:scale-95"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {guestStage.pending.length > 0 && (
                    <div>
                      <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Waiting to join</p>
                      <div className="space-y-1.5">
                        {guestStage.pending.map((g) => (
                          <div key={g.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2">
                            <Avatar src={g.avatar} alt={g.username} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">@{g.username}</span>
                            <button
                              type="button"
                              onClick={() => respondGuest(g.id, true)}
                              aria-label={`Accept ${g.username}`}
                              className="inline-flex items-center gap-1 rounded-full bg-[#D6A83F] px-2.5 py-1 text-[10px] font-extrabold text-black transition active:scale-95"
                            >
                              <Check size={11} strokeWidth={3} /> Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => respondGuest(g.id, false)}
                              aria-label={`Decline ${g.username}`}
                              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold text-white/70 transition active:scale-95"
                            >
                              Decline
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!allowGuests && (
                    <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">Guests are currently turned off for this live.</p>
                  )}
                </div>
              )}

              {sheet === 'beauty' || sheet === 'effects' ? (
                <div className="mt-3">
                  {/* Live preview card + reset */}
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2.5">
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#18181b] shadow-inner">
                      <img
                        src={avatar || '/branding/vanta-icon-192.png'}
                        alt="Effect preview"
                        className="h-full w-full object-cover"
                        style={{ filter: filterCss || undefined }}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{FILTERS.find((f) => f.id === filter)?.label || 'Original'}</p>
                      <p className="truncate text-[10px] text-white/45">Tap a filter to preview it on your camera</p>
                    </div>
                    {filter !== 'none' && (
                      <button
                        type="button"
                        onClick={() => setFilter('none')}
                        className="shrink-0 rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[10px] font-bold text-white/85 transition active:scale-95 hover:bg-white/[0.12]"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  {/* Circular filter swatches */}
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {FILTERS.map((f) => {
                      const selected = filter === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setFilter(f.id)}
                          aria-pressed={selected}
                          className={cn(
                            'flex flex-col items-center gap-1.5 rounded-2xl border py-2 text-[10px] font-semibold transition active:scale-95',
                            selected ? 'border-[#D6A83F]/70 bg-[#D6A83F]/15 text-[#F2C75C]' : 'border-white/[0.06] bg-white/[0.04] text-white/70 hover:bg-white/[0.08]',
                          )}
                        >
                          <span className={cn('relative grid h-12 w-12 place-items-center overflow-hidden rounded-full', selected ? 'ring-2 ring-[#D6A83F]/70' : 'ring-1 ring-white/15')}>
                            <img src={avatar || '/branding/vanta-icon-192.png'} alt={f.label} className="h-full w-full object-cover" style={{ filter: f.css || undefined }} />
                            {selected && (
                              <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[#D6A83F] text-black">
                                <Check size={9} strokeWidth={3.5} />
                              </span>
                            )}
                          </span>
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
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

              {sheet === 'more' && (
                <div className="mt-3 space-y-1.5">
                  {!isLiveRoom && <MoreRow icon={<RepeatIc size={16} />} label="Flip camera" onPress={() => void cam.flipCamera()} />}
                  <MoreRow
                    icon={isLiveRoom ? (lk.isMicrophoneOn ? <MicOff size={16} /> : <Mic size={16} />) : (cam.isAudioOn ? <MicOff size={16} /> : <Mic size={16} />)}
                    label={isLiveRoom ? (lk.isMicrophoneOn ? 'Mute microphone' : 'Unmute microphone') : (cam.isAudioOn ? 'Mute microphone' : 'Unmute microphone')}
                    onPress={isLiveRoom ? () => void lk.toggleMicrophone() : () => void cam.toggleAudio()}
                  />
                  <MoreRow
                    icon={isLiveRoom ? (lk.isCameraOn ? <CameraOff size={16} /> : <Camera size={16} />) : (cam.isVideoOn ? <CameraOff size={16} /> : <Camera size={16} />)}
                    label={isLiveRoom ? (lk.isCameraOn ? 'Turn camera off' : 'Turn camera on') : (cam.isVideoOn ? 'Turn camera off' : 'Turn camera on')}
                    onPress={isLiveRoom ? () => void lk.toggleCamera() : () => cam.toggleVideo()}
                  />
                  {isLiveRoom && (
                    <>
                      <MoreRow icon={<Share2 size={16} />} label="Share live" onPress={() => void shareLive()} />
                      <button type="button" onClick={endLiveRef.current} className="flex w-full items-center gap-3 rounded-2xl bg-rose-500/10 px-3 py-2.5 text-sm font-bold text-rose-300">
                        <X size={16} /> End live<span className="ml-auto text-xs font-medium text-rose-300/60">Tap to stop</span>
                      </button>
                    </>
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
    case 'category': return 'Choose a category';
    case 'guests': return 'Guests';
    case 'goal': return 'Set a LIVE goal';
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
        aria-pressed={active}
        className={cn(
          'relative grid h-12 w-12 place-items-center rounded-full border shadow-lg backdrop-blur-md transition active:scale-95',
          active
            ? 'border-[#D6A83F]/80 bg-[#D6A83F]/25 text-[#F2C75C] shadow-[0_0_18px_rgba(214,168,63,0.35)]'
            : 'border-white/15 bg-black/40 text-white/90 hover:bg-black/60',
        )}
      >
        {children}
        {!!badge && badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[18px] place-items-center rounded-full bg-[#D6A83F] px-1 text-[9px] font-extrabold text-black tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      <span className={cn('text-[9px] font-semibold uppercase tracking-wide drop-shadow', active ? 'text-[#F2C75C]' : 'text-white/75')}>{label}</span>
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
