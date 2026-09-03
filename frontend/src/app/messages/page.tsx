'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, invalidateCache } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import {
  MessageCircle, Search,
  Send, Paperclip, Check, CheckCheck,
  Loader2, Users, Hash, ArrowLeft, X, UserPlus, Camera, BellOff,
  Pin, Image as ImageIcon, FileText, Info, ChevronRight, Flag, Ban, Pencil, RefreshCw,
  Shield, Trash2, Crown, Globe2, Lock, UserMinus, Copy, Forward, Smile, MoreVertical,
  Mic, Square, Play, Pause, Phone, Video,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';
import { createSocket } from '@/lib/socketClient';
import type { Socket } from 'socket.io-client';
import MessagesCreateButton from '@/components/messages/MessagesCreateButton';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { useCalls } from '@/context/CallContext';
import { useChatUnread } from '@/context/ChatUnreadContext';

interface Conversation {
  id: string;
  type: 'direct' | 'group' | 'channel';
  name: string;
  avatar?: string;
  lastMessage?: {
    text: string;
    sender: string;
    timestamp: string;
    read: boolean;
  };
  unread: number;
  online: boolean;
  username?: string;
  verified?: boolean;
  lastSeen?: string;
  partnerId?: string;
  nextCursor?: string | null;
  pinned?: boolean;
  muted?: boolean;
  memberCount?: number;
  onlineMemberCount?: number;
  currentRole?: string;
  entityId?: string;
  description?: string;
  handle?: string;
  participants?: any[];
}

interface Message {
  id: string;
  text: string;
  type?: string;
  sender: { id: string; username: string; avatar?: string; verified?: boolean; fullName?: string; };
  timestamp: string;
  read: boolean;
  isOwn: boolean;
  content?: string;
  senderId?: string;
  conversationId?: string;
  createdAt?: string;
  reads?: Array<{ userId: string }>;
  attachments?: Array<{ id?: string; fileId?: string; url: string; fileType: string; fileName?: string; fileSize?: number }>;
  editedAt?: string | null;
  deletedAt?: string | null;
  pending?: boolean;
  failed?: boolean;
  pinnedAt?: string | null;
  reactions?: Array<{ id: string; reaction: string; userId: string }>;
  replyTo?: any;
}

const attachmentTextPattern = /^(?:https?:\/\/|www\.|\/?(?:storage|uploads?)\/|[^\s/]+\.(?:jpe?g|png|gif|webp|avif|mp4|webm|mov)(?:\?.*)?$)/i;
const imagePathPattern = /\.(?:jpe?g|png|gif|webp|avif)(?:\?.*)?$/i;
const videoPathPattern = /\.(?:mp4|webm|mov)(?:\?.*)?$/i;

const normalizeAttachmentType = (value: unknown, url: string): string => {
  const type = typeof value === 'string' ? value.toUpperCase() : '';
  if (type === 'IMAGE' || type.startsWith('IMAGE/')) return 'IMAGE';
  if (type === 'VIDEO' || type.startsWith('VIDEO/')) return 'VIDEO';
  if (type === 'AUDIO' || type.startsWith('AUDIO/')) return 'AUDIO';
  if (imagePathPattern.test(url)) return 'IMAGE';
  if (videoPathPattern.test(url)) return 'VIDEO';
  return type || 'FILE';
};

const normalizeMessageRecord = (msg: any, currentUserId?: string): Message => {
  const content = msg.content ?? msg.text ?? '';
  const attachments = (msg.attachments ?? []).map((attachment: any) => {
    const source = attachment.url ?? attachment.mediaUrl ?? attachment.path ?? attachment.fileName;
    return {
      ...attachment,
      url: resolveMediaUrl(source),
      fileType: normalizeAttachmentType(attachment.fileType ?? attachment.mimeType ?? attachment.type, String(source || '')),
    };
  });

  // Before Attachment rows existed, image messages stored the upload filename
  // in Message.content. Keep those messages usable without exposing that name.
  const messageType = typeof msg.type === 'string' ? msg.type.toUpperCase() : '';
  if (!attachments.length && messageType === 'IMAGE' && attachmentTextPattern.test(content)) {
    attachments.push({
      url: resolveMediaUrl(content),
      fileType: 'IMAGE',
      fileName: String(content).split('/').pop(),
    });
  }

  return {
    ...msg,
    id: msg.id,
    text: content,
    sender: msg.sender ?? { id: msg.senderId, username: 'User' },
    senderId: msg.senderId ?? msg.sender?.id,
    conversationId: msg.conversationId,
    timestamp: msg.createdAt ?? msg.timestamp,
    createdAt: msg.createdAt ?? msg.timestamp,
    read: Boolean(msg.read ?? msg.isRead ?? msg.reads?.some((read: any) => read.userId !== currentUserId)),
    isOwn: (msg.senderId ?? msg.sender?.id) === currentUserId,
    attachments,
    reactions: msg.reactions ?? [],
    replyTo: msg.replyTo,
  };
};

const visibleMessageText = (message: Message): string => {
  if (!message.attachments?.some(attachment => attachment.fileType === 'IMAGE')) return message.text;
  const text = message.text.trim();
  if (!text) return '';
  const image = message.attachments.find(attachment => attachment.fileType === 'IMAGE');
  const candidates = [image?.fileName, image?.url].filter(Boolean).map(value => String(value).split('/').pop());
  return candidates.includes(text) || attachmentTextPattern.test(text) ? '' : message.text;
};

const formatVoiceTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const safe = Math.floor(seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/** Inline voice-note player used for AUDIO message attachments. */
function VoiceNotePlayer({ src, name }: { src: string; name?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const label = isPlaying ? 'Pause voice note' : `Play voice note${name ? `: ${name.replace(/\.[a-z0-9]+$/i, '')}` : ''}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration); };
    const onEnd = () => { setIsPlaying(false); setProgress(0); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] max-w-full py-0.5 select-none">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={label}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#d6a83f]/15 text-[#f2c75c] transition hover:bg-[#d6a83f]/25 active:scale-90"
      >
        {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-[#d6a83f] transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[9px] text-white/40">
          {isPlaying || duration === 0 ? formatVoiceTime(progress) : formatVoiceTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const { setChatUnread } = useChatUnread();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileList, setShowMobileList] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<'group' | 'channel' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createHandle, setCreateHandle] = useState('');
  const [createVisibility, setCreateVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [createAvatar, setCreateAvatar] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState<any[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [isCreatingEntity, setIsCreatingEntity] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
// Separates the one-time "open at latest unread / bottom" anchor from the
// live "only auto-scroll when already near the bottom" behaviour.
const initialScrollDoneRef = useRef(false);
const wasNearBottomRef = useRef(true);
const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
const [pendingNewMessage, setPendingNewMessage] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const typingRenewRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingExpiryRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingBlobRef = useRef<Blob | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingDurationRef = useRef(0);
  const recordingTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingCancelledRef = useRef(false);
  const swipeStartRef = useRef<{ id: string; x: number; y: number; offset: number } | null>(null);
  const swipeOffsetRef = useRef(0);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [newChatResults, setNewChatResults] = useState<any[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [attachmentDraft, setAttachmentDraft] = useState<{ file: File; previewUrl: string; fileType: 'IMAGE' | 'VIDEO'; progress: number; status: 'ready' | 'uploading' | 'sending' | 'failed'; error?: string } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [editEntityOpen, setEditEntityOpen] = useState(false);
  const [editEntityId, setEditEntityId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [editVisibility, setEditVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [editHandle, setEditHandle] = useState('');
  const [managedEntity, setManagedEntity] = useState<any>(null);
  const [managementSearch, setManagementSearch] = useState('');
  const [managementResults, setManagementResults] = useState<any[]>([]);
  const [managementBusy, setManagementBusy] = useState<string | null>(null);
  const [isSavingEntity, setIsSavingEntity] = useState(false);
  const editAvatarInputRef = useRef<HTMLInputElement>(null);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, boolean>>({});
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'ready' | 'uploading'>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingPreviewUrlRef = useRef<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<{ id: string; offset: number } | null>(null);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [messageContextId, setMessageContextId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [filter, setFilter] = useState<'all' | 'direct' | 'group' | 'channel' | 'unread'>('all');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [messageSearchResults, setMessageSearchResults] = useState<Message[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [mediaViewer, setMediaViewer] = useState<{ url: string; fileType: string; fileName?: string } | null>(null);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const newChatSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live auto-scroll: only follow the newest message when the user is already
  // at (or near) the bottom. When they are reading older messages, keep their
  // position and surface the "New messages" jump indicator instead.
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) { wasNearBottomRef.current = true; return; }
    const lastMessageId = messages.at(-1)?.id ?? null;
    const previousLastMessageId = previousLastMessageIdRef.current;
    previousLastMessageIdRef.current = lastMessageId;
    if (!lastMessageId || lastMessageId === previousLastMessageId) return;
    // Initial open is owned by the dedicated one-time anchor effect below
    // (which jumps instantly to the unread area / bottom). Only follow live
    // appends once the reader already has an established position in the thread.
    if (!previousLastMessageId) return;

    const isNearBottom = () => (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) < 140;
    const near = wasNearBottomRef.current && isNearBottom();
    const newest = messages[messages.length - 1];
    const isIncoming = newest?.id !== previousLastMessageId && Boolean(newest) &&
      (newest.sender?.id !== user?.id) && !newest.isOwn;

    if (near) {
      // Already reading the latest region → follow the new message.
      const frame = window.requestAnimationFrame(() => {
        const target = messagesViewportRef.current;
        target?.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
      });
      setPendingNewMessage(false);
      wasNearBottomRef.current = true;
    } else if (isIncoming) {
      // Reading older messages → never yank the user back down; show pill.
      setPendingNewMessage(true);
    }
  }, [messages, user?.id]);

  // Track proximity to the bottom so live auto-scroll knows when to engage and
  // so the "New messages" pill clears once the user scrolls back down.
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      const near = (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) < 140;
      wasNearBottomRef.current = near;
      if (near) setPendingNewMessage(false);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [activeConversation]);

  // One-time anchor when a conversation opens: land on the latest unread area
  // (with a subtle "New messages" divider) or the bottom when everything is read.
  useEffect(() => {
    if (!activeConversation || messages.length === 0 || initialScrollDoneRef.current) return;
    // Wait until fetched messages belong to the conversation we just opened.
    if (!messages.some(item => item.conversationId === activeConversation)) return;
    initialScrollDoneRef.current = true;

    const unreadList = messages.filter(mg => !mg.isOwn && !(mg.reads || []).some(r => r.userId === user?.id));
    const firstUnread = unreadList[0] || null;
    setFirstUnreadId(firstUnread ? firstUnread.id : null);
    if (!firstUnread) setPendingNewMessage(false);

    const frame = window.requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current;
      if (!viewport) return;
      if (firstUnread) {
        const el = document.getElementById(`message-${firstUnread.id}`);
        if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' });
        else viewport.scrollTop = viewport.scrollHeight;
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
      // Reflect the actual position after anchoring so subsequent live appends
      // only auto-follow when the reader is genuinely at the newest region.
      wasNearBottomRef.current = (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) < 140;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversation, messages, user?.id]);

  useEffect(() => {
    // Chat owns the viewport. Lock the document even on the list screen so
    // the browser cannot scroll the app shell behind the independent panes.
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const viewport = window.visualViewport;

    const syncVisualViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      root.style.setProperty('--chat-viewport-height', `${height}px`);
      root.style.setProperty('--chat-viewport-offset', `${offsetTop}px`);

      if (document.activeElement === messageInputRef.current) {
        // Only follow to the newest message when the reader was already near the
        // bottom. If they are browsing older messages, the keyboard resize must
        // not yank them back down — keep their position (the composer stays put).
        if (wasNearBottomRef.current) {
          window.requestAnimationFrame(() => {
            const messagesViewport = messagesViewportRef.current;
            messagesViewport?.scrollTo({ top: messagesViewport.scrollHeight });
          });
        }
      }
    };

    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    syncVisualViewport();
    viewport?.addEventListener('resize', syncVisualViewport);
    viewport?.addEventListener('scroll', syncVisualViewport);
    window.addEventListener('resize', syncVisualViewport);

    return () => {
      viewport?.removeEventListener('resize', syncVisualViewport);
      viewport?.removeEventListener('scroll', syncVisualViewport);
      window.removeEventListener('resize', syncVisualViewport);
      root.style.removeProperty('--chat-viewport-height');
      root.style.removeProperty('--chat-viewport-offset');
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => { document.title = 'Chat | VANTA'; }, []);

  // Chat subviews participate in the URL history without becoming separate
  // app pages. This gives browser/system back the same contextual hierarchy
  // as the visible Chat headers: settings -> info -> conversation -> list.
  useEffect(() => {
    const view = searchParams.get('view');
    if (view !== 'info' && view !== 'settings') setDetailsOpen(false);
    if (view !== 'settings') setEditEntityOpen(false);
    if (view !== 'media') setMediaViewer(null);
  }, [searchParams]);

  const pushChatView = useCallback((view: 'info' | 'settings' | 'media') => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    router.push(`/chat?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const closeChatSubview = useCallback((fallback: () => void) => {
    if (searchParams.get('view')) router.back();
    else fallback();
  }, [router, searchParams]);

  const openConversationInfo = useCallback(() => {
    setDetailsOpen(true);
    pushChatView('info');
  }, [pushChatView]);

  const openMediaViewer = useCallback((attachment: { url: string; fileType: string; fileName?: string }) => {
    setMediaViewer(attachment);
    pushChatView('media');
  }, [pushChatView]);

  const fetchConversations = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const data = await apiGet<any>('/api/messages', token);
      const convList = Array.isArray(data) ? data : data?.conversations ?? data?.data ?? [];
      const normalizedConversations = convList.map((conv: any) => ({
        id: conv.id,
      type: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toLowerCase(),
        name: conv.name || conv.partner?.fullName || conv.partner?.username || 'Conversation',
        avatar: conv.partner?.avatar || conv.avatar,
        lastMessage: conv.lastMessage ? {
          text: conv.lastMessage.content ?? conv.lastMessage.text ?? '',
          sender: conv.lastMessage.sender?.username ?? 'Unknown',
          timestamp: conv.lastMessage.createdAt ?? conv.lastMessage.timestamp,
          read: conv.lastMessage.read ?? false,
        } : undefined,
        unread: conv.unreadCount ?? conv.unread ?? 0,
        online: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toUpperCase() === 'DIRECT'
          ? Boolean(conv.partner?.userPresence?.isOnline ?? conv.partner?.isOnline ?? conv.online)
          : false,
        onlineMemberCount: typeof conv.onlineMemberCount === 'number' ? conv.onlineMemberCount : undefined,
        username: conv.partner?.username,
        verified: Boolean(conv.partner?.verified),
        lastSeen: conv.partner?.userPresence?.lastActive,
        partnerId: conv.partner?.id,
        memberCount: conv.memberCount,
        currentRole: conv.currentRole,
        entityId: conv.entityId,
        muted: Boolean(conv.mutedAt),
        description: conv.description,
        handle: conv.handle,
        participants: conv.participants ?? [],
      }));
      setConversations(normalizedConversations);
      setConversationCursor(data?.nextCursor ?? null);
    } catch (err: any) {
      setError(err.message || 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadMoreConversations = async () => {
    if (!token || !conversationCursor) return;
    try {
      const data = await apiGet<any>(`/api/messages?limit=25&cursor=${encodeURIComponent(conversationCursor)}`, token);
      const next = (data?.conversations ?? []).map((conv: any) => ({
        id: conv.id, type: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toLowerCase(), name: conv.name || conv.partner?.fullName || conv.partner?.username || 'Conversation', avatar: conv.partner?.avatar || conv.avatar,
        lastMessage: conv.lastMessage ? { text: conv.lastMessage.content ?? '', sender: conv.lastMessage.sender?.username ?? 'Unknown', timestamp: conv.lastMessage.createdAt, read: Boolean(conv.lastMessage.read) } : undefined,
        unread: conv.unreadCount ?? 0, online: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toUpperCase() === 'DIRECT' ? Boolean(conv.partner?.userPresence?.isOnline ?? conv.partner?.isOnline ?? conv.online) : false, onlineMemberCount: typeof conv.onlineMemberCount === 'number' ? conv.onlineMemberCount : undefined, username: conv.partner?.username, verified: Boolean(conv.partner?.verified), lastSeen: conv.partner?.userPresence?.lastActive, partnerId: conv.partner?.id, memberCount: conv.memberCount, currentRole: conv.currentRole, entityId: conv.entityId,
      }));
      setConversations(previous => [...previous, ...next.filter((item: Conversation) => !previous.some(existing => existing.id === item.id))]);
      setConversationCursor(data?.nextCursor ?? null);
    } catch (err: any) { showToast?.({ type: 'error', title: 'Could not load more conversations', message: err?.message || 'Please try again.' }); }
  };

  const fetchMessages = useCallback(async (conversationId: string) => {
    if (!token) return;
    try {
      const data = await apiGet<any>(`/api/messages/${conversationId}?limit=50`, token);
      const msgList = Array.isArray(data) ? data : data?.messages ?? data?.data ?? [];
      setMessages(msgList.map((msg: any) => normalizeMessageRecord(msg, user?.id)));
      setMessageCursor(data?.nextCursor ?? null);
      await apiPut<any>(`/api/messages/${conversationId}/read`, {}, token).catch(() => undefined);
      setConversations(previous => previous.map(conversation => conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Chat unavailable', message: err?.message || 'Could not load this conversation.' }); }
  }, [token, user?.id, showToast]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Keep the global header Chat badge in sync with this page's per-conversation
  // unread state (no page refresh needed). The backend also pushes the same
  // authoritative total via `chat_unread_count`; both converge on the same number.

  useEffect(() => {
    const total = conversations.reduce((sum, conv) => sum + (conv.unread || 0), 0);
    setChatUnread(total);
  }, [conversations, setChatUnread]);

  const normalizeMessage = useCallback((msg: any) => normalizeMessageRecord(msg, user?.id), [user?.id]);

  const loadOlderMessages = async () => {
    if (!token || !activeConversation || !messageCursor || loadingOlder) return;
    const viewport = messagesViewportRef.current;
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const prevScrollTop = viewport?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const data = await apiGet<any>(`/api/messages/${activeConversation}?limit=50&cursor=${encodeURIComponent(messageCursor)}`, token);
      const older = (data?.messages ?? []).map((msg: any) => normalizeMessageRecord(msg, user?.id));
      setMessages(previous => [...older, ...previous]);
      setMessageCursor(data?.nextCursor ?? null);
      // Keep the reader exactly where they were after older messages are
      // prepended above the current viewport (prevents a jarring jump).
      const raf = window.requestAnimationFrame(() => {
        const target = messagesViewportRef.current;
        if (target) target.scrollTop = (target.scrollHeight - prevScrollHeight) + prevScrollTop;
      });
      window.setTimeout(() => window.cancelAnimationFrame(raf), 5000);
    } catch (err: any) { showToast?.({ type: 'error', title: 'Could not load older messages', message: err?.message || 'Please try again.' }); }
    finally { setLoadingOlder(false); }
  };

  const clearTypingFor = (conversationId: string) => {
    setTypingByConversation(previous => {
      if (!previous[conversationId]) return previous;
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });
    if (activeConversationRef.current === conversationId) setTypingUserId(null);
  };

  const stopOutgoingTyping = () => {
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      socketRef.current?.emit('typing:stop', { conversationId: activeConversationRef.current });
    }
    if (typingRenewRef.current) { clearInterval(typingRenewRef.current); typingRenewRef.current = null; }
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
  };

  const startVoiceRecording = async () => {
    if (recordingState !== 'idle' || !activeConversation) return;
    setRecordingError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingError('Voice messages are not supported in this browser.');
      showToast?.({ type: 'error', title: 'Recording unavailable', message: 'Your browser does not support voice messages.' });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setRecordingError('Microphone permission is required to record voice notes.');
      showToast?.({ type: 'error', title: 'Microphone blocked', message: 'Allow microphone access to record a voice note.' });
      return;
    }
    recordingStreamRef.current = stream;
    const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];
    const mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    recordingChunksRef.current = [];
    recordingDurationRef.current = 0;
    recordingCancelledRef.current = false;
    recorder.addEventListener('dataavailable', (event: BlobEvent) => { if (event.data && event.data.size > 0) recordingChunksRef.current.push(event.data); });
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach(track => track.stop());
      recordingStreamRef.current = null;
      if (recordingCancelledRef.current) {
        recordingCancelledRef.current = false;
        return;
      }
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) { clearVoiceState(); return; }
      recordingBlobRef.current = blob;
      recordingPreviewUrlRef.current = URL.createObjectURL(blob);
      setRecordingDuration(recordingDurationRef.current);
      setRecordingState('ready');
    });
    recorder.start();
    setRecordingState('recording');
    recordingStartedAtRef.current = Date.now();
    if (recordingTickRef.current) clearInterval(recordingTickRef.current);
    recordingTickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
      recordingDurationRef.current = elapsed;
      setRecordingDuration(elapsed);
      if (elapsed >= 120) stopRecordingPhase();
    }, 500);
  };

  const stopRecordingPhase = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (recordingTickRef.current) clearInterval(recordingTickRef.current);
    recorder.stop();
  };

  const clearVoiceState = () => {
    if (recordingTickRef.current) clearInterval(recordingTickRef.current);
    recordingBlobRef.current = null;
    if (recordingPreviewUrlRef.current) { URL.revokeObjectURL(recordingPreviewUrlRef.current); recordingPreviewUrlRef.current = null; }
    setRecordingDuration(0);
    recordingDurationRef.current = 0;
    setRecordingError(null);
    setRecordingState('idle');
  };

  const cancelRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recordingTickRef.current) clearInterval(recordingTickRef.current);
    recordingCancelledRef.current = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (recordingStreamRef.current) { recordingStreamRef.current.getTracks().forEach(track => track.stop()); recordingStreamRef.current = null; }
    clearVoiceState();
  };

  const sendVoiceNote = async () => {
    if (!token || !user || !activeConversation || recordingState !== 'ready') return;
    const blob = recordingBlobRef.current;
    if (!blob) return;
    const mimeType = blob.type || 'audio/webm';
    const ext = mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
    const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mimeType });
    setRecordingState('uploading');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('conversationId', activeConversation);
      const uploaded = await apiUpload<any>('/api/upload/message', form, token);
      const url = uploaded.url ?? uploaded.data?.url;
      const fileId = uploaded.fileId ?? uploaded.id ?? uploaded.data?.fileId;
      if (!url || !fileId) throw new Error('Upload did not return a usable attachment');
      await sendCurrentMessage('', [{ fileId, url, fileType: 'AUDIO', fileName: file.name, fileSize: file.size }]);
    } catch (err: any) {
      if (err?.statusCode === 499) { clearVoiceState(); return; }
      setRecordingState('ready');
      showToast?.({ type: 'error', title: 'Voice note not sent', message: err?.message || 'The recording could not be uploaded. Try again.' });
      return;
    }
    clearVoiceState();
  };

  const trackMessageSwipe = (event: React.PointerEvent, message: Message) => {
    const start = swipeStartRef.current;
    if (!start || start.id !== message.id || message.pending) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    // Vertical intent -> hand the gesture back to the scroll container.
    if (Math.abs(dy) > Math.abs(dx)) { swipeStartRef.current = null; setSwipeOffset(null); return; }
    if (dx < 0) { setSwipeOffset(null); return; }
    const offset = Math.min(76, Math.max(0, dx * 0.55));
    start.offset = offset;
    if (offset <= 0) { swipeOffsetRef.current = 0; setSwipeOffset(null); }
    else if (Math.abs(offset - swipeOffsetRef.current) >= 1.25) { swipeOffsetRef.current = offset; setSwipeOffset({ id: message.id, offset }); }
  };

  const finishMessageSwipe = () => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    swipeOffsetRef.current = 0;
    if (!start) { setSwipeOffset(null); return; }
    setSwipeOffset(null);
    if (start.offset < 56) return;
    const target = messages.find(message => message.id === start.id);
    if (!target || target.pending) return;
    setReplyingTo(target);
    if ('vibrate' in navigator) navigator.vibrate(14);
  };

  useEffect(() => {
    if (!token || !user?.id) return;
    const socket = createSocket(token, `messages-page-${user.id}`);
    socketRef.current = socket;
    const onMessage = (raw: any) => {
      const message = normalizeMessage(raw);
      if (message.conversationId === activeConversationRef.current) {
        setMessages(previous => previous.some(item => item.id === message.id) ? previous.map(item => item.id === message.id ? message : item) : [...previous.filter(item => !(item.pending && item.text === message.text && item.senderId === message.senderId)), message]);
        apiPut<any>(`/api/messages/${message.conversationId}/read`, {}, token).catch(() => undefined);
      }
      fetchConversations();
    };
    const onUpdated = (raw: any) => { const message = normalizeMessage(raw); setMessages(previous => previous.map(item => item.id === message.id ? message : item)); fetchConversations(); };
    const onRead = (data: any) => { if (data.readerId !== user.id) setMessages(previous => previous.map(item => item.isOwn ? { ...item, read: true } : item)); fetchConversations(); };
    const onPresence = (data: any) => setConversations(previous => previous.map(conversation => {
      if (conversation.type === 'direct') {
        return conversation.partnerId === data.userId ? { ...conversation, online: data.isOnline, lastSeen: data.lastActive } : conversation;
      }
      if (conversation.type === 'group' && conversation.participants?.some((p: any) => (p.id ?? p.userId) === data.userId)) {
        const participants = (conversation.participants || []).map((p: any) =>
          (p.id ?? p.userId) === data.userId ? { ...p, userPresence: { ...(p.userPresence || {}), isOnline: data.isOnline, lastActive: data.lastActive } } : p
        );
        return { ...conversation, participants, onlineMemberCount: participants.filter((p: any) => p.userPresence?.isOnline).length };
      }
      return conversation;
    }));
    const onTyping = (data: any) => {
      if (data.conversationId === activeConversationRef.current) setTypingUserId(data.typing ? data.userId : null);
      setTypingByConversation(previous => {
        const next = { ...previous };
        if (data.typing) next[data.conversationId] = true;
        else delete next[data.conversationId];
        return next;
      });
      // Auto-expire typing state so it never sticks after a dropped connection.
      if (typingExpiryRef.current[data.conversationId]) clearTimeout(typingExpiryRef.current[data.conversationId]);
      if (data.typing) {
        typingExpiryRef.current[data.conversationId] = setTimeout(() => clearTypingFor(data.conversationId), 5000);
      }
    };
    socket.on('message:new', onMessage); socket.on('message:updated', onUpdated); socket.on('message:deleted', onUpdated); socket.on('messages:read', onRead); socket.on('presence:changed', onPresence); socket.on('typing:changed', onTyping); socket.on('conversations:refresh', fetchConversations);
    socket.connect();
    return () => { socket.off('message:new', onMessage); socket.off('message:updated', onUpdated); socket.off('message:deleted', onUpdated); socket.off('messages:read', onRead); socket.off('presence:changed', onPresence); socket.off('typing:changed', onTyping); socket.off('conversations:refresh', fetchConversations); socket.disconnect(); stopOutgoingTyping(); };
  }, [token, user?.id, fetchConversations, normalizeMessage]);

  // Global cleanups when the chat screen unmounts.
  useEffect(() => () => {
    Object.values(typingExpiryRef.current).forEach(timer => clearTimeout(timer));
    if (recordingStreamRef.current) recordingStreamRef.current.getTracks().forEach(track => track.stop());
    if (recordingTickRef.current) clearInterval(recordingTickRef.current);
  }, []);

  const handleSelectConversation = (id: string) => {
    stopOutgoingTyping();
    if (activeConversationRef.current) socketRef.current?.emit('leave_conversation', activeConversationRef.current);
    activeConversationRef.current = id;
    previousLastMessageIdRef.current = null;
    initialScrollDoneRef.current = false;
    setFirstUnreadId(null);
    setPendingNewMessage(false);
    setActiveConversation(id);
    setShowMobileList(false);
    setDetailsOpen(false);
    fetchMessages(id);
    socketRef.current?.emit('conversation:join', id);
    if (searchParams.get('conversation') !== id) {
      router.push(`/chat?conversation=${encodeURIComponent(id)}`, { scroll: false });
    }
  };

  const handleCloseConversation = useCallback(() => {
    if (typingActiveRef.current) { typingActiveRef.current = false; socketRef.current?.emit('typing:stop', { conversationId: activeConversationRef.current }); }
    if (typingRenewRef.current) { clearInterval(typingRenewRef.current); typingRenewRef.current = null; }
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
    if (activeConversationRef.current) {
      socketRef.current?.emit('leave_conversation', activeConversationRef.current);
    }
    activeConversationRef.current = null;
    previousLastMessageIdRef.current = null;
    initialScrollDoneRef.current = false;
    setFirstUnreadId(null);
    setPendingNewMessage(false);
    setActiveConversation(null);
    setMessages([]);
    setShowMobileList(true);
    setDetailsOpen(false);
    router.replace('/chat', { scroll: false });
  }, [router]);

  const handleLeaveActiveConversation = async () => {
    if (!token || !activeConv || activeConv.type === 'direct') return;
    const entityId = activeConv.entityId || activeConv.id;
    setIsLeaving(true);
    try {
      if (activeConv.type === 'channel') {
        await apiPost<any>(`/api/channels/${entityId}/leave`, {}, token);
      } else {
        await apiDelete<any>(`/api/groups/${entityId}/members/${encodeURIComponent(user?.id || '')}`, token);
      }
      showToast?.({ type: 'success', title: activeConv.type === 'group' ? 'Left group' : 'Left channel', message: `You left ${activeConv.name}.` });
      setLeaveDialog(false);
      invalidateCache('api/messages');
      handleCloseConversation();
      fetchConversations();
    } catch (err: any) {
      showToast?.({ type: 'error', title: 'Could not leave', message: err?.message || 'Please try again.' });
    } finally {
      setIsLeaving(false);
    }
  };


  useEffect(() => {
    const requestedConversation = searchParams.get('conversation');
    if (!requestedConversation) {
      if (activeConversationRef.current) {
        activeConversationRef.current = null;
        previousLastMessageIdRef.current = null;
        setActiveConversation(null);
        setMessages([]);
        setShowMobileList(true);
      }
      return;
    }
    if (!conversations.some(conversation => conversation.id === requestedConversation)) return;
    if (activeConversationRef.current !== requestedConversation) handleSelectConversation(requestedConversation);
  // handleSelectConversation intentionally reads current refs and API state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, searchParams]);

  const sendCurrentMessage = async (content = messageInput.trim(), attachments: any[] = []) => {
    if (!token || !user || !activeConversation || (!content && !attachments.length)) return;
    stopOutgoingTyping();
    clearTypingFor(activeConversation);
    const pendingId = `pending-${Date.now()}`;
    const pending = normalizeMessage({ id: pendingId, conversationId: activeConversation, senderId: user.id, sender: user, content, attachments, createdAt: new Date().toISOString(), pending: true, replyTo: replyingTo ? { id: replyingTo.id, content: replyingTo.text, sender: replyingTo.sender } : undefined });
    setMessages(previous => [...previous, pending]); setMessageInput('');
    try {
      const result = await apiPost<any>('/api/messages/send', { conversationId: activeConversation, content, type: attachments[0]?.fileType || 'TEXT', attachments, replyToId: replyingTo?.id }, token);
      const saved = normalizeMessage(result.data ?? result.message ?? result);
      setMessages(previous => [...previous.filter(item => item.id !== pendingId && item.id !== saved.id), saved]);
      fetchConversations();
      setReplyingTo(null);
    } catch (err: any) {
      setMessages(previous => previous.map(item => item.id === pendingId ? { ...item, pending: false, failed: true } : item));
      showToast?.({ type: 'error', title: 'Message not sent', message: err?.message || 'Tap retry to send again.' });
      throw err;
    }
  };

  const reactToMessage = async (message: Message, reaction: string) => {
    if (!token) return;
    try {
      const result = await apiPut<any>(`/api/messages/message/${message.id}/reaction`, { reaction }, token);
      const updated = normalizeMessage(result.data ?? result);
      setMessages(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Reaction failed', message: err?.message || 'Please try again.' }); }
  };

  const toggleMessagePin = async (message: Message) => {
    if (!token) return;
    try {
      const result = await apiPut<any>(`/api/messages/message/${message.id}/pin`, { pinned: !message.pinnedAt }, token);
      const updated = normalizeMessage(result.data ?? result);
      setMessages(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Pin failed', message: err?.message || 'Please try again.' }); }
  };

  const toggleMute = async () => {
    if (!token || !activeConv) return;
    try {
      await apiPut(`/api/messages/${activeConv.id}/mute`, { muted: !activeConv.muted }, token);
      setConversations(previous => previous.map(item => item.id === activeConv.id ? { ...item, muted: !item.muted } : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Mute failed', message: err?.message || 'Please try again.' }); }
  };

  const searchWithinChat = async () => {
    if (!token || !activeConversation) return;
    const query = messageSearchQuery.trim();
    if (!query) return;
    setSearchingMessages(true);
    try {
      const result = await apiGet<any>(`/api/messages/${activeConversation}/search?query=${encodeURIComponent(query.trim())}`, token);
      setMessageSearchResults((Array.isArray(result) ? result : result?.data ?? []).map((item: any) => normalizeMessageRecord(item, user?.id)));
    } catch { setMessageSearchResults([]); }
    finally { setSearchingMessages(false); }
  };

  const blockActiveUser = async () => {
    if (!token || !activeConv?.partnerId || !window.confirm(`Block ${activeConv.name}? You will no longer receive chats from this account.`)) return;
    try {
      await apiPost('/api/settings/blocked', { targetId: activeConv.partnerId }, token);
      showToast?.({ type: 'success', title: 'Account blocked', message: `${activeConv.name} has been blocked.` });
    } catch (err: any) { showToast?.({ type: 'error', title: 'Block failed', message: err?.message || 'Please try again.' }); }
  };

  const reportActiveConversation = async () => {
    if (!token || !activeConv) return;
    const description = window.prompt(`Tell us what is wrong with this ${activeConv.type === 'direct' ? 'account' : activeConv.type}.`);
    if (!description?.trim()) return;
    try {
      await apiPost('/api/compliance/reports', { targetType: activeConv.type === 'direct' ? 'USER' : activeConv.type.toUpperCase(), targetId: activeConv.partnerId || activeConv.id, targetUserId: activeConv.partnerId, category: 'OTHER', description: description.trim() }, token);
      showToast?.({ type: 'success', title: 'Report received', message: 'VANTA will review this report.' });
    } catch (err: any) { showToast?.({ type: 'error', title: 'Report failed', message: err?.message || 'Please try again.' }); }
  };

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showToast?.({ type: 'error', title: 'Unsupported attachment', message: 'Choose a supported image or video.' });
      return;
    }
    const limit = file.type.startsWith('video/') ? 100 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > limit) {
      showToast?.({ type: 'error', title: 'File too large', message: `${file.type.startsWith('video/') ? 'Videos' : 'Images'} must be ${limit / 1024 / 1024} MB or smaller.` });
      return;
    }
    setAttachmentDraft(previous => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file), fileType: file.type.startsWith('image/') ? 'IMAGE' : 'VIDEO', progress: 0, status: 'ready' };
    });
  };

  const cancelAttachment = () => {
    uploadAbortRef.current?.abort();
    setAttachmentDraft(previous => { if (previous) URL.revokeObjectURL(previous.previewUrl); return null; });
    setIsUploadingAttachment(false);
  };

  const uploadAndSendAttachment = async () => {
    if (!attachmentDraft || !token || !activeConversation) return;
    setIsUploadingAttachment(true);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setAttachmentDraft(previous => previous ? { ...previous, status: 'uploading', progress: 0, error: undefined } : previous);
    try {
      const form = new FormData();
      form.append('file', attachmentDraft.file);
      form.append('conversationId', activeConversation);
      const uploaded = await apiUpload<any>('/api/upload/message', form, token, 'POST', progress => setAttachmentDraft(previous => previous ? { ...previous, progress } : previous), controller.signal);
      const url = uploaded.url ?? uploaded.data?.url;
      const fileId = uploaded.fileId ?? uploaded.id ?? uploaded.data?.fileId;
      if (!url || !fileId) throw new Error('Upload did not return a usable attachment');
      setAttachmentDraft(previous => previous ? { ...previous, status: 'sending', progress: 100 } : previous);
      await sendCurrentMessage(messageInput.trim(), [{ fileId, url, fileType: attachmentDraft.fileType, fileName: attachmentDraft.file.name, fileSize: attachmentDraft.file.size }]);
      setAttachmentDraft(previous => { if (previous) URL.revokeObjectURL(previous.previewUrl); return null; });
    } catch (err: any) {
      if (err?.statusCode !== 499) setAttachmentDraft(previous => previous ? { ...previous, status: 'failed', error: err?.message || 'Upload failed. Please try again.' } : previous);
    } finally {
      uploadAbortRef.current = null;
      setIsUploadingAttachment(false);
    }
  };

  const sendComposer = () => {
    if (!activeConversation || (!messageInput.trim() && !attachmentDraft)) return;
    if (attachmentDraft) {
      if (editingMessage) return;
      void uploadAndSendAttachment();
    } else {
      if (editingMessage) { void saveEditedMessage(); return; }
      void sendCurrentMessage();
    }
  };

  const editExistingMessage = (message: Message) => {
    if (!token || !message.isOwn || message.deletedAt) return;
    setEditingMessage(message); setMessageInput(message.text); setMessageContextId(null);
  };

  const saveEditedMessage = async () => {
    if (!token || !editingMessage) return;
    const content = messageInput.trim();
    if (!content || content === editingMessage.text) { setEditingMessage(null); setMessageInput(''); return; }
    try {
      const result = await apiPut<any>(`/api/messages/message/${editingMessage.id}`, { content }, token);
      const updated = normalizeMessage(result.data ?? result);
      setMessages(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Edit failed', message: err?.message || 'Could not edit this message.' }); }
    finally { setEditingMessage(null); setMessageInput(''); }
  };

  const deleteExistingMessage = async (message: Message) => {
    if (!token || (!message.isOwn && activeConv?.type === 'direct') || !window.confirm('Delete this message for everyone?')) return;
    try {
      const result = await apiDelete<any>(`/api/messages/message/${message.id}?forEveryone=true`, token);
      const deleted = normalizeMessage(result.data ?? result);
      setMessages(previous => previous.map(item => item.id === deleted.id ? deleted : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Delete failed', message: err?.message || 'Could not delete this message.' }); }
    finally { setMessageContextId(null); }
  };

  const startMessageLongPress = (message: Message, event?: React.PointerEvent) => {
    if (message.pending) return;
    if (event) {
      swipeStartRef.current = { id: message.id, x: event.clientX, y: event.clientY, offset: 0 };
      try { (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
    }
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      swipeStartRef.current = null;
      setMessageContextId(message.id);
      if ('vibrate' in navigator) navigator.vibrate(18);
    }, 420);
  };

  const cancelMessageLongPress = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const forwardMessage = async (message: Message) => {
    const text = message.text || 'Shared from VANTA';
    try {
      if (navigator.share) await navigator.share({ title: 'VANTA message', text });
      else {
        await navigator.clipboard.writeText(text);
        showToast?.({ type: 'success', title: 'Message ready to forward', message: 'The message was copied to your clipboard.' });
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') showToast?.({ type: 'error', title: 'Could not forward message', message: error?.message || 'Please try again.' });
    } finally { setMessageContextId(null); }
  };

  const resetCreateModal = () => {
    setCreateModalOpen(false);
    setCreateType(null);
    setCreateName('');
    setCreateDescription('');
    setCreateHandle('');
    setCreateVisibility('PUBLIC');
    setCreateAvatar(null);
    setMemberSearch('');
    setMemberSearchResults([]);
    setSelectedMembers([]);
  };

  const handleOpenCreateModal = (type: 'group' | 'channel') => {
    setCreateType(type);
    setCreateModalOpen(true);
    setSelectedMembers(
      user?.id
        ? [{
            id: user.id,
            username: user.username ?? user.fullName ?? 'You',
            avatar: user.avatar ?? undefined,
            fullName: user.fullName ?? user.username ?? 'You',
          }]
        : []
    );
  };

  const handleSearchMembers = useCallback(async (query: string) => {
    setMemberSearch(query);
    if (!query.trim() || !token) {
      setMemberSearchResults([]);
      return;
    }

    try {
      const result = await apiGet<any>(`/api/search?q=${encodeURIComponent(query)}&type=users`, token);
      const hits = Array.isArray(result) ? result : result?.results?.users ?? result?.data?.users ?? result?.users ?? [];
      setMemberSearchResults(
        hits.filter((item: any) => item.id !== user?.id && !selectedMembers.some((member) => member.id === item.id))
      );
    } catch {
      setMemberSearchResults([]);
    }
  }, [token, user?.id, selectedMembers]);

  const handleUploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !token) return;

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const uploadResult = await apiUpload<{ url: string }>('/api/upload/avatar', formData, token);
      setCreateAvatar(uploadResult.url);
      showToast?.({ type: 'success', title: 'Avatar ready', message: 'Your avatar is attached to the new conversation.' });
    } catch {
      showToast?.({ type: 'error', title: 'Upload failed', message: 'The avatar could not be uploaded right now.' });
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleCreateEntity = async () => {
    if (!token || !createType || !createName.trim()) {
      showToast?.({ type: 'error', title: 'Missing details', message: 'Please provide a name for your new conversation.' });
      return;
    }

    setIsCreatingEntity(true);
    try {
      const endpoint = createType === 'group' ? '/api/groups' : '/api/channels';
      const payload = {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        avatar: createAvatar || undefined,
        memberIds: selectedMembers.map((member) => member.id),
        ...(createType === 'channel' ? { handle: createHandle.trim().replace(/^@/, '') || undefined, visibility: createVisibility } : {}),
      };

      const created = await apiPost<any>(endpoint, payload, token);
      const newConversation = {
        id: created.conversationId ?? created.id ?? created.conversation?.id,
        type: createType,
        name: created.name ?? createName.trim(),
        avatar: created.avatar ?? createAvatar ?? undefined,
        unread: 0,
        online: false,
      };

      setConversations(prev => [newConversation, ...prev]);
      handleSelectConversation(newConversation.id);
      resetCreateModal();
      showToast?.({
        type: 'success',
        title: createType === 'group' ? 'Group created' : 'Channel created',
        message: `${createName.trim()} is now ready for conversation.`,
      });
    } catch (error: any) {
      showToast?.({
        type: 'error',
        title: 'Create failed',
        message: error?.message || 'The new conversation could not be created.',
      });
    } finally {
      setIsCreatingEntity(false);
    }
  };

  const handleNewGroup = () => handleOpenCreateModal('group');

  const handleNewChannel = () => handleOpenCreateModal('channel');

  const handleNewChatSearch = async (value: string) => {
    setNewChatSearch(value);
    if (!token || value.trim().length < 2) { setNewChatResults([]); return; }
    if (newChatSearchTimerRef.current) clearTimeout(newChatSearchTimerRef.current);
    newChatSearchTimerRef.current = setTimeout(async () => {
      try { const result = await apiGet<any>(`/api/search?q=${encodeURIComponent(value.trim())}&type=users`, token); setNewChatResults((result?.results?.users ?? result?.data?.users ?? result?.users ?? (Array.isArray(result) ? result : [])).filter((item: any) => item.id !== user?.id)); } catch { setNewChatResults([]); }
    }, 300);
  };
  const handleNewChat = async (person: any) => {
    if (!token) return;
    try { const result = await apiPost<any>('/api/messages/start', { participantIds: [person.id] }, token); const id = result.conversation?.id ?? result.id; await fetchConversations(); setNewChatSearch(''); setNewChatResults([]); handleSelectConversation(id); } catch (err: any) { showToast?.({ type: 'error', title: 'Could not start chat', message: err?.message || 'Please try again.' }); }
  };

  const filteredConversations = conversations.filter(conv => {
    const matchesFilter = filter === 'all' || (filter === 'unread' ? conv.unread > 0 : conv.type === filter);
    const query = debouncedSearch.toLowerCase();
    return matchesFilter && (!query || conv.name.toLowerCase().includes(query) || conv.username?.toLowerCase().includes(query) || conv.lastMessage?.text.toLowerCase().includes(query));
  });

  const activeConv = conversations.find(c => c.id === activeConversation);
  const canPublish = activeConv?.type !== 'channel' || ['OWNER', 'ADMIN', 'MODERATOR'].includes(activeConv.currentRole || '');

  // Private 1-to-1 voice/video calling (WebRTC + Socket.IO signaling). The call
  // session itself is owned by the global CallProvider so incoming calls and
  // the in-call UI work on every page. This page only tells the provider which
  // conversation is open so outgoing calls know their target.
  const { chatCalls, setCallTarget } = useCalls();

  useEffect(() => {
    setCallTarget({
      activeConversationId: activeConversation,
      isDirect: activeConv?.type === 'direct',
      peerPartnerId: activeConv?.partnerId,
      peerName: activeConv?.name,
      peerAvatar: activeConv?.avatar,
    });
  }, [activeConversation, activeConv, setCallTarget]);
  const canEditEntity = activeConv?.type === 'group'
    ? activeConv.currentRole === 'ADMIN' || activeConv.currentRole === 'OWNER'
    : activeConv?.type === 'channel' && ['OWNER', 'ADMIN', 'MODERATOR'].includes(activeConv.currentRole || '');
  const isManagedOwner = Boolean(managedEntity?.ownerId && managedEntity.ownerId === user?.id);
  const managedPermissions = activeConv?.type === 'channel'
    ? [
        ['postMessages', 'Post messages'], ['editMessages', 'Edit messages'], ['deleteMessages', 'Delete messages'],
        ['manageChannelInfo', 'Manage channel info'], ['manageSubscribers', 'Manage subscribers'], ['manageInviteLinks', 'Manage invite links'],
      ]
    : [
        ['sendMessages', 'Send messages'], ['sendMedia', 'Send media'], ['sendLinks', 'Send links'],
        ['addMembers', 'Add members'], ['pinMessages', 'Pin messages'], ['changeGroupInfo', 'Change group info'],
      ];
  const sharedAttachments = messages.flatMap(message => (message.attachments || []).map(attachment => ({ ...attachment, messageId: message.id })));

  const toggleMemberSelection = (member: any) => {
    setSelectedMembers(prev =>
      prev.some((item) => item.id === member.id)
        ? prev.filter((item) => item.id !== member.id)
        : [...prev, member]
    );
  };

  const openEntityEditor = async () => {
    if (!token || !activeConv || !canEditEntity || activeConv.type === 'direct') return;
    try {
      const entityId = activeConv.entityId || activeConv.id;
      const entity = await apiGet<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${entityId}`, token);
      setEditEntityId(entity.id || entityId);
      setEditName(entity.name || activeConv.name);
      setEditDescription(entity.description || '');
      setEditAvatar(entity.avatar || activeConv.avatar || null);
      setEditVisibility(entity.visibility || 'PUBLIC');
      setEditHandle(entity.handle || '');
      setManagedEntity(entity);
      setManagementSearch('');
      setManagementResults([]);
      setEditEntityOpen(true);
      pushChatView('settings');
    } catch (err: any) { showToast?.({ type: 'error', title: `Could not open ${activeConv.type} settings`, message: err?.message || 'Please try again.' }); }
  };

  const uploadEntityAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !token || !activeConv || !editEntityId) return;
    setIsUploadingAvatar(true);
    try {
      const form = new FormData(); form.append('avatar', file);
      const uploaded = await apiUpload<any>(`/api/upload/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}/avatar`, form, token);
      setEditAvatar(uploaded.url ?? uploaded.data?.url);
    } catch (err: any) { showToast?.({ type: 'error', title: 'Photo upload failed', message: err?.message || 'Please choose another image.' }); }
    finally { setIsUploadingAvatar(false); }
  };

  const saveEntityChanges = async () => {
    if (!token || !activeConv || !editEntityId || !editName.trim()) return;
    setIsSavingEntity(true);
    try {
      const updated = await apiPut<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}`, { name: editName.trim(), description: editDescription.trim(), avatar: editAvatar, permissions: managedEntity?.permissions || {}, ...(activeConv.type === 'channel' ? { visibility: editVisibility, handle: editHandle.trim().replace(/^@/, '') } : {}) }, token);
      setConversations(previous => previous.map(item => item.id === activeConv.id ? { ...item, name: updated.name || editName.trim(), description: updated.description ?? editDescription.trim(), avatar: updated.avatar ?? editAvatar ?? undefined } : item));
      setManagedEntity(updated);
      setEditEntityOpen(false);
      showToast?.({ type: 'success', title: `${activeConv.type === 'group' ? 'Group' : 'Channel'} updated`, message: 'Changes are visible throughout Chat.' });
    } catch (err: any) { showToast?.({ type: 'error', title: 'Changes not saved', message: err?.message || 'Please try again.' }); }
    finally { setIsSavingEntity(false); }
  };

  const searchManagementUsers = async (value: string) => {
    setManagementSearch(value);
    if (!token || value.trim().length < 2) { setManagementResults([]); return; }
    try {
      const result = await apiGet<any>(`/api/search?q=${encodeURIComponent(value.trim())}&type=users`, token);
      const users = result?.results?.users ?? result?.data?.users ?? result?.users ?? (Array.isArray(result) ? result : []);
      const memberIds = new Set((managedEntity?.members || []).map((member: any) => member.userId));
      setManagementResults(users.filter((person: any) => person.id !== user?.id && !memberIds.has(person.id)));
    } catch { setManagementResults([]); }
  };

  const updateManagedMembers = async (memberIds: string[], successMessage: string) => {
    if (!token || !activeConv || !editEntityId) return;
    setManagementBusy('members');
    try {
      const updated = await apiPut<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}`, { memberIds }, token);
      setManagedEntity(updated);
      setConversations(previous => previous.map(item => item.id === activeConv.id ? { ...item, memberCount: updated._count?.members ?? updated.members?.length ?? item.memberCount } : item));
      setManagementSearch(''); setManagementResults([]);
      showToast?.({ type: 'success', title: successMessage, message: 'Membership has been updated.' });
    } catch (err: any) { showToast?.({ type: 'error', title: 'Membership not changed', message: err?.message || 'Please try again.' }); }
    finally { setManagementBusy(null); }
  };

  const addManagedMember = (person: any) => updateManagedMembers([...(managedEntity?.members || []).map((member: any) => member.userId), person.id], `${person.username || 'Member'} added`);

  const removeManagedMember = (member: any) => {
    const username = member.user?.username || 'this member';
    if (!window.confirm(`Remove ${username} from this ${activeConv?.type}?`)) return;
    void updateManagedMembers((managedEntity?.members || []).filter((item: any) => item.userId !== member.userId).map((item: any) => item.userId), `${username} removed`);
  };

  const changeManagedRole = async (member: any, role: string) => {
    if (!token || !activeConv || !editEntityId) return;
    const action = role === 'MEMBER' ? 'remove administrator rights from' : 'promote';
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} @${member.user?.username || 'member'}?`)) return;
    setManagementBusy(member.userId);
    try {
      const updated = await apiPut<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}`, { memberRoles: { [member.userId]: role } }, token);
      setManagedEntity(updated);
      showToast?.({ type: 'success', title: 'Administrator access updated', message: 'The new role is active.' });
    } catch (err: any) { showToast?.({ type: 'error', title: 'Role not changed', message: err?.message || 'Please try again.' }); }
    finally { setManagementBusy(null); }
  };

  const toggleManagedPermission = (key: string) => setManagedEntity((previous: any) => ({ ...previous, permissions: { ...(previous?.permissions || {}), [key]: !(previous?.permissions?.[key] ?? true) } }));

  if (loading) {
    return (
      <div className="grid h-[var(--chat-viewport-height,100dvh)] w-screen grid-cols-1 overflow-hidden bg-[#050505] md:grid-cols-[minmax(300px,360px)_1fr]">
        <div className="border-r border-white/[0.08] bg-[#0d0d0f] p-4"><div className="h-8 w-24 animate-pulse bg-white/[0.08]" /><div className="mt-5 h-10 animate-pulse bg-white/[0.05]" />{[1,2,3,4,5].map(item => <div key={item} className="mt-4 flex gap-3"><div className="h-11 w-11 animate-pulse rounded-full bg-white/[0.06]"/><div className="flex-1"><div className="h-3 w-2/3 animate-pulse bg-white/[0.06]"/><div className="mt-2 h-3 animate-pulse bg-white/[0.04]"/></div></div>)}</div>
        <div className="hidden place-items-center md:grid"><Loader2 size={22} className="animate-spin text-white/30" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[var(--chat-viewport-height,100dvh)] w-screen flex-col items-center justify-center overflow-hidden bg-[#050505] px-5 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <Loader2 size={24} className="text-red-400" />
        </div>
        <h3 className="text-white/70 font-medium text-lg mb-1">Couldn&apos;t load your chats.</h3>
        <p className="text-white/30 text-sm mb-4">{error}</p>
        <button onClick={fetchConversations} className="btn-primary text-sm">Try Again</button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        'chat-screen relative flex h-[var(--chat-viewport-height,100dvh)] min-h-0 w-screen max-w-none overflow-hidden overscroll-none bg-[#050505]',
        showMobileList
          ? 'h-[100dvh]'
          : 'top-[var(--chat-viewport-offset,0px)] h-[var(--chat-viewport-height,100dvh)]'
      )}
    >
      {/* Conversation List */}
      <div className={cn(
        'flex h-full w-full shrink-0 flex-col border-r border-white/[0.08] bg-[#0d0d0f] md:w-[360px] md:max-w-[38vw]',
        !showMobileList && 'hidden md:flex'
      )}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg border border-white/[0.12] bg-[#161616] flex items-center justify-center">
              <MessageCircle size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">CHAT</h1>
          </div>
          <MessagesCreateButton
            search={newChatSearch}
            results={newChatResults}
            onSearch={handleNewChatSearch}
            onSelectUser={handleNewChat}
            onNewGroup={handleNewGroup}
            onNewChannel={handleNewChannel}
          />
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-white/[0.08] bg-[#161616] py-2.5 pl-9 pr-4 text-xs text-white placeholder-gray-500 outline-none focus:border-white/[0.2] transition-all"
            />
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Chat filters">
            {(['all','direct','group','channel','unread'] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={cn('whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[10px] capitalize transition', filter === value ? 'border-[#d6a83f]/50 bg-[#d6a83f]/15 text-[#f2c75c]' : 'border-transparent bg-white/[0.04] text-white/50 hover:bg-white/[0.08]')}>{value === 'group' ? 'Groups' : value === 'channel' ? 'Channels' : value}</button>)}
          </div>
          <p className="mt-4 text-[9px] font-semibold uppercase tracking-[.18em] text-white/30">Chat list</p>
        </div>

        {/* Conversation List */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide [-webkit-overflow-scrolling:touch]">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageCircle size={28} className="text-white/10 mb-3" />
              <p className="text-sm text-white/70">Your conversations start here.</p>
              <p className="text-xs text-white/35 mt-1">Connect with people and creators on VANTA.</p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 transition-all text-left',
                  activeConversation === conv.id
                    ? 'bg-[#d6a83f]/[0.07] border-l-2 border-[#d6a83f]'
                    : 'hover:bg-white/[0.02] border-l-2 border-transparent'
                )}
              >
                <div className="relative shrink-0">
                  <Avatar src={conv.avatar} alt={conv.name} size="md" />
                  {conv.type === 'direct' && conv.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0a0f]" />
                  )}
                  {conv.type !== 'direct' && <span className="absolute -top-1 -right-1 rounded-full border border-white/10 bg-[#161616] p-1 text-white/50">{conv.type === 'channel' ? <Hash size={8} /> : <Users size={8} />}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1 text-sm font-semibold text-white truncate">{conv.name}{conv.verified && <VerificationBadge verified size="xs" className="shrink-0" />}</p>
                    {conv.lastMessage && (
                      <span className="text-[10px] text-gray-500 shrink-0 ml-2">
                        {new Date(conv.lastMessage.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {typingByConversation[conv.id] && conv.type !== 'channel' ? (
                      <p className="text-xs italic text-white/60 truncate flex-1">typing…</p>
                    ) : (
                      <>
                        {(conv.type === 'group' || conv.type === 'channel') && (
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {conv.type === 'group'
                              ? `${conv.memberCount || 0} members${conv.onlineMemberCount ? ` · ${conv.onlineMemberCount} online` : ''}`
                              : `${conv.memberCount || 1} subscribers`}
                          </span>
                        )}
                        {conv.lastMessage ? (
                          <p className="text-xs text-gray-500 truncate flex-1">
                            {conv.lastMessage.read ? (
                              <CheckCheck size={10} className="inline mr-1 text-white/70" />
                            ) : (
                              <Check size={10} className="inline mr-1 text-gray-500" />
                            )}
                            {conv.lastMessage.text}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 truncate flex-1">{conv.type === 'group' ? 'Group created' : conv.type === 'channel' ? 'Channel created' : 'No chats yet'}</p>
                        )}
                      </>
                    )}
                    {conv.muted && <BellOff size={11} className="shrink-0 text-white/30" />}
                    {conv.unread > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-[#d6a83f] text-[9px] font-bold text-black flex items-center justify-center px-1">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
          {conversationCursor && <div className="flex justify-center py-3"><button onClick={loadMoreConversations} className="rounded-full bg-white/[0.04] px-3 py-1 text-[10px] text-white/40">Load more</button></div>}
        </div>
      </div>

      {/* Chat Window */}
      <div className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#050505]',
        showMobileList && 'hidden md:flex'
      )}>
        {activeConversation && activeConv ? (
          <>
            {/* Chat Header */}
             <header className="relative z-20 flex min-h-[68px] shrink-0 items-center justify-between border-b border-[#d6a83f]/10 bg-[#0d0d0f]/95 px-3 pb-1 pt-[max(4px,env(safe-area-inset-top))] shadow-[0_10px_30px_rgba(0,0,0,.35)] backdrop-blur-xl">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={handleCloseConversation}
                   className="grid h-10 w-10 place-items-center text-[#c8c8cc] hover:text-white"
                >
                  <ArrowLeft size={18} />
                </button>
                <button onClick={openConversationInfo} className="flex min-w-0 items-center gap-3 text-left" aria-label={`Open ${activeConv.name} information`}>
                 <span className="rounded-full border border-[#d6a83f]/20 p-0.5"><Avatar src={activeConv.avatar} alt={activeConv.name} size="sm" /></span>
                <div className="min-w-0">
                   <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-[#f5f5f5]">{activeConv.name}{activeConv.verified && <VerificationBadge verified size="sm" className="shrink-0" />}</p>
                  <p className="truncate text-[10px] text-white/40">
                    {activeConv.type === 'channel' ? `${activeConv.memberCount || 1} subscribers · broadcast` : activeConv.type === 'group' ? (typingUserId ? `${activeConv.participants?.find((p: any) => p.id === typingUserId)?.fullName || 'Someone'} is typing…` : `${activeConv.memberCount || 1} members${activeConv.onlineMemberCount ? ` · ${activeConv.onlineMemberCount} online` : ''}`) : typingUserId ? 'Typing…' : activeConv.online ? 'Online' : activeConv.lastSeen ? `Last seen ${new Date(activeConv.lastSeen).toLocaleString()}` : 'Offline'}
                  </p>
                </div></button>
              </div>
              <div className="flex items-center gap-1">
                {activeConv.type === 'direct' && (
                  <>
                    <button
                      onClick={() => void chatCalls.startCall('voice')}
                      disabled={chatCalls.status !== 'idle'}
                      className="btn-icon w-8 h-8"
                      aria-label="Start a voice call"
                      title="Start a voice call"
                    >
                      <Phone size={15} />
                    </button>
                    <button
                      onClick={() => void chatCalls.startCall('video')}
                      disabled={chatCalls.status !== 'idle'}
                      className="btn-icon w-8 h-8"
                      aria-label="Start a video call"
                      title="Start a video call"
                    >
                      <Video size={15} />
                    </button>
                  </>
                )}
                <button onClick={() => setMessageSearchOpen(value => !value)} className="btn-icon w-8 h-8" aria-label="Search chat"><Search size={15} /></button>
                 <button onClick={openConversationInfo} className="btn-icon w-9 h-9" aria-label="Conversation information"><MoreVertical size={17} /></button>
              </div>
            </header>

            {messageSearchOpen && <div className="border-b border-white/[0.08] bg-[#101010] px-4 py-2"><form onSubmit={event => { event.preventDefault(); void searchWithinChat(); }} className="flex items-center gap-2"><Search size={14} className="shrink-0 text-white/35" /><input autoFocus value={messageSearchQuery} onChange={event => setMessageSearchQuery(event.target.value)} placeholder="Search this chat" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30" /><button type="submit" disabled={!messageSearchQuery.trim() || searchingMessages} className="text-[11px] font-medium text-white disabled:text-white/25">Search</button><button type="button" onClick={() => { setMessageSearchOpen(false); setMessageSearchQuery(''); setMessageSearchResults([]); }} aria-label="Close chat search" className="text-white/40"><X size={14}/></button></form></div>}

            {(searchingMessages || messageSearchResults.length > 0) && <div className="border-b border-white/[0.08] bg-[#101010] px-4 py-2"><div className="flex items-center justify-between"><span className="text-[10px] text-white/40">{searchingMessages ? 'Searching chat...' : `${messageSearchResults.length} result${messageSearchResults.length === 1 ? '' : 's'}`}</span><button onClick={() => setMessageSearchResults([])} className="text-white/40" aria-label="Close search results"><X size={13}/></button></div>{messageSearchResults.slice(0, 5).map(result => <button key={result.id} onClick={() => document.getElementById(`message-${result.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="mt-1 block w-full truncate rounded bg-white/[0.03] px-2 py-1 text-left text-[10px] text-white/60">@{result.sender.username}: {result.text}</button>)}</div>}

            {/* Messages */}
            <div ref={messagesViewportRef} className="relative min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto scrollbar-hide space-y-3 bg-[#050505] px-3 py-4 pb-6 [overflow-anchor:none] [-webkit-overflow-scrolling:touch]">
              {messageCursor && <div className="flex justify-center"><button onClick={loadOlderMessages} disabled={loadingOlder} className="rounded-full bg-white/[0.05] px-3 py-1 text-[10px] text-white/50 disabled:opacity-50">{loadingOlder ? 'Loading…' : 'Load older messages'}</button></div>}
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <MessageCircle size={32} className="text-white/10 mb-3" />
                  <p className="text-sm text-white/50">{activeConv.type === 'channel' ? 'No posts yet' : 'No chats yet'}</p>
                  <p className="text-xs text-white/20 mt-1">{activeConv.type === 'channel' ? 'Channel posts will appear here.' : 'Be the first to start the conversation.'}</p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const currentDate = new Date(msg.timestamp);
                  const previousDate = index > 0 ? new Date(messages[index - 1].timestamp) : null;
                  const showDate = !previousDate || currentDate.toDateString() !== previousDate.toDateString();
                  const dateLabel = currentDate.toDateString() === new Date().toDateString() ? 'Today' : currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                  const senderRole = activeConv.participants?.find((participant: any) => participant.id === msg.sender.id)?.role;
                  const hasImageAttachment = (msg.attachments || []).some(attachment => attachment.fileType === 'IMAGE');
                  const isMediaOnly = hasImageAttachment && !msg.replyTo && !visibleMessageText(msg).trim();
                  return <div key={msg.id}>{showDate && <div className="my-5 flex justify-center"><span className="rounded-full border border-white/[0.06] bg-[#0d0d0f] px-3 py-1 text-[9px] text-white/35">{dateLabel}</span></div>}{msg.id === firstUnreadId && <div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-[#d6a83f]/25"/><span className="rounded-full border border-[#d6a83f]/30 bg-[#d6a83f]/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-[.14em] text-[#f2c75c]">New messages</span><span className="h-px flex-1 bg-[#d6a83f]/25"/></div>}
                  <div
                    id={`message-${msg.id}`}
                    className={cn('flex relative scroll-mt-24 transition-shadow touch-pan-y will-change-transform', msg.isOwn ? 'justify-end' : 'justify-start')}
                    style={swipeOffset?.id === msg.id ? { transform: `translateX(${swipeOffset.offset}px)` } : undefined}
                    onPointerDown={event => startMessageLongPress(msg, event)}
                    onPointerUp={() => { cancelMessageLongPress(); finishMessageSwipe(); }}
                    onPointerCancel={() => { cancelMessageLongPress(); finishMessageSwipe(); }}
                    onPointerMove={event => { cancelMessageLongPress(); trackMessageSwipe(event, msg); }}
                    onContextMenu={event => { if (!msg.pending) { event.preventDefault(); setMessageContextId(msg.id); } }}
                  >
                    <div className="max-w-[82%]">
                      {!msg.isOwn && (
                        <div className="flex items-center gap-2 mb-1 ml-1">
                          <span className="text-[11px] font-medium text-[#c8c8cc]">{msg.sender.fullName || msg.sender.username}</span>
                          {['OWNER', 'ADMIN', 'MODERATOR'].includes(senderRole || '') && <span className="text-[8px] font-bold uppercase text-[#d6a83f]">{senderRole === 'OWNER' ? 'Owner' : senderRole === 'MODERATOR' ? 'Moderator' : 'Admin'}</span>}
                        </div>
                      )}
                      <div className={cn(
                        cn(
                          'border text-[14px] leading-[1.45] shadow-[0_8px_24px_rgba(0,0,0,.22)] select-none',
                          isMediaOnly ? 'w-fit max-w-full overflow-hidden p-0' : 'px-3.5 py-2.5'
                        ),
                        msg.isOwn
                           ? 'rounded-[15px] rounded-br-[4px] border-[#d6a83f]/15 bg-[#202023] text-[#f5f5f5]'
                           : 'rounded-[15px] rounded-bl-[4px] border-white/[0.08] bg-[#151517] text-[#f5f5f5]'
                      )}>
                        {msg.deletedAt ? <span className="italic opacity-60">Message deleted</span> : msg.type === 'CALL' ? (
                          <span className="flex items-center justify-center gap-1.5 whitespace-nowrap py-0.5 text-xs text-white/50">
                            <Phone size={12} className="text-[#d6a83f]" />
                            {msg.text || msg.content}
                          </span>
                        ) : (
                          <>
                          {msg.replyTo && <button className="mb-2 block w-full rounded-md border-l-2 border-[#d6a83f] bg-black/25 px-2.5 py-2 text-left text-[10px] text-white/55" onClick={() => { const original = document.getElementById(`message-${msg.replyTo.id}`); original?.scrollIntoView({ behavior: 'smooth', block: 'center' }); original?.classList.add('ring-1', 'ring-[#d6a83f]/70'); window.setTimeout(() => original?.classList.remove('ring-1', 'ring-[#d6a83f]/70'), 1200); }}><strong className="mb-0.5 block text-[#f2c75c]">{msg.replyTo.sender?.fullName || `@${msg.replyTo.sender?.username || 'user'}`}</strong><span className="line-clamp-2">{msg.replyTo.content || msg.replyTo.text || 'Attachment'}</span></button>}
                          {msg.attachments?.map((attachment, index) => attachment.fileType === 'IMAGE'
                            ? <button key={attachment.id || index} type="button" onClick={() => openMediaViewer(attachment)} className="block max-w-full overflow-hidden rounded-[15px] bg-transparent text-left" aria-label={`Open ${attachment.fileName || 'image'} in media viewer`}><img
                              src={attachment.url}
                              alt={attachment.fileName || 'Image attachment'}
                              loading="lazy"
                              className="block max-h-[440px] w-auto max-w-full rounded-[15px] object-contain"
                            /></button>
                            : attachment.fileType === 'VIDEO' ? <button key={attachment.id || index} type="button" onClick={() => openMediaViewer(attachment)} className="mb-2 block max-w-full overflow-hidden rounded-[15px] bg-black text-left" aria-label={`Open ${attachment.fileName || 'video'} in media viewer`}><video src={attachment.url} muted playsInline preload="metadata" className="max-h-72 max-w-full" /></button>
                            : attachment.fileType === 'AUDIO' ? <div key={attachment.id || index} className="mb-1.5 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5"><VoiceNotePlayer src={attachment.url} name={attachment.fileName} /></div>
                            : <a key={attachment.id || index} href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 block underline">{attachment.fileName || 'Download attachment'}</a>)}
                          {visibleMessageText(msg)}{msg.editedAt && <span className="ml-1 text-[9px] opacity-60">edited</span>}
                        </>)}
                      </div>
                      <div className={cn('flex items-center gap-1 mt-0.5', msg.isOwn ? 'justify-end mr-1' : 'justify-start ml-1')}>
                        <span className="text-[9px] text-gray-500">
                          {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.pinnedAt && <Pin size={9} className="text-white/40" />}
                        {msg.isOwn && (
                          msg.failed ? <button onClick={() => sendCurrentMessage(msg.text, msg.attachments)} className="text-[9px] text-red-400">Failed to send · Retry</button> : msg.pending ? <Loader2 size={10} className="animate-spin text-gray-400" /> : msg.read ? <CheckCheck size={10} className="text-white/70" /> : <Check size={10} className="text-gray-500" />
                        )}
                      </div>
                      {msg.reactions && msg.reactions.length > 0 && <div className={cn('mt-1 flex flex-wrap gap-1', msg.isOwn && 'justify-end')}>{Array.from(new Set(msg.reactions.map(item => item.reaction))).map(reaction => <button key={reaction} onClick={() => reactToMessage(msg, reaction)} className="rounded-full border border-white/10 bg-[#161616] px-2 py-0.5 text-xs">{reaction} {msg.reactions?.filter(item => item.reaction === reaction).length}</button>)}</div>}
                    </div>
                  </div>
                  </div>})
              )}
              <div ref={messagesEndRef} />
              {pendingNewMessage && (
                <div className="sticky bottom-3 z-20 mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      const viewport = messagesViewportRef.current;
                      if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
                      wasNearBottomRef.current = true;
                      setPendingNewMessage(false);
                    }}
                    className="pointer-events-auto rounded-full border border-[#d6a83f]/40 bg-[#161616]/95 px-4 py-2 text-[11px] font-semibold text-[#f2c75c] shadow-lg backdrop-blur-xl transition hover:bg-[#1c1c1c]"
                  >
                    New messages ↓
                  </button>
                </div>
              )}
            </div>

            {/* Message Input */}
            {canPublish ? <div className="relative z-20 shrink-0 border-t border-[#d6a83f]/10 bg-[#0d0d0f]/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(0,0,0,.34)] backdrop-blur-xl">
              {editingMessage && <div className="mb-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70"><span>Editing message</span><button onClick={() => { setEditingMessage(null); setMessageInput(''); }} aria-label="Cancel editing"><X size={14} /></button></div>}
              {replyingTo && <div className="mb-2 flex items-start justify-between border-l-2 border-[#d6a83f] bg-[#151517] px-3 py-2.5 text-xs text-white/60"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => { const original = document.getElementById(`message-${replyingTo.id}`); original?.scrollIntoView({ behavior: 'smooth', block: 'center' }); original?.classList.add('ring-1', 'ring-[#d6a83f]/70'); window.setTimeout(() => original?.classList.remove('ring-1', 'ring-[#d6a83f]/70'), 1200); }}><strong className="block text-[#f2c75c]">Replying to {replyingTo.sender?.fullName || `@${replyingTo.sender?.username || 'user'}`}</strong><span className="mt-1 block truncate text-white/45">{replyingTo.text || replyingTo.content || 'Attachment'}</span></button><button className="grid h-7 w-7 shrink-0 place-items-center text-white/40" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
              {(recordingState === 'recording' || recordingState === 'ready' || recordingState === 'uploading') && (
                <div className="mb-2 flex items-center gap-3 rounded-lg border border-[#d6a83f]/25 bg-[#151517] px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-300">
                    {recordingState === 'recording' ? <Square size={12} /> : recordingState === 'uploading' ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white/80">{recordingState === 'recording' ? 'Recording voice note…' : recordingState === 'uploading' ? 'Uploading voice note…' : 'Voice note ready'}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] tabular-nums text-[#f2c75c]">{formatVoiceTime(recordingDuration)}</span>
                      {recordingState === 'recording' && <span className="flex items-center gap-1 text-[10px] text-red-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> live</span>}
                      {recordingError && <span className="truncate text-[10px] text-red-300">{recordingError}</span>}
                    </div>
                  </div>
                  {recordingState === 'recording' ? (
                    <button onClick={stopRecordingPhase} className="shrink-0 rounded-md bg-[#f5f5f5] px-3 py-2 text-[10px] font-semibold text-black">Stop</button>
                  ) : recordingState === 'ready' ? (
                    <>
                      <button onClick={cancelRecording} className="btn-icon h-8 w-8 text-white/40" aria-label="Discard voice note"><X size={14} /></button>
                      <button onClick={() => void sendVoiceNote()} className="shrink-0 rounded-md bg-[#f5f5f5] px-3 py-2 text-[10px] font-semibold text-black">Send</button>
                    </>
                  ) : (
                    <span className="shrink-0 text-[10px] text-white/40">Sending…</span>
                  )}
                </div>
              )}
              {attachmentDraft && <div className="mb-2 flex items-center gap-3 rounded-lg border border-white/[0.1] bg-[#101010] p-2.5">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-black">{attachmentDraft.fileType === 'IMAGE' ? <img src={attachmentDraft.previewUrl} alt="Attachment preview" className="h-full w-full object-cover"/> : <video src={attachmentDraft.previewUrl} muted preload="metadata" className="h-full w-full object-cover"/>}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{attachmentDraft.file.name}</p><p className={cn('mt-1 text-[10px]', attachmentDraft.status === 'failed' ? 'text-red-300' : 'text-white/40')}>{attachmentDraft.status === 'ready' ? 'Ready to send' : attachmentDraft.status === 'uploading' ? `Uploading... ${attachmentDraft.progress}%` : attachmentDraft.status === 'sending' ? 'Sending...' : attachmentDraft.error || 'Upload failed'}</p>{attachmentDraft.status === 'uploading' && <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/[0.08]"><div className="h-full bg-[#d4af37] transition-[width]" style={{ width: `${attachmentDraft.progress}%` }}/></div>}</div>
                {attachmentDraft.status === 'failed' ? <button onClick={uploadAndSendAttachment} className="btn-icon h-8 w-8" aria-label="Retry upload"><RefreshCw size={14}/></button> : attachmentDraft.status === 'ready' ? <button onClick={uploadAndSendAttachment} className="rounded-md bg-[#f5f5f5] px-3 py-2 text-[10px] font-semibold text-black">Send</button> : null}
                <button onClick={cancelAttachment} className="btn-icon h-8 w-8" aria-label="Cancel attachment"><X size={14}/></button>
              </div>}
              <div className="flex items-center gap-2">
                <input ref={attachmentInputRef} type="file" className="hidden" accept="image/*,video/*" onChange={handleAttachment} />
                <button onClick={() => attachmentInputRef.current?.click()} disabled={isUploadingAttachment || Boolean(attachmentDraft)} className="btn-icon h-11 w-11 shrink-0 disabled:opacity-50" aria-label="Add attachment">{isUploadingAttachment ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={17} />}</button>
                <div className="flex-1 relative">
                  <input
                    ref={messageInputRef}
                    type="text"
                    value={messageInput}
                    onChange={e => {
                      setMessageInput(e.target.value);
                      if (!activeConversation || activeConv?.type === 'channel') return;
                      if (!typingActiveRef.current) {
                        typingActiveRef.current = true;
                        socketRef.current?.emit('typing:start', { conversationId: activeConversation });
                        if (typingRenewRef.current) clearInterval(typingRenewRef.current);
                        typingRenewRef.current = setInterval(() => {
                          if (typingActiveRef.current && activeConversationRef.current) socketRef.current?.emit('typing:start', { conversationId: activeConversationRef.current });
                        }, 2500);
                      }
                      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                      typingTimerRef.current = setTimeout(() => {
                        if (typingActiveRef.current) {
                          typingActiveRef.current = false;
                          socketRef.current?.emit('typing:stop', { conversationId: activeConversationRef.current });
                        }
                        if (typingRenewRef.current) { clearInterval(typingRenewRef.current); typingRenewRef.current = null; }
                      }, 1500);
                    }}
                    disabled={recordingState !== 'idle'}
                    placeholder="Message..."
                    className="h-11 w-full rounded-xl border border-white/[0.09] bg-[#151517] px-4 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-[#d6a83f]/55 focus:shadow-[0_0_0_2px_rgba(214,168,63,.06)]"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (messageInput.trim() || attachmentDraft)) { e.preventDefault(); sendComposer(); }
                    }}
                  />
                </div>
                {messageInput.trim() || attachmentDraft ? (
                  <button
                    onClick={sendComposer}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#d6a83f]/60 bg-[#d6a83f] text-black transition-all hover:bg-[#f2c75c]"
                    aria-label="Send message"
                  >
                    <Send size={16} />
                  </button>
                ) : recordingState === 'idle' ? (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    type="button"
                    onClick={() => void startVoiceRecording()}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#d6a83f]/40 bg-[#d6a83f]/10 text-[#f2c75c] transition-all hover:bg-[#d6a83f]/20"
                    aria-label="Record voice note"
                    title="Record voice note"
                  >
                    <Mic size={16} />
                  </motion.button>
                ) : recordingState === 'uploading' ? (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-[#151517] text-gray-500" aria-label="Uploading voice note"><Loader2 size={16} className="animate-spin" /></span>
                ) : (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    type="button"
                    onClick={stopRecordingPhase}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-400/40 bg-red-500/15 text-red-300 transition-all hover:bg-red-500/25"
                    aria-label="Stop recording"
                    title="Stop recording"
                  >
                    <Square size={14} />
                  </motion.button>
                )}
              </div>
            </div> : <div className="border-t border-white/[0.06] px-4 py-4 text-center text-xs text-white/35">Only channel administrators can publish posts.</div>}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-20 h-20 rounded-lg border border-white/10 bg-[#101010] flex items-center justify-center mb-5">
              <MessageCircle size={36} className="text-white/20" />
            </div>
            <p className="mb-2 text-xs font-semibold tracking-[.2em] text-white/30">VANTA</p>
            <h3 className="text-lg font-bold text-white mb-1">Select a chat</h3>
            <p className="text-sm text-white/30 max-w-sm">
              Choose a conversation or start a new one.
            </p>
          </div>
        )}
      </div>

      {activeConv && detailsOpen && <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="fixed inset-0 z-50 h-[var(--chat-viewport-height,100dvh)] w-full overflow-y-auto overscroll-contain border-l border-white/[0.08] bg-[#0d0d0f] md:left-auto md:right-0 md:w-[min(440px,42vw)]">
        <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/[0.08] bg-[#0d0d0f]/95 px-4 backdrop-blur-xl"><button onClick={() => closeChatSubview(() => setDetailsOpen(false))} className="btn-icon h-9 w-9" aria-label="Close conversation information"><ArrowLeft size={18}/></button><h2 className="text-xs font-semibold text-white">Conversation info</h2><span className="h-9 w-9" aria-hidden="true"/></div>
        <div className="border-b border-white/[0.08] px-5 py-6 text-center"><div className="mx-auto w-fit"><Avatar src={activeConv.avatar} alt={activeConv.name} size="xl" /></div><h3 className="mt-3 text-base font-semibold text-white">{activeConv.name}</h3><p className="mt-1 text-xs text-white/40">{activeConv.type === 'direct' ? `@${activeConv.username || 'user'}` : activeConv.type === 'channel' ? `#${activeConv.handle || activeConv.name.toLowerCase().replace(/\s+/g, '-')}` : `${activeConv.memberCount || activeConv.participants?.length || 1} members`}</p>{activeConv.description && <p className="mt-3 text-xs leading-relaxed text-white/50">{activeConv.description}</p>}</div>
        <div className="border-b border-white/[0.08] p-3">
          {canEditEntity && <button onClick={openEntityEditor} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[#f2c75c] hover:bg-[#d6a83f]/[0.06]"><Pencil size={14}/>Manage {activeConv.type === 'group' ? 'Group' : 'Channel'}<ChevronRight size={13} className="ml-auto"/></button>}
          <button onClick={searchWithinChat} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"><Search size={14}/>Search chat<ChevronRight size={13} className="ml-auto"/></button>
          <button onClick={toggleMute} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"><BellOff size={14}/>{activeConv.muted ? 'Unmute chat' : 'Mute chat'}<ChevronRight size={13} className="ml-auto"/></button>
          {activeConv.type === 'direct' && activeConv.username && <a href={`/profile/${activeConv.username}`} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"><Info size={14}/>View profile<ChevronRight size={13} className="ml-auto"/></a>}
        </div>
        <div className="border-b border-white/[0.08] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-[.14em] text-white/35">Shared</h3><span className="text-[10px] text-white/25">{sharedAttachments.length}</span></div>{sharedAttachments.length === 0 ? <p className="py-4 text-center text-[10px] text-white/25">No shared media or files.</p> : <div className="grid grid-cols-3 gap-1.5">{sharedAttachments.slice(0, 9).map((attachment, index) => attachment.fileType === 'IMAGE' ? <a key={`${attachment.messageId}-${index}`} href={attachment.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded bg-white/[0.04]"><img src={attachment.url} alt={attachment.fileName || 'Shared image'} loading="lazy" className="h-full w-full object-cover"/></a> : <a key={`${attachment.messageId}-${index}`} href={attachment.url} target="_blank" rel="noreferrer" title={attachment.fileName || 'Shared file'} className="flex aspect-square items-center justify-center rounded bg-white/[0.04] text-white/40">{attachment.fileType === 'VIDEO' ? <ImageIcon size={16}/> : <FileText size={16}/>}</a>)}</div>}</div>
        <div className="p-3">{activeConv.type === 'direct' && <button onClick={blockActiveUser} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-red-300/70 hover:bg-red-500/[0.06]"><Ban size={14}/>Block user</button>}{activeConv.type !== 'direct' && <button onClick={() => setLeaveDialog(true)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-red-300/70 hover:bg-red-500/[0.06]"><UserMinus size={14}/>Leave {activeConv.type === 'group' ? 'Group' : 'Channel'}</button>}<button onClick={reportActiveConversation} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-red-300/70 hover:bg-red-500/[0.06]"><Flag size={14}/>Report {activeConv.type === 'direct' ? 'user' : activeConv.type}</button></div>
      </motion.aside>}

      {leaveDialog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-5" role="alertdialog" aria-modal="true" aria-labelledby="leave-dialog-title">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#151517] p-5 shadow-2xl">
            <h2 id="leave-dialog-title" className="text-base font-semibold text-white">Leave {activeConv?.type === 'group' ? 'Group' : 'Channel'}?</h2>
            <p className="mt-2 text-sm text-white/50">Are you sure you want to leave {activeConv?.type === 'group' ? 'this group' : 'this channel'}?</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setLeaveDialog(false)} className="rounded-lg border border-white/[0.1] px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/[0.05]">Cancel</button>
              <button type="button" onClick={() => void handleLeaveActiveConversation()} disabled={isLeaving} className="rounded-lg bg-[#d6a83f] px-4 py-2 text-sm font-semibold text-black hover:bg-[#f2c75c] disabled:opacity-60">{isLeaving ? 'Leaving...' : 'Leave'}</button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {mediaViewer && <motion.div role="dialog" aria-modal="true" aria-label={mediaViewer.fileName || 'Media viewer'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex h-[var(--chat-viewport-height,100dvh)] w-screen flex-col overflow-hidden bg-black">
          <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] bg-black/90 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-xl">
            <button type="button" onClick={() => closeChatSubview(() => setMediaViewer(null))} className="grid h-10 w-10 place-items-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.08] hover:text-white" aria-label="Close media viewer"><ArrowLeft size={19}/></button>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-[#f5f5f5]">{mediaViewer.fileName || 'Shared media'}</p>
            <a href={mediaViewer.url} download={mediaViewer.fileName} target="_blank" rel="noreferrer" className="rounded-lg border border-white/[0.1] px-3 py-2 text-[10px] font-medium text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white">Download</a>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {mediaViewer.fileType === 'VIDEO' ? <video src={mediaViewer.url} controls autoPlay playsInline preload="metadata" className="max-h-full max-w-full object-contain"/> : <img src={mediaViewer.url} alt={mediaViewer.fileName || 'Shared image'} className="max-h-full max-w-full object-contain"/>}
          </div>
        </motion.div>}
        {messageContextId && (() => {
          const selected = messages.find(message => message.id === messageContextId);
          if (!selected) return null;
          return <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 px-2 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMessageContextId(null)}>
            <motion.section role="dialog" aria-modal="true" aria-label="Message actions" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={{ type: 'spring', damping: 28, stiffness: 340 }} onClick={event => event.stopPropagation()} className="w-full max-w-[510px] overflow-hidden rounded-t-2xl border border-white/[0.09] bg-[#151517] shadow-[0_-24px_64px_rgba(0,0,0,.7)]">
              <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20" />
              <div className="border-b border-white/[0.07] px-4 pb-3 pt-2"><p className="text-[10px] font-semibold uppercase text-white/30">Message actions</p><p className="mt-1 line-clamp-2 text-xs text-white/55">{selected.text || 'Attachment'}</p></div>
              <div className="flex items-center justify-around border-b border-white/[0.07] px-3 py-3">{['❤️','😂','🔥','👏','👍'].map(reaction => <button key={reaction} onClick={() => { void reactToMessage(selected, reaction); setMessageContextId(null); }} className="grid h-10 w-10 place-items-center rounded-full bg-[#202023] text-lg active:scale-90">{reaction}</button>)}</div>
              <div className="grid grid-cols-3 gap-1 p-2">
                <button onClick={() => { void reactToMessage(selected, '❤️'); setMessageContextId(null); }} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-[#c8c8cc] active:bg-white/[0.05]"><Smile size={19}/><span className="text-[10px]">React</span></button>
                <button onClick={() => { void navigator.clipboard.writeText(selected.text); setMessageContextId(null); }} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-[#c8c8cc] active:bg-white/[0.05]"><Copy size={19}/><span className="text-[10px]">Copy</span></button>
                <button onClick={() => void forwardMessage(selected)} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-[#c8c8cc] active:bg-white/[0.05]"><Forward size={19}/><span className="text-[10px]">Forward</span></button>
              </div>
              <div className="grid grid-cols-2 border-t border-white/[0.07] p-2">
                {activeConv?.type !== 'direct' && <button onClick={() => { void toggleMessagePin(selected); setMessageContextId(null); }} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-xs text-white/65 active:bg-white/[0.05]"><Pin size={16}/>{selected.pinnedAt ? 'Unpin message' : 'Pin message'}</button>}
                {selected.isOwn && <button onClick={() => editExistingMessage(selected)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-xs text-white/65 active:bg-white/[0.05]"><Pencil size={16}/>Edit</button>}
                {(selected.isOwn || activeConv?.type !== 'direct') && <button onClick={() => void deleteExistingMessage(selected)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-xs text-red-300 active:bg-red-500/[0.06]"><Trash2 size={16}/>Delete</button>}
              </div>
            </motion.section>
          </motion.div>;
        })()}
        {editEntityOpen && activeConv && activeConv.type !== 'direct' && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] h-[var(--chat-viewport-height,100dvh)] bg-[#050505]"><motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="mx-auto flex h-full w-full max-w-[720px] flex-col bg-[#0d0d0f]">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-4"><button onClick={() => closeChatSubview(() => setEditEntityOpen(false))} className="btn-icon h-9 w-9" aria-label="Close management"><ArrowLeft size={18}/></button><div className="text-center"><h2 className="text-sm font-semibold text-[#f5f5f5]">{activeConv.type === 'group' ? 'Group' : 'Channel'} Management</h2><p className="text-[9px] uppercase tracking-[.14em] text-[#d6a83f]">{isManagedOwner ? 'Owner controls' : 'Administrator controls'}</p></div><button onClick={saveEntityChanges} disabled={isSavingEntity || isUploadingAvatar || !editName.trim()} className="min-w-9 text-xs font-semibold text-[#f2c75c] disabled:text-white/25">{isSavingEntity ? <Loader2 size={15} className="animate-spin"/> : 'Save'}</button></header>
          <div className="flex-1 overflow-y-auto pb-10 scrollbar-hide">
            <section className="border-b border-white/[0.07] px-5 py-6 text-center"><div className="relative mx-auto w-fit"><button onClick={() => editAvatarInputRef.current?.click()} className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-[#d6a83f]/25 bg-[#151517]" aria-label="Change photo">{editAvatar ? <Avatar src={editAvatar} alt={`${activeConv.name} photo`} size="xl" className="!h-full !w-full"/> : <Camera size={22} className="text-white/35"/>}{isUploadingAvatar && <span className="absolute inset-0 grid place-items-center bg-black/70"><Loader2 size={18} className="animate-spin"/></span>}</button><span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-[#d6a83f]/30 bg-[#202023] text-[#f2c75c]"><Camera size={14}/></span></div><input ref={editAvatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={uploadEntityAvatar}/><div className="mt-3 flex justify-center gap-4"><button onClick={() => editAvatarInputRef.current?.click()} className="text-[11px] font-medium text-[#f2c75c]">Change photo</button>{editAvatar && <button onClick={() => setEditAvatar(null)} className="text-[11px] text-red-300">Remove</button>}</div><h3 className="mt-4 text-lg font-semibold text-[#f5f5f5]">{editName || activeConv.name}</h3><p className="mt-1 text-xs text-[#c8c8cc]/50">{managedEntity?._count?.members ?? managedEntity?.members?.length ?? 0} {activeConv.type === 'channel' ? 'subscribers' : 'members'} · {isManagedOwner ? 'Owner' : 'Admin'}</p></section>

            <section className="border-b border-white/[0.07] px-4 py-5"><h3 className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-white/35">Identity</h3><div className="divide-y divide-white/[0.07] border-y border-white/[0.07] bg-[#151517] px-3"><label className="block py-3 text-[10px] text-white/40">Name<input value={editName} maxLength={60} onChange={event => setEditName(event.target.value)} className="mt-1 block w-full bg-transparent text-sm text-[#f5f5f5] outline-none"/></label><label className="block py-3 text-[10px] text-white/40">Description<textarea value={editDescription} maxLength={500} onChange={event => setEditDescription(event.target.value)} rows={3} className="mt-1 block w-full resize-none bg-transparent text-sm leading-relaxed text-[#f5f5f5] outline-none"/></label>{activeConv.type === 'channel' && <><label className="block py-3 text-[10px] text-white/40">Handle<div className="mt-1 flex text-sm text-[#f5f5f5]"><span className="text-white/30">@</span><input value={editHandle} onChange={event => setEditHandle(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="channel_handle"/></div></label><div className="flex items-center justify-between py-3"><div className="flex items-center gap-3">{editVisibility === 'PUBLIC' ? <Globe2 size={16} className="text-[#d6a83f]"/> : <Lock size={16} className="text-[#d6a83f]"/>}<div><p className="text-sm text-[#f5f5f5]">Channel access</p><p className="text-[10px] text-white/35">{editVisibility === 'PUBLIC' ? 'Discoverable and open to join' : 'Available only to invited people'}</p></div></div><button onClick={() => setEditVisibility(value => value === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC')} className={cn('relative h-6 w-11 rounded-full border transition', editVisibility === 'PUBLIC' ? 'border-[#d6a83f]/60 bg-[#d6a83f]/25' : 'border-white/15 bg-[#202023]')} aria-label="Toggle channel access"><span className={cn('absolute top-0.5 h-4.5 w-4.5 rounded-full bg-[#f5f5f5] transition-all', editVisibility === 'PUBLIC' ? 'left-[22px]' : 'left-0.5')}/></button></div></>}</div></section>

            <section className="border-b border-white/[0.07] px-4 py-5"><div className="mb-3 flex items-center justify-between px-1"><h3 className="text-[10px] font-semibold uppercase tracking-[.15em] text-white/35">{activeConv.type === 'channel' ? 'Audience' : 'Members'}</h3><span className="text-[10px] text-white/30">{managedEntity?.members?.length || 0}</span></div><div className="flex items-center gap-2 border-y border-white/[0.07] bg-[#151517] px-3 py-2.5"><Search size={14} className="text-white/30"/><input value={managementSearch} onChange={event => void searchManagementUsers(event.target.value)} placeholder={`Add ${activeConv.type === 'channel' ? 'subscriber' : 'member'}`} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/25"/>{managementBusy === 'members' && <Loader2 size={13} className="animate-spin text-[#d6a83f]"/>}</div>{managementResults.length > 0 && <div className="border-b border-white/[0.07] bg-[#101012]">{managementResults.slice(0, 8).map(person => <button key={person.id} onClick={() => void addManagedMember(person)} className="flex w-full items-center gap-3 border-b border-white/[0.05] px-3 py-2.5 text-left last:border-0"><Avatar src={person.avatar} alt={person.username || person.fullName} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-xs text-white">{person.fullName || person.username}</p><p className="truncate text-[10px] text-white/35">@{person.username}</p></div><UserPlus size={15} className="text-[#f2c75c]"/></button>)}</div>}
              <div className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.07] bg-[#151517]">{(managedEntity?.members || []).map((member: any) => { const owner = member.userId === managedEntity.ownerId; const elevated = owner || ['ADMIN', 'MODERATOR'].includes(member.role); return <div key={member.userId} className="flex items-center gap-3 px-3 py-3"><Avatar src={member.user?.avatar} alt={member.user?.username || 'Member'} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[#f5f5f5]">{member.user?.fullName || member.user?.username}</p><div className="mt-0.5 flex items-center gap-1.5"><span className="truncate text-[10px] text-white/35">@{member.user?.username}</span>{elevated && <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase text-[#d6a83f]">{owner ? <Crown size={9}/> : <Shield size={9}/>} {owner ? 'Owner' : member.role === 'MODERATOR' ? 'Moderator' : 'Admin'}</span>}</div></div>{!owner && member.userId !== user?.id && <div className="flex items-center gap-1">{isManagedOwner && <button disabled={managementBusy === member.userId} onClick={() => void changeManagedRole(member, elevated ? 'MEMBER' : 'ADMIN')} className="btn-icon h-8 w-8 text-[#d6a83f]" aria-label={elevated ? 'Remove administrator rights' : 'Promote to administrator'}>{managementBusy === member.userId ? <Loader2 size={13} className="animate-spin"/> : <Shield size={14}/>}</button>}{(!elevated || isManagedOwner) && <button onClick={() => removeManagedMember(member)} className="btn-icon h-8 w-8 text-red-300" aria-label="Remove member"><UserMinus size={14}/></button>}</div>}</div>})}</div>
            </section>

            <section className="px-4 py-5"><div className="mb-3 flex items-center gap-2 px-1"><Shield size={13} className="text-[#d6a83f]"/><h3 className="text-[10px] font-semibold uppercase tracking-[.15em] text-white/35">Permissions</h3></div><div className="divide-y divide-white/[0.06] border-y border-white/[0.07] bg-[#151517]">{managedPermissions.map(([key, label]) => { const enabled = managedEntity?.permissions?.[key] ?? true; return <div key={key} className="flex items-center justify-between px-3 py-3"><span className="text-xs text-[#c8c8cc]">{label}</span><button onClick={() => toggleManagedPermission(key)} className={cn('relative h-6 w-11 rounded-full border transition', enabled ? 'border-[#d6a83f]/60 bg-[#d6a83f]/25' : 'border-white/15 bg-[#202023]')} aria-label={`Toggle ${label}`}><span className={cn('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', enabled ? 'left-[22px] bg-[#f2c75c]' : 'left-0.5 bg-[#c8c8cc]')}/></button></div>})}</div><p className="mt-2 px-1 text-[10px] leading-relaxed text-white/25">Changes take effect when you save and are enforced by VANTA on the server.</p></section>
          </div>
        </motion.div></motion.div>}
        {createModalOpen && createType && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex h-[var(--chat-viewport-height,100dvh)] items-stretch justify-center overflow-hidden bg-[#050505]"
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              className="h-full w-full max-w-[720px] overflow-y-auto bg-[#0d0d0f] p-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/30">Create {createType}</p>
                  <h3 className="text-lg font-semibold text-white">{createType === 'group' ? 'New Group' : 'New Channel'}</h3>
                </div>

                {createType === 'channel' && <div className="grid grid-cols-1 gap-3 "><div><label className="block text-xs text-white/40 mb-1">Username / handle</label><input value={createHandle} onChange={e => setCreateHandle(e.target.value)} placeholder="@vanta-news" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" /></div><div><label className="block text-xs text-white/40 mb-1">Access</label><select value={createVisibility} onChange={e => setCreateVisibility(e.target.value as 'PUBLIC' | 'PRIVATE')} className="w-full rounded-lg border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white outline-none"><option value="PUBLIC">Public</option><option value="PRIVATE">Private</option></select></div></div>}
                <button onClick={resetCreateModal} className="btn-icon w-9 h-9"><X size={16} /></button>
              </div>

              <div className="grid gap-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    className="relative h-16 w-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden flex items-center justify-center"
                  >
                    {createAvatar ? <Avatar src={createAvatar} alt="avatar preview" size="lg" /> : <Camera size={18} className="text-white/30" />}
                  </button>
                  <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadAvatar} />
                  <div className="flex-1">
                    <label className="block text-xs text-white/40 mb-1">Name</label>
                    <input
                      value={createName}
                      onChange={e => setCreateName(e.target.value)}
                      placeholder={createType === 'group' ? 'Team workspace' : 'Announcements hub'}
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <textarea
                    value={createDescription}
                    onChange={e => setCreateDescription(e.target.value)}
                    placeholder="Give your conversation a short description"
                    rows={3}
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-white/40 mb-1">Invite members</label>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {selectedMembers.map((member) => (
                        <button
                          key={member.id}
                          onClick={() => toggleMemberSelection(member)}
                          className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-white hover:border-white/30"
                        >
                          <Avatar src={member.avatar} alt={member.username || member.fullName} size="xs" />
                          <span>{member.id === user?.id ? 'You' : member.username || member.fullName}</span>
                        </button>
                      ))}
                    </div>
                    <input
                      value={memberSearch}
                      onChange={e => handleSearchMembers(e.target.value)}
                      placeholder="Search users to add"
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div className="mt-3 space-y-1 max-h-40 overflow-y-auto pr-1">
                    {memberSearchResults.map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => toggleMemberSelection(item)}
                        className="w-full flex items-center justify-between rounded-xl px-2.5 py-2 hover:bg-white/[0.04] text-left"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar src={item.avatar} alt={item.username || item.fullName} size="sm" />
                          <div>
                            <p className="text-sm text-white">{item.username || item.fullName}</p>
                            <p className="text-[10px] text-white/40">{item.fullName || 'User'}</p>
                          </div>
                        </div>
                        <UserPlus size={14} className="text-white/40" />
                      </button>
                    ))}
                    {memberSearch && memberSearchResults.length === 0 && (
                      <p className="text-xs text-white/30">No matching users found.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={resetCreateModal} className="btn-secondary text-sm">Cancel</button>
                <button
                  onClick={handleCreateEntity}
                  disabled={isCreatingEntity || isUploadingAvatar || !createName.trim()}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {isCreatingEntity ? 'Creating...' : `Create ${createType}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}