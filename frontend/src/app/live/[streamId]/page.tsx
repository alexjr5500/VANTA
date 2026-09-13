'use client';

/**
 * VANTA Live Viewer
 * -----------------
 * Opens an active live stream as a full-screen mobile experience.
 *
 * The real host video (LiveKit) fills the entire viewport; all controls float
 * over it: top-left streamer card + Fan Club, top-right viewer count + exit,
 * bottom-right circular rail (Chat / Gift / Share / More). Comments, gifts,
 * reactions and viewer-join notices stream in as live overlays through the
 * existing live Socket.IO channels — nothing here is mocked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Crown,
  Ellipsis,
  Eye,
  Flag,
  Gift,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Pin,
  Radio,
  RefreshCw,
  Send,
  Share2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ConnectionState } from 'livekit-client';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';
import { useLiveKit, getLiveKitToken } from '@/lib/hooks/useLiveKit';
import { createSocket, type Socket } from '@/lib/socketClient';
import { cn, formatNumber } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import GiftPicker from '@/components/social/GiftPicker';
import GiftPickerBoundary from '@/components/social/GiftPickerBoundary';
import { normalizeGiftCatalog, type GiftCatalogItem } from '@/lib/giftCatalog';
import GiftAnimationOverlay from '@/components/gifts/GiftAnimationOverlay';
import { useGiftAnimationQueue } from '@/components/gifts/useGiftAnimationQueue';
import LiveParticipantGrid, { type StageParticipant } from '@/components/live/LiveParticipantGrid';
import { reconcileLiveChat, type ChatLineLike } from '@/lib/liveChatDedupe';

type ViewerPhase = 'LOADING' | 'LIVE' | 'ENDED' | 'ERROR';
type SheetId = 'none' | 'chat' | 'viewers' | 'more' | 'gift';

interface Host {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

interface StreamDetail {
  id: string;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  viewerCount: number;
  liveKitRoom?: string | null;
  status: string;
  active: boolean;
  categoryName?: string | null;
  allowGifts?: boolean;
  startedAt?: string | null;
  host: Host;
  _count?: { viewers?: number; giftEvents?: number };
}

interface ChatMessage {
  id: string;
  message: string;
  createdAt?: string;
  kind?: 'comment' | 'system';
  meta?: { icon?: string; type?: string };
  user?: { id: string; username: string; avatar?: string | null; verified?: boolean } | null;
}

function viewerEventLine(d: any): string | null {
  const u = d?.user;
  const name = u?.username ? `@${u.username}` : 'Someone';
  switch (d?.type) {
    case 'joined': return `${name} joined the live`;
    case 'left': return `${name} left the live`;
    case 'liked': return '';
    case 'shared': return `${name} shared the live`;
    case 'followed': return `${name} started following`;
    case 'gift': return `${name} sent ${d.giftName || 'a gift'}${d.quantity && d.quantity > 1 ? ` × ${d.quantity}` : ''}`;
    default: return '';
  }
}

function toChatMessage(raw: any): ChatMessage {
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

// Shared reconcile options for the viewer chat. Dedup anchors on the stable
// server message id first; when a message has no id we fall back to an
// author+text fingerprint so a duplicated server-un-ids delivery can never
// render twice. (Comments normally always carry a server id, this is a safety
// net for malformed/legacy payloads.)
const CHAT_RECONCILE: { idOf: (l: ChatLineLike) => unknown; fingerprintOf: (l: ChatLineLike) => string } = {
  idOf: (l) => (l as ChatMessage).id,
  fingerprintOf: (l) => {
    const m = l as ChatMessage;
    return `${m.user?.id ?? ''}\u0000${m.kind ?? ''}\u0000${m.message}`;
  },
};

/** Attaches a MediaStream (remote host video) to a <video>. */
function ViewerVideo({ stream }: { stream: MediaStream | null }) {
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
  return <video ref={videoRef} playsInline autoPlay className="h-full w-full object-cover" aria-label="Live stream" />;
}

