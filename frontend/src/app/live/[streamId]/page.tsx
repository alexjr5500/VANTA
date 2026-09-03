'use client';

/**
 * VANTA Live Viewer
 * -----------------
 * Opens an active live stream. Real video is pulled from the LiveKit room the
 * host is publishing to (via a scoped viewer token). Live comments, viewer
 * counts and stream-lifecycle events arrive over the existing live socket.
 * Gifts reuse the VANTA GiftPicker + coin economy; Following reuses the
 * existing live follow endpoint. On leaving, the socket and LiveKit room are
 * torn down so no media connection is left active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Eye,
  Gift,
  Loader2,
  Mic,
  Radio,
  RefreshCw,
  Send,
  Share2,
  UserPlus,
  Heart,
  MessageSquare,
  Pin,
  Trash2,
  Flag,
  Ban,
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

type ViewerPhase = 'LOADING' | 'LIVE' | 'ENDED' | 'ERROR';

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

/** Turn a real-time `live_event` payload into a lightweight system-chat line. */
function viewerEventLine(d: any): string | null {
  const u = d?.user;
  const name = u?.username ? `@${u.username}` : 'Someone';
  switch (d?.type) {
    case 'joined': return `${name} joined the live`;
    case 'left': return `${name} left the live`;
    // A LIKE is an ephemeral interaction rendered by the floating-heart overlay,
    // NOT a chat message. Backend no longer emits `live_event` for likes, but
    // keep this guard so a stale event can never become a chat line.
    case 'liked': return '';
    case 'shared': return `${name} shared the live`;
    case 'followed': return `${name} started following`;
    case 'gift': return `${name} sent ${d.giftName || 'a gift'}${d.quantity && d.quantity > 1 ? ` × ${d.quantity}` : ''}`;
    case 'guest_request': return `${name} wants to join`;
    case 'guest_joined': return `${name} joined the stage`;
    case 'guest_left': return `${name} left the stage`;
    case 'guest_removed': return `${name} was removed from the stage`;
    case 'guest_rejected': return `${name}'s request was declined`;
    default: return '';
  }
}

