'use client';

/**
 * VANTA Live Studio
 * ------------------
 * The single creator capture + publish experience.
 *
 * Flow: PREPARING (permission + preview) -> CONNECTING (start stream, get host
 * token, publish to LiveKit) -> LIVE -> ENDING -> ENDED. Any failure becomes
 * ERROR with a recovery action. On unmount or end, the camera/microphone and
 * the LiveKit room are fully torn down so no tracks keep running.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Flag,
  Gavel,
  Gift,
  Heart,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Pin,
  Radio,
  RefreshCw,
  Save,
  Send,
  Share2,
  Shield,
  Trash2,
  MoreVertical,
  Users,
  UserPlus,
  UserX,
  VolumeX,
  X,
} from 'lucide-react';
import { ConnectionState } from 'livekit-client';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut } from '@/lib/apiClient';
import { createSocket, type Socket } from '@/lib/socketClient';
import { useMediaDevices } from '@/lib/hooks/useMediaDevices';
import { useLiveKit, getLiveKitToken } from '@/lib/hooks/useLiveKit';
import GiftAnimationOverlay from '@/components/gifts/GiftAnimationOverlay';
import { useGiftAnimationQueue } from '@/components/gifts/useGiftAnimationQueue';
import LiveParticipantGrid, { type StageParticipant } from '@/components/live/LiveParticipantGrid';
import Avatar from '@/components/ui/Avatar';
import { cn, formatNumber } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { useContentCreation } from '@/components/create/ContentCreationContext';

type Phase = 'PREPARING' | 'CONNECTING' | 'LIVE' | 'ENDING' | 'ENDED' | 'ERROR';

interface GuestUser {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

interface StreamDetail {
  id: string;
  title: string;
  liveKitRoom?: string | null;
  viewerCount: number;
  status: string;
  active: boolean;
}

interface StudioChatMessage {
  id: string;
  message: string;
  createdAt?: string;
  kind?: 'comment' | 'system';
  meta?: { icon?: string; type?: string };
  user?: { id: string; username: string; avatar?: string | null; verified?: boolean } | null;
}

const FALLBACK_CATEGORIES = [
  'Just Chatting', 'Music', 'Gaming', 'Education', 'Technology',
  'Lifestyle', 'Sports', 'Art', 'Cooking', 'Other',
];

const MAX_TITLE = 120;

/** Turn a real-time `live_event` payload into a lightweight system-chat line. */
function liveEventLine(d: any): string | null {
  const u = d?.user;
  const name = u?.username ? `@${u.username}` : 'Someone';
  switch (d?.type) {
    case 'joined': return `${name} joined the live`;
    case 'left': return `${name} left the live`;
    // A LIKE is an ephemeral interaction shown by the Reactions counter +
    // floating-heart overlay, NOT a chat message. Backend no longer emits
    // `live_event` for likes, but keep this guard so a stale event can never
    // become a chat line.
    case 'liked': return '';
    case 'shared': return `${name} shared the live`;
    case 'followed': return `${name} started following`;
    case 'gift': return `${name} sent ${d.giftName || 'a gift'}${d.quantity && d.quantity > 1 ? ` × ${d.quantity}` : ''}`;
    case 'guest_request': return `${name} wants to join your live`;
    case 'guest_joined': return `${name} joined the stage`;
    case 'guest_left': return `${name} left the stage`;
    case 'guest_rejected': return `${name}'s request was declined`;
    case 'guest_removed': return `${name} was removed from the stage`;
    case 'guest_cancelled': return `${name} withdrew their request`;
    default: return '';
  }
}

interface StudioVideoProps {
  stream: MediaStream | null;
  roomLocalVideo: MediaStream | null;
}