export default function LiveViewerPage() {
  const params = useParams<{ streamId: string }>();
  const streamId = params?.streamId ?? '';
  const router = useRouter();
  const toast = useToast();
  const { token, user } = useAuth();

  const { room, connect, disconnect, connectionState } = useLiveKit();

  const [phase, setPhase] = useState<ViewerPhase>('LOADING');
  const [stream, setStream] = useState<StreamDetail | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<MediaStream | null>(null);
  const [viewers, setViewers] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetId>('none');
  const [chatPaused, setChatPaused] = useState(false);

  const [giftGifts, setGiftGifts] = useState<GiftCatalogItem[]>([]);
  const [giftBalance, setGiftBalance] = useState(0);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftLoadError, setGiftLoadError] = useState<string | null>(null);

  const { giftAnimations, enqueueGiftAnimation } = useGiftAnimationQueue();
  const giftSocketRef = useRef<Socket | null>(null);

  // Guest stage (kept functional — opened via the More sheet).
  const [guestStatus, setGuestStatus] = useState<'idle' | 'pending' | 'live' | 'denied'>('idle');
  const [guestRoster, setGuestRoster] = useState<{ id: string; username: string; avatar?: string | null }[]>([]);
  const [guestCapacity, setGuestCapacity] = useState({ count: 0, limit: 4 });
  const [myStream, setMyStream] = useState<MediaStream | null>(null);

  // Reactions + viewer roster + join notices + pin + report.
  const [reactions, setReactions] = useState<{ id: string; emoji: string }[]>([]);
  const [viewersList, setViewersList] = useState<{ id: string; username: string; avatar?: string | null }[]>([]);
  const [joinNotice, setJoinNotice] = useState<{ id: string; username: string; joined: boolean } | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; username: string | null; message: string } | null>(null);
  const [actionFor, setActionFor] = useState<ChatMessage | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const cleanupRef = useRef<() => void>(() => undefined);
  const streamIdRef = useRef(streamId);
  const phaseRef = useRef<ViewerPhase>('LOADING');
  const guestStatusRef = useRef(guestStatus);
  const loadStreamRef = useRef<() => Promise<void>>(async () => undefined);

  const REACTIONS_LIST = ['❤️', '🔥', '👏', '😂', '😍', '🎉'];

  useEffect(() => { streamIdRef.current = streamId; }, [streamId]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { guestStatusRef.current = guestStatus; }, [guestStatus]);

  const burstReaction = useCallback((emoji: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((prev) => [...prev.slice(-14), { id, emoji }]);
    window.setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2600);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    burstReaction(emoji);
    socketRef.current?.emit('reaction', { streamId: streamIdRef.current, emoji });
  }, [burstReaction]);

  const noticeJoin = useCallback((username: string, joined: boolean) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setJoinNotice({ id, username, joined });
    window.setTimeout(() => setJoinNotice((n) => (n && n.id === id ? null : n)), 2600);
  }, []);

  const appendMessage = useCallback((raw: any) => {
    const line = toChatMessage(raw);
    // Reconcile by stable server id: the same message can arrive via history +
    // live push and (for a host) via the dedicated user_ room, so it must be
    // shown exactly once. Non-matching older lines are returned as overflow so
    // full chat can still surface them — never destructively deleted.
    setMessages((prev) => reconcileLiveChat(prev, [line], { maxVisible: 80, ...CHAT_RECONCILE }).visible as ChatMessage[]);
  }, []);

  const handleStreamEnded = useCallback(() => {
    if (streamIdRef.current && socketRef.current) socketRef.current.emit('leave_stream', streamIdRef.current);
    disconnect();
    setPhase('ENDED');
  }, [disconnect]);

  // ---- Guest stage (request → accept → publish as guest) ----
  const requestToJoin = useCallback(() => {
    socketRef.current?.emit('request_join', { streamId: streamIdRef.current });
  }, []);

  const cancelJoin = useCallback(() => {
    socketRef.current?.emit('cancel_request', { streamId: streamIdRef.current });
    setGuestStatus('idle');
  }, []);

  const joinStage = useCallback(async (token: string, roomName: string) => {
    try {
      await disconnect();
      await connect(token, roomName, { camera: true, microphone: true });
      setGuestStatus('live');
      toast.success('You are on stage!');
    } catch (err: any) {
      setGuestStatus('idle');
      toast.error('Could not join the stage', err?.message || 'Please try again.');
    }
  }, [connect, disconnect, toast]);

  const leaveStage = useCallback(() => {
    socketRef.current?.emit('guest_leave', { streamId: streamIdRef.current });
    setGuestStatus('idle');
    if (guestStatusRef.current === 'live') disconnect();
    void loadStreamRef.current?.();
  }, [disconnect]);

  const joinStageRef = useRef(joinStage);
  useEffect(() => { joinStageRef.current = joinStage; }, [joinStage]);

  const setupSocket = useCallback((rid: string, t: string) => {
    try {
      const socket = createSocket(t);
      socket.connect();
      socketRef.current = socket;
      socket.on('connect', () => socket.emit('join_stream', rid));
      socket.on('new_comment', (d: any) => {
        if (d?.streamId === rid && d?.message) appendMessage(d.message);
      });
      socket.on('chat_paused', (d: any) => {
        if (d?.streamId === rid) setChatPaused(Boolean(d.paused));
      });
      // Gifts via the REST economy publish `gift_received` here — animate it.
      socket.on('gift_received', (payload: any) => {
        if (payload?.streamId !== rid) return;
        const tx = payload?.transaction || payload;
        enqueueGiftAnimation({
          ...tx, senderId: tx?.senderId || payload?.senderId, senderName: tx?.senderName || payload?.senderName,
          giftId: tx?.giftId || payload?.giftId, giftName: tx?.giftName || payload?.giftName,
          amount: payload?.amount ?? tx?.amount, quantity: tx?.quantity || payload?.quantity || 1,
          thumbnailUrl: tx?.thumbnailUrl, animationUrl: tx?.animationUrl, animationType: tx?.animationType,
          glowColor: tx?.glowColor, particleColor: tx?.particleColor, animationDuration: tx?.animationDuration,
          isLegendary: tx?.isLegendary, tier: tx?.tier, rarity: tx?.rarity, impactLevel: tx?.impactLevel,
          artworkType: tx?.artworkType, id: tx?.id,
        });
      });
      socket.on('viewer_count', (d: any) => {
        if (d?.streamId === rid && Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
      });
      socket.on('stream_ended', (d: any) => {
        if (d?.streamId === rid) handleStreamEnded();
      });
      socket.on('stream_state', (d: any) => {
        if (d?.streamId === rid && (d?.state === 'ENDED' || d?.state === 'FAILED')) handleStreamEnded();
      });
      socket.on('reaction', (d: any) => {
        if (d?.streamId === rid && d?.emoji) burstReaction(d.emoji);
      });
      socket.on('live_event', (d: any) => {
        if (d?.streamId !== rid) return;
        const line = viewerEventLine(d);
        if (!line) return;
        const sys: ChatMessage = { id: `ev-${d.at}-${d.type}-${Math.random().toString(36).slice(2, 6)}`, message: line, kind: 'system', meta: { type: d.type }, createdAt: d.at };
        setMessages((prev) => reconcileLiveChat(prev, [sys], { maxVisible: 80, ...CHAT_RECONCILE }).visible as ChatMessage[]);
      });
      socket.on('message_pinned', (d: any) => {
        if (d?.streamId === rid && d?.pinned) setPinnedMessage({ id: d.pinned.id, username: d.pinned.username, message: d.pinned.message });
      });
      socket.on('message_unpinned', (d: any) => {
        if (d?.streamId === rid) setPinnedMessage(null);
      });
      socket.on('message_deleted', (d: any) => {
        if (d?.streamId === rid && d?.messageId) setMessages((prev) => prev.filter((m) => m.id !== d.messageId));
      });
      socket.on('chat_cleared', (d: any) => {
        if (d?.streamId === rid) setMessages([]);
      });
      socket.on('guest_request_sent', () => setGuestStatus('pending'));
      socket.on('guest_error', (d: any) => {
        setGuestStatus('idle');
        if (d?.error) toast.error('Request to join', d.error);
      });
      socket.on('guest_rejected', (d: any) => {
        if (d?.streamId === rid) {
          setGuestStatus('idle');
          toast.info('Request declined', 'The host declined your request to join.');
        }
      });
socket.on('guest_state', (d: any) => {
        if (d?.streamId !== rid) return;
        setGuestRoster((Array.isArray(d.guests) ? d.guests : []).map((g: any) => ({ id: g.id, username: g.username, avatar: g.avatar })));
        setGuestCapacity({ count: Number(d.guestCount) || 0, limit: Number(d.guestLimit) || 4 });
      });
      socket.on('guest_accepted', (d: any) => {
        if (d?.streamId !== rid || !d?.token || !d?.roomName) return;
        void joinStageRef.current(d.token, d.roomName);
      });
      socket.on('guest_removed', (d: any) => {
        if (d?.streamId === rid && guestStatusRef.current !== 'idle') {
          setGuestStatus('idle');
          toast.info('Removed from stage', 'You are back to watching.');
          disconnect();
        }
      });
      socket.on('viewer_joined', (d: any) => {
        if (d?.streamId !== rid) return;
        if (Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
        if (d?.username && d?.userId !== (user as any)?.id) noticeJoin(d.username, true);
      });
      socket.on('viewer_left', (d: any) => {
        if (d?.streamId !== rid) return;
        if (Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
      });
      socket.on('viewers_list', (d: any) => {
        if (d?.streamId === rid && Array.isArray(d?.viewers)) setViewersList(d.viewers);
      });
      socket.on('banned_from_stream', (d: any) => {
        if (d?.streamId === rid) {
          toast.error('You were removed', 'You can no longer chat in this live.');
          handleStreamEnded();
        }
      });
      socket.on('chat_error', (d: any) => {
        if (d?.error) toast.error('Chat', d.error);
      });

      cleanupRef.current = () => {
        try { socket.emit('leave_stream', rid); } catch { /* noop */ }
        socket.disconnect();
      };

      // Dedicated /gifts namespace channel (queue de-dupes by id).
      try {
        const giftSocket = createSocket(t, '/gifts');
        giftSocket.connect();
        giftSocket.on('connect', () => giftSocket.emit('join:stream', rid));
        giftSocket.on('gift:received', (payload: any) => {
          if (payload?.streamId || payload?.receiverId) {
            enqueueGiftAnimation({ ...payload, senderId: payload.senderId, senderName: payload.senderName, giftId: payload.giftId, giftName: payload.giftName, amount: payload.amount, quantity: payload.comboCount || 1 });
          }
        });
        giftSocketRef.current = giftSocket;
        const prevCleanup = cleanupRef.current;
        cleanupRef.current = () => {
          prevCleanup();
          try { giftSocket.emit('leave:stream', rid); } catch { /* noop */ }
          giftSocket.disconnect();
        };
      } catch { /* gift channel is optional */ }
    } catch (err) {
      console.error('Socket setup failed:', err);
    }
  }, [appendMessage, handleStreamEnded, toast, burstReaction, noticeJoin, user, enqueueGiftAnimation]);
// Load stream, view as LiveKit viewer, load chat + follow status, join socket.
  const loadStream = useCallback(async () => {
    if (!token || !streamIdRef.current) return;
    loadStreamRef.current = loadStream;
    setPhase('LOADING');
    setConnectError(null);
    try {
      const data = await apiGet<StreamDetail>(`/api/live/${streamIdRef.current}`, token);
      setStream(data);
      if (!data || !data.active || data.status !== 'LIVE' || !data.liveKitRoom) {
        setPhase('ENDED');
        return;
      }
      setViewers(data.viewerCount ?? 0);

      const viewerToken = await getLiveKitToken(streamIdRef.current, token, 'viewer');
      await connect(viewerToken, data.liveKitRoom, { camera: false, microphone: false });

      apiGet<any>(`/api/live/${streamIdRef.current}/chat`, token, { skipCache: true })
        .then((d) => {
          const messagesRaw =
            (Array.isArray(d?.messages) ? d.messages : undefined) ??
            (Array.isArray(d?.messages?.items) ? d.messages.items : undefined) ??
            [];
          setMessages((prev) => reconcileLiveChat(prev, (messagesRaw as any[]).map(toChatMessage).reverse(), { maxVisible: 80, ...CHAT_RECONCILE }).visible as ChatMessage[]);
        })
        .catch(() => undefined);

      apiGet<{ following: boolean }>(`/api/live/${streamIdRef.current}/following`, token, { skipCache: true })
        .then((d) => setFollowing(!!d?.following))
        .catch(() => undefined);

      apiGet<any>(`/api/live/${streamIdRef.current}/guests`, token, { skipCache: true })
        .then((d) => {
          if (!d) return;
          setGuestRoster((Array.isArray(d.guests) ? d.guests : []).map((g: any) => ({ id: g.id, username: g.username, avatar: g.avatar })));
          setGuestCapacity({ count: Number(d.guestCount) || 0, limit: Number(d.guestLimit) || 4 });
        })
        .catch(() => undefined);

      setupSocket(streamIdRef.current, token);
      setPhase('LIVE');
    } catch (err: any) {
      console.error('Viewer load failed:', err);
      setConnectError(err?.message || 'Unable to connect to the live stream');
      setPhase('ERROR');
    }
  }, [token, connect, setupSocket]);

  useEffect(() => {
    void loadStream();
  }, [loadStream]);

  // Attach the host's remote video track(s) once the room is connected.
  useEffect(() => {
    if (!room || phase !== 'LIVE') return;
    const lkRoom = room as any;
    const collect = () => {
      const tracks: MediaStreamTrack[] = [];
      lkRoom.remoteParticipants?.forEach((p: any) => {
        p.videoTrackPublications?.forEach((pub: any) => {
          if (pub?.track?.mediaStreamTrack) tracks.push(pub.track.mediaStreamTrack);
        });
      });
      setRemoteVideo(tracks.length ? new MediaStream(tracks) : null);
    };
    const onSub = () => collect();
    lkRoom.on('trackSubscribed', onSub);
    lkRoom.on('trackUnsubscribed', onSub);
    lkRoom.on('participantDisconnected', onSub);
    collect();
    const timer = window.setInterval(collect, 500);
    window.setTimeout(() => window.clearInterval(timer), 8000);
    return () => {
      window.clearInterval(timer);
      lkRoom.off('trackSubscribed', onSub);
      lkRoom.off('trackUnsubscribed', onSub);
      lkRoom.off('participantDisconnected', onSub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, phase]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      if (socketRef.current) {
        try { socketRef.current.emit('leave_stream', streamIdRef.current); } catch { /* noop */ }
        try { socketRef.current.disconnect(); } catch { /* noop */ }
      }
      if (giftSocketRef.current) {
        try { giftSocketRef.current.emit('leave:stream', streamIdRef.current); } catch { /* noop */ }
        try { giftSocketRef.current.disconnect(); } catch { /* noop */ }
      }
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
const sendComment = useCallback(() => {
    const text = comment.trim();
    if (!text || sendingComment || !socketRef.current) return;
    setSendingComment(true);
    try {
      socketRef.current.emit('send_comment', { streamId: streamIdRef.current, comment: text });
      setComment('');
    } finally {
      setSendingComment(false);
    }
  }, [comment, sendingComment]);

  const toggleFollow = useCallback(async () => {
    if (!token || followBusy) return;
    setFollowBusy(true);
    try {
      const d = await apiPost<{ follow?: { following: boolean } }>(`/api/live/${streamIdRef.current}/follow`, {}, token);
      const next = !!d?.follow?.following;
      setFollowing(next);
      if (next) socketRef.current?.emit('live_follow', { streamId: streamIdRef.current });
      toast.success(next ? `Following ${stream?.host?.username || ''}`.trim() : 'Unfollowed');
    } catch (err: any) {
      toast.error('Could not update follow', err?.message || 'Please try again.');
    } finally {
      setFollowBusy(false);
    }
  }, [token, followBusy, stream?.host?.username, toast]);

  const openGift = useCallback(async () => {
    if (!token) return;
    setSheet('gift');
    if (giftGifts.length) return;
    setGiftLoading(true);
    setGiftLoadError(null);
    try {
      const [g, w] = await Promise.all([
        apiGet<any[]>('/api/monetization/gifts', token),
        apiGet<any>('/api/monetization/wallet', token),
      ]);
      setGiftGifts(normalizeGiftCatalog(g));
      const bal = Number(w?.coinBalance);
      setGiftBalance(Number.isFinite(bal) ? bal : 0);
    } catch (err: any) {
      setGiftLoadError(err?.message || 'Gifts could not be loaded.');
    } finally {
      setGiftLoading(false);
    }
  }, [token, giftGifts.length]);

  const closeGift = useCallback(() => setSheet('none'), []);

  const reportMessage = useCallback(async (msg: ChatMessage) => {
    if (!token || reportBusy) return;
    setReportBusy(true);
    setActionFor(null);
    try {
      const reason = `Reported message from ${msg.user?.username || 'a viewer'}: "${msg.message.slice(0, 80)}"`;
      await apiPost<any>(`/api/live/${streamIdRef.current}/report`, { reason, description: `Live chat message ${msg.id}` }, token);
      toast.success('Reported', 'Thanks — our team will review this message.');
    } catch (err: any) {
      toast.error('Could not report', err?.message || 'Please try again.');
    } finally {
      setReportBusy(false);
    }
  }, [token, reportBusy, toast]);

  const handleLeave = useCallback(() => {
    if (socketRef.current) {
      try { socketRef.current.emit('leave_stream', streamIdRef.current); } catch { /* noop */ }
      try { socketRef.current.disconnect(); } catch { /* noop */ }
    }
    if (giftSocketRef.current) {
      try { giftSocketRef.current.emit('leave:stream', streamIdRef.current); } catch { /* noop */ }
      try { giftSocketRef.current.disconnect(); } catch { /* noop */ }
      giftSocketRef.current = null;
    }
    disconnect();
    router.replace('/live');
  }, [disconnect, router]);

  const shareLive = useCallback(async () => {
    const url = `${window.location.origin}/live/${streamIdRef.current}`;
    const body = `Join ${stream?.host?.username || 'this'} live on VANTA!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'VANTA Live', text: body, url });
        socketRef.current?.emit('live_share', { streamId: streamIdRef.current });
      } catch { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', 'Share it with your friends.');
    } catch {
      toast.error('Could not share');
    }
  }, [stream?.host?.username, toast]);

  // Guest stage tiles for the multi-participant grid view.
  const stageTiles = useMemo(() => {
    const items: StageParticipant[] = [];
    (room as any)?.remoteParticipants?.forEach((p: any) => {
      const vids: MediaStreamTrack[] = [];
      (p.videoTrackPublications || new Set())?.forEach((pub: any) => {
        if (pub?.track?.mediaStreamTrack) vids.push(pub.track.mediaStreamTrack);
      });
      const isHost = p.identity === stream?.host?.id;
      const rosterGuest = guestRoster.find((g) => g.id === p.identity);
      items.push({
        id: p.identity,
        username: isHost ? (stream?.host?.username || 'Host') : (rosterGuest?.username || p.identity),
        avatar: isHost ? stream?.host?.avatar : rosterGuest?.avatar,
        verified: isHost ? !!stream?.host?.verified : false,
        isHost,
        stream: vids.length ? new MediaStream(vids) : null,
        cameraOn: vids.length > 0,
        micOn: (p.audioTrackPublications?.size || 0) > 0,
      });
    });
    if (guestStatus === 'live') {
      items.push({ id: (user as any)?.id || 'me', username: (user as any)?.username || 'You', avatar: undefined, verified: false, stream: myStream, cameraOn: true, micOn: true });
    }
    const hostIndex = items.findIndex((t) => t.isHost);
    if (hostIndex > 0) { const host = items[hostIndex]; items.splice(hostIndex, 1); items.unshift(host); }
    return items.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, stream, guestRoster, guestStatus, myStream]);

  const stageActive = guestStatus === 'live' || stageTiles.length > 1;

  if (!token) {
    return (
      <main className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#050505] px-6 text-center text-white">
        <AlertTriangle className="text-[#D6A83F]" size={26} />
        <h2 className="mt-3 text-base font-semibold text-white">Sign in to watch live</h2>
        <p className="mt-1 max-w-xs text-sm text-white/50">Create an account or sign in to join this live stream.</p>
        <button type="button" onClick={() => router.push('/login')} className="mt-5 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white">
          Sign in
        </button>
      </main>
    );
  }

  if (phase === 'LOADING') {
    return (
      <main className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[#050505] text-white">
        <Loader2 size={28} className="animate-spin text-[#F2C75C]" />
        <p className="text-sm text-white/50">Opening live stream…</p>
      </main>
    );
  }

  if (phase === 'ERROR') {
    return (
      <main className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#050505] px-6 text-center text-white">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-rose-500/15">
          <AlertTriangle size={26} className="text-rose-400" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">Unable to connect to the live stream</h2>
        <p className="mt-1 max-w-xs text-sm text-white/50">{connectError || 'The stream may have ended or connection was lost.'}</p>
        <div className="mt-6 flex items-center gap-3">
          <button type="button" onClick={() => void loadStream()} className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]">
            <RefreshCw size={15} /> Retry
          </button>
          <button type="button" onClick={() => router.replace('/live')} className="rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white">
            Back to Live
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'ENDED' || !stream) {
    return (
      <main className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#050505] px-6 text-center text-white">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
          <Check size={26} className="text-emerald-400" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">This live has ended</h2>
        <p className="mt-1 max-w-xs text-sm text-white/50">{stream?.title || 'The stream you were watching has ended.'}</p>
        <button type="button" onClick={() => router.replace('/live')} className="mt-6 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white">
          Return to Live
        </button>
      </main>
    );
  }

  const viewerCount = viewers || stream?.viewerCount || stream?._count?.viewers || 0;
  const isOwn = user?.id === stream.host.id;
  const isConnecting = connectionState === ConnectionState.Reconnecting;
  const started = stream?.startedAt ? new Date(stream.startedAt).getTime() : null;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'LIVE' || !started) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [phase, started]);
  const eSecs = elapsed % 60;
  const eMins = Math.floor(elapsed / 60) % 60;
  const eHrs = Math.floor(elapsed / 3600);
  const streamClock = `${eHrs > 0 ? `${eHrs}:` : ''}${String(eMins).padStart(2, '0')}:${String(eSecs).padStart(2, '0')}`;

  return (
    <main className="fixed inset-0 z-40 overflow-hidden bg-black text-white">
      {/* The live video is the primary interface — full screen. */}
      <div className="absolute inset-0">
        {stageActive ? (
          <LiveParticipantGrid participants={stageTiles} />
        ) : remoteVideo ? (
          <ViewerVideo stream={remoteVideo} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#050505]">
            <Loader2 size={26} className="animate-spin text-[#F2C75C]" />
          </div>
        )}
      </div>

      {/* Legibility gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/65" />

      {/* Floating join notice */}
      <AnimatePresence>
        {joinNotice && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top)+64px)] z-20 -translate-x-1/2 rounded-full border border-white/15 bg-black/55 px-3.5 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-md"
          >
            {joinNotice.joined ? <><span className="text-emerald-300">●</span> {joinNotice.username} joined</> : <><span className="text-white/40">○</span> {joinNotice.username} left</>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating reactions */}
      <div className="pointer-events-none absolute inset-0 z-[70]">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.span
              key={r.id}
              initial={{ opacity: 0, y: 0, scale: 0.5 }}
              animate={{ opacity: [0, 1, 1, 0], y: -170, scale: [0.5, 1.2, 1.4, 1.2] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.2, times: [0, 0.15, 0.7, 1] }}
              className="absolute bottom-[36%] left-1/2 -ml-3 text-3xl drop-shadow-lg"
              aria-hidden
            >
              {r.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {/* Gift animations from any viewer */}
      <GiftAnimationOverlay events={giftAnimations} />

      {/* Top-left: streamer card + Fan Club */}
      <div className="absolute left-3 top-[calc(env(safe-area-inset-top)+8px)] z-20 flex items-center gap-2">
        <button type="button" onClick={() => router.push(`/profile/${stream.host.username}`)} aria-label="Host profile" className="shrink-0">
          <Avatar src={stream.host.avatar} alt={stream.host.username} size="md" wrapperClassName="ring-2 ring-white/20" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="max-w-[120px] truncate text-sm font-bold text-white drop-shadow">{stream.host.username}</p>
            {stream.host.verified && <VerificationBadge size="xs" />}
{/* Top-right: viewer count + exit */}
      <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+8px)] z-20 flex items-center gap-2">
        {isConnecting && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-300 backdrop-blur-md">
            <Loader2 size={11} className="animate-spin" /> Syncing
          </span>
        )}
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3 text-xs font-bold text-white backdrop-blur-md tabular-nums">
          <Eye size={13} className="text-[#F2C75C]" /> {formatNumber(viewerCount)}
        </span>
        <button type="button" onClick={handleLeave} aria-label="Leave live" className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-md transition active:scale-95 hover:bg-black/70">
          <X size={17} strokeWidth={2.6} />
        </button>
      </div>

      {/* Pinned message (compact overlay above chat) */}
      <AnimatePresence>
        {pinnedMessage && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute bottom-[104px] left-3 z-20 mr-20 max-w-[70%] rounded-xl border border-[#D6A83F]/25 bg-black/55 px-3 py-1.5 backdrop-blur-md"
          >
            <span className="flex items-start gap-1.5 text-[11px] leading-snug">
              <Pin size={11} className="mt-0.5 shrink-0 text-[#D6A83F]" />
              <span><b className="text-[#F2C75C]">{pinnedMessage.username || 'host'}</b> <span className="text-white/90">{pinnedMessage.message}</span></span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-left: live comment overlay */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 mr-16">
        {messages.slice(-4).map((m) =>
          m.kind === 'system' ? (
            <p key={m.id} className="text-[11px] font-medium text-white/60 drop-shadow">{m.message}</p>
          ) : (
            <p key={m.id} className="truncate text-[12px] leading-snug text-white/95 drop-shadow-md">
              <span className="font-bold text-[#F2C75C]">{m.user?.username || 'Viewer'}: </span>
              <span className="text-white/90">{m.message}</span>
            </p>
          ),
        )}
      </div>

      {/* Bottom-right: circular control rail */}
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] right-3 z-20 flex flex-col items-center gap-3">
        <RailButton onPress={() => setSheet('chat')} label="Chat" badge={messages.filter((m) => m.kind !== 'system').length}>
          <MessageCircle size={20} />
        </RailButton>
        <RailButton onPress={() => void openGift()} label="Gift" active>
          <Gift size={20} />
        </RailButton>
        <RailButton onPress={() => void shareLive()} label="Share">
          <Share2 size={20} />
        </RailButton>
        <RailButton onPress={() => setSheet('more')} label="More">
          <Ellipsis size={20} />
        </RailButton>
      </div>

      {/* Bottom-center: quick reactions */}
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+20px)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/40 px-1.5 py-1 backdrop-blur-lg">
        {REACTIONS_LIST.slice(0, 4).map((emoji) => (
          <button key={emoji} type="button" onClick={() => sendReaction(emoji)} aria-label={`React ${emoji}`} className="grid h-8 w-8 place-items-center rounded-full text-base transition active:scale-125">
            {emoji}
          </button>
        ))}
      </div>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#D6A83F]/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-black">
              <Radio size={8} fill="currentColor" /> LIVE
            </span>
            <span className="text-[10px] font-semibold text-white/85 tabular-nums">{streamClock || '0:00'}</span>
          </div>
          <button
            type="button"
            onClick={() => void toggleFollow()}
            disabled={followBusy}
            className="mt-1 inline-flex h-6 items-center gap-1 rounded-full bg-gradient-to-r from-[#D6A83F] to-[#F2C75C] px-2.5 text-[10px] font-extrabold text-black shadow transition active:scale-95 disabled:opacity-60"
          >
            <Crown size={11} fill="currentColor" />
            {following ? 'Fan Club ✓' : 'Join Fan Club'}
          </button>
        </div>
      </div>
{/* Viewers sheet */}
      <AnimatePresence>
        {sheet === 'viewers' && (
          <div className="absolute inset-0 z-[80] flex items-end" onClick={() => setSheet('none')}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60" />
            <motion.div
              initial={{ y: 40, opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[55vh] w-full rounded-t-3xl border-t border-white/10 bg-[#101013]/95 pb-[calc(env(safe-area-inset-bottom)+12px)] text-white backdrop-blur-2xl"
            >
              <div className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex items-center justify-between px-4 py-2">
                <h2 className="text-sm font-bold">Viewers <span className="text-white/40">({formatNumber(viewerCount)})</span></h2>
                <button type="button" onClick={() => setSheet('none')} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-white/60"><X size={15} /></button>
              </div>
              <div className="max-h-[42vh] overflow-y-auto px-2 pb-2">
                {viewersList.length === 0 ? (
                  <p className="py-10 text-center text-sm text-white/40">No viewers yet.</p>
                ) : (
                  viewersList.map((v) => (
                    <div key={`${v.id}-${v.username}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
                      <Avatar src={v.avatar} alt={v.username} size="sm" />
                      <span className="truncate text-sm text-white/90">{v.username}</span>
                      {v.id === stream.host.id && <span className="ml-auto rounded-full bg-[#D6A83F]/15 px-2 py-0.5 text-[10px] font-semibold text-[#F2C75C]">Host</span>}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
{/* Chat sheet */}
      <AnimatePresence>
        {sheet === 'chat' && (
          <div className="absolute inset-0 z-[80] flex items-end" onClick={() => setSheet('none')}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
            <motion.div
              initial={{ y: 60, opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="relative flex h-[62vh] min-h-[320px] w-full flex-col rounded-t-3xl border-t border-white/10 bg-[#0d0d0f]/97 pb-[calc(env(safe-area-inset-bottom)+10px)] text-white backdrop-blur-2xl"
            >
              <div className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex items-center justify-between px-4 pb-2">
                <h2 className="text-sm font-bold">Live chat {chatPaused && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Paused</span>}</h2>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setSheet('viewers')} aria-label="Viewers" className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-white/70"><Users size={15} /></button>
                  <button type="button" onClick={() => setSheet('none')} aria-label="Close chat" className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-white/70"><X size={15} /></button>
                </div>
              </div>

              <AnimatePresence>
                {pinnedMessage && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="mx-3 mb-2 flex items-start gap-2 rounded-xl border border-[#D6A83F]/25 bg-black/55 px-3 py-2">
                    <Pin size={13} className="mt-0.5 shrink-0 text-[#D6A83F]" />
                    <div className="min-w-0 flex-1 text-[11px] leading-snug">
                      <span className="font-semibold text-[#F2C75C]">{pinnedMessage.username || 'host'}</span>
                      <span className="text-white/90"> {pinnedMessage.message}</span>
                    </div>
                    <button type="button" onClick={() => setPinnedMessage(null)} aria-label="Dismiss pinned message" className="shrink-0 text-white/50 hover:text-white"><X size={13} /></button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2 [scrollbar-width:none]">
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-xs text-white/40">No messages yet — say something!</p>
                ) : (
                  messages.map((m) =>
                    m.kind === 'system' ? (
                      <div key={m.id} className="my-1 flex justify-center">
                        <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[10.5px] text-white/55">{m.message}</span>
                      </div>
                    ) : (
                      <div key={m.id} className="group mb-1.5 flex items-start gap-2 text-[12px] leading-snug">
                        <Avatar src={m.user?.avatar} alt={m.user?.username || 'u'} size="xs" />
                        <div className="min-w-0 flex-1">
                          <span className="inline-flex items-center gap-1 font-semibold text-[#D6A83F]">
                            {m.user?.username || 'user'}
                            {m.user?.id === stream.host.id && <span className="rounded bg-[#D6A83F]/20 px-1 text-[8px] font-bold uppercase tracking-wide text-[#F2C75C]">Streamer</span>}
                            {m.user?.verified && <VerificationBadge size="xs" />}
                          </span>
                          <span className="ml-1 break-words text-white/90">{m.message}</span>
                        </div>
                        <button type="button" onClick={() => setActionFor(m)} aria-label={`Report message from ${m.user?.username || 'user'}`} className="shrink-0 rounded p-0.5 text-white/0 transition hover:bg-white/10 hover:text-white/80 group-hover:text-white/45">
                          <Flag size={11} />
                        </button>
                      </div>
                    ),
                  )
                )}
              </div>

              <div className="mt-2 flex items-center gap-2 px-3">
                <button type="button" onClick={() => sendReaction('❤️')} aria-label="Send heart" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/55 text-lg backdrop-blur-md transition active:scale-110">❤️</button>
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendComment(); }}
                  disabled={chatPaused}
                  placeholder={chatPaused ? 'Chat is paused' : 'Say something…'}
                  autoFocus
                  aria-label="Comment"
                  className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#D6A83F]/50"
                />
                <button type="button" onClick={sendComment} disabled={!comment.trim() || chatPaused} aria-label="Send comment" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#D6A83F] text-black transition active:scale-95 disabled:opacity-40">
                  <Send size={16} />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
{/* Report message dialog */}
      <AnimatePresence>
        {actionFor && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => setActionFor(null)}>
            <motion.div
              className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#161618] p-4"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-white">Report this message?</p>
              <p className="mt-1 line-clamp-2 text-xs text-white/55">“{actionFor.message}”</p>
              <div className="mt-4 flex items-center gap-2">
                <button type="button" onClick={() => setActionFor(null)} className="h-10 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.04] text-sm font-medium text-white transition hover:bg-white/[0.08]">
                  Cancel
                </button>
                <button type="button" onClick={() => void reportMessage(actionFor)} disabled={reportBusy} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-500/90 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50">
                  {reportBusy ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
                  Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* More sheet */}
      <AnimatePresence>
        {sheet === 'more' && (
          <div className="absolute inset-0 z-[80] flex items-end" onClick={() => setSheet('none')}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
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
                <h2 className="text-sm font-bold">More options</h2>
                <button type="button" onClick={() => setSheet('none')} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-white/70"><X size={15} /></button>
              </div>
              <div className="mt-3 space-y-1.5">
                {!isOwn && (
                  <button type="button" onClick={() => void toggleFollow()} disabled={followBusy} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99]">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[#D6A83F]/15 text-[#F2C75C]"><Crown size={16} /></span>
                    <span className="flex-1 text-left">
                      <span className="block text-sm font-semibold">{following ? 'Leave Fan Club' : 'Join Fan Club'}</span>
                      <span className="block text-[11px] text-white/50">Support {stream.host.username} with exclusive perks</span>
                    </span>
                  </button>
                )}
                {!isOwn && guestStatus === 'idle' && (
                  <button type="button" onClick={requestToJoin} disabled={guestCapacity.count >= guestCapacity.limit} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99] disabled:opacity-50">
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-[#D6A83F]/40 bg-[#D6A83F]/10 text-[#F2C75C]"><Mic size={16} /></span>
                    <span className="flex-1 text-left">
                      <span className="block text-sm font-semibold">Join the live stage</span>
                      <span className="block text-[11px] text-white/50">{guestCapacity.count >= guestCapacity.limit ? 'Guest stage is full' : 'Request to speak on camera with the host'}</span>
                    </span>
                  </button>
                )}
                {!isOwn && guestStatus === 'pending' && (
                  <button type="button" onClick={cancelJoin} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-500/15 text-amber-300"><Loader2 size={16} className="animate-spin" /></span>
                    <span className="flex-1 text-left text-sm font-semibold">Request sent — waiting for {stream.host.username}…</span>
                  </button>
                )}
                {!isOwn && guestStatus === 'live' && (
                  <button type="button" onClick={leaveStage} className="flex w-full items-center gap-3 rounded-2xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-500/15"><MicOff size={16} /></span>
                    <span className="flex-1 text-left text-sm font-semibold">Leave the stage</span>
                  </button>
                )}
<button type="button" onClick={() => setSheet('chat')} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99]">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70"><MessageCircle size={16} /></span>
                  <span className="flex-1 text-left text-sm font-semibold">Open full chat</span>
                </button>
                <button type="button" onClick={() => setSheet('viewers')} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99]">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70"><Users size={16} /></span>
                  <span className="flex-1 text-left text-sm font-semibold">Viewers ({formatNumber(viewerCount)})</span>
                </button>
                <button type="button" onClick={() => void shareLive()} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99]">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70"><Share2 size={16} /></span>
                  <span className="flex-1 text-left text-sm font-semibold">Share this live</span>
                </button>
                <button type="button" onClick={() => router.push(`/profile/${stream.host.username}`)} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm text-white/90 transition active:scale-[0.99]">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/70"><UserPlus size={16} /></span>
                  <span className="flex-1 text-left text-sm font-semibold">View {stream.host.username}’s profile</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Gift picker */}
      <AnimatePresence>
        {sheet === 'gift' && (
          <GiftPickerBoundary onClose={closeGift}>
            <GiftPicker
              gifts={giftGifts}
              balance={giftBalance}
              recipient={{ id: stream.host.id, username: stream.host.username, avatar: stream.host.avatar || undefined }}
              token={token}
              streamId={streamId}
              loading={giftLoading}
              loadError={giftLoadError || undefined}
              onRetry={() => void openGift()}
              onClose={closeGift}
              onSent={(sentBalance, sentAmount) => {
                setGiftBalance(sentBalance);
                closeGift();
                toast.success('Gift sent!', `${stream.host.username} loved your gift (+${sentAmount} coins).`);
              }}
            />
          </GiftPickerBoundary>
        )}
      </AnimatePresence>
    </main>
  );
}

/* -------------------------------------------------------------------------
 * Small presentational helpers
 * ------------------------------------------------------------------------- */
function RailButton({ onPress, label, badge, active, children }: { onPress: () => void; label: string; badge?: number; active?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onPress}
        aria-label={label}
        className={cn(
          'relative grid h-12 w-12 place-items-center rounded-full border shadow-lg backdrop-blur-md transition active:scale-95',
          active ? 'border-[#D6A83F]/60 bg-[#D6A83F]/25 text-white' : 'border-white/15 bg-black/45 text-white/90 hover:bg-black/60',
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