interface GiftRecipient {
  id: string;
  username: string;
  fullName?: string;
  avatar?: string;
}

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

  const [giftOpen, setGiftOpen] = useState(false);
  const [giftGifts, setGiftGifts] = useState<GiftCatalogItem[]>([]);
  const [giftBalance, setGiftBalance] = useState(0);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftLoadError, setGiftLoadError] = useState<string | null>(null);

  const { giftAnimations, enqueueGiftAnimation } = useGiftAnimationQueue();
  const giftSocketRef = useRef<Socket | null>(null);

  // Guest request → stage overlay state.
  const [guestStatus, setGuestStatus] = useState<'idle' | 'pending' | 'live' | 'denied'>('idle');
  const [guestRoster, setGuestRoster] = useState<{ id: string; username: string; avatar?: string | null }[]>([]);
  const [guestCapacity, setGuestCapacity] = useState({ count: 0, limit: 4 });

  // Reactions (floating burst) + viewer roster + join notifications + pin.
  const [reactions, setReactions] = useState<{ id: string; emoji: string }[]>([]);
  const [viewersList, setViewersList] = useState<{ id: string; username: string; avatar?: string | null }[]>([]);
  const [viewerPanelOpen, setViewerPanelOpen] = useState(false);
  const [joinNotice, setJoinNotice] = useState<{ id: string; username: string; joined: boolean } | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; username: string | null; message: string } | null>(null);
  const [actionFor, setActionFor] = useState<ChatMessage | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const streamIdRef = useRef(streamId);
  useEffect(() => { streamIdRef.current = streamId; }, [streamId]);

  const recipient = useMemo<GiftRecipient | null>(
    () => (stream?.host ? { id: stream.host.id, username: stream.host.username, fullName: stream.host.fullName || undefined, avatar: stream.host.avatar || undefined } : null),
    [stream],
  );

  const isOwn = Boolean(stream && user && stream.host.id === (user as any)?.id);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev.slice(-59), msg]);
  }, []);

  /** Push a floating reaction and auto-remove it after its animation. */
  const burstReaction = useCallback((emoji: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((prev) => [...prev.slice(-14), { id, emoji }]);
    window.setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2400);
  }, []);

  const emitReaction = useCallback((emoji: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('reaction', { streamId: streamIdRef.current, emoji });
    burstReaction(emoji);
  }, [burstReaction]);

  /** Show a transient "X joined / left" notice. */
  const noticeJoin = useCallback((username: string, joined: boolean) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setJoinNotice({ id, username, joined });
    window.setTimeout(() => setJoinNotice((cur) => (cur?.id === id ? null : cur)), 2200);
  }, []);

  // Auto-fade the pinned message when the host unpins.
  useEffect(() => {
    if (pinnedMessage) {
      const t = window.setTimeout(() => setPinnedMessage(null), 15000);
      return () => window.clearTimeout(t);
    }
  }, [pinnedMessage]);

  /** Open the native share sheet or copy the live link. Also emits a real-time share event. */
  const shareStream = useCallback(async () => {
    const url = stream?.id ? `${window.location.origin}/live/${stream.id}` : window.location.href;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: stream?.title ? `Watch ${stream.title} live on VANTA` : 'VANTA Live', url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied', 'Paste it anywhere to share this live.');
      }
      socketRef.current?.emit('live_share', { streamId: streamIdRef.current });
    } catch {
      /* user dismissed the share sheet */
      socketRef.current?.emit('live_share', { streamId: streamIdRef.current });
    }
  }, [stream, toast]);

  const reconnecting = connectionState === ConnectionState.Reconnecting;

  // Build the live-stage tiles (host + guests). For a solo spectator we keep the
  // full-screen host video; when the viewer is a guest (or guests are present) we
  // show the adaptive participant grid.
  const myStream = useMemo<MediaStream | null>(() => {
    if (!room) return null;
    const vids: MediaStreamTrack[] = [];
    (room as any).localParticipant?.videoTrackPublications?.forEach((pub: any) => { if (pub?.track?.mediaStreamTrack) vids.push(pub.track.mediaStreamTrack); });
    return vids.length ? new MediaStream(vids) : null;
  }, [room]);

  const stageTiles = useMemo<StageParticipant[]>(() => {
    if (phase !== 'LIVE') return [];
    const tiles: StageParticipant[] = [];
    (room as any)?.remoteParticipants?.forEach((p: any) => {
      const vids: MediaStreamTrack[] = [];
      (p.videoTrackPublications || new Set())?.forEach((pub: any) => { if (pub?.track?.mediaStreamTrack) vids.push(pub.track.mediaStreamTrack); });
      const isHost = p.identity === stream?.host?.id;
      const rosterGuest = guestRoster.find((g) => g.id === p.identity);
      tiles.push({
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
      tiles.push({ id: (user as any)?.id || 'me', username: (user as any)?.username || 'You', avatar: undefined, verified: false, stream: myStream, cameraOn: true, micOn: true });
    }
    // Ensure the host is always the first (prioritized) tile.
    const hostIndex = tiles.findIndex((t) => t.isHost);
    if (hostIndex > 0) { const [host] = tiles.splice(hostIndex, 1); tiles.unshift(host); }
    return tiles.slice(0, 5);
  }, [phase, room, stream, guestRoster, guestStatus, user, myStream]);

  const stageActive = guestStatus === 'live' || stageTiles.filter((t) => t.isHost).length > 0 && stageTiles.length > 1;

  const handleStreamEnded = useCallback(() => {
    if (streamIdRef.current && socketRef.current) {
      socketRef.current.emit('leave_stream', streamIdRef.current);
    }
    disconnect();
    setPhase('ENDED');
  }, [disconnect]);

  // ---- Guest stage (viewer request → accept → publish as guest) ----
  const guestStatusRef = useRef(guestStatus);
  useEffect(() => { guestStatusRef.current = guestStatus; }, [guestStatus]);

  const requestToJoin = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('request_join', { streamId: streamIdRef.current });
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

  const loadStreamRef = useRef<() => Promise<void>>(async () => undefined);

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
      socket.on('connect', () => {
        socket.emit('join_stream', rid);
      });
      socket.on('new_comment', (d: any) => {
        if (d?.streamId !== rid || !d?.message) return;
        appendMessage(d.message);
      });
      // Gifts sent via the REST economy path publish `gift_received` on this main
      // socket room — trigger the cinematic overlay here (queue de-dupes by id).
      socket.on('gift_received', (payload: any) => {
        if (payload?.streamId !== rid) return;
        const tx = payload?.transaction || payload;
        enqueueGiftAnimation({ ...tx, senderId: tx?.senderId || payload?.senderId, senderName: tx?.senderName || payload?.senderName, giftId: tx?.giftId || payload?.giftId, giftName: tx?.giftName || payload?.giftName, amount: payload?.amount ?? tx?.amount, quantity: tx?.quantity || payload?.quantity || 1, thumbnailUrl: tx?.thumbnailUrl, animationUrl: tx?.animationUrl, animationType: tx?.animationType, glowColor: tx?.glowColor, particleColor: tx?.particleColor, animationDuration: tx?.animationDuration, isLegendary: tx?.isLegendary, tier: tx?.tier, rarity: tx?.rarity, impactLevel: tx?.impactLevel, artworkType: tx?.artworkType, id: tx?.id });
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
      // Real-time typed system activity (joined/liked/shared/followed/gift/guest).
      socket.on('live_event', (d: any) => {
        if (d?.streamId !== rid) return;
        const line = viewerEventLine(d);
        if (!line) return;
        appendMessage({ id: `ev-${d.at}-${d.type}-${Math.random().toString(36).slice(2, 6)}`, message: line, kind: 'system', meta: { type: d.type }, createdAt: d.at });
      });
      // Guest request round-trip.
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
        setGuestRoster(Array.isArray(d.guests) ? d.guests.map((g: unknown) => ({ id: (g as any).id, username: (g as any).username, avatar: (g as any).avatar })) : []);
        setGuestCapacity({ count: Number(d.guestCount) || 0, limit: Number(d.guestLimit) || 4 });
      });
      // Host accepted my request — I become a publishing guest on the stage.
      socket.on('guest_accepted', (d: any) => {
        if (d?.streamId !== rid || !d?.token || !d?.roomName) return;
        void joinStageRef.current(d.token, d.roomName);
      });
      // Host removed me (or my session ended) — leave the stage.
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
        if (d?.userId && d?.username) setViewersList((prev) => (prev.some((v) => v.id === d.userId) ? prev : [...prev, { id: d.userId, username: d.username, avatar: d.avatar }]).slice(-250));
      });
      socket.on('viewer_left', (d: any) => {
        if (d?.streamId !== rid) return;
        if (Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
        if (d?.username && d?.userId !== (user as any)?.id) noticeJoin(d.username, false);
        if (d?.userId) setViewersList((prev) => prev.filter((v) => v.id !== d.userId));
      });
      socket.on('viewers_list', (d: any) => {
        if (d?.streamId === rid && Array.isArray(d?.viewers)) setViewersList(d.viewers.slice(-250));
      });
      socket.on('message_deleted', (d: any) => {
        if (d?.streamId === rid && d?.messageId) setMessages((prev) => prev.filter((m) => m.id !== d.messageId));
      });
      socket.on('chat_cleared', (d: any) => {
        if (d?.streamId === rid) {
          setMessages([]);
          setPinnedMessage(null);
          toast.info('Chat cleared', 'The host cleared this chat.');
        }
      });
      socket.on('message_pinned', (d: any) => {
        if (d?.streamId === rid && d?.pinned) setPinnedMessage({ id: d.pinned.id, username: d.pinned.username, message: d.pinned.message });
      });
      socket.on('message_unpinned', (d: any) => {
        if (d?.streamId === rid) setPinnedMessage(null);
      });
      socket.on('chat_error', (d: any) => {
        toast.error('Message not sent', d?.error || 'Unable to send your message.');
      });
      // Banned by the host — leave the room.
      socket.on('banned_from_stream', (d: any) => {
        if (d?.streamId === rid) {
          toast.error('Banned', 'You have been banned from this stream.');
          handleStreamEnded();
        }
      });
      socketRef.current = socket;

      // Gift events arrive on the /gifts socket namespace.
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
        cleanupRef.current = () => {
          try {
            giftSocket.emit('leave:stream', rid);
            giftSocket.disconnect();
          } catch { /* noop */ }
        };
      } catch (err) {
        console.error('Gift socket setup failed:', err);
      }
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
          setMessages((messagesRaw as any[]).map((m: any) => ({ id: m.id, message: m.message, user: m.user })).reverse().slice(-60));
        })
        .catch(() => undefined);

      apiGet<{ following: boolean }>(`/api/live/${streamIdRef.current}/following`, token, { skipCache: true })
        .then((d) => setFollowing(!!d?.following))
        .catch(() => undefined);

      // Seed the guest stage roster + capacity so the Join button reflects reality.
      apiGet<any>(`/api/live/${streamIdRef.current}/guests`, token, { skipCache: true })
        .then((d) => {
          if (!d) return;
          setGuestRoster(Array.isArray(d.guests) ? d.guests.map((g: unknown) => ({ id: (g as any).id, username: (g as any).username, avatar: (g as any).avatar })) : []);
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
    // Some tracks subscribe slightly after connect — poll briefly.
    const timer = window.setInterval(collect, 500);
    window.setTimeout(() => window.clearInterval(timer), 8000);
    return () => {
      window.clearInterval(timer);
      lkRoom.off('trackSubscribed', onSub);
      lkRoom.off('trackUnsubscribed', onSub);
      lkRoom.off('participantDisconnected', onSub);
    };
  }, [room, phase]);

  useEffect(() => {
    void loadStream();
  }, [loadStream]);

  // Cleanup on unmount: leave the socket room and disconnect from LiveKit.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      if (socketRef.current) {
        try {
          socketRef.current.emit('leave_stream', streamIdRef.current);
          socketRef.current.disconnect();
        } catch {
          /* noop */
        }
      }
      if (giftSocketRef.current) {
        try {
          giftSocketRef.current.emit('leave:stream', streamIdRef.current);
          giftSocketRef.current.disconnect();
        } catch {
          /* noop */
        }
      }
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendComment = useCallback(async () => {
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
    setGiftOpen(true);
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

  const closeGift = useCallback(() => setGiftOpen(false), []);

  /** Report a chat message (viewer moderation). */
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

  const REACTIONS = ['❤️', '🔥', '👏', '😂', '😍', '🎉'];

  const handleLeave = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.emit('leave_stream', streamIdRef.current);
        socketRef.current.disconnect();
      } catch {
        /* noop */
      }
    }
    if (giftSocketRef.current) {
      try {
        giftSocketRef.current.emit('leave:stream', streamIdRef.current);
        giftSocketRef.current.disconnect();
      } catch {
        /* noop */
      }
      giftSocketRef.current = null;
    }
    disconnect();
    router.replace('/live');
  }, [disconnect, router]);

  const viewerCount = viewers || stream?.viewerCount || stream?._count?.viewers || 0;