/** A single <video> element that attaches whichever live source is current. */
function StudioVideo({ stream, roomLocalVideo }: StudioVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomLocalVideoRef = useRef(roomLocalVideo);

  useEffect(() => {
    roomLocalVideoRef.current = roomLocalVideo;
  }, [roomLocalVideo]);

  const attach = useCallback((media: MediaStream | null) => {
    const video = videoRef.current;
    if (!video) return;
    if (!media) {
      video.pause();
      video.srcObject = null;
      return;
    }
    video.srcObject = media;
    video.play().catch(() => undefined);
  }, []);

  // Preview source (before publish).
  useEffect(() => {
    if (stream && !roomLocalVideo) attach(stream);
  }, [stream, roomLocalVideo, attach]);

  // Live source (published room track). LiveKit stops the preview stream on
  // publish, so we switch to the actual published local video track.
  useEffect(() => {
    if (!roomLocalVideo) return;
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      if (roomLocalVideoRef.current) {
        attach(roomLocalVideoRef.current);
        return;
      }
      window.setTimeout(attempt, 200);
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [roomLocalVideo, attach]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      className="h-full w-full object-cover"
      aria-label="Camera preview"
    />
  );
}

export default function StudioPage() {
  const router = useRouter();
  const toast = useToast();
  const { token } = useAuth();
  const { liveDraft, clearLiveDraft } = useContentCreation();

  const {
    stream,
    videoDevices,
    audioDevices,
    isVideoOn,
    isAudioOn,
    error: mediaError,
    permissionState,
    isLoading,
    startMedia,
    stopMedia,
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,
    getMediaState,
  } = useMediaDevices();

  const {
    room,
    localParticipant,
    connect,
    disconnect,
    toggleCamera,
    toggleMicrophone,
    isCameraOn,
    isMicrophoneOn,
    connectionState,
    error,
  } = useLiveKit();

  const [phase, setPhase] = useState<Phase>('PREPARING');
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Just Chatting');
  const [streamData, setStreamData] = useState<StreamDetail | null>(null);
  const [viewers, setViewers] = useState(0);
  const [duration, setDuration] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [roomLocalVideo, setRoomLocalVideo] = useState<MediaStream | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [audience, setAudience] = useState<'public' | 'followers' | 'private'>('public');
  const [peakViewers, setPeakViewers] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [summary, setSummary] = useState<{
    duration: number;
    peakViewers: number;
    totalViewers: number;
    newFollowers: number;
    messages: number;
    reactions: number;
    giftCount: number;
    estimatedEarnings: number;
  } | null>(null);

  // Live chat + moderation state.
  const [hostMessages, setHostMessages] = useState<StudioChatMessage[]>([]);
  const [hostComment, setHostComment] = useState('');
  const [sendingHostComment, setSendingHostComment] = useState(false);
  const [chatPaused, setChatPaused] = useState(false);
  const [slowMode, setSlowMode] = useState(false);
  const [slowModeInterval, setSlowModeInterval] = useState(3);
  const [modMuted, setModMuted] = useState<string[]>([]);
  const [modBanned, setModBanned] = useState<string[]>([]);
  const [chatPinned, setChatPinned] = useState<{ id: string; username: string | null; message: string } | null>(null);
  const [modOpen, setModOpen] = useState(false);
  const [chatConnState, setChatConnState] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [actionTarget, setActionTarget] = useState<{ type: 'message' | 'viewer'; id: string; username?: string } | null>(null);
  const [viewerRoster, setViewerRoster] = useState<{ id: string; username: string; avatar?: string | null }[]>([]);
  const [reactionCount, setReactionCount] = useState(0);
  const [liveGiftCount, setLiveGiftCount] = useState(0);
  const [liveFollowerDelta, setLiveFollowerDelta] = useState(0);
  const hostSocketRef = useRef<Socket | null>(null);
  const studioGiftSocketRef = useRef<Socket | null>(null);
  const { giftAnimations, enqueueGiftAnimation } = useGiftAnimationQueue();

  // Multi-guest stage + real-time system activity.
  const [guestStage, setGuestStage] = useState<{ guests: GuestUser[]; pending: GuestUser[]; guestCount: number; guestLimit: number } | null>(null);
  const [guestPanelOpen, setGuestPanelOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const mediaStateRef = useRef({ video: true, audio: true });
  const phaseRef = useRef<Phase>('PREPARING');
  const titleRef = useRef('');
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const thumbnailRef = useRef<string | null>(null);
  const hasChosenCategoryRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { streamRef.current = stream; }, [stream]);
  useEffect(() => { thumbnailRef.current = thumbnailUrl; }, [thumbnailUrl]);
  useEffect(() => { mediaStateRef.current = { video: isVideoOn, audio: isAudioOn }; }, [isVideoOn, isAudioOn]);

  // Prefill title/category/thumbnail that were chosen in the "+" Go Live modal.
  useEffect(() => {
    if (!liveDraft) return;
    if (liveDraft.title) {
      setTitle(liveDraft.title.slice(0, MAX_TITLE));
      titleRef.current = liveDraft.title.slice(0, MAX_TITLE);
    }
    if (liveDraft.category) {
      setCategory(liveDraft.category);
      hasChosenCategoryRef.current = true;
    }
    if (liveDraft.thumbnailUrl) setThumbnailUrl(liveDraft.thumbnailUrl);
    clearLiveDraft();
  }, [liveDraft, clearLiveDraft]);

  // Load real categories so stream start never fails on a bad FK.
  useEffect(() => {
    let mounted = true;
    apiGet<any[]>('/api/live/categories')
      .then((data) => {
        if (!mounted) return;
        const names = (Array.isArray(data) ? data : [])
          .map((c: any) => c?.name)
          .filter((n: unknown): n is string => typeof n === 'string' && !!n.trim());
        if (names.length) {
          setCategories(names);
          // Don't override a category the user picked in the "+" Go Live modal.
          if (!hasChosenCategoryRef.current) {
            setCategory(names.includes('Just Chatting') ? 'Just Chatting' : names[0]);
          }
        }
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  // Poll viewer count + duration while live.
  useEffect(() => {
    if (phase !== 'LIVE' || !streamData?.id) return;
    const startedAt = Date.now();
    const sid = streamData.id;
    const timer = window.setInterval(() => {
      setDuration(Math.floor((Date.now() - startedAt) / 1000));
      apiGet<any>(`/api/live/${sid}`, token || undefined, { skipCache: true })
        .then((d) => {
          const v = Number(d?.viewerCount);
          if (Number.isFinite(v)) {
            setViewers(v);
            setPeakViewers((p) => Math.max(p, v));
          }
        })
        .catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [phase, streamData?.id, token]);

  // Live chat + moderation + gifts (host control room).
  useEffect(() => {
    if (phase !== 'LIVE' || !streamData?.id || !token) return;
    const rid = streamData.id;
    setChatConnState('connecting');
    let alive = true;

    const sock = createSocket(token);
    sock.connect();
    sock.on('connect', () => {
      if (!alive) return;
      setChatConnState('connected');
      sock.emit('host_room', rid);
    });
    sock.on('disconnect', () => alive && setChatConnState('disconnected'));
    sock.on('reconnect', () => sock.emit('host_room', rid));

    sock.on('host_chat_history', (d: any) => {
      if (alive && d?.streamId === rid && Array.isArray(d?.messages)) setHostMessages((d.messages as StudioChatMessage[]).slice(-100));
    });
    sock.on('host_settings', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      const s = d.settings || {};
      setChatPaused(Boolean(s.chatPaused));
      setSlowMode(Boolean(s.slowMode));
      if (s.slowModeInterval) setSlowModeInterval(Number(s.slowModeInterval));
      setModMuted(Array.isArray(s.mutedUsers) ? s.mutedUsers : []);
      setModBanned(Array.isArray(s.bannedUsers) ? s.bannedUsers : []);
      if (d.pinned) setChatPinned({ id: d.pinned.id, username: d.pinned.username, message: d.pinned.message });
      else setChatPinned(null);
    });
    sock.on('new_comment', (d: any) => {
      if (alive && d?.streamId === rid && d?.message) {
        setHostMessages((prev) => [...prev.slice(-99), d.message as StudioChatMessage]);
      }
    });
    sock.on('viewer_count', (d: any) => {
      if (alive && d?.streamId === rid && Number.isFinite(Number(d?.viewers))) {
        setViewers(Number(d.viewers));
        setPeakViewers((p) => Math.max(p, Number(d.viewers)));
      }
    });
    sock.on('viewer_joined', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      if (Number.isFinite(Number(d?.viewers))) {
        setViewers(Number(d.viewers));
        setPeakViewers((p) => Math.max(p, Number(d.viewers)));
      }
      if (d?.userId && d?.username) setViewerRoster((prev) => (prev.some((v) => v.id === d.userId) ? prev : [...prev, { id: d.userId, username: d.username, avatar: d.avatar }]).slice(-250));
    });
    sock.on('viewer_left', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      if (Number.isFinite(Number(d?.viewers))) setViewers(Number(d.viewers));
      if (d?.userId) setViewerRoster((prev) => prev.filter((v) => v.id !== d.userId));
    });
    sock.on('reaction', (d: any) => {
      if (alive && d?.streamId === rid) setReactionCount((c) => c + 1);
    });
    sock.on('message_deleted', (d: any) => {
      if (alive && d?.streamId === rid && d?.messageId) setHostMessages((prev) => prev.filter((m) => m.id !== d.messageId));
    });
    sock.on('chat_cleared', (d: any) => {
      if (alive && d?.streamId === rid) {
        setHostMessages([]);
        setChatPinned(null);
      }
    });
    sock.on('message_pinned', (d: any) => {
      if (alive && d?.streamId === rid && d?.pinned) setChatPinned({ id: d.pinned.id, username: d.pinned.username, message: d.pinned.message });
    });
    sock.on('message_unpinned', (d: any) => {
      if (alive && d?.streamId === rid) setChatPinned(null);
    });
    sock.on('chat_paused', (d: any) => alive && d?.streamId === rid && setChatPaused(Boolean(d.paused)));
    sock.on('slow_mode', (d: any) => {
      if (alive && d?.streamId === rid) {
        setSlowMode(Boolean(d.enabled));
        if (d.interval) setSlowModeInterval(Number(d.interval));
      }
    });

    // Real-time typed system activity (joined / liked / shared / followed / gift / guest).
    sock.on('live_event', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      const line = liveEventLine(d);
      if (!line) return;
      setHostMessages((prev) => [...prev.slice(-99), { id: `ev-${d.at}-${d.type}-${Math.random().toString(36).slice(2, 6)}`, message: line, kind: 'system', meta: { type: d.type } }]);
    });

    // Host view of the guest stage + capacity.
    sock.on('guest_state', (d: any) => {
      if (!alive || d?.streamId !== rid) return;
      setGuestStage({
        guests: Array.isArray(d.guests) ? d.guests : [],
        pending: Array.isArray(d.pending) ? d.pending : [],
        guestCount: Number(d.guestCount) || 0,
        guestLimit: Number(d.guestLimit) || 4,
      });
    });

    // A viewer wants to join — notify host with Accept/Decline.
    sock.on('guest_request', (d: any) => {
      if (!alive || d?.streamId !== rid || !d?.user) return;
      setGuestStage((prev) => ({
        guests: prev?.guests || [],
        pending: prev?.pending ? (prev.pending.some((u) => u.id === d.user.id) ? prev.pending : [...prev.pending, d.user]) : [d.user],
        guestCount: prev?.guestCount || 0,
        guestLimit: prev?.guestLimit || 4,
      }));
      toast.info('Guest request', `@${d.user.username} wants to join your live`);
      setGuestPanelOpen(true);
    });

    hostSocketRef.current = sock;

    // Redundant gift event path on the main socket (social-events room emit). The
    // animation queue de-duplicates by transaction id, so this never double-plays.
    sock.on('gift_received', (payload: any) => {
      if (!alive) return;
      const tx = payload?.transaction || payload;
      if (payload?.streamId || payload?.receiverId) {
        setLiveGiftCount((c) => c + 1);
        enqueueGiftAnimation({ ...tx, senderId: tx?.senderId || payload?.senderId, senderName: tx?.senderName || payload?.senderName, giftId: tx?.giftId || payload?.giftId, giftName: tx?.giftName || payload?.giftName, amount: payload?.amount ?? tx?.amount, quantity: tx?.quantity || payload?.quantity || 1, thumbnailUrl: tx?.thumbnailUrl, animationUrl: tx?.animationUrl, animationType: tx?.animationType, glowColor: tx?.glowColor, particleColor: tx?.particleColor, animationDuration: tx?.animationDuration, isLegendary: tx?.isLegendary, tier: tx?.tier, rarity: tx?.rarity, impactLevel: tx?.impactLevel, artworkType: tx?.artworkType, id: tx?.id });
      }
    });

    // Gift events on the /gifts namespace.
    try {
      const gsock = createSocket(token, '/gifts');
      gsock.connect();
      gsock.on('connect', () => gsock.emit('join:stream', rid));
      gsock.on('gift:received', (payload: any) => {
        if (!alive) return;
        setLiveGiftCount((c) => c + 1);
        if (payload?.receiverId || payload?.streamId) {
          enqueueGiftAnimation({ ...payload, senderId: payload.senderId, senderName: payload.senderName, giftId: payload.giftId, giftName: payload.giftName, amount: payload.amount, quantity: payload.comboCount || 1 });
        }
      });
      studioGiftSocketRef.current = gsock;
    } catch (err) {
      console.error('Studio gift socket setup failed:', err);
    }

    return () => {
      alive = false;
      try {
        studioGiftSocketRef.current?.emit('leave:stream', rid);
        studioGiftSocketRef.current?.disconnect();
      } catch { /* noop */ }
      studioGiftSocketRef.current = null;
      sock.emit('leave_stream', rid);
      sock.disconnect();
      hostSocketRef.current = null;
    };
  }, [phase, streamData?.id, token, enqueueGiftAnimation]);

  // Also reset live counters when a new stream goes live.
  useEffect(() => {
    if (phase !== 'LIVE') return;
    setReactionCount(0);
    setLiveGiftCount(0);
    setLiveFollowerDelta(0);
    setHostMessages([]);
    setViewerRoster([]);
    setChatPinned(null);
    setModMuted([]);
    setModBanned([]);
    setChatPaused(false);
    setSlowMode(false);
  }, [phase, streamData?.id]);

  // Watch the published local video track and surface it as a MediaStream.
  useEffect(() => {
    if (phase !== 'LIVE' || !localParticipant) return;
    let cancelled = false;
    const pick = () => {
      if (cancelled) return;
      const pubs = localParticipant.videoTrackPublications;
      let found: MediaStream | null = null;
      pubs.forEach((pub) => {
        if (found || !pub.track || pub.track.kind !== 'video') return;
        const mt = pub.track.mediaStreamTrack;
        if (mt) found = new MediaStream([mt]);
      });
      if (found) {
        setRoomLocalVideo(found);
      } else {
        window.setTimeout(pick, 250);
      }
    };
    pick();
    const onSub = () => { if (!cancelled) pick(); };
    room?.on('trackSubscribed', onSub);
    return () => {
      cancelled = true;
      room?.off('trackSubscribed', onSub);
    };
  }, [phase, localParticipant, room]);

  // Force cleanup on unmount so no camera/mic keeps running in the background.
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      disconnect();
      stopMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginMedia = useCallback(async () => {
    setDeviceBusy(true);
    try {
      await startMedia();
    } catch {
      /* permissionState + error already updated by the hook */
    } finally {
      setDeviceBusy(false);
    }
  }, [startMedia]);

  const handleRetryMedia = useCallback(async () => {
    setDeviceBusy(true);
    stopMedia();
    try {
      await startMedia();
    } catch {
      /* noop */
    } finally {
      setDeviceBusy(false);
    }
  }, [startMedia, stopMedia]);

  const startLive = useCallback(async () => {
    if (!token) return;
    if (phaseRef.current !== 'PREPARING') return;
    if (!titleRef.current.trim()) {
      toast.error('Add a title', 'Give your live stream a title before going live.');
      return;
    }
    const state = getMediaState();
    if (!state.video && !state.audio) {
      toast.error('No media available', 'Enable your camera or microphone before going live.');
      return;
    }

    setPhase('CONNECTING');
    setSeeding(true);
    try {
      const { stream: created } = await apiPost<{ stream: StreamDetail }>(
        '/api/live/start',
        { title: titleRef.current.trim(), category, description: description.trim(), allowGifts: true, thumbnailUrl: thumbnailRef.current || undefined, tags: tagsText.trim() || undefined, audience },
        token,
      );
      setStreamData(created);
      if (!created?.id || !created?.liveKitRoom) {
        throw new Error('The live room could not be created.');
      }

      const hostToken = await getLiveKitToken(created.id, token, 'host');

      // LiveKit acquires the same camera/mic the preview used and stops the
      // preview tracks, so the on-screen source switches to the room track.
      await connect(hostToken, created.liveKitRoom, {
        camera: state.video,
        microphone: state.audio,
        cameraDeviceId: state.videoDeviceId || undefined,
        microphoneDeviceId: state.audioDeviceId || undefined,
        mediaStream: streamRef.current || undefined,
      });

      setPhase('LIVE');
      toast.success('You are live');
    } catch (err: any) {
      console.error('Start live failed:', err);
      setPhase('ERROR');
      toast.error('Unable to go live', err?.message || 'The stream could not be started.');
    } finally {
      setSeeding(false);
    }
  }, [token, category, description, tagsText, audience, getMediaState, connect, toast]);

  /** Load the post-live analytics summary for the ended screen. */
  const loadAnalytics = useCallback(async () => {
    if (!token || !streamData?.id) return;
    apiGet<any>(`/api/live/${streamData.id}/analytics`, token, { skipCache: true })
      .then((d) => {
        if (!d) return;
        setSummary({
          duration: Number(d.duration) || 0,
          peakViewers: Number(d.peakViewers) || 0,
          totalViewers: Number(d.totalViewers) || 0,
          newFollowers: Number(d.newFollowers) || 0,
          messages: Number(d.messages) || 0,
          reactions: Number(d.reactions) || 0,
          giftCount: Number(d.giftCount) || 0,
          estimatedEarnings: Number(d.estimatedEarnings) || 0,
        });
      })
      .catch(() => undefined);
  }, [token, streamData?.id]);

  const endLive = useCallback(async () => {
    if (!token || !streamData?.id) return;
    const current = phaseRef.current;
    if (current !== 'LIVE' && current !== 'CONNECTING') return;
    setPhase('ENDING');
    setConfirmEnd(false);
    try {
      // Broadcast the ended state to all viewers over the socket (the REST end
      // updates the DB + closes the room but does not push `stream_ended`).
      hostSocketRef.current?.emit('end_stream', { streamId: streamData.id });
      if (phaseRef.current === 'LIVE' || phaseRef.current === 'CONNECTING') {
        await apiPut<any>(`/api/live/${streamData.id}/end`, {}, token).catch(async () => {
          await apiPost<any>(`/api/live/${streamData.id}/end`, {}, token).catch(() => undefined);
        });
      }
    } catch {
      /* stream may already be marked ended — still tear down locally */
    }
    disconnect();
    stopMedia();
    setPhase('ENDED');
    loadAnalytics();
    toast.success('Live ended');
  }, [token, streamData?.id, disconnect, stopMedia, loadAnalytics, toast]);

  /** Persist updated stream info while live (PATCH). */
  const saveStreamInfo = useCallback(async () => {
    if (!token || !streamData?.id || saveBusy) return;
    setSaveBusy(true);
    try {
      await apiPut<any>(
        `/api/live/${streamData.id}`,
        {
          title: title.trim(),
          category,
          description: description.trim(),
          thumbnailUrl: thumbnailRef.current || undefined,
          tags: tagsText.trim() || undefined,
          audience,
        },
        token,
      );
      toast.success('Stream info updated');
    } catch (err: any) {
      toast.error('Could not update', err?.message || 'Please try again.');
    } finally {
      setSaveBusy(false);
    }
  }, [token, streamData?.id, saveBusy, title, category, description, tagsText, audience, toast]);

  /** Snapshot the current preview frame as a stream thumbnail. */
  const captureThumbnail = useCallback(() => {
    const video = document.querySelector<HTMLVideoElement>('video[aria-label="Camera preview"]');
    if (!video || !video.videoWidth) {
      toast.error('No preview available', 'Turn your camera on first.');
      return;
    }
    const canvas = document.createElement('canvas');
    const w = 1280;
    const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    try {
      setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.85));
      toast.success('Thumbnail captured');
    } catch {
      toast.error('Could not capture frame');
    }
  }, [toast]);

  /** Open the native share sheet or copy the live link. */
  const shareStream = useCallback(async () => {
    const url = streamData?.id ? `${window.location.origin}/live/${streamData.id}` : window.location.href;
    const text = streamData ? `Watch "${streamData.title}" live on VANTA` : 'Watch live on VANTA';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'VANTA Live', text, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied', 'Paste it anywhere to share your live.');
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }, [streamData, toast]);

  const handleLeave = useCallback(() => {
    disconnect();
    stopMedia();
    router.replace('/live');
  }, [disconnect, stopMedia, router]);

  const toggleCam = useCallback(async () => {
    if (phase === 'LIVE') {
      await toggleCamera();
    } else {
      await toggleVideo();
    }
  }, [phase, toggleCamera, toggleVideo]);

  const toggleMic = useCallback(async () => {
    if (phase === 'LIVE') {
      await toggleMicrophone();
    } else {
      await toggleAudio();
    }
  }, [phase, toggleMicrophone, toggleAudio]);

  const hostSocket = () => hostSocketRef.current;

  const sendHostComment = useCallback(async () => {
    const text = hostComment.trim();
    if (!text || !streamData?.id || !hostSocket()) return;
    setSendingHostComment(true);
    try {
      hostSocket()!.emit('send_comment', { streamId: streamData.id, comment: text });
      setHostComment('');
    } catch {
      /* noop */
    } finally {
      setSendingHostComment(false);
    }
  }, [hostComment, streamData?.id]);

  const modEmit = useCallback((event: string, payload: Record<string, unknown>) => {
    const sid = streamData?.id;
    if (!sid || !hostSocket()) return;
    hostSocket()!.emit(event, { streamId: sid, ...payload });
  }, [streamData?.id]);

  const deleteMessage = useCallback((msg: StudioChatMessage) => {
    modEmit('delete_message', { messageId: msg.id });
    setHostMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }, [modEmit]);

  const pinMessage = useCallback((msg: StudioChatMessage) => {
    modEmit('pin_message', { messageId: msg.id });
    setChatPinned({ id: msg.id, username: msg.user?.username || null, message: msg.message });
  }, [modEmit]);

  const unpinMessage = useCallback(() => {
    modEmit('unpin_message', {});
    setChatPinned(null);
  }, [modEmit]);

  const toggleChatPause = useCallback(() => {
    modEmit('toggle_chat_pause', {});
    setChatPaused((p) => !p);
  }, [modEmit]);

  const toggleSlowMode = useCallback((interval?: number) => {
    modEmit('toggle_slow_mode', interval ? { interval } : {});
    setSlowMode((s) => !s);
    if (interval) setSlowModeInterval(interval);
  }, [modEmit]);

  const clearChat = useCallback(() => {
    modEmit('clear_chat', {});
    setHostMessages([]);
    setChatPinned(null);
  }, [modEmit]);

  const muteViewer = useCallback((userId: string) => {
    modEmit('mute_viewer', { targetUserId: userId });
    setModMuted((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
  }, [modEmit]);

  const unmuteViewer = useCallback((userId: string) => {
    modEmit('unmute_viewer', { targetUserId: userId });
    setModMuted((prev) => prev.filter((id) => id !== userId));
  }, [modEmit]);

  const banViewer = useCallback((userId: string) => {
    modEmit('ban_viewer', { targetUserId: userId });
    setModBanned((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setViewerRoster((prev) => prev.filter((v) => v.id !== userId));
  }, [modEmit]);

  const unbanViewer = useCallback((userId: string) => {
    modEmit('unban_viewer', { targetUserId: userId });
    setModBanned((prev) => prev.filter((id) => id !== userId));
  }, [modEmit]);

  // ---- Multi-guest stage controls (host) ----
  const respondGuest = useCallback((viewerId: string, accept: boolean) => {
    const sid = streamData?.id;
    if (!sid || !hostSocket()) return;
    hostSocket()!.emit('guest_respond', { streamId: sid, viewerId, accept });
    if (!accept) setGuestStage((prev) => (prev ? { ...prev, pending: prev.pending.filter((g) => g.id !== viewerId) } : prev));
  }, [streamData?.id]);

  const removeGuest = useCallback((guestId: string) => {
    const sid = streamData?.id;
    if (!sid || !hostSocket()) return;
    hostSocket()!.emit('guest_remove', { streamId: sid, guestId });
    setGuestStage((prev) => (prev ? { ...prev, guests: prev.guests.filter((g) => g.id !== guestId) } : prev));
  }, [streamData?.id]);

  const endGuestSession = useCallback((guestId: string) => {
    const sid = streamData?.id;
    if (!sid || !hostSocket()) return;
    hostSocket()!.emit('guest_end_session', { streamId: sid, guestId });
    setGuestStage((prev) => (prev ? { ...prev, guests: prev.guests.filter((g) => g.id !== guestId) } : prev));
  }, [streamData?.id]);

  const fmtDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const camOn = phase === 'LIVE' ? isCameraOn : isVideoOn;
  const micOn = phase === 'LIVE' ? isMicrophoneOn : isAudioOn;

  // Build the on-stage participant tiles (host + approved guests). Host is always
  // first. Remote guests are matched to the approved roster by LiveKit identity.
  const stageParticipants = useMemo<StageParticipant[]>(() => {
    if (phase !== 'LIVE') return [];
    const items: StageParticipant[] = [{
      id: 'host',
      username: 'You',
      isHost: true,
      stream: roomLocalVideo,
      cameraOn: isCameraOn,
      micOn: isMicrophoneOn,
    }];
    if (!room || !guestStage) return items;
    const approved = guestStage.guests || [];
    const seen = new Set<string>();
    room.remoteParticipants.forEach((p: any) => {
      const guest = approved.find((g) => g.id === p.identity);
      if (!guest || seen.has(p.identity)) return;
      seen.add(p.identity);
      const vids: MediaStreamTrack[] = [];
      p.videoTrackPublications?.forEach((pub: any) => { if (pub?.track?.mediaStreamTrack) vids.push(pub.track.mediaStreamTrack); });
      const hasAudio = p.audioTrackPublications?.size > 0;
      items.push({
        id: p.identity,
        username: guest.username,
        avatar: guest.avatar,
        verified: guest.verified,
        stream: vids.length ? new MediaStream(vids) : null,
        cameraOn: vids.length > 0,
        micOn: hasAudio,
      });
    });
    return items.slice(0, 5);
  }, [phase, room, roomLocalVideo, isCameraOn, isMicrophoneOn, guestStage]);

  const liveConnState: 'connected' | 'connecting' | 'reconnecting' =
    phase === 'LIVE'
      ? connectionState === ConnectionState.Reconnecting
        ? 'reconnecting'
        : connectionState === ConnectionState.Connecting
          ? 'connecting'
          : 'connected'
      : phase === 'CONNECTING' || phase === 'ENDING'
        ? 'connecting'
        : 'connected';

  const needsPermission = permissionState === 'denied' || permissionState === 'unavailable';
  const hasPreview = Boolean(stream);

  return (
    <main className="flex min-h-dvh flex-col bg-[#050505] text-white">
      {/* Header */}
      <header className="relative z-20 flex min-h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#080808]/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <button
          type="button"
          onClick={handleLeave}
          aria-label="Close studio"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8a8a8a] transition hover:bg-white/[0.05] hover:text-white"
        >
          <X size={19} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8A8A8A]">Creator Studio</p>
          <h1 className="truncate text-lg font-semibold text-[#F5F5F5]">Go Live</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(phase === 'LIVE' || phase === 'CONNECTING' || phase === 'ENDING') && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]',
                liveConnState === 'reconnecting' ? 'bg-amber-500/15 text-amber-400' : 'bg-[#D6A83F]/15 text-[#F2C75C]',
              )}
            >
              <motion.span
                className={cn('h-1.5 w-1.5 rounded-full', liveConnState === 'reconnecting' ? 'bg-amber-400' : 'bg-[#F2C75C]')}
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: liveConnState === 'reconnecting' ? 0.7 : 1.4, repeat: Infinity }}
              />
              {liveConnState === 'reconnecting'
                ? 'Reconnecting'
                : phase === 'LIVE'
                  ? 'Live'
                  : phase === 'ENDING'
                    ? 'Ending'
                    : 'Starting'}
            </span>
          )}
          {phase === 'LIVE' && (
            <button
              type="button"
              onClick={() => void shareStream()}
              aria-label="Share live"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] font-medium text-white/70 transition hover:bg-white/[0.1] hover:text-white"
            >
              <Share2 size={12} />
              Share
            </button>
          )}
          {phase === 'LIVE' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/60">
              <Eye size={11} />
              <span className="tabular-nums">{formatNumber(viewers)}</span>
            </span>
          )}
        </div>
      </header>

      {(phase === 'LIVE' || phase === 'CONNECTING' || phase === 'ENDING') ? (
        <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col bg-black">
          <div className="relative mx-auto w-full max-w-6xl flex-1">
            <div className="absolute inset-0">
              <LiveParticipantGrid participants={stageParticipants} />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
            <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-white shadow-lg">
                  <motion.span
                    className="h-1.5 w-1.5 rounded-full bg-white"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  LIVE
                </span>
                <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                  {category}
                </span>
              </div>
              <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium tabular-nums text-white/80 backdrop-blur-sm">
                {fmtDuration(duration)}
              </span>
            </div>
            {phase === 'CONNECTING' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 text-center backdrop-blur-sm">
                <Loader2 size={30} className="animate-spin text-[#F2C75C]" />
                <p className="text-sm font-medium text-white">Connecting to your live stream…</p>
              </div>
            )}
          </div>
          <div className="mx-auto w-full max-w-[560px] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-[#F5F5F5]">{title}</span>
              <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-white/50">
                <span className="flex items-center gap-1">
                  <Eye size={12} />
                  <span className="tabular-nums">{formatNumber(viewers)}</span> watching
                </span>
                <span className="flex items-center gap-1">
                  <Users size={12} />
                  <span className="tabular-nums">{formatNumber(peakViewers)}</span> peak
                </span>
              </span>
            </div>
            <div className="mb-3 grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0D0F] px-1 py-2">
                <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8A8A]"><Users size={11} /> Live</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{formatNumber(viewers)}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0D0F] px-1 py-2">
                <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8A8A]"><Heart size={11} /> Reactions</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{formatNumber(reactionCount)}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0D0F] px-1 py-2">
                <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8A8A]"><Gift size={11} /> Gifts</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{formatNumber(liveGiftCount)}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0D0F] px-1 py-2">
                <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8A8A]"><UserPlus size={11} /> Followers</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{formatNumber(liveFollowerDelta)}</p>
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/40 px-2.5 py-1.5 text-[11px] font-medium text-white/70">
                  <Users size={14} className="text-[#F2C75C]" />
                  Guests {guestStage?.guestCount ?? 0}/{guestStage?.guestLimit ?? 4}
                </span>
                <button
                  type="button"
                  onClick={() => setGuestPanelOpen(true)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition',
                    (guestStage?.pending?.length ?? 0) > 0 ? 'bg-[#D6A83F]/20 text-[#F2C75C]' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1]',
                  )}
                >
                  <UserPlus size={13} />
                  Requests{(guestStage?.pending?.length ?? 0) > 0 ? ` (${guestStage!.pending!.length})` : ''}
                </button>
              </div>
              {/* Compact icon-only primary controls + More menu */}
              <div className="mb-3 flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void toggleCam()}
                  aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                  title={camOn ? 'Turn camera off' : 'Turn camera on'}
                  className={cn('grid h-11 w-11 place-items-center rounded-full border transition', camOn ? 'border-white/[0.12] bg-white/[0.08] text-white' : 'border-white/[0.06] bg-black/40 text-white/40')}
                >
                  {camOn ? <Camera size={17} /> : <CameraOff size={17} />}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  title={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  className={cn('grid h-11 w-11 place-items-center rounded-full border transition', micOn ? 'border-white/[0.12] bg-white/[0.08] text-white' : 'border-white/[0.06] bg-black/40 text-white/40')}
                >
                  {micOn ? <Mic size={17} /> : <MicOff size={17} />}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmEnd(true)}
                  disabled={phase === 'ENDING'}
                  aria-label="End live"
                  title="End live"
                  className="grid h-11 w-11 place-items-center rounded-full border border-rose-500/40 bg-rose-500/15 text-rose-400 transition hover:bg-rose-500/25 disabled:opacity-50"
                >
                  {phase === 'ENDING' ? <Loader2 size={17} className="animate-spin" /> : <Radio size={17} />}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((o) => !o)}
                    aria-label="More live options"
                    aria-expanded={moreOpen}
                    className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.08] bg-black/40 text-white/70 transition hover:bg-white/[0.1] hover:text-white"
                  >
                    <MoreVertical size={17} />
                  </button>
                  {moreOpen && (
                    <div className="absolute bottom-14 right-0 z-30 min-w-44 overflow-hidden rounded-xl border border-white/[0.08] bg-[#151517] py-1 shadow-2xl">
                      <button type="button" onClick={() => { void shareStream(); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                        <Share2 size={14} /> Share live
                      </button>
                      <button type="button" onClick={() => { setChatOpen(true); setMoreOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                        <MessageSquare size={14} /> Chat
                      </button>
                      <button type="button" onClick={() => { setGuestPanelOpen(true); setMoreOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                        <Users size={14} /> Invite guests
                      </button>
                      <button type="button" onClick={() => { setModOpen(true); setMoreOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                        <Shield size={14} /> Moderation
                      </button>
                      <div className="my-1 h-px bg-white/[0.06]" />
                      <button type="button" onClick={() => { setConfirmEnd(true); setMoreOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-medium text-rose-400 transition hover:bg-rose-500/10">
                        <Radio size={14} /> End live
                      </button>
                    </div>
                  )}
                </div>
              </div>
            <details className="mt-2 rounded-xl border border-white/[0.1] bg-[#0D0D0F]">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs font-medium text-white/70 transition hover:text-white">
                <Save size={14} className="text-[#D6A83F]" />
                Stream info
              </summary>
              <div className="space-y-3 border-t border-white/[0.08] px-4 py-3">
                <div>
                  <label htmlFor="live-info-title" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">Title</label>
                  <input id="live-info-title" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#151517] px-3 text-xs text-white outline-none" />
                </div>
                <div>
                  <label htmlFor="live-info-cat" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">Category</label>
                  <select id="live-info-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#151517] px-3 text-xs text-white outline-none">
                    {categories.map((c) => (
                      <option key={c} value={c} className="bg-[#151517]">{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="live-info-desc" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">Description</label>
                  <textarea id="live-info-desc" value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} className="w-full resize-none rounded-lg border border-white/[0.1] bg-[#151517] px-3 py-2 text-xs text-white outline-none" />
                </div>
                <button
                  type="button"
                  onClick={() => void saveStreamInfo()}
                  disabled={saveBusy || !title.trim()}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#F5F5F5] text-xs font-bold text-black transition hover:bg-white disabled:opacity-40"
                >
                  {saveBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save stream info
                </button>
              </div>
            </details>
          </div>

          {/* Cinematic gift overlay — rendered for the host too */}
          <GiftAnimationOverlay events={giftAnimations} />

          {/* Compact live chat overlay so the host sees comments/system events while streaming */}
          <AnimatePresence>
            {chatOpen && (
              <div className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-full max-w-[340px] flex-col border-l border-white/[0.06] bg-black/75 backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
                  <p className="text-xs font-semibold text-white">Live chat</p>
                  <button type="button" onClick={() => setChatOpen(false)} aria-label="Close chat" className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                  {hostMessages.length === 0 && <p className="py-8 text-center text-xs text-white/35">No messages yet.</p>}
                  {hostMessages.map((m) =>
                    m.kind === 'system' ? (
                      <div key={m.id} className="flex justify-center">
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">{m.message}</span>
                      </div>
                    ) : (
                      <div key={m.id} className="flex items-start gap-2">
                        <Avatar src={m.user?.avatar || null} alt={m.user?.username || 'user'} size="xs" />
                        <div className="min-w-0 flex-1">
                          <span className="mr-1.5 text-[11px] font-semibold text-white/85">{m.user?.username || 'user'}</span>
                          <span className="break-words text-[12.5px] leading-snug text-white/80">{m.message}</span>
                        </div>
                      </div>
                    ),
                  )}
                </div>
                <form
                  className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2.5"
                  onSubmit={(e) => { e.preventDefault(); void sendHostComment(); }}
                >
                  <input
                    value={hostComment}
                    onChange={(e) => setHostComment(e.target.value)}
                    maxLength={500}
                    placeholder="Send a message…"
                    aria-label="Send a chat message"
                    className="h-9 flex-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-white/20"
                  />
                  <button
                    type="submit"
                    aria-label="Send message"
                    disabled={sendingHostComment || !hostComment.trim()}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F5F5F5] text-black transition hover:bg-white disabled:opacity-40"
                  >
                    <Send size={15} />
                  </button>
                </form>
              </div>
            )}
          </AnimatePresence>

          {/* Guest stage panel: pending requests + on-stage guests + per-guest controls */}
          <AnimatePresence>
            {guestPanelOpen && (
              <div className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-full max-w-[340px] flex-col border-l border-white/[0.06] bg-black/75 backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-white">Guests {guestStage?.guestCount ?? 0}/{guestStage?.guestLimit ?? 4}</p>
                  <button type="button" onClick={() => setGuestPanelOpen(false)} aria-label="Close guests" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">Requests</p>
                    {(guestStage?.pending?.length ?? 0) === 0 ? (
                      <p className="text-xs text-white/40">No pending requests.</p>
                    ) : (
                      guestStage!.pending!.map((g) => (
                        <div key={g.id} className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2">
                          <Avatar src={g.avatar || null} alt={g.username} size="xs" />
                          <span className="min-w-0 flex-1 truncate text-xs text-white/85">@{g.username}</span>
                          <button type="button" onClick={() => respondGuest(g.id, true)} aria-label={`Accept ${g.username}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/25">
                            <Check size={13} /> Accept
                          </button>
                          <button type="button" onClick={() => respondGuest(g.id, false)} aria-label={`Decline ${g.username}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/20">
                            <X size={13} /> Decline
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">On stage</p>
                    {(guestStage?.guests?.length ?? 0) === 0 ? (
                      <p className="text-xs text-white/40">No guests on stage yet.</p>
                    ) : (
                      guestStage!.guests!.map((g) => (
                        <div key={g.id} className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2">
                          <Avatar src={g.avatar || null} alt={g.username} size="xs" />
                          <span className="min-w-0 flex-1 truncate text-xs text-white/85">@{g.username}</span>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => endGuestSession(g.id)} title="End session" aria-label={`End ${g.username}'s session`} className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-white/70 transition hover:bg-white/[0.12] hover:text-white"><VolumeX size={13} /></button>
                            <button type="button" onClick={() => removeGuest(g.id)} title="Remove guest" aria-label={`Remove ${g.username}`} className="grid h-7 w-7 place-items-center rounded-lg bg-rose-500/10 text-rose-400 transition hover:bg-rose-500/20"><UserX size={13} /></button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* ---------------- PRE-LIVE SETUP ---------------- */
        <div className="mx-auto w-full max-w-[560px] flex-1 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
          <AnimatePresence mode="wait">
            {phase === 'ENDED' ? (
              <motion.section
                key="ended"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center rounded-2xl border border-white/[0.08] bg-[#0D0D0F] p-8 text-center"
              >
                <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
                  <Check size={26} className="text-emerald-400" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">Live ended</h2>
                <p className="mt-1 max-w-xs text-sm text-white/50">
                  {streamData ? `You were live in "${streamData.title}"` : 'Your stream has ended.'}
                </p>

                {summary ? (
                  <div className="mt-6 grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] text-left">
                    {([
                      ['Duration', fmtDuration(summary.duration)],
                      ['Peak viewers', formatNumber(summary.peakViewers)],
                      ['Total viewers', formatNumber(summary.totalViewers)],
                      ['New followers', formatNumber(summary.newFollowers)],
                      ['Messages', formatNumber(summary.messages)],
                      ['Reactions', formatNumber(summary.reactions)],
                      ['Gifts', formatNumber(summary.giftCount)],
                      ['VANTA earned', `¢ ${formatNumber(summary.estimatedEarnings)}`],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} className="bg-[#0D0D0F] px-4 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">{label}</p>
                        <p className="mt-0.5 text-base font-semibold tabular-nums text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-6 flex items-center gap-2 text-xs text-white/40">
                    <Loader2 size={14} className="animate-spin" /> Compiling your stream summary…
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleLeave}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white"
                >
                  Return to Live
                  <ChevronRight size={15} />
                </button>
              </motion.section>
            ) : phase === 'ERROR' ? (
              <motion.section
                key="error"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center rounded-2xl border border-white/[0.08] bg-[#0D0D0F] p-8 text-center"
              >
                <div className="grid h-14 w-14 place-items-center rounded-full bg-rose-500/15">
                  <AlertTriangle size={26} className="text-rose-400" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">Unable to go live</h2>
                <p className="mt-1 max-w-xs text-sm text-white/50">
                  {error || 'LiveKit is not running or the stream could not connect. Start a LiveKit server, then retry.'}
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPhase('PREPARING')}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                  >
                    <RefreshCw size={15} />
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={handleLeave}
                    className="inline-flex items-center gap-2 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white"
                  >
                    Back to Live
                  </button>
                </div>
              </motion.section>
            ) : (
              <motion.div key="setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
                  {needsPermission ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0D0F] p-6 text-center">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-[#D6A83F]/15">
                        <CameraOff size={24} className="text-[#F2C75C]" />
                      </div>
                      <h3 className="mt-4 text-base font-semibold text-white">Camera &amp; microphone required</h3>
                      <p className="mt-1 max-w-xs text-sm text-white/50">
                        {mediaError && permissionState === 'unavailable'
                          ? mediaError
                          : 'VANTA needs access to your camera and microphone to go live. Allow access in your browser, then tap Retry.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleRetryMedia()}
                        disabled={deviceBusy}
                        className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#F5F5F5] px-6 py-3 text-sm font-bold text-black transition hover:bg-white disabled:opacity-50"
                      >
                        {deviceBusy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                        Retry permission
                      </button>
                    </div>
                  ) : isLoading || (deviceBusy && !hasPreview) ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0D0D0F]">
                      <Loader2 size={26} className="animate-spin text-[#F2C75C]" />
                      <p className="text-sm text-white/50">Requesting camera &amp; microphone…</p>
                    </div>
                  ) : hasPreview ? (
                    <>
                      <StudioVideo stream={stream} roomLocalVideo={null} />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0D0D0F]">
                      <Radio size={26} className="text-white/15" />
                      <p className="text-sm text-white/40">Camera is off</p>
                    </div>
                  )}

                  {isVideoOn && hasPreview && (
                    <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-[#D6A83F]/15 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#F2C75C]">
                      <motion.span
                        className="h-1.5 w-1.5 rounded-full bg-[#F2C75C]"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.4, repeat: Infinity }}
                      />
                      Preview
                    </div>
                  )}
                </div>

                {/* Preview device toggles */}
                {hasPreview && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleVideo()}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition',
                        isVideoOn ? 'border-white/[0.12] bg-white/[0.06] text-white' : 'border-white/[0.08] bg-black/40 text-white/40',
                      )}
                    >
                      {isVideoOn ? <Camera size={15} /> : <CameraOff size={15} />}
                      {isVideoOn ? 'Camera on' : 'Camera off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleAudio()}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition',
                        isAudioOn ? 'border-white/[0.12] bg-white/[0.06] text-white' : 'border-white/[0.08] bg-black/40 text-white/40',
                      )}
                    >
                      {isAudioOn ? <Mic size={15} /> : <MicOff size={15} />}
                      {isAudioOn ? 'Mic on' : 'Mic off'}
                    </button>
                  </div>
                )}

                {/* Title + category */}
                <div className="mt-5 space-y-3">
                  <div>
                    <label htmlFor="live-title" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                      Stream title
                    </label>
                    <input
                      id="live-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                      placeholder="What are you streaming?"
                      className="h-12 w-full rounded-xl border border-white/[0.1] bg-[#0D0D0F] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/[0.25]"
                    />
                    <p className="mt-1 text-right text-[10px] text-white/30">{title.length}/{MAX_TITLE}</p>
                  </div>
                  {thumbnailUrl && (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                        Thumbnail
                      </label>
                      <div className="relative overflow-hidden rounded-xl border border-white/[0.1]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbnailUrl} alt="Stream thumbnail" className="aspect-video w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setThumbnailUrl(null)}
                          aria-label="Remove thumbnail"
                          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition hover:bg-black/90"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label htmlFor="live-category" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                      Category
                    </label>
                    <select
                      id="live-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="h-12 w-full rounded-xl border border-white/[0.1] bg-[#0D0D0F] px-3 text-sm text-white outline-none transition focus:border-white/[0.25]"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c} className="bg-[#0D0D0F]">
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="live-description" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                      Description
                    </label>
                    <textarea
                      id="live-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                      rows={3}
                      placeholder="Tell viewers what this stream is about."
                      className="w-full resize-none rounded-xl border border-white/[0.1] bg-[#0D0D0F] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/[0.25]"
                    />
                  </div>

                  <div>
                    <label htmlFor="live-audience" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                      Audience
                    </label>
                    <select
                      id="live-audience"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value as 'public' | 'followers' | 'private')}
                      className="h-12 w-full rounded-xl border border-white/[0.1] bg-[#0D0D0F] px-3 text-sm text-white outline-none transition focus:border-white/[0.25]"
                    >
                      <option value="public" className="bg-[#0D0D0F]">Public — visible to everyone</option>
                      <option value="followers" className="bg-[#0D0D0F]">Followers only</option>
                      <option value="private" className="bg-[#0D0D0F]">Private — only you</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="live-tags" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                      Tags
                    </label>
                    <input
                      id="live-tags"
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
                      placeholder="Comma separated, e.g. chatting, music, gaming"
                      className="h-12 w-full rounded-xl border border-white/[0.1] bg-[#0D0D0F] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/[0.25]"
                    />
                  </div>

                  {!thumbnailUrl && hasPreview && (
                    <button
                      type="button"
                      onClick={captureThumbnail}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-[#0D0D0F] text-xs font-medium text-white/70 transition hover:bg-white/[0.05] hover:text-white"
                    >
                      <Camera size={15} className="text-[#D6A83F]" />
                      Use current frame as thumbnail
                    </button>
                  )}
                </div>

                {/* Device switching */}
                {hasPreview && (videoDevices.length > 1 || audioDevices.length > 1) && (
                  <details
                    className="mt-3 rounded-xl border border-white/[0.08] bg-[#0D0D0F]"
                    open={showDevices}
                    onToggle={(e) => setShowDevices((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs font-medium text-white/70 transition hover:text-white">
                      <Camera size={14} className="text-[#D6A83F]" />
                      Devices
                    </summary>
                    <div className="space-y-3 px-4 pb-4">
                      {videoDevices.length > 1 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">Camera</p>
                          <select
                            onChange={(e) => { void switchCamera(e.target.value); }}
                            value={videoDevices.find((d) => d.deviceId)?.deviceId ?? ''}
                            className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#151517] px-3 text-xs text-white outline-none"
                          >
                            {videoDevices.map((d) => (
                              <option key={d.deviceId} value={d.deviceId} className="bg-[#151517]">
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {audioDevices.length > 1 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A]">Microphone</p>
                          <select
                            onChange={(e) => { void switchMicrophone(e.target.value); }}
                            value={audioDevices.find((d) => d.deviceId)?.deviceId ?? ''}
                            className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#151517] px-3 text-xs text-white outline-none"
                          >
                            {audioDevices.map((d) => (
                              <option key={d.deviceId} value={d.deviceId} className="bg-[#151517]">
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {/* GO LIVE */}
                <button
                  type="button"
                  onClick={() => void startLive()}
                  disabled={!hasPreview || deviceBusy || seeding || !title.trim()}
                  className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg,#F2C75C 0%,#D6A83F 55%,#A8842C 100%)',
                    color: '#050505',
                    boxShadow: '0 0 32px rgba(214,168,63,0.18)',
                  }}
                >
                  {seeding ? <Loader2 size={18} className="animate-spin" /> : <Radio size={18} />}
                  GO LIVE
                </button>
                {!hasPreview && (
                  <button
                    type="button"
                    onClick={() => void beginMedia()}
                    disabled={deviceBusy}
                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#D6A83F]/40 bg-[#D6A83F]/10 text-sm font-semibold text-[#F2C75C] transition hover:bg-[#D6A83F]/20 disabled:opacity-50"
                  >
                    {deviceBusy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    Enable camera &amp; microphone
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* End-live confirmation */}
      <AnimatePresence>
        {confirmEnd && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button aria-label="Cancel" onClick={() => setConfirmEnd(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              role="alertdialog"
              aria-modal="true"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              className="relative z-10 m-4 w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#151517] p-6 text-center shadow-2xl"
            >
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#D6A83F]/15">
                <Radio size={22} className="text-[#F2C75C]" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-white">End this live?</h2>
              <p className="mt-1 text-sm text-white/50">
                The stream will stop and viewers will be returned to Live discovery.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="h-12 rounded-xl border border-white/[0.12] bg-white/[0.04] text-sm font-medium text-white transition hover:bg-white/[0.08]"
                >
                  Keep streaming
                </button>
                <button
                  type="button"
                  onClick={() => void endLive()}
                  className="h-12 rounded-xl border border-[#D6A83F]/50 bg-[#D6A83F] text-sm font-bold text-black transition hover:bg-[#F2C75C]"
                >
                  End Live
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