if (!token) {
    return (
      <main className="flex min-h-dvh flex-col bg-[#050505] text-white">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#080808]/90 px-4 pt-[env(safe-area-inset-top)]">
          <button type="button" onClick={handleLeave} aria-label="Back to Live" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white">
            <ArrowLeft size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-[#F5F5F5]">Live</h1>
          </div>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="text-[#D6A83F]" size={26} />
          <h2 className="mt-3 text-base font-semibold text-white">Sign in to watch live</h2>
          <p className="mt-1 max-w-xs text-sm text-white/50">Create an account or sign in to join this live stream.</p>
          <button type="button" onClick={() => router.push('/login')} className="mt-5 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white">
            Sign in
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'LOADING') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#050505] text-white">
        <Loader2 size={28} className="animate-spin text-[#F2C75C]" />
        <p className="text-sm text-white/50">Opening live stream…</p>
      </main>
    );
  }

  if (phase === 'ERROR') {
    return (
      <main className="flex min-h-dvh flex-col bg-[#050505] text-white">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#080808]/90 px-4 pt-[env(safe-area-inset-top)]">
          <button type="button" onClick={handleLeave} aria-label="Back to Live" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white">
            <ArrowLeft size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-[#F5F5F5]">Live</h1>
          </div>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
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
        </div>
      </main>
    );
  }

  if (phase === 'ENDED' || !stream) {
    return (
      <main className="flex min-h-dvh flex-col bg-[#050505] text-white">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#080808]/90 px-4 pt-[env(safe-area-inset-top)]">
          <button type="button" onClick={handleLeave} aria-label="Back to Live" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white">
            <ArrowLeft size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-[#F5F5F5]">Live</h1>
          </div>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
            <Check size={26} className="text-emerald-400" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">This live has ended</h2>
          <p className="mt-1 max-w-xs text-sm text-white/50">{stream?.title || 'The stream you were watching has ended.'}</p>
          <button type="button" onClick={() => router.replace('/live')} className="mt-6 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white">
            Return to Live
          </button>
        </div>
      </main>
    );
  }

return (
    <main className="relative flex min-h-dvh flex-col bg-black text-white">
      {/* Video */}
      <div className="absolute inset-0">
        {stageActive && stageTiles.length > 0 ? (
          <LiveParticipantGrid participants={stageTiles} />
        ) : remoteVideo ? (
          <ViewerVideo stream={remoteVideo} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#0D0D0F]">
            <Loader2 size={26} className="animate-spin text-[#F2C75C]" />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center gap-2 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={handleLeave}
          aria-label="Leave stream"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70"
        >
          <X size={19} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold tracking-[0.12em] shadow-lg',
              reconnecting ? 'bg-amber-500 text-black' : 'bg-red-600 text-white',
            )}
          >
            <motion.span
              className={cn('h-1.5 w-1.5 rounded-full', reconnecting ? 'bg-black' : 'bg-white')}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: reconnecting ? 0.7 : 1.5, repeat: Infinity }}
            />
            {reconnecting ? 'RECONNECTING' : 'LIVE'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/85 backdrop-blur-md">
            <Eye size={11} />
            <span className="tabular-nums">{formatNumber(viewerCount)}</span>
          </span>
        </div>
        <span className="shrink-0 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white/70 backdrop-blur-md">
          {stream.categoryName || 'General'}
        </span>
        <button
          type="button"
          onClick={() => void shareStream()}
          aria-label="Share live"
          className="shrink-0 rounded-md bg-black/55 p-1.5 text-white/80 backdrop-blur-md transition hover:bg-black/70 hover:text-white"
        >
          <Share2 size={14} />
        </button>
      </header>

      {/* Creator row + chat */}
      <div className="relative z-10 mt-auto flex min-h-0 flex-col p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center gap-2.5">
          <button type="button" onClick={() => router.push(`/profile/${stream.host.username}`)} className="flex shrink-0 flex-col items-center gap-1">
            <Avatar src={stream.host.avatar} alt={stream.host.username} size="lg" />
            <span className="flex min-w-0 max-w-[64px] items-center justify-center gap-0.5">
              <span className="truncate text-[9px] font-medium text-white/80">{stream.host.username}</span>
              {stream.host.verified && <VerificationBadge verified size="xs" />}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-[#F5F5F5]">{stream.title}</h1>
            <div className="flex items-center gap-1 text-[11px] text-white/60">
              <span className="truncate">@{stream.host.username}</span>
              {stream.host.fullName && <span className="truncate text-white/35">· {stream.host.fullName}</span>}
            </div>
            {stream.description && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/50">{stream.description}</p>
            )}
          </div>
          {!isOwn && (
            <button
              type="button"
              onClick={() => void toggleFollow()}
              disabled={followBusy}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-bold transition',
                following ? 'border border-white/[0.14] bg-white/[0.08] text-white' : 'bg-[#D6A83F] text-black hover:bg-[#F2C75C]',
              )}
            >
              {followBusy ? <Loader2 size={14} className="animate-spin" /> : following ? <Check size={14} /> : <UserPlus size={14} />}
              {following ? 'Following' : 'Follow'}
            </button>
          )}
          {isOwn && (
            <button
              type="button"
              onClick={() => router.push('/live/studio')}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#D6A83F]/40 bg-[#D6A83F]/10 px-4 text-xs font-semibold text-[#F2C75C] transition hover:bg-[#D6A83F]/20"
            >
              Studio
            </button>
          )}
          {!isOwn && guestStatus === 'idle' && (
            <button
              type="button"
              onClick={() => void requestToJoin()}
              disabled={guestCapacity.count >= guestCapacity.limit}
              title={guestCapacity.count >= guestCapacity.limit ? 'Guest stage is full' : 'Request to join the live stage'}
              aria-label="Request to join"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#D6A83F]/40 bg-[#D6A83F]/10 px-4 text-xs font-semibold text-[#F2C75C] transition hover:bg-[#D6A83F]/20 disabled:opacity-40"
            >
              <Mic size={13} /> Join
            </button>
          )}
          {guestStatus === 'pending' && (
            <button
              type="button"
              onClick={() => void cancelJoin()}
              aria-label="Cancel request to join"
              title="Cancel request to join"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-xs font-semibold text-white/80 transition hover:bg-white/[0.1]"
            >
              <Loader2 size={13} className="animate-spin" /> Requested
            </button>
          )}
          {guestStatus === 'live' && (
            <button
              type="button"
              onClick={() => void leaveStage()}
              aria-label="Leave stage"
              title="Leave the guest stage"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/15 px-4 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/25"
            >
              <Radio size={13} /> Leave stage
            </button>
          )}
        </div>

        {/* Pinned message */}
        <AnimatePresence>
          {pinnedMessage && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mb-2 flex items-start gap-2 rounded-xl border border-[#D6A83F]/25 bg-black/55 px-3 py-2 backdrop-blur-md"
            >
              <Pin size={13} className="mt-0.5 shrink-0 text-[#D6A83F]" />
              <div className="min-w-0 flex-1 text-[11px] leading-snug">
                <span className="font-semibold text-[#F2C75C]">{pinnedMessage.username || 'host'}</span>
                <span className="text-white/90"> {pinnedMessage.message}</span>
              </div>
              <button type="button" onClick={() => setPinnedMessage(null)} aria-label="Dismiss pinned message" className="shrink-0 text-white/50 hover:text-white">
                <X size={13} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat messages */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-black/30 px-3 py-2 backdrop-blur-sm [scrollbar-width:none]">
          {messages.length === 0 ? (
            <p className="py-3 text-center text-xs text-white/40">No messages yet — say something!</p>
          ) : (
            messages.map((m) =>
              m.kind === 'system' ? (
                <div key={m.id} className="my-1 flex justify-center">
                  <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[10.5px] text-white/55">
                    {m.message}
                  </span>
                </div>
              ) : (
                <div key={m.id} className="group mb-1.5 flex items-start gap-1.5 text-[12px] leading-snug">
                  <span className="shrink-0 font-semibold text-[#D6A83F]">{m.user?.username || 'user'}:</span>
                  <span className="min-w-0 break-words text-white/90">{m.message}</span>
                  <button
                    type="button"
                    onClick={() => setActionFor(m)}
                    aria-label={`Report message from ${m.user?.username || 'user'}`}
                    className="ml-auto shrink-0 rounded p-0.5 text-white/0 transition hover:bg-white/10 hover:text-white/80 group-hover:text-white/45"
                  >
                    <Flag size={11} />
                  </button>
                </div>
              ),
            )
          )}
        </div>

        {/* Input row */}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewerPanelOpen((v) => !v)}
            aria-label="Viewers"
            className="grid h-11 w-11 shrink-0 place-items-center gap-0.5 rounded-full bg-black/55 text-white/85 backdrop-blur-md transition hover:bg-black/70"
          >
            <Users size={18} />
            <span className="text-[9px] font-semibold tabular-nums">{formatNumber(viewerCount)}</span>
          </button>
          {/* Reaction quick-fire */}
          {REACTIONS.slice(0, 3).map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => emitReaction(emoji)}
              aria-label={`React ${emoji}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/55 text-lg backdrop-blur-md transition hover:bg-black/70 active:scale-90"
            >
              {emoji}
            </button>
          ))}
          {stream.allowGifts !== false && (
            <button
              type="button"
              onClick={() => void openGift()}
              aria-label="Send a gift"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/55 text-[#D6A83F] backdrop-blur-md transition hover:bg-black/70"
            >
              <Gift size={20} />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/[0.1] bg-black/55 px-4 py-1.5 backdrop-blur-md">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void sendComment(); }}
              placeholder="Say something…"
              maxLength={500}
              className="h-9 w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
            <button
              type="button"
              onClick={() => void sendComment()}
              disabled={sendingComment || !comment.trim()}
              aria-label="Send comment"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F5F5F5] text-black transition hover:bg-white disabled:opacity-40"
            >
              {sendingComment ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* Gift picker */}
      <AnimatePresence>
        {giftOpen && recipient && (
          <GiftPickerBoundary onClose={closeGift}>
            <GiftPicker
              gifts={giftGifts}
              balance={giftBalance}
              recipient={recipient}
              token={token}
              streamId={stream.id}
              loading={giftLoading}
              loadError={giftLoadError || undefined}
              onRetry={() => void openGift()}
              onClose={closeGift}
              onSent={(_b, _a) => undefined}
            />
          </GiftPickerBoundary>
        )}
      </AnimatePresence>

      {/* Gift animations from any viewer */}
      <GiftAnimationOverlay events={giftAnimations} />

      {/* Floating reactions */}
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-live="polite">
        {reactions.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, scale: 0.4, y: 0 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.25, 1.1, 1.3], y: [-0, -70, -130, -200] }}
            transition={{ duration: 2.3, ease: 'easeOut' }}
            className="absolute bottom-40 text-3xl"
            style={{ left: `${20 + Math.random() * 60}%` }}
          >
            {r.emoji}
          </motion.div>
        ))}
      </div>

      {/* Join / leave notice */}
      <AnimatePresence>
        {joinNotice && (
          <motion.div
            key={joinNotice.id}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="pointer-events-none fixed left-1/2 top-[4.5rem] z-[60] -translate-x-1/2 rounded-full border border-white/12 bg-black/70 px-3 py-1.5 text-[11px] text-white/90 backdrop-blur-md"
          >
            <span className="font-semibold text-[#F2C75C]">{joinNotice.username}</span>{' '}
            {joinNotice.joined ? 'joined the stream' : 'left the stream'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Viewer roster */}
      <AnimatePresence>
        {viewerPanelOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewerPanelOpen(false)}
          >
            <motion.div
              className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-[#0E0E10] sm:rounded-2xl"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Viewers <span className="text-white/40">({formatNumber(viewerCount)})</span></h2>
                <button type="button" onClick={() => setViewerPanelOpen(false)} aria-label="Close viewers" className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white">
                  <X size={17} />
                </button>
              </div>
              <div className="max-h-[52vh] overflow-y-auto p-2">
                {viewersList.length === 0 ? (
                  <p className="py-10 text-center text-sm text-white/40">No viewers yet.</p>
                ) : (
                  viewersList.map((v) => (
                    <div key={`${v.id}-${v.username}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
                      <Avatar src={v.avatar} alt={v.username} size="sm" />
                      <span className="truncate text-sm text-white/90">{v.username}</span>
                      {v.id === stream.host.id && (
                        <span className="ml-auto rounded-full bg-[#D6A83F]/15 px-2 py-0.5 text-[10px] font-semibold text-[#F2C75C]">Host</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Message action menu (viewer report) */}
      <AnimatePresence>
        {actionFor && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setActionFor(null)}>
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
                <button
                  type="button"
                  onClick={() => setActionFor(null)}
                  className="h-10 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.04] text-sm font-medium text-white transition hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void reportMessage(actionFor)}
                  disabled={reportBusy}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-500/90 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                >
                  {reportBusy ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
                  Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}