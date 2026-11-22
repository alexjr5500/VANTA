'use client';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, invalidateCache } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import {
  Bell, MessageCircle, Search, Compass, Radio, House, Clapperboard, User, Megaphone,
  Send, Paperclip, Check, CheckCheck,
  Loader2, Users, ArrowLeft, X, UserPlus, Camera, BellOff, AtSign,
  Pin, Image as ImageIcon, FileText, Info, ChevronRight, Flag, Ban, Pencil, RefreshCw,
  Shield, Trash2, Crown, Globe2, Lock, UserMinus, Copy, Forward, Smile, MoreVertical, MapPin, BarChart3, Music2, Wallet as WalletIcon,
  Mic, Square, Phone, Video, Play,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import PullToRefresh from '@/components/ui/PullToRefresh';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';
import { createSocket } from '@/lib/socketClient';
import type { Socket } from 'socket.io-client';
import MessageFab from '@/components/messages/MessageFab';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { useCalls } from '@/context/CallContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { useNotifications } from '@/context/NotificationContext';
import VideoTrimModal from '@/components/video/VideoTrimModal';
import type { VideoTrimResult } from '@/components/video/VideoTrimEditor';
import { VoiceNotePlayer, VideoFullscreenPlayer } from '@/components/messages/ChatMediaPlayer';
import { activeReplyFor, createReply, type ReplyState } from '@/lib/replyState';
import { isSecureMediaContext, mapMediaError } from '@/lib/mediaPermissions';
import { addDrafts, hasBusyDraft, readyDraftCount, removeDraft, type AttachmentDraft } from '@/lib/attachmentDrafts';
import { renderTextWithLinks } from '@/lib/linkify';
import { extractQuoteRef } from '@/lib/quotePost';
import QuoteEmbed from '@/components/social/QuoteEmbed';
import { friendlyError, errorMessage } from '@/lib/errors';
import type { VerificationType } from '@/types/verification';

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
    senderId?: string;
    isOwn?: boolean;
    type?: string;
    hasAttachments?: boolean;
  };
  unread: number;
  online: boolean;
  username?: string;
  verified?: boolean;
  verificationType?: VerificationType | null;
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
  legacyPoll?: { question: string; options: string[]; imageUrl?: string | null } | null;
  pollVotes?: Array<{ userId: string; optionIndex: number }>;
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
  uploading?: boolean;
  uploadProgress?: number;
  failed?: boolean;
  pinnedAt?: string | null;
  reactions?: Array<{ id: string; reaction: string; userId: string }>;
  replyTo?: any;
  // Story reply — private message referencing a Story (snapshot fields keep the
  // reference readable after the Story expires).
  storyReplyStoryId?: string | null;
  storyReplyMediaUrl?: string | null;
  storyReplyCaption?: string | null;
  storyReplyAuthor?: string | null;
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
  // Older CONTACT shares were persisted as TEXT in some environments. Recover
  // the structured profile card from its JSON payload instead of rendering the
  // serialized object as a chat bubble. Require multiple profile-specific fields
  // so ordinary JSON messages are not misclassified.
  let legacyContact = false;
  if (typeof content === 'string' && (!msg.type || ['TEXT', 'CONTACT'].includes(String(msg.type).toUpperCase()))) {
    try {
      const parsed = JSON.parse(content);
      legacyContact = Boolean(
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        typeof parsed.username === 'string' && parsed.username.trim() &&
        (typeof parsed.userId === 'string' || typeof parsed.fullName === 'string' ||
          typeof parsed.avatarUrl === 'string' || typeof parsed.bannerUrl === 'string' ||
          (parsed.counts && typeof parsed.counts === 'object'))
      );
    } catch { /* ordinary text */ }
  }
  let legacyPoll: { question: string; options: string[]; imageUrl?: string | null } | null = null;
  let pollVotes: Array<{ userId: string; optionIndex: number }> = [];
  let pollPayload = false;
  if (typeof content === 'string' && (msg.type == null || ['TEXT', 'POLL'].includes(String(msg.type).toUpperCase()))) {
    try {
      const parsed = JSON.parse(content);
      pollPayload = Boolean(parsed && typeof parsed === 'object' && ('question' in parsed || 'options' in parsed));
      if (parsed && typeof parsed.question === 'string' && parsed.question.trim() && Array.isArray(parsed.options) && parsed.options.length >= 2 && parsed.options.length <= 10 && parsed.options.every((option: unknown) => typeof option === 'string' && option.trim())) {
        legacyPoll = { question: parsed.question.trim(), options: parsed.options.map((option: string) => option.trim()), imageUrl: typeof parsed.imageUrl === 'string' ? resolveMediaUrl(parsed.imageUrl) : null };
        pollVotes = Array.isArray(parsed.votes) ? parsed.votes.filter((vote: any) => vote && typeof vote.userId === 'string' && Number.isInteger(vote.optionIndex) && vote.optionIndex >= 0 && vote.optionIndex < parsed.options.length) : [];
      }
    } catch { /* ordinary text */ }
  }
  const safeLegacyPoll = legacyPoll ?? ((pollPayload || msg.type === 'POLL') ? { question: 'Poll', options: [] as string[] } : null);
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
    ...(safeLegacyPoll ? { type: 'POLL', legacyPoll: safeLegacyPoll, text: '' } : (legacyContact ? { type: 'CONTACT' } : (pollPayload || msg.type === 'POLL' || msg.type === 'WALLET' ? { text: '' } : {}))),
    id: msg.id,
    text: (safeLegacyPoll || pollPayload || msg.type === 'POLL' || msg.type === 'WALLET') ? '' : content,
    sender: msg.sender ?? { id: msg.senderId, username: 'User' },
    senderId: msg.senderId ?? msg.sender?.id,
    conversationId: msg.conversationId,
    timestamp: msg.createdAt ?? msg.timestamp,
    createdAt: msg.createdAt ?? msg.timestamp,
    read: Boolean(msg.read ?? msg.isRead ?? msg.reads?.some((read: any) => read.userId !== currentUserId)),
    isOwn: (msg.senderId ?? msg.sender?.id) === currentUserId,
    attachments,
    reactions: msg.reactions ?? [],
    pollVotes,
    replyTo: msg.replyTo,
  };
};

const conversationPreviewText = (value: unknown, type?: string): string => {
  const raw = typeof value === 'string' ? value : '';
  if (String(type || '').toUpperCase() === 'POLL') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed?.question === 'string' && parsed.question.trim() ? `Sent a poll: ${parsed.question.trim()}` : 'Sent a poll';
    } catch { return 'Sent a poll'; }
  }
  if (String(type || '').toUpperCase() === 'CONTACT' || (raw.trim().startsWith('{') && raw.includes('"username"'))) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.username === 'string' && parsed.username.trim()) return 'Contact card · @' + parsed.username.trim();
      return 'Shared a contact';
    } catch { return 'Shared a contact'; }
  }
  return raw;
};

// VANTA post/reel links in a message render as a rich preview card instead of a raw URL.
const chatQuoteOf = (message: Message) => {
  if (message.deletedAt || typeof window === 'undefined') return null;
  return extractQuoteRef(visibleMessageText(message), window.location.host);
};

// Direct links to uploaded images, videos or documents render an inline attachment preview.
const chatMediaLinksOf = (text: string): { url: string; kind: 'image' | 'video' | 'file'; name: string }[] => {
  const out: { url: string; kind: 'image' | 'video' | 'file'; name: string }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = match[0].replace(/[.,)]+$/, '');
    const path = url.split(/[?#]/)[0];
    const filename = path.split('/').pop() || 'File';
    let name = filename;
    try { name = decodeURIComponent(filename); } catch { /* Keep malformed URL text instead of crashing chat rendering. */ }
    const kind = /\.(png|jpe?g|gif|webp|avif)$/i.test(path) ? 'image' : /\.(mp4|webm|mov|m4v)$/i.test(path) ? 'video' : /\.(pdf|docx?|xlsx?|pptx?|txt|zip|csv)$/i.test(path) ? 'file' : null;
    if (kind && !out.some(item => item.url === url)) out.push({ url, kind, name });
  }
  return out.slice(0, 3);
};

const visibleMessageText = (message: Message): string => {
  if (!message.attachments?.some(attachment => attachment.fileType === 'IMAGE')) return message.text;
  const text = message.text.trim();
  if (!text) return '';
  const image = message.attachments.find(attachment => attachment.fileType === 'IMAGE');
  const candidates = [image?.fileName, image?.url].filter(Boolean).map(value => String(value).split('/').pop());
  return candidates.includes(text) || attachmentTextPattern.test(text) ? '' : message.text;
};

// ============================================================================
// RESPONSIVE MEDIA GALLERY GRID
//
// Used by BOTH the composer draft preview and the sent/received message bubbles
// so every place renders a multi-attachment group with the same Instagram-style
// responsive gallery rules:
//   1 attachment → full-size single tile
//   2 attachments → 2 equal columns
//   3 attachments → first large on the left, 2 & 3 stacked on the right
//   4 attachments → 2×2 grid
//   5+ attachments → polished multi-item grid with remaining-count overlay
//
// Only IMAGE / VIDEO tiles go in the grid (they share one object-fit:cover tile).
// FILE / AUDIO attachments keep their dedicated document/audio cards rendered
// adjacent to (not inside) the grid.
// ============================================================================

/** Versatile attachment shape shared by drafts and persisted messages. */
type GridAttachment = {
  id?: string;
  url?: string;
  previewUrl?: string;
  fileType: string;
  fileName?: string;
};

const GRID_MAX_VISIBLE = 5;

/** Aspect ratio of the whole grid container so `auto-rows-fr` yields even cells. */
function gridAspectClass(count: number): string {
  if (count === 1) return 'aspect-[4/3]';
  if (count === 2) return 'aspect-[2/1]';
  if (count === 3 || count === 4) return 'aspect-square';
  return 'aspect-[3/2]';
}

/** Grid template columns/rows per count; every row shares height via auto-rows-fr. */
function gridColumnsClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1 auto-rows-fr';
  if (count === 3) return 'grid-cols-2 grid-rows-2 auto-rows-fr';
  if (count === 4) return 'grid-cols-2 grid-rows-2 auto-rows-fr';
  return 'grid-cols-3 grid-rows-2 auto-rows-fr';
}

/** Per-tile placement classes (the 3-item "featured left" layout is custom). */
function gridTileClass(count: number, index: number): string {
  if (count === 3) return index === 0 ? 'col-span-1 row-span-2' : 'col-span-1 row-span-1';
  return '';
}

/** Compact relative timestamp used in chat list and message metadata. */
const formatRelativeChatTime = (value?: string | Date | null): string => {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return seconds <= 5 ? 'now' : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
};

const formatVoiceTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const safe = Math.floor(seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/** Human-readable presence timestamps that remain unambiguous after several days. */
const formatRelativePresenceTime = (value?: string | Date | null): string => {
  if (!value) return 'recently';
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return 'recently';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export default function MessagesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const { setChatUnread } = useChatUnread();
  const { unreadCount: notificationUnread } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileList, setShowMobileList] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creatorFollowers, setCreatorFollowers] = useState<any[]>([]);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [autoDeleteSeconds, setAutoDeleteSeconds] = useState(0);
  const [customDeleteDays, setCustomDeleteDays] = useState('2');
  const [createType, setCreateType] = useState<'group' | 'channel' | null>(null);
  // Polls are stored as typed chat messages with server-validated vote payloads.
  const [pollDraft, setPollDraft] = useState<{ question: string; options: string[]; allowMultiple: boolean; imageFile?: File | null } | null>(null);
  const [pollImagePreviewUrl, setPollImagePreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pollDraft?.imageFile) { setPollImagePreviewUrl(null); return; }
    const previewUrl = URL.createObjectURL(pollDraft.imageFile);
    setPollImagePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [pollDraft?.imageFile]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<any[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [contactSearchError, setContactSearchError] = useState<string | null>(null);
  const contactSearchSequenceRef = useRef(0);
  const contactSendInFlightRef = useRef(false);
  const [specialSending, setSpecialSending] = useState(false);
  const specialSendLockRef = useRef(false);
  const pollSubmitLockRef = useRef(false);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createHandle, setCreateHandle] = useState('');
  const [createVisibility, setCreateVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [createAvatar, setCreateAvatar] = useState<string | null>(null);
  const [createAvatarFileId, setCreateAvatarFileId] = useState<string | null>(null);
  const [createAvatarError, setCreateAvatarError] = useState<string | null>(null);
  const [createValidationError, setCreateValidationError] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState<any[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [isCreatingEntity, setIsCreatingEntity] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
// Separates the one-time "open at latest unread / bottom" anchor from the
// live "only auto-scroll when already near the bottom" behaviour.
const initialScrollDoneRef = useRef(false);
const wasNearBottomRef = useRef(true);
const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
const [pendingNewMessage, setPendingNewMessage] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Source of truth for the temporary create-modal image so cleanup (cancel /
  // create success / failure) always targets the correct server file.
  const createAvatarFileIdRef = useRef<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Native document/file picker — multi-select documents for the composer.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  const entityInfoRequestRef = useRef(0);
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
  const [attachmentDrafts, setAttachmentDrafts] = useState<AttachmentDraft[]>([]);
  // Toggles the compact Camera / Photos / Files attachment sheet above the composer.
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  const [cameraPreviewError, setCameraPreviewError] = useState<string | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    let cancelled = false;
    const stopPreview = () => {
      cameraPreviewStreamRef.current?.getTracks().forEach(track => track.stop());
      cameraPreviewStreamRef.current = null;
      if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
    };
    if (!showAttachmentSheet) {
      stopPreview();
      setCameraPreviewError(null);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPreviewError('Live camera preview is not available here. Use Camera to open your device camera.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        cameraPreviewStreamRef.current = stream;
        if (cameraPreviewRef.current) {
          cameraPreviewRef.current.srcObject = stream;
          void cameraPreviewRef.current.play().catch(() => undefined);
        }
        setCameraPreviewError(null);
      })
      .catch(() => {
        if (!cancelled) setCameraPreviewError('Allow camera access to use the live preview, or tap Camera to open the device camera.');
      });
    return () => { cancelled = true; stopPreview(); };
  }, [showAttachmentSheet]);

  const uploadAbortRef = useRef<AbortController | null>(null);
  // Retains local files + preview URLs for in-chat media messages that are
  // still uploading (or failed), so a retry can re-upload the same files.
  const pendingMediaRef = useRef<Record<string, { file: File; fileType: 'IMAGE' | 'VIDEO' | 'FILE'; fileName: string; previewUrl: string }[]>>({});
  const [trimVideoFile, setTrimVideoFile] = useState<File | null>(null);
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
  const managementSearchRequestRef = useRef(0);
  const [managementBusy, setManagementBusy] = useState<string | null>(null);
  const [ownershipConfirm, setOwnershipConfirm] = useState<any | null>(null);
  const [isSavingEntity, setIsSavingEntity] = useState(false);
  const entitySaveInFlightRef = useRef(false);
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
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<Message | null>(null);
  const [deleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false);
  const [deleteForEveryone, setDeleteForEveryone] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyState<Message> | null>(null);
  // Only a reply bound to the currently-open conversation may be shown/submitted.
  // If the stored conversation does not match the active one, treat it as absent.
  const activeReply: Message | null = activeReplyFor(replyingTo, activeConversation);
  const [filter, setFilter] = useState<'all' | 'direct' | 'group' | 'channel' | 'unread'>('all');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [directMenuOpen, setDirectMenuOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [memberBrowserOpen, setMemberBrowserOpen] = useState(false);
  const [memberBrowserQuery, setMemberBrowserQuery] = useState('');
  const [isLoadingEntityInfo, setIsLoadingEntityInfo] = useState(false);
  // Unified Call button: opens the Voice/Video call-type menu. The menu closes
  // on selection, when the user taps outside, on back navigation, and the
  // moment a call starts (the in-call overlay takes over).
  const [callMenuOpen, setCallMenuOpen] = useState(false);
  const [messageSearchResults, setMessageSearchResults] = useState<Message[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [mediaViewer, setMediaViewer] = useState<{ url: string; fileType: string; fileName?: string } | null>(null);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const newChatSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedMessageRef = useRef<string | null>(null);
  const selectionHistoryRef = useRef(false);
  const conversationLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedConversationRef = useRef<string | null>(null);
  const conversationLongPressStartRef = useRef<{ x: number; y: number } | null>(null);

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
    // Back navigation closes transient chat overlays.
    setCallMenuOpen(false);
    setDirectMenuOpen(false);
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

  const openConversationInfo = useCallback(async () => {
    const requestId = ++entityInfoRequestRef.current;
    setDetailsOpen(true);
    setMemberBrowserOpen(false);
    setMemberBrowserQuery('');
    pushChatView('info');
    setManagedEntity(null);
    const conversation = conversations.find(item => item.id === activeConversation);
    if (!conversation) return;
    if (conversation.type === 'direct' || !token) return;
    setIsLoadingEntityInfo(true);
    try {
      const entityId = conversation.entityId || conversation.id;
      const entity = await apiGet<any>(`/api/${conversation.type === 'group' ? 'groups' : 'channels'}/${entityId}`, token);
      if (entityInfoRequestRef.current === requestId && activeConversationRef.current === conversation.id) setManagedEntity(entity);
    } catch {
      // The overview remains usable from conversation data if extra info is unavailable.
    } finally {
      if (entityInfoRequestRef.current === requestId) setIsLoadingEntityInfo(false);
    }
  }, [activeConversation, conversations, pushChatView, token]);

  const handleOpenConversationActions = useCallback(() => {
    const selectedConversation = conversations.find(item => item.id === activeConversation);
    if (selectedConversation?.type === 'direct') {
      setDirectMenuOpen(true);
      setCallMenuOpen(false);
      return;
    }
    void openConversationInfo();
  }, [activeConversation, conversations, openConversationInfo]);

  const openMediaViewer = useCallback((attachment: { url: string; fileType: string; fileName?: string }) => {
    setMediaViewer(attachment);
    pushChatView('media');
  }, [pushChatView]);

  const fetchConversations = useCallback(async (refresh?: unknown) => {
    // Pull-to-refresh passes an explicit `true`; legacy callers (e.g. the
    // error screen's onClick handler) pass other values and keep the default
    // full-page flow.
    const background = refresh === true;
    if (!token) return;
    if (!background) setError(null);
    try {
      const data = await apiGet<any>('/api/messages', token);
      const convList = Array.isArray(data) ? data : data?.conversations ?? data?.data ?? [];
      const normalizedConversations = convList.map((conv: any) => ({
        id: conv.id,
      type: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toLowerCase(),
        name: conv.name || conv.partner?.fullName || conv.partner?.username || 'Conversation',
        avatar: conv.partner?.avatar || conv.avatar,
        updatedAt: conv.updatedAt,
        lastMessage: conv.lastMessage ? {
          text: conversationPreviewText(conv.lastMessage.content ?? conv.lastMessage.text ?? '', conv.lastMessage.type),
          sender: conv.lastMessage.sender?.username ?? 'Unknown',
          senderId: conv.lastMessage.senderId ?? conv.lastMessage.sender?.id,
          isOwn: (conv.lastMessage.senderId ?? conv.lastMessage.sender?.id) === user?.id,
          timestamp: conv.lastMessage.createdAt ?? conv.lastMessage.timestamp,
          read: conv.lastMessage.read ?? false,
          type: conv.lastMessage.type ?? 'TEXT',
          hasAttachments: Array.isArray(conv.lastMessage.attachments) && conv.lastMessage.attachments.length > 0,
        } : undefined,
        unread: conv.unreadCount ?? conv.unread ?? 0,
        online: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toUpperCase() === 'DIRECT'
          ? Boolean(conv.partner?.userPresence?.isOnline ?? conv.partner?.isOnline ?? conv.online)
          : false,
        onlineMemberCount: typeof conv.onlineMemberCount === 'number' ? conv.onlineMemberCount : undefined,
        username: conv.partner?.username,
        verified: Boolean(conv.partner?.verified),
        verificationType: conv.partner?.verificationType || undefined,
        lastSeen: conv.partner?.userPresence?.lastActive,
        partnerId: conv.partner?.id,
        memberCount: conv.memberCount,
        currentRole: conv.currentRole,
        entityId: conv.entityId ?? conv.group?.id ?? conv.channel?.id,
        muted: Boolean(conv.mutedAt),
        description: conv.description,
        handle: conv.handle,
        participants: conv.participants ?? conv.members?.map((member: any) => ({ ...member, user: member.user || member })) ?? [],
      }));
      normalizedConversations.sort((a: any, b: any) => {
        const aTime = new Date(a.lastMessage?.timestamp || a.updatedAt || 0).getTime();
        const bTime = new Date(b.lastMessage?.timestamp || b.updatedAt || 0).getTime();
        return bTime - aTime;
      });
      setConversations(normalizedConversations);
      setConversationCursor(data?.nextCursor ?? null);
    } catch (err: any) {
      // A pull-to-refresh failure must not replace the whole chat screen:
      // rethrow so the gesture can show its retry hint instead.
      if (background) throw err;
      setError(err.message || 'Failed to load conversations');
    } finally {
      if (!background) setLoading(false);
    }
  }, [token, user?.id]);

  const loadMoreConversations = async () => {
    if (!token || !conversationCursor) return;
    try {
      const data = await apiGet<any>(`/api/messages?limit=25&cursor=${encodeURIComponent(conversationCursor)}`, token);
      const next = (data?.conversations ?? []).map((conv: any) => ({
        id: conv.id, type: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toLowerCase(), name: conv.name || conv.partner?.fullName || conv.partner?.username || 'Conversation', avatar: conv.partner?.avatar || conv.avatar,
        lastMessage: conv.lastMessage ? { text: conversationPreviewText(conv.lastMessage.content ?? conv.lastMessage.text ?? '', conv.lastMessage.type), sender: conv.lastMessage.sender?.username ?? 'Unknown', senderId: conv.lastMessage.senderId ?? conv.lastMessage.sender?.id, isOwn: (conv.lastMessage.senderId ?? conv.lastMessage.sender?.id) === user?.id, timestamp: conv.lastMessage.createdAt ?? conv.lastMessage.timestamp, read: Boolean(conv.lastMessage.read), type: conv.lastMessage.type ?? 'TEXT', hasAttachments: Array.isArray(conv.lastMessage.attachments) && conv.lastMessage.attachments.length > 0 } : undefined,
        unread: conv.unreadCount ?? 0, description: conv.description, handle: conv.handle, participants: conv.participants ?? [], online: (conv.type || (conv.isGroup ? 'GROUP' : 'DIRECT')).toUpperCase() === 'DIRECT' ? Boolean(conv.partner?.userPresence?.isOnline ?? conv.partner?.isOnline ?? conv.online) : false, onlineMemberCount: typeof conv.onlineMemberCount === 'number' ? conv.onlineMemberCount : undefined, username: conv.partner?.username, verified: Boolean(conv.partner?.verified), verificationType: conv.partner?.verificationType || undefined, lastSeen: conv.partner?.userPresence?.lastActive, partnerId: conv.partner?.id, memberCount: conv.memberCount, currentRole: conv.currentRole, entityId: conv.entityId,
      }));
      setConversations(previous => [...previous, ...next.filter((item: Conversation) => !previous.some(existing => existing.id === item.id))]);
      setConversationCursor(data?.nextCursor ?? null);
    } catch (err: any) { showToast?.({ type: 'error', title: 'Could not load more conversations', message: errorMessage(err, { action: 'load more conversations', fallback: 'Please try again.' }) }); }
  };

  const fetchMessages = useCallback(async (conversationId: string) => {
    if (!token) return;
    try {
      const data = await apiGet<any>(`/api/messages/${conversationId}?limit=50`, token);
      if (activeConversationRef.current !== conversationId) return;
      const msgList = Array.isArray(data) ? data : data?.messages ?? data?.data ?? [];
      setMessages(msgList.map((msg: any) => normalizeMessageRecord(msg, user?.id)).filter((msg: Message) => !msg.deletedAt));
      setMessageCursor(data?.nextCursor ?? null);
      await apiPut<any>(`/api/messages/${conversationId}/read`, {}, token).catch(() => undefined);
      if (activeConversationRef.current === conversationId) {
        setConversations(previous => previous.map(conversation => conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation));
      }
    } catch (err: any) {
      if (activeConversationRef.current === conversationId) showToast?.({ type: 'error', title: 'Chat unavailable', message: errorMessage(err, { action: 'load this conversation', context: 'conversation', fallback: 'Could not load this conversation.' }) });
    }
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
    const conversationId = activeConversation;
    const viewport = messagesViewportRef.current;
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const prevScrollTop = viewport?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const data = await apiGet<any>(`/api/messages/${conversationId}?limit=50&cursor=${encodeURIComponent(messageCursor)}`, token);
      if (activeConversationRef.current !== conversationId) return;
      const older = (data?.messages ?? [])
        .map((msg: any) => normalizeMessageRecord(msg, user?.id))
        .filter((msg: Message) => !msg.deletedAt);
      setMessages(previous => {
        const existing = new Set(previous.map(message => message.id));
        return [...older.filter((message: Message) => !existing.has(message.id)), ...previous];
      });
      setMessageCursor(data?.nextCursor ?? null);
      // Preserve the reader's scroll position after prepending older messages.
      window.requestAnimationFrame(() => {
        if (activeConversationRef.current !== conversationId) return;
        const target = messagesViewportRef.current;
        if (target) target.scrollTop = (target.scrollHeight - prevScrollHeight) + prevScrollTop;
      });
    } catch (err: any) {
      if (activeConversationRef.current === conversationId) showToast?.({ type: 'error', title: 'Could not load older messages', message: errorMessage(err, { action: 'load older messages', fallback: 'Please try again.' }) });
    } finally {
      setLoadingOlder(false);
    }
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
    // Microphone access (getUserMedia) requires a secure context (HTTPS or
    // localhost). On a plain-HTTP LAN address navigator.mediaDevices is
    // undefined, and on insecure origins the request would fail anyway.
    if (!isSecureMediaContext()) {
      setRecordingError('Voice messages require a secure connection. Please open VANTA using HTTPS (or on localhost).');
      showToast?.({ type: 'error', title: 'Secure connection required', message: 'Open VANTA over HTTPS to record voice notes.' });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      // Map the raw browser error into a consistent VANTA message. This keeps
      // raw errors (e.g. NotAllowedError) out of the UI while giving the user a
      // precise, actionable explanation for camera/mic denial, missing hardware,
      // contention, unsupported browsers, and insecure contexts.
      const issue = mapMediaError(error, 'microphone');
      setRecordingError(issue.message);
      // technical detail is logged for developers by mapMediaError consumers.
      showToast?.({
        type: 'error',
        title: issue.title,
        message: issue.message,
      });
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
      showToast?.({ type: 'error', title: 'Voice note not sent', message: errorMessage(err, { action: 'send the voice note', fallback: 'The recording could not be uploaded. Try again.' }) });
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
    setReplyingTo(createReply(activeConversation as string, target));
    if ('vibrate' in navigator) navigator.vibrate(14);
  };

  useEffect(() => {
    if (!token || !user?.id) return;
    const socket = createSocket(token, `messages-page-${user.id}`);
    socketRef.current = socket;
    const onMessage = (raw: any) => {
      const message = normalizeMessage(raw);
      // A message that arrives already deleted never enters the visible list.
      if (message.deletedAt) return;
      if (message.conversationId === activeConversationRef.current) {
        setMessages(previous => previous.some(item => item.id === message.id) ? previous.map(item => item.id === message.id ? message : item) : [...previous.filter(item => !(item.pending && item.text === message.text && item.senderId === message.senderId)), message]);
        apiPut<any>(`/api/messages/${message.conversationId}/read`, {}, token).catch(() => undefined);
      }
      fetchConversations();
    };
    // `message:updated` and `message:deleted` share one handler: an updated/deleted
    // message must finish its lifecycle in the same place. Deleted messages are
    // removed entirely (no placeholder) — the conversation behaves as if they
    // never existed. On refresh / other devices the backend omits them too.
    const onUpdated = (raw: any) => {
      const message = normalizeMessage(raw);
      if (message.deletedAt) {
        setMessages(previous => previous.filter(item => item.id !== message.id));
      } else {
        setMessages(previous => previous.map(item => item.id === message.id ? message : item));
      }
      fetchConversations();
    };
    const onRead = (data: any) => { if (data.readerId !== user.id) setMessages(previous => previous.map(item => item.isOwn ? { ...item, read: true } : item)); fetchConversations(); };
    const onPresence = (data: any) => setConversations(previous => previous.map(conversation => {
      if (conversation.type === 'direct') {
        return conversation.partnerId === data.userId ? {
          ...conversation,
          ...(typeof data.isOnline === 'boolean' ? { online: data.isOnline } : {}),
          ...(data.lastActive !== undefined ? { lastSeen: data.lastActive } : {}),
        } : conversation;
      }
      if (conversation.type === 'group' && conversation.participants?.some((p: any) => (p.id ?? p.userId) === data.userId)) {
        const participants = (conversation.participants || []).map((p: any) =>
          (p.id ?? p.userId) === data.userId ? {
            ...p,
            userPresence: {
              ...(p.userPresence || {}),
              ...(typeof data.isOnline === 'boolean' ? { isOnline: data.isOnline } : {}),
              ...(data.lastActive !== undefined ? { lastActive: data.lastActive } : {}),
            },
          } : p
        );
        return {
          ...conversation,
          participants,
          ...(typeof data.isOnline === 'boolean' ? { onlineMemberCount: participants.filter((p: any) => p.userPresence?.isOnline).length } : {}),
        };
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

  const clearConversationLongPress = () => {
    if (conversationLongPressTimerRef.current) clearTimeout(conversationLongPressTimerRef.current);
    conversationLongPressTimerRef.current = null;
    conversationLongPressStartRef.current = null;
  };

  const beginConversationLongPress = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (selectedConversationIds.size > 0 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    clearConversationLongPress();
    conversationLongPressStartRef.current = { x: event.clientX, y: event.clientY };
    conversationLongPressTimerRef.current = setTimeout(() => {
      longPressedConversationRef.current = id;
      setSelectedConversationIds(new Set([id]));
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(18);
    }, 480);
  };

  const trackConversationLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = conversationLongPressStartRef.current;
    if (!start) return;
    // Ignore tiny touch jitter, but cancel when the finger is clearly scrolling.
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) {
      clearConversationLongPress();
      conversationLongPressStartRef.current = null;
    }
  };

  const toggleConversationSelection = (id: string) => {
    setSelectedConversationIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConversationRowClick = (id: string) => {
    if (longPressedConversationRef.current === id) {
      longPressedConversationRef.current = null;
      return;
    }
    if (selectedConversationIds.size > 0) {
      toggleConversationSelection(id);
      return;
    }
    handleSelectConversation(id);
  };

  const handleSelectConversation = (id: string) => {
    stopOutgoingTyping();
    closeMessageSelection();
    // Leaving a conversation cancels any unsent reply/edits — a reply belongs to
    // the exact conversation it was created in, never to the whole messaging app.
    setReplyingTo(null);
    setEditingMessage(null);
    setMessageInput('');
    if (activeConversationRef.current) socketRef.current?.emit('leave_conversation', activeConversationRef.current);
    entityInfoRequestRef.current += 1;
    managementSearchRequestRef.current += 1;
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
    setReplyingTo(null);
    setEditingMessage(null);
    closeMessageSelection();
    setMessageInput('');
    setActiveConversation(null);
    setMessages([]);
    setShowMobileList(true);
    setDetailsOpen(false);
    setDirectMenuOpen(false);
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
      showToast?.({ type: 'error', title: 'Could not leave', message: errorMessage(err, { action: 'leave', context: activeConv?.type === 'channel' ? 'channel' : 'group', fallback: 'Please try again.' }) });
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
        setReplyingTo(null);
        setEditingMessage(null);
        setMessageInput('');
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
    const pending = normalizeMessage({ id: pendingId, conversationId: activeConversation, senderId: user.id, sender: user, content, attachments, createdAt: new Date().toISOString(), pending: true, replyTo: activeReply ? { id: activeReply.id, content: activeReply.text, sender: activeReply.sender } : undefined });
    setMessages(previous => [...previous, pending]); setMessageInput('');
    try {
      const result = await apiPost<any>('/api/messages/send', { conversationId: activeConversation, content, type: attachments[0]?.fileType || 'TEXT', attachments, replyToId: activeReply?.id }, token);
      const saved = normalizeMessage(result.data ?? result.message ?? result);
      setMessages(previous => [...previous.filter(item => item.id !== pendingId && item.id !== saved.id), saved]);
      fetchConversations();
      setReplyingTo(null);
    } catch (err: any) {
      setMessages(previous => previous.map(item => item.id === pendingId ? { ...item, pending: false, failed: true } : item));
      showToast?.({ type: 'error', title: 'Message not sent', message: errorMessage(err, { action: 'send the message', context: 'message', fallback: 'Tap retry to send again.' }) });
      throw err;
    }
  };

  const reactToMessage = async (message: Message, reaction: string) => {
    if (!token) return;
    try {
      const result = await apiPut<any>(`/api/messages/message/${message.id}/reaction`, { reaction }, token);
      const updated = normalizeMessage(result.data ?? result);
      setMessages(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Reaction failed', message: errorMessage(err, { action: 'add the reaction', fallback: 'Please try again.' }) }); }
  };

  // Telegram-style rich messages (location / poll / contact / wallet) travel as
  // typed messages with a JSON payload in `content`. Rendering is client-side.
  const sendSpecialMessage = async (type: string, payload: any, pendingLabel: string, attachments: any[] = []): Promise<boolean> => {
    if (!token || !user || !activeConversation || specialSendLockRef.current) return false;
    specialSendLockRef.current = true;
    setSpecialSending(true);
    const pendingId = `pending-${Date.now()}`;
    const pending = normalizeMessage({ id: pendingId, conversationId: activeConversation, senderId: user.id, sender: user, content: JSON.stringify(payload), type, attachments, createdAt: new Date().toISOString(), pending: true, pendingLabel });
    setMessages(previous => [...previous, pending]);
    try {
      const result = await apiPost<any>('/api/messages/send', { conversationId: activeConversation, content: JSON.stringify(payload), type, attachments }, token);
      const saved = normalizeMessage(result.data ?? result.message ?? result);
      setMessages(previous => [...previous.filter(item => item.id !== pendingId && item.id !== saved.id), saved]);
      fetchConversations();
      setSpecialSending(false);
      specialSendLockRef.current = false;
      return true;
    } catch (err: any) {
      setMessages(previous => previous.map(item => item.id === pendingId ? { ...item, pending: false, failed: true } : item));
      showToast?.({ type: 'error', title: 'Message not sent', message: errorMessage(err, { action: 'send it', fallback: 'Try again.' }) });
      setSpecialSending(false);
      specialSendLockRef.current = false;
      return false;
    }
  };

  const sendLocationMessage = () => {
    if (!navigator.geolocation) {
      showToast?.({ type: 'error', title: 'Location unavailable', message: 'This device or browser cannot share a location. You can type an address in chat instead.' });
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      showToast?.({ type: 'error', title: 'Location unavailable', message: 'Location sharing requires a secure connection. You can type an address in chat instead.' });
      return;
    }
    showToast?.({ type: 'info', title: 'Getting location', message: 'Sharing your current location...' });
    navigator.geolocation.getCurrentPosition(
      position => void sendSpecialMessage('LOCATION', { lat: position.coords.latitude, lng: position.coords.longitude }, 'Location'),
      error => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access in your device or browser settings, or type an address in chat.'
          : error.code === error.TIMEOUT
            ? 'Location lookup timed out. Try again, or type an address in chat.'
            : 'Could not read your location. Check that location access is allowed, or type an address in chat.';
        showToast?.({ type: 'error', title: 'Location unavailable', message });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const openWallet = () => {
    setShowAttachmentSheet(false);
    router.push('/balance');
  };

  const submitPoll = async () => {
    if (!pollDraft || pollSubmitLockRef.current) return;
    pollSubmitLockRef.current = true;
    const question = pollDraft.question.trim();
    const options = pollDraft.options.map(option => option.trim()).filter(Boolean);
    if (!question) { pollSubmitLockRef.current = false; showToast?.({ type: 'error', title: 'Add a question', message: 'Enter a question before creating the poll.' }); return; }
    if (options.length < 2) { pollSubmitLockRef.current = false; showToast?.({ type: 'error', title: 'Add more options', message: 'A poll needs at least two non-empty options.' }); return; }
    let imageUrl: string | undefined;
    let imageAttachment: any[] = [];
    if (pollDraft.imageFile) {
      if (!token || !activeConversation) { pollSubmitLockRef.current = false; return; }
      try {
        const form = new FormData();
        form.append('file', pollDraft.imageFile);
        form.append('conversationId', activeConversation);
        const uploaded = await apiUpload<any>('/api/upload/message', form, token);
        imageUrl = uploaded.url ?? uploaded.data?.url;
        const fileId = uploaded.fileId ?? uploaded.id ?? uploaded.data?.fileId;
        if (!imageUrl || !fileId) throw new Error('Upload did not return a usable image attachment');
        imageAttachment = [{ fileId, url: imageUrl, fileType: 'IMAGE', fileName: pollDraft.imageFile.name, fileSize: pollDraft.imageFile.size }];
      } catch (err: any) {
        showToast?.({ type: 'error', title: 'Poll image upload failed', message: errorMessage(err, { action: 'upload the poll image', context: 'photo', fallback: 'Please choose another image.' }) });
        pollSubmitLockRef.current = false;
        return;
      }
    }
    const sent = await sendSpecialMessage('POLL', { question, options, allowMultiple: pollDraft.allowMultiple, ...(imageUrl ? { imageUrl } : {}), votes: [] }, 'Poll', imageAttachment);
    if (sent) { setPollDraft(null); setShowAttachmentSheet(false); }
    pollSubmitLockRef.current = false;
  };

  const voteOnPoll = async (message: Message, optionIndex: number) => {
    if (!token || !message.id || message.pending || message.failed) return;
    try {
      const result = await apiPost<any>(`/api/messages/poll/${encodeURIComponent(message.id)}/vote`, { optionIndex }, token);
      const saved = normalizeMessage(result.data ?? result.message ?? result);
      setMessages(previous => previous.map(item => item.id === message.id ? saved : item));
    } catch (err: any) {
      showToast?.({ type: 'error', title: 'Vote not saved', message: errorMessage(err, { action: 'save your vote', fallback: 'Please try again.' }) });
    }
  };

  const searchContacts = async (query: string) => {
    setContactSearch(query);
    const sequence = ++contactSearchSequenceRef.current;
    const prefix = query.trim().replace(/^@/, '');
    if (!prefix) { setContactResults([]); setContactSearching(false); setContactSearchError(null); return; }
    if (!token) { setContactSearchError('Sign in again to search VANTA members.'); return; }
    setContactSearching(true);
    setContactSearchError(null);
    try {
      const result = await apiGet<any>(`/api/search?q=${encodeURIComponent(prefix)}&type=users&limit=30`, token);
      if (sequence !== contactSearchSequenceRef.current) return;
      const users = Array.isArray(result?.users) ? result.users : [];
      setContactResults(users
        .filter((person: any) => String(person.username || '').toLowerCase().startsWith(prefix.toLowerCase()))
        .sort((a: any, b: any) => String(a.username || '').localeCompare(String(b.username || '')))
        .slice(0, 20));
    } catch {
      if (sequence === contactSearchSequenceRef.current) {
        setContactResults([]);
        setContactSearchError('Could not search VANTA right now. Check your connection and try again.');
      }
    } finally {
      if (sequence === contactSearchSequenceRef.current) setContactSearching(false);
    }
  };

  const sendContactMessage = async (person: any) => {
    if (!token || !person?.username || contactSendInFlightRef.current) return;
    contactSendInFlightRef.current = true;
    setContactSearching(true);
    try {
      const profile = await apiGet<any>(`/api/profiles/public/${encodeURIComponent(person.username)}`, token);
      const profileCard = {
        userId: profile.id || person.id,
        username: profile.username || person.username,
        fullName: profile.fullName || person.fullName || person.username,
        avatarUrl: resolveMediaUrl(profile.avatarUrl || person.avatar || null) || null,
        bannerUrl: resolveMediaUrl(profile.bannerUrl || null) || null,
        bio: profile.bio || person.bio || '',
        verified: Boolean(profile.verified ?? person.verified),
        verificationType: profile.verificationType || person.verificationType || null,
        counts: {
          followers: Number.isFinite(Number(profile.counts?.followers ?? person._count?.followers)) && (profile.counts?.followers ?? person._count?.followers) != null ? Number(profile.counts?.followers ?? person._count?.followers) : null,
          following: Number.isFinite(Number(profile.counts?.following)) && profile.counts?.following != null ? Number(profile.counts.following) : null,
          posts: Number.isFinite(Number(profile.counts?.posts ?? profile.stats?.totalPosts)) && (profile.counts?.posts ?? profile.stats?.totalPosts) != null ? Number(profile.counts?.posts ?? profile.stats?.totalPosts) : null,
        },
        totalLikes: Number.isFinite(Number(profile.stats?.totalLikes)) && profile.stats?.totalLikes != null ? Number(profile.stats.totalLikes) : null,
        joinedAt: profile.joinedAt || profile.createdAt || null,
        online: typeof profile.online === 'boolean' ? profile.online : typeof person.online === 'boolean' ? person.online : null,
      };
      const sent = await sendSpecialMessage('CONTACT', profileCard, profileCard.fullName || profileCard.username);
      if (!sent) return;
      setContactPickerOpen(false);
      setShowAttachmentSheet(false);
      setContactSearch('');
      setContactResults([]);
      setContactSearchError(null);
    } catch (error: any) {
      showToast?.({ type: 'error', title: 'Profile not shared', message: errorMessage(error, { action: 'share this profile', fallback: 'This profile may be private or unavailable.' }) });
    } finally {
      contactSendInFlightRef.current = false;
      setContactSearching(false);
    }
  };

  const handleMusicAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !token || !activeConversation) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)) {
      showToast?.({ type: 'error', title: 'Unsupported file', message: 'Choose an audio file (mp3, wav, ogg, m4a, flac).' });
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast?.({ type: 'error', title: 'File too large', message: 'Audio must be 30 MB or smaller.' });
      return;
    }
    setShowAttachmentSheet(false);
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
      showToast?.({ type: 'error', title: 'Music not sent', message: errorMessage(err, { action: 'send the audio', fallback: 'The file could not be uploaded. Try again.' }) });
    }
  };

  const toggleMessagePin = async (message: Message) => {
    if (!token) return;
    try {
      const result = await apiPut<any>(`/api/messages/message/${message.id}/pin`, { pinned: !message.pinnedAt }, token);
      const updated = normalizeMessage(result.data ?? result);
      setMessages(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) { showToast?.({ type: 'error', title: 'Pin failed', message: errorMessage(err, { action: 'pin the message', fallback: 'Please try again.' }) }); }
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

  const blockActiveUser = () => {
    if (!token || !activeConv?.partnerId) return;
    setBlockConfirmOpen(true);
  };

  const confirmBlockActiveUser = async () => {
    if (!token || !activeConv?.partnerId) return;
    setBlockConfirmOpen(false);
    try {
      await apiPost('/api/settings/blocked', { targetId: activeConv.partnerId }, token);
      showToast?.({ type: 'success', title: 'Account blocked', message: `@${activeConv.username || activeConv.name} can no longer message you.` });
      setActiveConversation(null);
    } catch (err: any) {
      showToast?.({ type: 'error', title: 'Could not block account', message: err?.message || 'Please try again.' });
    }
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
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const imageInputs: { file: File; fileType: 'IMAGE' }[] = [];
    const documentInputs: { file: File; fileType: 'FILE' }[] = [];
    const videosToTrim: File[] = [];
    const documentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];

    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const isDocument = documentTypes.includes(file.type) || /\\.(pdf|doc|docx|txt)$/i.test(file.name);
      if (!isImage && !isVideo && !isDocument) {
        showToast?.({ type: 'error', title: 'Unsupported attachment', message: 'Choose an image, video, PDF, DOC, DOCX or TXT file.' });
        continue;
      }
      const limit = isVideo ? 100 * 1024 * 1024 : isDocument ? 10 * 1024 * 1024 : 15 * 1024 * 1024;
      if (file.size > limit) {
        const kind = isVideo ? 'Videos' : isDocument ? 'Documents' : 'Images';
        showToast?.({ type: 'error', title: 'File too large', message: `${kind} must be ${limit / 1024 / 1024} MB or smaller.` });
        continue;
      }
      if (isVideo) videosToTrim.push(file);
      else if (isImage) imageInputs.push({ file, fileType: 'IMAGE' });
      else documentInputs.push({ file, fileType: 'FILE' });
    }
    if (imageInputs.length) {
      setAttachmentDrafts(previous => addDrafts(previous, imageInputs, file => URL.createObjectURL(file)));
    }
    if (documentInputs.length) {
      setAttachmentDrafts(previous => addDrafts(previous, documentInputs, file => URL.createObjectURL(file)));
    }
    // Videos pass through the shared trimmer one at a time.
    if (videosToTrim.length) setTrimVideoFile(videosToTrim[0]);
  };

  /**
   * Native multi-select documents/files for the chat composer. Documents are
   * added as FILE drafts (no video-trim pass) and are uploaded + sent through
   * the same single-send pipeline as images and videos.
   */
  const handleDocumentAttachment = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const documentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    const documentInputs: { file: File; fileType: 'FILE' }[] = [];
    for (const file of files) {
      if (!documentTypes.includes(file.type)) {
        showToast?.({ type: 'error', title: 'Unsupported file type', message: 'Choose PDF, DOC, DOCX or TXT files.' });
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast?.({ type: 'error', title: 'File too large', message: 'Documents must be 10 MB or smaller.' });
        continue;
      }
      documentInputs.push({ file, fileType: 'FILE' });
    }
    if (documentInputs.length) {
      setAttachmentDrafts(previous => addDrafts(previous, documentInputs, file => URL.createObjectURL(file)));
    }
  };

  const captureLivePhoto = () => {
    const video = cameraPreviewRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      showToast?.({ type: 'error', title: 'Camera not ready', message: 'Wait for the live preview, then try again.' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) { showToast?.({ type: 'error', title: 'Photo failed', message: 'Could not capture this photo. Try again.' }); return; }
      const file = new File([blob], `vanta-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setAttachmentDrafts(previous => [...previous, {
        file, previewUrl: URL.createObjectURL(file), fileType: 'IMAGE', progress: 0, status: 'ready',
        id: typeof crypto !== 'undefined' && crypto?.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}`,
      }]);
    }, 'image/jpeg', 0.92);
  };

  /** Open the native device camera for a photo or video. */
  const openCamera = () => {
    setShowAttachmentSheet(false);
    // A hidden `<input type="file" capture>` opens the OS camera app and requests
    // camera permission at the OS level — no custom/photo-picker fallback.
    window.requestAnimationFrame(() => cameraInputRef.current?.click());
  };

  const handleTrimVideoConfirm = (result: VideoTrimResult) => {
    setTrimVideoFile(null);
    setAttachmentDrafts(previous => [...previous, {
      file: result.file,
      previewUrl: URL.createObjectURL(result.file),
      fileType: 'VIDEO',
      progress: 0,
      status: 'ready',
      id: typeof crypto !== 'undefined' && crypto?.randomUUID ? crypto.randomUUID() : `draft-legacy-${Date.now()}-${Math.random()}`,
    }]);
  };

  const revokeDraftUrls = (drafts: AttachmentDraft[]) => {
    drafts.forEach(draft => { try { URL.revokeObjectURL(draft.previewUrl); } catch { /* ignore */ } });
  };

  const cancelAttachment = (id?: string) => {
    if (id) {
      // Remove a single attachment without disturbing the typed caption or the
      // remaining attachments.
      const removed = attachmentDrafts.filter(draft => draft.id === id);
      setAttachmentDrafts(previous => removeDraft(previous, id));
      removed.forEach(draft => { try { URL.revokeObjectURL(draft.previewUrl); } catch { /* ignore */ } });
      return;
    }
    uploadAbortRef.current?.abort();
    const current = attachmentDrafts;
    setAttachmentDrafts([]);
    revokeDraftUrls(current);
    setIsUploadingAttachment(false);
  };

  /**
   * Upload every pending draft and send them as ONE in-chat message. A pending
   * message appears in the conversation immediately (with live upload progress)
   * and the composer/media-selection UI closes at once, so the user can keep
   * chatting while large files upload. When the uploads finish the same message
   * is swapped for the saved server message.
   */
  const uploadAndSendMedia = async (drafts: AttachmentDraft[], content: string, replyToId?: string): Promise<void> => {
    if (!token || !user || !activeConversation || !drafts.length) return;
    const sendConv = activeConversation;
    const pendingId = `pending-media-${Date.now()}`;
    const previewAttachments = drafts.map(draft => ({ url: draft.previewUrl, fileType: draft.fileType, fileName: draft.file.name }));
    const pending = normalizeMessage({
      id: pendingId, conversationId: sendConv, senderId: user.id, sender: user,
      content, attachments: previewAttachments, createdAt: new Date().toISOString(),
      pending: true, uploading: true, uploadProgress: 0,
      replyTo: activeReply ? { id: activeReply.id, content: activeReply.text, sender: activeReply.sender } : undefined,
    });
    setMessages(previous => [...previous, pending]);
    // Retain local files + preview URLs so a failed upload can be retried.
    pendingMediaRef.current[pendingId] = drafts.map(draft => ({ file: draft.file, fileType: draft.fileType, fileName: draft.file.name, previewUrl: draft.previewUrl }));
    // Release the composer + media-selection UI immediately.
    setReplyingTo(null);
    setMessageInput('');
    setAttachmentDrafts([]);
    resetComposerHeight();
    stopOutgoingTyping();
    clearTypingFor(activeConversation);

    const updateProgress = (value: number) => {
      if (activeConversationRef.current !== sendConv) return;
      setMessages(previous => previous.map(item => item.id === pendingId ? { ...item, uploadProgress: value } : item));
    };
    const total = drafts.length;
    let completed = 0;
    let firstError: any = null;
    const metas: any[] = [];

    for (const draft of drafts) {
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      try {
        const form = new FormData();
        form.append('file', draft.file);
        form.append('conversationId', sendConv);
        const uploaded = await apiUpload<any>('/api/upload/message', form, token, 'POST', progress => {
          const overall = Math.min(100, Math.round(((completed + progress / 100) / total) * 100));
          updateProgress(overall);
        }, controller.signal);
        const url = uploaded.url ?? uploaded.data?.url;
        const fileId = uploaded.fileId ?? uploaded.id ?? uploaded.data?.fileId;
        if (!url || !fileId) throw new Error('Upload did not return a usable attachment');
        metas.push({ fileId, url, fileType: draft.fileType, fileName: draft.file.name, fileSize: draft.file.size });
        completed += 1;
        updateProgress(Math.round((completed / total) * 100));
      } catch (err: any) {
        if (err?.statusCode !== 499) firstError = firstError ?? err;
        break;
      } finally {
        uploadAbortRef.current = null;
      }
    }

    if (firstError) {
      setMessages(previous => previous.map(item => item.id === pendingId ? { ...item, pending: false, uploading: false, failed: true } : item));
      showToast?.({ type: 'error', title: 'Upload failed', message: errorMessage(firstError, { action: 'upload the attachment', context: 'file', fallback: 'Tap retry to upload again.' }) });
      return;
    }

    try {
      const result = await apiPost<any>('/api/messages/send', { conversationId: sendConv, content, type: metas[0]?.fileType || 'TEXT', attachments: metas, replyToId }, token);
      const saved = normalizeMessage(result.data ?? result.message ?? result);
      if (activeConversationRef.current === sendConv) {
        setMessages(previous => [...previous.filter(item => item.id !== pendingId && item.id !== saved.id), saved]);
      } else {
        setMessages(previous => previous.filter(item => item.id !== pendingId));
      }
      fetchConversations();
      // Free local object URLs now that the saved message uses server URLs.
      (pendingMediaRef.current[pendingId] || []).forEach(ref => { try { URL.revokeObjectURL(ref.previewUrl); } catch { /* ignore */ } });
      delete pendingMediaRef.current[pendingId];
    } catch (err: any) {
      setMessages(previous => previous.map(item => item.id === pendingId ? { ...item, pending: false, uploading: false, failed: true } : item));
      showToast?.({ type: 'error', title: 'Message not sent', message: err?.message || 'Tap retry to send again.' });
    }
  };

  /**
   * Upload every pending draft then send them as ONE message with the caption so
   * multiple media + caption produce a single logical Message row (the backend
   * Message model carries many Attachment children).
   */
  const uploadAllAndSend = async (): Promise<void> => {
    if (!token || !activeConversation || !attachmentDrafts.length) return;
    const draftsToSend = attachmentDrafts.filter(item => item.status === 'ready' || item.status === 'failed');
    if (!draftsToSend.length) return;
    await uploadAndSendMedia(draftsToSend, messageInput.trim(), activeReply?.id);
    setIsUploadingAttachment(false);
  };

  /** Re-send a failed message. Media messages re-upload their retained files. */
  const retryFailedMessage = async (message: Message): Promise<void> => {
    if (!token || !activeConversation) return;
    const stored = pendingMediaRef.current[message.id];
    if (stored && stored.length) {
      const drafts: AttachmentDraft[] = stored.map(item => ({
        file: item.file,
        previewUrl: item.previewUrl,
        fileType: item.fileType,
        progress: 0,
        status: 'ready' as const,
        id: typeof crypto !== 'undefined' && crypto?.randomUUID ? crypto.randomUUID() : `draft-retry-${Date.now()}-${Math.random()}`,
      }));
      delete pendingMediaRef.current[message.id];
      setMessages(previous => previous.filter(item => item.id !== message.id));
      await uploadAndSendMedia(drafts, message.text || '', undefined);
    } else {
      await sendCurrentMessage(message.text, message.attachments || []);
    }
  };

  const sendComposer = () => {
    if (!activeConversation || (!messageInput.trim() && !attachmentDrafts.length)) return;
    const hasReadyOrFailed = attachmentDrafts.some(item => item.status === 'ready' || item.status === 'failed');
    if (hasReadyOrFailed) {
      if (editingMessage) return;
      // ONE Send action: upload all selected attachments, then send them as a
      // single message with the caption. No second send button is introduced.
      void uploadAllAndSend();
    } else {
      if (editingMessage) { void saveEditedMessage(); return; }
      void sendCurrentMessage();
    }
    // Collapse the auto-expanding composer back to a single line after sending.
    resetComposerHeight();
  };

  const resetComposerHeight = () => {
    if (messageInputRef.current) {
      messageInputRef.current.style.height = 'auto';
    }
  };

  const editExistingMessage = (message: Message) => {
    if (!token || !message.isOwn || message.deletedAt) return;
    setEditingMessage(message); setMessageInput(message.text);
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
    finally { setEditingMessage(null); setMessageInput(''); resetComposerHeight(); }
  };

  const deleteExistingMessage = (message: Message) => {
    if (!token) return;
    setDeleteForEveryone(false);
    setDeleteConfirmMessage(message);
  };

  const confirmDeleteMessage = async () => {
    const message = deleteConfirmMessage;
    if (!token || !message) return;
    setDeleteConfirmMessage(null);
    setDeleteForEveryone(false);
    try {
      const result = await apiDelete<any>(`/api/messages/message/${message.id}?forEveryone=${deleteForEveryone && message.isOwn}`, token);
      const deleted = normalizeMessage(result.data ?? result);
      // A deleted message is wiped from the conversation — never shown as a
      // placeholder or tombstone. Removing it from local state immediately
      // keeps the UI consistent until the authoritative `message:deleted`
      // socket event (or a re-fetch) confirms it.
      setMessages(previous => previous.filter(item => item.id !== deleted.id));
      fetchConversations();
    } catch (err: any) { showToast?.({ type: 'error', title: 'Delete failed', message: err?.message || 'Could not delete this message.' }); }
  };

  const requestDeleteSelectedMessages = () => {
    const selected = messages.filter(message => selectedMessageIds.has(message.id));
    if (!selected.length) return;
    setDeleteForEveryone(false);
    setDeleteSelectedConfirmOpen(true);
  };

  const confirmDeleteSelectedMessages = async () => {
    if (!token) return;
    const selected = messages.filter(message => selectedMessageIds.has(message.id));
    const deletable = selected;
    if (!deletable.length) {
      setDeleteSelectedConfirmOpen(false);
      closeMessageSelection();
      return;
    }
    setDeleteSelectedConfirmOpen(false);
    const results: Array<PromiseSettledResult<any>> = [];
    for (let index = 0; index < deletable.length; index += 10) {
      const batch = await Promise.allSettled(deletable.slice(index, index + 10).map(message =>
        apiDelete<any>(`/api/messages/message/${message.id}?forEveryone=${deleteForEveryone && message.isOwn}`, token)
      ));
      results.push(...batch);
    }
    const deletedIds = deletable.filter((_, index) => results[index].status === 'fulfilled').map(message => message.id);
    const failedIds = deletable.filter((_, index) => results[index].status === 'rejected').map(message => message.id);
    if (deletedIds.length) {
      const deleted = new Set(deletedIds);
      setMessages(previous => previous.filter(message => !deleted.has(message.id)));
      void fetchConversations();
    }
    setSelectedMessageIds(new Set(failedIds));
    setDeleteForEveryone(false);
    if (failedIds.length) {
      showToast?.({ type: 'error', title: 'Some messages were not deleted', message: `${deletedIds.length} deleted; ${failedIds.length} could not be deleted. The remaining messages are still selected.` });
    } else {
      showToast?.({ type: 'success', title: 'Messages deleted', message: `${deletedIds.length} messages deleted.` });
    }
  };

  const startMessageLongPress = (message: Message, event?: React.PointerEvent) => {
    if (message.pending || (event?.pointerType === 'mouse' && event.button !== 0)) return;
    if (event) {
      swipeStartRef.current = { id: message.id, x: event.clientX, y: event.clientY, offset: 0 };
    }
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      swipeStartRef.current = null;
      longPressedMessageRef.current = message.id;
      setSelectedMessageIds(current => current.size ? new Set([...current, message.id]) : new Set([message.id]));
      if ('vibrate' in navigator) navigator.vibrate(18);
    }, 420);
  };

  const toggleMessageSelection = (id: string) => {
    setSelectedMessageIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const closeMessageSelection = () => {
    if (selectionHistoryRef.current) {
      selectionHistoryRef.current = false;
      window.history.back();
    }
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressedMessageRef.current = null;
    swipeStartRef.current = null;
    swipeOffsetRef.current = 0;
    setSwipeOffset(null);
    setDeleteSelectedConfirmOpen(false);
    setSelectedMessageIds(new Set());
  };

  // Give message selection its own history entry. Android/system Back closes
  // selection first instead of unexpectedly navigating away from the chat.
  useEffect(() => {
    if (selectedMessageIds.size > 0 && !selectionHistoryRef.current) {
      window.history.pushState(
        { ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}), vantaMessageSelection: true },
        '',
        window.location.href,
      );
      selectionHistoryRef.current = true;
    }
    if (selectedMessageIds.size === 0) {
      if (selectionHistoryRef.current) {
        selectionHistoryRef.current = false;
        window.history.back();
      }
      return;
    }
    const closeOnBack = () => {
      selectionHistoryRef.current = false;
      closeMessageSelection();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMessageSelection();
      }
    };
    window.addEventListener('popstate', closeOnBack);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('popstate', closeOnBack);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedMessageIds.size]);

  // Never allow the selection toolbar to leak into the conversation list.
  useEffect(() => {
    if (showMobileList || !activeConversation) {
      setDeleteSelectedConfirmOpen(false);
      closeMessageSelection();
    }
  }, [showMobileList, activeConversation]);

  const copySelectedMessages = async () => {
    const selected = messages.filter(message => selectedMessageIds.has(message.id));
    const content = selected.map(message => message.text || (message.attachments?.length ? '[Attachment]' : '')).filter(Boolean).join('\n');
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      showToast?.({ type: 'success', title: 'Copied', message: selected.length === 1 ? 'Message copied to clipboard.' : 'Messages copied to clipboard.' });
      closeMessageSelection();
    } catch {
      showToast?.({ type: 'error', title: 'Copy failed', message: 'VANTA could not access the clipboard. Please try again.' });
    }
  };

  const forwardSelectedMessages = async () => {
    const selected = messages.filter(message => selectedMessageIds.has(message.id));
    const content = selected.map(message => message.text || (message.attachments?.length ? '[Attachment]' : '')).filter(Boolean).join('\n\n');
    if (!content) return;
    try {
      if (navigator.share) await navigator.share({ title: 'VANTA messages', text: content });
      else {
        await navigator.clipboard.writeText(content);
        showToast?.({ type: 'success', title: 'Ready to forward', message: 'Selected messages copied. Paste them into a chat.' });
      }
      closeMessageSelection();
    } catch (error: any) {
      if (error?.name !== 'AbortError') showToast?.({ type: 'error', title: 'Forward failed', message: error?.message || 'Please try again.' });
    }
  };

  const cancelMessageLongPress = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const resetCreateModal = (options?: { discardImage?: boolean }) => {
    const discardImage = options?.discardImage ?? true;
    const pendingFileId = createAvatarFileIdRef.current;

    // Cancel/back must discard the temporary uploaded image so it can NEVER
    // become anyone's profile picture or linger unattached on the server.
    if (discardImage && pendingFileId) {
      createAvatarFileIdRef.current = null;
      setCreateAvatarFileId(null);
      if (token) {
        apiDelete<any>(`/api/upload/files/${pendingFileId}`, token).catch(() => undefined);
      }
    }

    setCreateModalOpen(false);
    setCreateType(null);
    setAutoDeleteSeconds(0);
    setCreatorFollowers([]);
    setCreateName('');
    setCreateDescription('');
    setCreateHandle('');
    setCreateVisibility('PUBLIC');
    setCreateAvatar(null);
    setCreateAvatarError(null);
    setCreateValidationError(null);
    setMemberSearch('');
    setMemberSearchResults([]);
    setSelectedMembers([]);
  };

  const handleOpenCreateModal = (type: 'group' | 'channel') => {
    setCreateType(type);
    setCreateModalOpen(true);
    setAutoDeleteSeconds(0);
    if (type === 'group' && token) {
      setFollowersLoading(true);
      apiGet<any>('/api/profiles/me/followers?limit=100', token)
        .then(result => { const items = result?.items ?? result?.data?.items ?? []; setCreatorFollowers(items); setMemberSearchResults(items.filter((item: any) => item.id !== user?.id)); })
        .catch(() => setCreatorFollowers([]))
        .finally(() => setFollowersLoading(false));
    }
    setCreateAvatar(null);
    setCreateAvatarError(null);
    setCreateValidationError(null);
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

  const handleSearchMembers = useCallback((query: string) => {
    setMemberSearch(query);
    const normalized = query.trim().toLowerCase();
    setMemberSearchResults(creatorFollowers.filter((item: any) => item.id !== user?.id && !selectedMembers.some((member) => member.id === item.id) && (!normalized || String(item.username || '').toLowerCase().includes(normalized) || String(item.fullName || '').toLowerCase().includes(normalized))));
  }, [creatorFollowers, user?.id, selectedMembers]);

  /**
   * Create Group / Create Channel image upload.
   *
   * This intentionally uses the dedicated TEMP ENTITY endpoint
   * (`POST /api/upload/entity-avatar`), which stores the asset as an isolated
   * `group-avatar` / `channel-avatar` file owned by the user. It never calls
   * the profile avatar endpoint (`/api/upload/avatar`) and can never change
   * the user's personal profile picture. If the flow is cancelled the file is
   * deleted again; if the flow completes it is linked to the new record.
   */
  const handleCreateImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !token || !createType) return;

    const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'];
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    const imageTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif' };
    const expectedType = imageTypes[extension];
    const uploadFile = expectedType && !ACCEPTED.includes(file.type) ? new File([file], file.name, { type: expectedType, lastModified: file.lastModified }) : file;
    const MAX_SIZE = 5 * 1024 * 1024;
    if (!ACCEPTED.includes(uploadFile.type)) {
      setCreateAvatarError('Please choose a JPG, PNG, WebP, GIF, AVIF, BMP, TIFF or HEIC image.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setCreateAvatarError('This image is larger than 5MB. Please choose a smaller file.');
      return;
    }

    setCreateAvatarError(null);
    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', uploadFile);
      formData.append('entityType', createType === 'group' ? 'group' : 'channel');
      const uploadResult = await apiUpload<{ url: string; id?: string; file?: { id?: string } }>(
        '/api/upload/entity-avatar',
        formData,
        token
      );
      const url = uploadResult.url;
      const fileId = uploadResult.id ?? uploadResult.file?.id ?? null;
      setCreateAvatar(url);
      createAvatarFileIdRef.current = fileId;
      setCreateAvatarFileId(fileId);
    } catch (error: any) {
      setCreateAvatarError(errorMessage(error, { action: 'upload the image', context: 'photo', fallback: 'The image could not be uploaded right now.' }));
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  /** Remove the temporary create image — both from the UI and the server. */
  const removeCreateAvatar = async () => {
    const fileId = createAvatarFileIdRef.current;
    createAvatarFileIdRef.current = null;
    setCreateAvatarFileId(null);
    setCreateAvatar(null);
    setCreateAvatarError(null);
    if (fileId && token) {
      apiDelete<any>(`/api/upload/files/${fileId}`, token).catch(() => undefined);
    }
  };

  const handleCreateEntity = async () => {
    if (!token || !createType) return;
    if (!createName.trim()) {
      setCreateValidationError(`Please give your new ${createType} a name.`);
      return;
    }
    setCreateValidationError(null);

    setIsCreatingEntity(true);
    try {
      const endpoint = createType === 'group' ? '/api/groups' : '/api/channels';
      const payload = {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        avatar: createAvatar || undefined,
        memberIds: selectedMembers.filter((member) => member.id !== user?.id).map((member) => member.id),
        ...(createType === 'group' ? { autoDeleteSeconds } : {}),
        ...(createType === 'channel' ? { handle: createHandle.trim().replace(/^@/, '') || undefined, visibility: createVisibility } : {}),
      };

      const created = await apiPost<any>(endpoint, payload, token);
      const entityId = created.id ?? created.group?.id ?? created.channel?.id ?? created.conversationId;

      // Bind the temporary group/channel photo to the NEW record — it belongs
      // to the Group/Channel avatar, NEVER to the user's profile.
      const pendingFileId = createAvatarFileIdRef.current;
      if (pendingFileId && entityId) {
        createAvatarFileIdRef.current = null;
        setCreateAvatarFileId(null);
        apiPost<any>('/api/upload/link', {
          fileId: pendingFileId,
          recordType: createType === 'group' ? 'Group' : 'Channel',
          recordId: entityId,
          category: createType === 'group' ? 'group-avatar' : 'channel-avatar',
        }, token).catch(() => undefined);
      }

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
      resetCreateModal({ discardImage: false });
      showToast?.({
        type: 'success',
        title: createType === 'group' ? 'Group created' : 'Channel created',
        message: `${createName.trim()} is now ready for conversation.`,
      });
    } catch (error: any) {
      // The group/channel was never created — discard the temporary image so
      // it can never become anyone's profile picture.
      const pendingFileId = createAvatarFileIdRef.current;
      if (pendingFileId && token) {
        createAvatarFileIdRef.current = null;
        setCreateAvatarFileId(null);
        apiDelete<any>(`/api/upload/files/${pendingFileId}`, token).catch(() => undefined);
      }
      // Normalize the failure into human copy and keep the modal open with the
      // user's typed name intact so they can correct the field and retry.
      const friendly = friendlyError(error, {
        action: createType === 'group' ? 'create the group' : 'create the channel',
        context: createType,
      });
      setCreateValidationError(friendly.message);
      showToast?.({
        type: 'error',
        title: friendly.title,
        message: friendly.message,
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

  // The moment a call leaves the idle state the in-call overlay appears, so the
  // call-type menu must disappear with it (prevents a stale floating menu).
  useEffect(() => {
    if (chatCalls.status !== 'idle') setCallMenuOpen(false);
  }, [chatCalls.status]);
  const isManagedOwner = Boolean(managedEntity?.ownerId && managedEntity.ownerId === user?.id);
  const isGroupPrivileged = ['OWNER', 'ADMIN'].includes(activeConv?.currentRole || '');
  const canEditEntity = activeConv?.type === 'group'
    ? isGroupPrivileged || managedEntity?.permissions?.changeGroupInfo === true || managedEntity?.permissions?.addMembers === true
    : activeConv?.type === 'channel' && ['OWNER', 'ADMIN', 'MODERATOR'].includes(activeConv.currentRole || '')
      && (isManagedOwner || managedEntity?.permissions?.manageChannelInfo !== false || managedEntity?.permissions?.manageSubscribers !== false);
  const canEditEntityInfo = activeConv?.type === 'group'
    ? isGroupPrivileged || managedEntity?.permissions?.changeGroupInfo === true
    : activeConv?.type === 'channel' && ['OWNER', 'ADMIN', 'MODERATOR'].includes(activeConv.currentRole || '')
      && (isManagedOwner || managedEntity?.permissions?.manageChannelInfo !== false);
  const canManageEntityMembers = activeConv?.type === 'group'
    ? isGroupPrivileged || managedEntity?.permissions?.addMembers === true
    : activeConv?.type === 'channel' && ['OWNER', 'ADMIN', 'MODERATOR'].includes(activeConv.currentRole || '')
      && (isManagedOwner || managedEntity?.permissions?.manageSubscribers !== false);
  const canRemoveEntityMembers = activeConv?.type === 'group' ? isGroupPrivileged : canManageEntityMembers;
  const canManageEntityPermissions = activeConv?.type === 'group' ? isGroupPrivileged : activeConv?.type === 'channel' && isManagedOwner;
  const managedPermissions = activeConv?.type === 'channel'
    ? [
        ['postMessages', 'Post messages'],
        ['editMessages', 'Edit messages'],
        ['deleteMessages', 'Delete messages'],
        ['manageChannelInfo', 'Manage channel info'],
        ['manageSubscribers', 'Manage subscribers'],
      ]
    : [
        ['sendMessages', 'Send messages'], ['sendMedia', 'Send media'], ['sendLinks', 'Send links'],
        ['addMembers', 'Add members'], ['pinMessages', 'Pin messages'], ['changeGroupInfo', 'Change group info'],
      ];
  // Plain-language, enforced description for every permission toggle. Defaults
  // are always the safe, current VANTA behaviour — toggling only ever expands a
  // capability to members (or restricts admins) and is checked on the server.
  const permissionHints: Record<string, string> = activeConv?.type === 'channel'
    ? {
        postMessages: 'Members can publish posts to the channel.',
        editMessages: 'Administrators can edit any member’s post.',
        deleteMessages: 'Administrators can remove any member’s post.',
        manageChannelInfo: 'Administrators can change the name, description and photo.',
        manageSubscribers: 'Administrators can add or remove subscribers.',
      }
    : {
        sendMessages: 'Members can send messages.',
        sendMedia: 'Members can send photos and videos.',
        sendLinks: 'Members can send links.',
        addMembers: 'Members can add new people to the group.',
        pinMessages: 'Members can pin messages.',
        changeGroupInfo: 'Members can edit the name and description.',
      };
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
    const conversationId = activeConv.id;
    const requestId = ++entityInfoRequestRef.current;
    try {
      const entityId = activeConv.entityId || activeConv.id;
      const entity = await apiGet<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${entityId}`, token);
      if (entityInfoRequestRef.current !== requestId || activeConversationRef.current !== conversationId) return;
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
    } catch (err: any) {
      if (entityInfoRequestRef.current === requestId && activeConversationRef.current === conversationId) showToast?.({ type: 'error', title: `Could not open ${activeConv.type} settings`, message: err?.message || 'Please try again.' });
    }
  };

  const uploadEntityAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !token || !activeConv || !editEntityId || !canEditEntityInfo) return;
    setIsUploadingAvatar(true);
    try {
      const form = new FormData(); form.append('avatar', file);
      const uploaded = await apiUpload<any>(`/api/upload/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}/avatar`, form, token);
      setEditAvatar(uploaded.url ?? uploaded.data?.url);
    } catch (err: any) { showToast?.({ type: 'error', title: 'Photo upload failed', message: errorMessage(err, { action: 'upload the photo', context: 'photo', fallback: 'Please choose another image.' }) }); }
    finally { setIsUploadingAvatar(false); }
  };

  const saveEntityChanges = async () => {
    if (!token || !activeConv || !editEntityId || !editName.trim() || !canEditEntityInfo || entitySaveInFlightRef.current) return;
    const conversationId = activeConv.id;
    const requestId = entityInfoRequestRef.current;
    entitySaveInFlightRef.current = true;
    setIsSavingEntity(true);
    try {
      const updated = await apiPut<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}`, { name: editName.trim(), description: editDescription.trim(), avatar: editAvatar, ...((activeConv.type === 'group' && isGroupPrivileged) || (activeConv.type === 'channel' && isManagedOwner) ? { permissions: managedEntity?.permissions || {} } : {}), ...(activeConv.type === 'channel' ? { visibility: editVisibility, handle: editHandle.trim().replace(/^@/, '') } : {}) }, token);
      if (entityInfoRequestRef.current !== requestId || activeConversationRef.current !== conversationId) return;
      setConversations(previous => previous.map(item => item.id === conversationId ? { ...item, name: updated.name || editName.trim(), description: updated.description ?? editDescription.trim(), avatar: updated.avatar ?? editAvatar ?? undefined } : item));
      setManagedEntity(updated);
      setEditEntityOpen(false);
      showToast?.({ type: 'success', title: `${activeConv.type === 'group' ? 'Group' : 'Channel'} updated`, message: 'Changes are visible throughout Chat.' });
    } catch (err: any) {
      if (entityInfoRequestRef.current === requestId && activeConversationRef.current === conversationId) showToast?.({ type: 'error', title: 'Changes not saved', message: errorMessage(err, { action: 'save the changes', context: activeConv?.type === 'channel' ? 'channel' : 'group', fallback: 'Please try again.' }) });
    } finally {
      entitySaveInFlightRef.current = false;
      setIsSavingEntity(false);
    }
  };

  const searchManagementUsers = async (value: string) => {
    const requestId = ++managementSearchRequestRef.current;
    const conversationId = activeConversationRef.current;
    setManagementSearch(value);
    if (!token || value.trim().length < 2) { setManagementResults([]); return; }
    try {
      const result = await apiGet<any>(`/api/search?q=${encodeURIComponent(value.trim())}&type=users`, token);
      const users = result?.results?.users ?? result?.data?.users ?? result?.users ?? (Array.isArray(result) ? result : []);
      if (managementSearchRequestRef.current !== requestId || activeConversationRef.current !== conversationId) return;
      const memberIds = new Set((managedEntity?.members || []).map((member: any) => member.userId));
      setManagementResults(users.filter((person: any) => person.id !== user?.id && !memberIds.has(person.id)));
    } catch {
      if (managementSearchRequestRef.current === requestId && activeConversationRef.current === conversationId) setManagementResults([]);
    }
  };

  const updateManagedMembers = async (memberIds: string[], successMessage: string) => {
    if (!token || !activeConv || !editEntityId || !canManageEntityMembers) return;
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
    if (!canRemoveEntityMembers) return;
    const username = member.user?.username || 'this member';
    if (!window.confirm(`Remove ${username} from this ${activeConv?.type}?`)) return;
    void updateManagedMembers((managedEntity?.members || []).filter((item: any) => item.userId !== member.userId).map((item: any) => item.userId), `${username} removed`);
  };

  const changeManagedRole = async (member: any, role: string) => {
    if (!token || !activeConv || !editEntityId || !isGroupPrivileged && activeConv.type === 'group' || activeConv.type === 'channel' && !isManagedOwner || managementBusy || !member?.userId || !['MEMBER', 'ADMIN', 'MODERATOR'].includes(role)) return;
    const conversationId = activeConv.id;
    const requestId = entityInfoRequestRef.current;
    const action = role === 'MEMBER' ? 'remove administrator rights from' : 'promote';
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} @${member.user?.username || 'member'}?`)) return;
    setManagementBusy(member.userId);
    try {
      const updated = await apiPut<any>(`/api/${activeConv.type === 'group' ? 'groups' : 'channels'}/${editEntityId}`, { memberRoles: { [member.userId]: role } }, token);
      if (entityInfoRequestRef.current !== requestId || activeConversationRef.current !== conversationId) return;
      setManagedEntity(updated);
      showToast?.({ type: 'success', title: 'Administrator access updated', message: 'The new role is active.' });
    } catch (err: any) {
      if (entityInfoRequestRef.current === requestId && activeConversationRef.current === conversationId) showToast?.({ type: 'error', title: 'Role not changed', message: err?.message || 'Please try again.' });
    }
    finally { setManagementBusy(null); }
  };

  const toggleManagedPermission = (key: string) => {
    if (!canManageEntityPermissions || !managedPermissions.some(([permission]) => permission === key)) return;
    setManagedEntity((previous: any) => { const current = previous?.permissions?.[key] ?? (activeConv?.type === 'channel' ? ['deleteMessages', 'manageChannelInfo', 'manageSubscribers'].includes(key) : ['sendMessages', 'sendMedia', 'sendLinks'].includes(key)); return { ...previous, permissions: { ...(previous?.permissions || {}), [key]: !current } }; });
  };

  const confirmOwnershipTransfer = async () => {
    if (!token || !activeConv || !editEntityId || !ownershipConfirm || activeConv.type === 'direct' || !isManagedOwner || managementBusy || !ownershipConfirm.userId || ownershipConfirm.userId === user?.id) return;
    const conversationId = activeConv.id;
    const requestId = entityInfoRequestRef.current;
    setManagementBusy('ownership');
    try {
      const endpoint = activeConv.type === 'group' ? 'groups' : 'channels';
      const updated = await apiPost<any>(`/api/${endpoint}/${editEntityId}/transfer-ownership`, { targetUserId: ownershipConfirm.userId }, token);
      if (entityInfoRequestRef.current !== requestId || activeConversationRef.current !== conversationId) return;
      setManagedEntity(updated);
      setOwnershipConfirm(null);
      // The backend also broadcasts `conversations:refresh` on the socket, but a
      // local refetch makes the new owner/role state appear instantly here too.
      await fetchConversations();
      if (entityInfoRequestRef.current !== requestId || activeConversationRef.current !== conversationId) return;
      const targetName = ownershipConfirm.user?.username || 'The new owner';
      showToast?.({
        type: 'success',
        title: 'Ownership transferred',
        message: `${targetName} is now the owner of this ${activeConv.type}.`,
      });
    } catch (err: any) {
      if (entityInfoRequestRef.current === requestId && activeConversationRef.current === conversationId) showToast?.({
        type: 'error',
        title: 'Ownership transfer failed',
        message: err?.message || 'Please try again.',
      });
    } finally {
      setManagementBusy(null);
    }
  };

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
        'chat-screen fixed inset-x-0 top-[var(--chat-viewport-offset,0px)] bottom-0 z-10 flex min-h-0 w-screen max-w-none overflow-hidden overscroll-none bg-[#050505]'
      )}
    >
      {/* Conversation List */}
      <div className={cn(
        'flex h-full min-h-0 w-full shrink-0 flex-col border-r border-white/[0.08] bg-[#0d0d0f] md:w-[360px] md:max-w-[38vw]',
        !showMobileList && 'hidden md:flex'
      )}>
        {/* Header */}
        <div className="flex h-14 min-h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-white/[0.045] flex items-center justify-center">
              <MessageCircle size={17} strokeWidth={2} className="text-white/75" />
            </div>
            <h1 className="text-base font-semibold tracking-tight text-white">Chats</h1>
          </div>
          <button type="button" onClick={() => router.push('/notifications')} aria-label="Open notifications" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/65 transition hover:bg-white/[.06] hover:text-white">
            <Bell size={18} />
            {notificationUnread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#d6a83f] px-1 text-[9px] font-bold leading-none text-black">{notificationUnread > 99 ? '99+' : notificationUnread}</span>}
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 py-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-white/[0.08] bg-[#161616] py-2.5 pl-9 pr-4 text-sm text-white placeholder-gray-500 outline-none transition-all"
            />
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1 rounded-lg bg-white/[0.035] p-0.5" role="tablist" aria-label="Conversation types">
            {(['all', 'direct', 'group', 'channel', 'unread'] as const).map(value => {
              const label = value === 'all' ? 'Chats' : value === 'direct' ? 'People' : value === 'group' ? 'Groups' : value === 'channel' ? 'Channels' : 'Unread';
              return <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn('min-w-0 rounded-lg px-1.5 py-2 text-[10px] font-medium transition', filter === value ? 'bg-[#d6a83f]/15 text-[#f2c75c] shadow-sm' : 'text-white/45 hover:bg-white/[0.04] hover:text-white/80')}><span className="block truncate">{label}</span></button>;
            })}
          </div>
          
        </div>

        {selectedConversationIds.size > 0 && (
          <div className="flex min-h-11 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#171717] px-4">
            <span className="text-xs font-semibold text-white">{selectedConversationIds.size} selected</span>
            <button type="button" onClick={() => { setSelectedConversationIds(new Set()); longPressedConversationRef.current = null; }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#d6a83f] hover:bg-white/[.05]">Cancel</button>
          </div>
        )}

        {/* Conversation List */}
        <PullToRefresh onRefresh={() => fetchConversations(true)} className="min-h-0 w-full flex-1 touch-pan-y" ariaLabel="Your conversations">
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
                onClick={() => handleConversationRowClick(conv.id)}
                onPointerDown={event => beginConversationLongPress(conv.id, event)}
                onPointerUp={clearConversationLongPress}
                onPointerCancel={clearConversationLongPress}
                onPointerLeave={clearConversationLongPress}
                onPointerMove={trackConversationLongPress}
                onContextMenu={event => {
                  event.preventDefault();
                  clearConversationLongPress();
                  setSelectedConversationIds(current => current.has(conv.id) ? current : new Set([conv.id]));
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left select-none',
                  selectedConversationIds.has(conv.id)
                    ? 'bg-[#d6a83f]/[0.12] border-l-2 border-[#d6a83f]'
                    : activeConversation === conv.id
                      ? 'bg-[#d6a83f]/[0.07] border-l-2 border-[#d6a83f]'
                      : 'hover:bg-white/[0.02] border-l-2 border-transparent'
                )}
              >
                <div className="relative shrink-0">
                  {selectedConversationIds.size > 0 && <span className={cn('absolute -left-1.5 -top-1.5 z-10 grid h-4 w-4 place-items-center rounded-full border', selectedConversationIds.has(conv.id) ? 'border-[#d6a83f] bg-[#d6a83f] text-black' : 'border-white/35 bg-[#111] text-transparent')}>{selectedConversationIds.has(conv.id) && <Check size={11} strokeWidth={3}/>}</span>}
                  <Avatar src={conv.avatar} alt={conv.name} size="md" wrapperClassName="!h-10 !w-10" className="!h-10 !w-10" />
                  {conv.type === 'direct' && conv.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0a0f]" />
                  )}
                  {conv.type !== 'direct' && <span className="absolute -top-1 -right-1 rounded-full border border-white/10 bg-[#161616] p-1 text-white/50">{conv.type === 'channel' ? <Megaphone size={9} /> : <Users size={9} />}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1 text-sm font-semibold text-white truncate">{conv.name}{conv.verified && conv.verificationType && <VerificationBadge verified type={conv.verificationType} size="xs" className="shrink-0" />}</p>
                    {conv.lastMessage && (
                      <span className="text-[11px] text-gray-500 shrink-0 ml-2">
                        {formatRelativeChatTime(conv.lastMessage.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {typingByConversation[conv.id] && conv.type !== 'channel' ? (
                      <p className="text-xs italic text-white/60 truncate flex-1">typing…</p>
                    ) : (
                      <>
                        {(conv.type === 'group' || conv.type === 'channel') && (
                          <span className="text-[11px] text-gray-500 shrink-0">
                            {conv.type === 'group'
                              ? `${conv.memberCount || 0} members${conv.onlineMemberCount ? ` · ${conv.onlineMemberCount} online` : ''}`
                              : `${conv.memberCount || 1} subscribers`}
                          </span>
                        )}
                        {conv.lastMessage ? (
                          <p className={cn('text-xs truncate flex-1', conv.unread > 0 ? 'font-semibold text-white/85' : 'text-gray-500')}>
                            {conv.unread > 0 ? (
                              <span className="mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d6a83f] px-1 align-middle text-[9px] font-bold leading-none text-black">{conv.unread > 99 ? '99+' : conv.unread}</span>
                            ) : conv.lastMessage.isOwn ? (
                              conv.lastMessage.read
                                ? <CheckCheck size={10} className="inline mr-1 text-white/70" />
                                : <Check size={10} className="inline mr-1 text-gray-500" />
                            ) : null}
                            {conv.lastMessage.type === 'STORY_REPLY' && <span className="inline-flex items-center gap-1 rounded bg-[#d6a83f]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#d6a83f]"><MessageCircle size={9} />Story reply</span>}
                            {(conv.type === 'group' || conv.type === 'channel') && conv.lastMessage.sender && conv.lastMessage.sender !== 'Unknown' && (
                              <span className="font-medium text-white/60">{conv.lastMessage.isOwn ? 'You' : conv.lastMessage.sender}: </span>
                            )}
                            {conv.lastMessage.text.trim() || (conv.lastMessage.hasAttachments ? (conv.lastMessage.type === 'AUDIO' ? 'Voice message' : 'Attachment') : conv.lastMessage.type === 'SYSTEM' ? 'System message' : conv.lastMessage.type === 'AUDIO' ? 'Voice message' : conv.lastMessage.type === 'CALL' ? 'Call' : conv.lastMessage.type === 'WALLET' ? 'Wallet update' : conv.lastMessage.type === 'POLL' ? 'Poll' : 'Message')}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 truncate flex-1">{conv.type === 'group' ? 'Group created' : conv.type === 'channel' ? 'Channel created' : 'No chats yet'}</p>
                        )}
                      </>
                    )}
                    {conv.muted && <BellOff size={11} className="shrink-0 text-white/30" />}
                  </div>
                </div>
              </button>
            ))
          )}
          {conversationCursor && <div className="flex justify-center py-3"><button onClick={loadMoreConversations} className="rounded-full bg-white/[0.04] px-3 py-1 text-[10px] text-white/40">Load more</button></div>}
        </PullToRefresh>
      </div>

      {/* Chat Window */}
      <div className={cn(
        'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#050505]',
        showMobileList && 'hidden md:flex'
      )}>
        {activeConversation && activeConv ? (
          <>
            {/* Chat Header */}
             {selectedMessageIds.size > 0 && (
              <header className="relative z-20 flex h-14 min-h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#1F2630] px-3">
                <button type="button" onClick={closeMessageSelection} aria-label="Exit message selection" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/75 transition hover:bg-white/[0.07] hover:text-white"><X size={20}/></button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{selectedMessageIds.size} selected</p>
                  <p className="text-[10px] text-white/45">Choose messages to manage</p>
                </div>
                <button type="button" onClick={() => setSelectedMessageIds(current => current.size === messages.length ? new Set() : new Set(messages.filter(message => !message.pending).map(message => message.id)))} className="rounded-full px-3 py-2 text-[11px] font-semibold text-[#f2c75c] transition hover:bg-[#d6a83f]/10">{selectedMessageIds.size === messages.filter(message => !message.pending).length ? "Clear all" : "Select loaded"}</button>
              </header>
            )}
            <header className={cn("relative z-20 flex h-14 min-h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0d0d0f]/95 px-3 backdrop-blur-xl", selectedMessageIds.size > 0 && "hidden")}>
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={handleCloseConversation}
                   className="grid h-10 w-10 place-items-center text-[#c8c8cc] hover:text-white"
                >
                  <ArrowLeft size={18} />
                </button>
                <button onClick={openConversationInfo} className="flex min-w-0 items-center gap-3 text-left" aria-label={`Open ${activeConv.name} information`}>
                 <Avatar src={activeConv.avatar} alt={activeConv.name} size="sm" wrapperClassName="!h-[35px] !w-[35px]" className="!h-[35px] !w-[35px]" />
                <div className="min-w-0">
                   <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-[#f5f5f5]">{activeConv.name}{activeConv.verified && activeConv.verificationType && <VerificationBadge verified type={activeConv.verificationType} size="sm" className="shrink-0" />}</p>
                  <p className="truncate text-[10px] text-white/40">
                    {activeConv.type === 'channel' ? `${activeConv.memberCount || 1} subscribers · broadcast` : activeConv.type === 'group' ? (typingUserId ? `${activeConv.participants?.find((p: any) => p.id === typingUserId)?.fullName || 'Someone'} is typing…` : `${activeConv.memberCount || 1} members${activeConv.onlineMemberCount ? ` · ${activeConv.onlineMemberCount} online` : ''}`) : typingUserId ? 'Typing…' : activeConv.online ? 'Online' : activeConv.lastSeen ? `Last seen ${formatRelativePresenceTime(activeConv.lastSeen)}` : 'Offline'}
                  </p>
                </div></button>
              </div>
              <div className="flex items-center gap-1">
                {activeConv.type === 'direct' && (
                  <>
                    <div className="relative">
                      <button
                        onClick={() => setCallMenuOpen(value => !value)}
                        disabled={chatCalls.status !== 'idle'}
                        className="btn-icon h-9 w-9"
                        aria-label="Start a call"
                        aria-haspopup="menu"
                        aria-expanded={callMenuOpen}
                        title="Call"
                      >
                        <Phone size={15} />
                      </button>
                      {callMenuOpen && (
                        <>
                          {/* Transparent capture layer: tap outside closes the menu. */}
                          <div
                            aria-hidden="true"
                            className="fixed inset-0 z-[69]"
                            onClick={() => setCallMenuOpen(false)}
                          />
                          <div
                            role="menu"
                            aria-label="Choose call type"
                            className="absolute right-0 top-[calc(100%+6px)] z-[70] w-44 overflow-hidden rounded-xl border border-white/[0.1] bg-[#151517] p-1 shadow-[0_14px_40px_rgba(0,0,0,.55)] backdrop-blur-xl"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setCallMenuOpen(false);
                                void chatCalls.startCall('voice');
                              }}
                              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-white transition hover:bg-white/[0.06]"
                            >
                              <Phone size={15} className="text-[#8b93a6]" />
                              Voice Call
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setCallMenuOpen(false);
                                void chatCalls.startCall('video');
                              }}
                              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-white transition hover:bg-white/[0.06]"
                            >
                              <Video size={15} className="text-[#d6a83f]" />
                              Video Call
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
                <button onClick={() => setMessageSearchOpen(value => !value)} className="btn-icon h-9 w-9" aria-label="Search chat"><Search size={15} /></button>
                 <button onClick={handleOpenConversationActions} className="btn-icon h-9 w-9" aria-label={activeConv.type === 'direct' ? 'Open conversation actions' : `Open ${activeConv.type === 'group' ? 'group' : 'channel'} information`}><MoreVertical size={17} /></button>
              </div>
            </header>

            {messageSearchOpen && <div className="border-b border-white/[0.08] bg-[#101010] px-4 py-2"><form onSubmit={event => { event.preventDefault(); void searchWithinChat(); }} className="flex items-center gap-2"><Search size={14} className="shrink-0 text-white/35" /><input autoFocus value={messageSearchQuery} onChange={event => setMessageSearchQuery(event.target.value)} placeholder="Search this chat" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30" /><button type="submit" disabled={!messageSearchQuery.trim() || searchingMessages} className="text-[11px] font-medium text-white disabled:text-white/25">Search</button><button type="button" onClick={() => { setMessageSearchOpen(false); setMessageSearchQuery(''); setMessageSearchResults([]); }} aria-label="Close chat search" className="text-white/40"><X size={14}/></button></form></div>}

            {(searchingMessages || messageSearchResults.length > 0) && <div className="border-b border-white/[0.08] bg-[#101010] px-4 py-2"><div className="flex items-center justify-between"><span className="text-[10px] text-white/40">{searchingMessages ? 'Searching chat...' : `${messageSearchResults.length} result${messageSearchResults.length === 1 ? '' : 's'}`}</span><button onClick={() => setMessageSearchResults([])} className="text-white/40" aria-label="Close search results"><X size={13}/></button></div>{messageSearchResults.slice(0, 5).map(result => <button key={result.id} onClick={() => document.getElementById(`message-${result.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="mt-1 block w-full truncate rounded bg-white/[0.03] px-2 py-1 text-left text-[10px] text-white/60">@{result.sender.username}: {result.text}</button>)}</div>}

            {/* Messages */}
            <div ref={messagesViewportRef} className={cn("relative min-h-0 flex-1 touch-pan-y overscroll-contain overflow-x-hidden overflow-y-auto scrollbar-hide bg-[#050505] px-3 py-4 pb-6 [overflow-anchor:none] [-webkit-overflow-scrolling:touch]", selectedMessageIds.size > 0 && "bg-[#1F2630] pt-4 pb-4")}>
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
                  const dateLabel = currentDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
                  const senderRole = activeConv.participants?.find((participant: any) => (participant.id ?? participant.userId) === msg.sender.id)?.role;
                  const senderName = msg.sender.fullName || msg.sender.username || 'Unknown user';
                  const previousMessage = index > 0 ? messages[index - 1] : null;
                  const inSameRun = Boolean(previousMessage
                    && previousMessage.sender.id === msg.sender.id
                    && new Date(previousMessage.timestamp).toDateString() === currentDate.toDateString()
                    && currentDate.getTime() - new Date(previousMessage.timestamp).getTime() < 60_000);
                  const senderChanged = !previousMessage || previousMessage.sender.id !== msg.sender.id || new Date(previousMessage.timestamp).toDateString() !== currentDate.toDateString();
                  // Outgoing bubbles show their own time. Incoming runs show one
                  // timestamp beneath the final bubble in each sender/minute group.
                  const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
                  const nextDate = nextMessage ? new Date(nextMessage.timestamp) : null;
                  const endsIncomingGroup = !nextMessage
                    || nextMessage.sender.id !== msg.sender.id
                    || nextDate!.toDateString() !== currentDate.toDateString()
                    || nextDate!.getTime() - currentDate.getTime() >= 60_000;
                  const showMessageTime = msg.isOwn || endsIncomingGroup;
                  const hasAudioAttachment = (msg.attachments ?? []).some(attachment => attachment.fileType === 'AUDIO');
                  // Direct chats stay private and compact: no role badges, and
                  // show the other person's avatar only at the start of a run.
                  // Group/channel conversations retain sender identity for each run.
                  const isGroupLike = activeConv?.type === 'group' || activeConv?.type === 'channel';
                  const showSenderIdentity = isGroupLike ? !inSameRun : (!msg.isOwn && !inSameRun);
                  return <div key={msg.id} className={inSameRun ? 'mt-1' : ''}>{showDate && <div className="my-5 flex justify-center"><span className="rounded-full bg-[#202126] px-3 py-1.5 text-[11px] font-medium text-white/65">{dateLabel}</span></div>}{msg.id === firstUnreadId && <div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-[#d6a83f]/25"/><span className="rounded-full border border-[#d6a83f]/30 bg-[#d6a83f]/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-[.14em] text-[#f2c75c]">New messages</span><span className="h-px flex-1 bg-[#d6a83f]/25"/></div>}
                  <div
                    id={`message-${msg.id}`}
                    className={cn('flex relative scroll-mt-24 transition-shadow touch-pan-y will-change-transform', msg.isOwn ? 'justify-end' : 'justify-start', selectedMessageIds.size > 0 && 'cursor-pointer -mx-3 w-[calc(100%+1.5rem)] py-1.5 pl-[3.25rem] pr-3 transition-colors duration-150 [&_*]:pointer-events-none select-none', selectedMessageIds.has(msg.id) && 'bg-[#d6a83f]/[0.14] shadow-[inset_3px_0_0_#d6a83f]')}
                    style={swipeOffset?.id === msg.id ? { transform: `translateX(${swipeOffset.offset}px)` } : undefined}
                    role={selectedMessageIds.size > 0 ? "checkbox" : undefined}
                    aria-checked={selectedMessageIds.size > 0 ? selectedMessageIds.has(msg.id) : undefined}
                    tabIndex={selectedMessageIds.size > 0 ? 0 : undefined}
                    onClick={() => { if (longPressedMessageRef.current === msg.id) { longPressedMessageRef.current = null; return; } if (selectedMessageIds.size) toggleMessageSelection(msg.id); }}
                    onKeyDown={event => { if (selectedMessageIds.size > 0 && (event.key === " " || event.key === "Enter")) { event.preventDefault(); toggleMessageSelection(msg.id); } }}
                    onContextMenu={event => event.preventDefault()}
                    onPointerDown={event => startMessageLongPress(msg, event)}
                    onPointerUp={() => { cancelMessageLongPress(); finishMessageSwipe(); }}
                    onPointerCancel={() => { cancelMessageLongPress(); finishMessageSwipe(); }}
                    onPointerLeave={() => { cancelMessageLongPress(); finishMessageSwipe(); }}
                    onPointerMove={event => { const start = swipeStartRef.current; if (start && start.id === msg.id && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) cancelMessageLongPress(); trackMessageSwipe(event, msg); }}
                  >
                    {selectedMessageIds.size > 0 && <span aria-hidden="true" className={cn('absolute left-2.5 top-1/2 z-10 grid h-[22px] w-[22px] -translate-y-1/2 place-items-center rounded-full border-2 transition-all duration-150', selectedMessageIds.has(msg.id) ? 'scale-100 border-[#e8c65f] bg-gradient-to-b from-[#f2d777] to-[#c49a2f] text-[#17130a] shadow-[0_0_12px_rgba(214,168,63,.5)]' : 'scale-95 border-white/30 bg-black/30 text-transparent')}><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>}
                    <div className={cn('flex w-full min-w-0 items-start gap-2.5', msg.isOwn ? 'flex-row-reverse' : 'flex-row')}>
                      <div className="w-fit min-w-[3.5rem] max-w-[calc(100%-2.75rem)]">
                        {showSenderIdentity && (
                          <div className={cn('flex max-w-[min(100%,420px)] items-center gap-2', msg.isOwn && 'justify-end')}>
                            <button
                              type="button"
                              onClick={() => msg.sender.username && router.push(`/profile/${encodeURIComponent(msg.sender.username)}`)}
                              className="truncate text-[10px] font-semibold uppercase tracking-[.08em] text-[#c8c8cc] transition hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                            >
                              {senderName}
                            </button>
                            {isGroupLike && !msg.isOwn && ['OWNER', 'ADMIN', 'MODERATOR'].includes(senderRole || '') && <span className="text-[8px] font-bold uppercase text-[#d6a83f]">{senderRole === 'OWNER' ? 'Owner' : senderRole === 'MODERATOR' ? 'Moderator' : 'Admin'}</span>}
                          </div>
                        )}
                      <div className={cn(
                        'chat-bubble-text w-fit max-w-full overflow-hidden text-[15px] leading-[1.45]',
                        msg.isOwn
                           ? 'border-r-2 border-[#c9a227]/60 bg-transparent pr-2.5 text-white'
                           : 'bg-transparent text-white'
                      )}>
                        {msg.deletedAt ? null : msg.type === 'CALL' ? (
                          <span className="flex items-center justify-center gap-1.5 whitespace-nowrap py-0.5 px-3 text-xs text-white/50">
                            <Phone size={12} className="text-[#d6a83f]" />
                            {renderTextWithLinks(msg.text || msg.content || '', 'linkify', { mentions: true, hashtags: true })}
                          </span>
                        ) : msg.type === 'LOCATION' ? (
                          <button type="button" onClick={() => { try { const loc = JSON.parse(msg.text); window.open(`https://maps.google.com/?q=${loc.lat},${loc.lng}`, '_blank'); } catch {} }} className="flex min-w-0 max-w-[min(100%,300px)] items-center gap-2.5 px-3 py-2.5 text-left">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#c9a227]/15 text-[#e2bb4c]"><MapPin size={19}/></span>
                            <span className="min-w-0"><span className="block text-sm font-semibold text-white">Location</span><span className="block truncate text-[11px] text-white/45">Tap to open in Google Maps</span></span>
                          </button>
                        ) : msg.type === 'CONTACT' ? (() => {
                          let contact: any = null;
                          try { contact = JSON.parse(msg.text || msg.content || '{}'); } catch {}
                          const hasProfileHandle = typeof contact?.username === 'string' && contact.username.trim().length > 0;
                          const handle = hasProfileHandle ? contact.username.trim() : '';
                          const cardName = String(contact?.fullName || contact?.name || (handle ? `@${handle}` : 'Unavailable profile'));
                          return (
                            <button
                              type="button"
                              onClick={() => { if (hasProfileHandle) router.push('/profile/' + encodeURIComponent(handle)); }}
                              disabled={!hasProfileHandle}
                              aria-label={hasProfileHandle ? "View @" + handle + "'s profile" : 'This shared contact is unavailable'}
                              className="group block w-[min(78vw,300px)] rounded-2xl border border-white/[.08] bg-[#1F2630] px-3 py-3 text-left transition hover:border-white/[.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a227]/70 disabled:cursor-default"
                            >
                              <span className="flex min-w-0 items-center gap-3">
                                <Avatar src={resolveMediaUrl(contact?.avatarUrl || contact?.avatar || null)} alt={cardName} size="md" className="!h-11 !w-11" wrapperClassName="!h-11 !w-11 !min-h-11 !min-w-11" />
                                <span className="min-w-0 flex-1">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-sm font-semibold text-white">{cardName}</span>
                                    {contact?.verified && <VerificationBadge verified type={contact?.verificationType || 'GOLD'} size="xs" />}
                                  </span>
                                  <span className="mt-0.5 block truncate text-xs text-white/45">@{handle || 'VANTA member'}</span>
                                  {typeof contact?.bio === 'string' && contact.bio.trim() && <span className="mt-1 block line-clamp-1 text-[11px] text-white/55">{contact.bio.trim()}</span>}
                                </span>
                                <span className="shrink-0 text-[11px] font-medium text-[#e2bb4c] transition group-hover:text-[#f2c75c]">View</span>
                              </span>
                            </button>
                          );
                        })() : msg.type === 'WALLET' ? (
                          <button type="button" onClick={() => router.push('/balance')} className="flex min-w-0 max-w-[min(100%,300px)] items-center gap-2.5 px-3 py-2.5 text-left" aria-label="Open wallet balance">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d6a83f]/15 text-[#f2c75c]"><WalletIcon size={19}/></span>
                            <span className="min-w-0"><span className="block text-[11px] text-white/45">Wallet</span><span className="block text-sm font-semibold text-white">Open balance</span></span>
                          </button>
                        ) : msg.type === 'POLL' ? (() => {
                          const poll = msg.legacyPoll;
                          if (!poll) return <span className="px-3 py-2 text-sm text-white/60">This poll isn’t available in this version.</span>;
                          return (
                            <div className="min-w-0 max-w-[min(100%,340px)] px-3 py-2.5">
                              <p className="text-sm font-semibold text-white">{poll.question}</p>
                              {(poll.imageUrl || msg.attachments?.find(attachment => attachment.fileType === 'IMAGE')?.url) && <img src={poll.imageUrl || msg.attachments?.find(attachment => attachment.fileType === 'IMAGE')?.url || ''} alt="Poll image" className="mt-2 max-h-56 w-full rounded-xl object-cover" />}
                              <p className="mt-0.5 text-[10px] text-white/45">{msg.pollVotes?.length ?? 0} vote{(msg.pollVotes?.length ?? 0) === 1 ? '' : 's'} · {msg.content && (() => { try { return JSON.parse(msg.content).allowMultiple ? 'Choose all that apply' : 'Choose one option'; } catch { return 'Choose one option'; } })()}</p>
                              <div className="mt-2 flex flex-col gap-1.5">
                                {poll.options.map((option, optionIndex) => {
                                  const votes = msg.pollVotes ?? [];
                                  const count = votes.filter(vote => vote.optionIndex === optionIndex).length;
                                  const selected = votes.some(vote => vote.userId === user?.id && vote.optionIndex === optionIndex);
                                  const totalVoters = new Set(votes.map(vote => vote.userId)).size;
                                  const percent = totalVoters ? Math.round(count / totalVoters * 100) : 0;
                                  return (
                                    <button key={optionIndex} type="button" onClick={() => void voteOnPoll(msg, optionIndex)} disabled={Boolean(msg.pending || msg.failed)} className={cn('relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-xs transition disabled:opacity-60', selected ? 'border-[#d6a83f]/60 bg-[#d6a83f]/10 text-white' : 'border-white/[0.1] bg-white/[0.03] text-white/85 hover:bg-white/[0.07]')}>
                                      <span className="absolute inset-y-0 left-0 bg-[#d6a83f]/10" style={{ width: `${percent}%` }} />
                                      <span className="relative flex items-center justify-between gap-3"><span>{option}</span><span className="shrink-0 text-[10px] text-white/55">{count} · {percent}%</span></span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })() : msg.type === 'STORY_REPLY' ? (
                          <div className="min-w-0 max-w-[min(100%,420px)]">
                            <div className={cn('relative overflow-hidden rounded-[14px] border', msg.isOwn ? 'border-[#d6a83f]/20 bg-[#2a2618]' : 'border-[#d6a83f]/20 bg-[#1d1a12]')}>
                              <div className="flex items-center gap-2 px-3 py-2">
                                <MessageCircle size={13} className="shrink-0 text-[#f2c75c]" />
                                <span className={cn('text-[9px] font-bold uppercase tracking-[.14em]', msg.isOwn ? 'text-[#f2c75c]' : 'text-[#d6a83f]')}>Story reply</span>
                                {msg.storyReplyAuthor && <span className="min-w-0 flex-1 truncate text-[10px] text-white/45">re: {msg.storyReplyAuthor}</span>}
                              </div>
                              {msg.storyReplyCaption?.trim() && <p className="line-clamp-2 px-3 pt-0.5 text-[11px] leading-snug text-white/60">{msg.storyReplyCaption}</p>}
                              {msg.storyReplyMediaUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={resolveMediaUrl(msg.storyReplyMediaUrl)} alt="Story preview" decoding="async" loading="lazy" className="mt-1 h-16 w-full rounded-[10px] object-cover" />
                              )}
                            </div>
                            {msg.text.trim() && <p className="px-3 pt-1 pb-0.5 max-w-[min(420px,65vw)] whitespace-pre-wrap break-normal [overflow-wrap:break-word]">{renderTextWithLinks(msg.text, 'linkify', { mentions: true, hashtags: true })}</p>}
                          </div>
                        ) : (
                          <>
                          {msg.replyTo && <div className="mx-3 mt-2 mb-0.5 flex min-w-0 max-w-[min(100%,360px)] flex-col border-l-2 border-[#d6a83f] rounded-sm bg-black/20 pr-2 pl-2 pt-1.5 pb-1.5"><button type="button" className="min-w-0 max-w-full text-left" onClick={() => { const original = document.getElementById(`message-${msg.replyTo.id}`); original?.scrollIntoView({ behavior: 'smooth', block: 'center' }); original?.classList.add('ring-1', 'ring-[#d6a83f]/70'); window.setTimeout(() => original?.classList.remove('ring-1', 'ring-[#d6a83f]/70'), 1200); }}><strong className="block truncate text-[9px] text-[#f2c75c]">{msg.replyTo.sender?.fullName || `@${msg.replyTo.sender?.username || 'user'}`}</strong><span className="block truncate text-[10px] text-white/55">{msg.replyTo.content || msg.replyTo.text || 'Attachment'}</span></button></div>}
                          {(() => {
                            const allAtts: GridAttachment[] = ((msg.attachments ?? []) as any[]).map(a => ({ ...a, url: (a && (a.url || a.previewUrl)) as string, previewUrl: undefined }));
                            const mediaAtts = allAtts.filter(a => a.fileType === 'IMAGE' || a.fileType === 'VIDEO');
                            const otherAtts = allAtts.filter(a => a.fileType !== 'IMAGE' && a.fileType !== 'VIDEO');
                            const total = mediaAtts.length;
                            const visible = total > GRID_MAX_VISIBLE ? mediaAtts.slice(0, GRID_MAX_VISIBLE) : mediaAtts;
                            const hiddenCount = total - visible.length;
                            return (
                              <>
                                {total > 0 && (
                                  <div className={cn('grid w-full gap-1.5 overflow-hidden rounded-[14px]', gridAspectClass(total), gridColumnsClass(total))}>
                                    {visible.map((att, index) => (
                                      <div key={att.id || `${att.url}-${index}`} className={cn('relative min-w-0 overflow-hidden', gridTileClass(total, index))}>
                                        <button
                                          type="button"
                                          onClick={() => openMediaViewer({ ...att, url: att.url! })}
                                          className="group block h-full w-full bg-[#0d0d0f] text-left"
                                          aria-label={`Open ${att.fileName || (att.fileType === 'VIDEO' ? 'video' : 'image')} in media viewer`}
                                        >
                                          {att.fileType === 'VIDEO' ? (
                                            <>
                                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                              <video src={att.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                                              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                                <span className="grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-[2px] group-hover:bg-black/75"><Play size={14} className="ml-0.5 fill-current" /></span>
                                              </span>
                                            </>
                                          ) : (
                                            <img src={att.url} alt={att.fileName || 'Image attachment'} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                          )}
                                        </button>
                                        {hiddenCount > 0 && index === visible.length - 1 && (
                                          <span className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-black/60 text-base font-semibold text-white">+{hiddenCount}</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {otherAtts.map((att, index) => att.fileType === 'AUDIO'
                                  ? <div key={att.id || `extra-${index}`} className={cn('min-w-0 px-3', visibleMessageText(msg) ? 'pt-2 pb-1' : 'py-2.5')}><VoiceNotePlayer src={att.url!} name={att.fileName} sentAt={currentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} isOwn={msg.isOwn} /></div>
                                  : <a key={att.id || `extra-${index}`} href={att.url} target="_blank" rel="noreferrer" className="flex min-w-0 max-w-full items-center gap-2 px-3 py-2.5 text-xs underline underline-offset-2 text-white/70 hover:text-white">{<FileText size={13} className="shrink-0 text-white/40" />}<span className="min-w-0 truncate">{att.fileName || 'Download attachment'}</span></a>)}
                              </>
                            );
                          })()}
                          {(chatQuoteOf(msg)?.rest ?? visibleMessageText(msg)).trim() && <p className="px-3 py-2 max-w-[min(420px,65vw)] whitespace-pre-wrap break-normal [overflow-wrap:break-word]">{showMessageTime && !msg.deletedAt && !(msg.isOwn && hasAudioAttachment) && <span className={cn('float-right ml-2 inline-flex translate-y-[3px] items-center gap-1 select-none text-[10px] leading-none tabular-nums', msg.isOwn ? 'text-white/75' : 'text-white/40')}>{currentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}{msg.isOwn && (msg.failed ? <button onClick={() => retryFailedMessage(msg)} className="text-[9px] text-red-100">Retry</button> : msg.pending ? <Loader2 size={10} className="animate-spin" /> : <CheckCheck size={11} />)}</span>}{renderTextWithLinks(chatQuoteOf(msg)?.rest ?? visibleMessageText(msg), 'linkify', { mentions: true, hashtags: true })}{msg.editedAt && <span className="ml-1 text-[9px] opacity-60">edited</span>}</p>}
                          {!msg.deletedAt && chatMediaLinksOf(visibleMessageText(msg)).map(link => <div key={link.url} className="w-[min(320px,65vw)] max-w-full px-2 pb-2 pt-1">{link.kind === 'video' ? <video src={link.url} controls playsInline preload="metadata" className="max-h-64 w-full rounded-xl bg-black object-cover" /> : link.kind === 'image' ? <a href={link.url} target="_blank" rel="noreferrer"><img src={link.url} alt="" loading="lazy" className="max-h-64 w-full rounded-xl object-cover" /></a> : <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-white/[.12] bg-white/[.04] px-3 py-2 text-[13px] text-white"><FileText size={16} className="shrink-0 text-[#f2c75c]" /><span className="truncate">{link.name}</span></a>}</div>)}
                          {chatQuoteOf(msg) && <div className="w-[min(320px,65vw)] max-w-full px-2 pb-2 pt-1"><QuoteEmbed quote={chatQuoteOf(msg)!.ref} /></div>}
                          {!(chatQuoteOf(msg)?.rest ?? visibleMessageText(msg)).trim() && showMessageTime && !msg.deletedAt && !(msg.isOwn && hasAudioAttachment) && (
                          <div className={cn('flex items-center gap-1 px-3 pb-1.5 pt-0.5 text-[10px] tabular-nums', msg.isOwn ? 'justify-end text-white/75' : 'text-white/40')}>
                            <span>{currentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                            {msg.isOwn && (msg.failed ? <button onClick={() => retryFailedMessage(msg)} className="text-[9px] text-red-100">Retry</button> : msg.pending ? <Loader2 size={10} className="animate-spin" /> : <CheckCheck size={11} />)}
                          </div>
                        )}{msg.uploading && <div className="mt-1 flex items-center gap-1.5 px-3 pb-2 text-[10px] text-[#6aa5ff]"><Loader2 size={10} className="animate-spin" /><span className="tabular-nums">Uploading {msg.uploadProgress ?? 0}%</span></div>}
                        </>)}
                      </div>
                      <div className={cn('flex items-center gap-1 mt-0.5', msg.isOwn ? 'justify-end mr-1' : 'justify-start ml-1')}>
                        {msg.pinnedAt && <Pin size={9} className="text-white/40" />}
                      </div>
                      {msg.reactions && msg.reactions.length > 0 && <div className={cn('mt-1 flex flex-wrap gap-1', msg.isOwn && 'justify-end')}>{Array.from(new Set(msg.reactions.map(item => item.reaction))).map(reaction => <button key={reaction} onClick={() => reactToMessage(msg, reaction)} className="rounded-full border border-white/10 bg-[#161616] px-2 py-0.5 text-xs">{reaction} {msg.reactions?.filter(item => item.reaction === reaction).length}</button>)}</div>}
                    </div>
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
            {selectedMessageIds.size > 0 ? (
              <div className="sticky bottom-0 z-30 shrink-0 border-t border-white/[0.08] bg-[#1F2630] px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-5 gap-1.5">
                  <button type="button" disabled={selectedMessageIds.size !== 1} onClick={() => { const selected = messages.find(message => selectedMessageIds.has(message.id)); if (selected) { setReplyingTo(createReply(activeConversation as string, selected)); closeMessageSelection(); } }} className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#293441] text-[10px] font-semibold text-white/85 transition hover:bg-[#354252] disabled:opacity-35"><MessageCircle size={17}/>Reply</button>
                  <button type="button" onClick={() => void forwardSelectedMessages()} className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#293441] text-[10px] font-semibold text-white/85 transition hover:bg-[#354252]"><Forward size={17}/>Forward</button>
                  <button type="button" onClick={() => void copySelectedMessages()} className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#293441] text-[10px] font-semibold text-white/85 transition hover:bg-[#354252]"><Copy size={17}/>Copy</button>
                  <button type="button" disabled={selectedMessageIds.size !== 1 || !messages.find(message => selectedMessageIds.has(message.id))?.isOwn} onClick={() => { const selected = messages.find(message => selectedMessageIds.has(message.id)); if (selected) { closeMessageSelection(); editExistingMessage(selected); } }} className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#293441] text-[10px] font-semibold text-white/85 transition hover:bg-[#354252] disabled:opacity-35"><Pencil size={17}/>Edit</button>
                  <button type="button" onClick={requestDeleteSelectedMessages} className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#4a2c32] text-[10px] font-semibold text-[#ffb9bd] transition hover:bg-[#5a343b]"><Trash2 size={17}/>Delete</button>
                </div>
              </div>
            ) : canPublish ? <div className="sticky bottom-0 z-30 shrink-0 bg-transparent px-2.5 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
              {editingMessage && <div className="mb-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70"><span>Editing message</span><button onClick={() => { setEditingMessage(null); setMessageInput(''); }} aria-label="Cancel editing"><X size={14} /></button></div>}
              {activeReply && <div className="mb-1.5 flex items-center gap-2 border-l-2 border-[#d6a83f] pr-2 pl-2 py-1"><button type="button" className="min-w-0 flex-1 truncate text-left text-[11px]" onClick={() => { const original = document.getElementById(`message-${activeReply.id}`); original?.scrollIntoView({ behavior: 'smooth', block: 'center' }); original?.classList.add('ring-1', 'ring-[#d6a83f]/70'); window.setTimeout(() => original?.classList.remove('ring-1', 'ring-[#d6a83f]/70'), 1200); }}><span className="font-semibold text-[#f2c75c]">@{activeReply.sender?.username || 'user'}</span><span className="text-white/45"> · {activeReply.text || activeReply.content || 'Attachment'}</span></button><button className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/40" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={12} /></button></div>}
              {(recordingState === 'recording' || recordingState === 'ready' || recordingState === 'uploading') && (
                <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#27313d] px-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c9a227]/15 text-[#f2c75c]">
                    {recordingState === 'recording' ? <Square size={12} /> : recordingState === 'uploading' ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    {recordingState === 'ready' && recordingPreviewUrlRef.current ? (
                      <VoiceNotePlayer src={recordingPreviewUrlRef.current} name="voice-note" />
                    ) : (
                      <>
                        <p className="text-xs font-medium text-white/80">{recordingState === 'recording' ? 'Recording voice note…' : recordingState === 'uploading' ? 'Uploading voice note…' : 'Voice note ready'}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[11px] font-medium tabular-nums text-[#f2c75c]">{formatVoiceTime(recordingDuration)}</span>
                          {recordingState === 'recording' && <span className="flex items-center gap-1 text-[10px] text-red-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> live</span>}
                          {recordingError && <span className="truncate text-[10px] text-red-300">{recordingError}</span>}
                        </div>
                      </>
                    )}
                  </div>
                  {recordingState === 'ready' && (
                    <button onClick={cancelRecording} className="btn-icon h-8 w-8 shrink-0 text-white/40" aria-label="Discard voice note"><X size={14} /></button>
                  )}
                </div>
              )}
              {attachmentDrafts.length > 0 && (
                <div className="mb-2 rounded-lg border border-white/[0.1] bg-[#101010] p-2">
                  {(() => {
                    const mediaDrafts = attachmentDrafts.filter(d => d.fileType === 'IMAGE' || d.fileType === 'VIDEO');
                    const fileDrafts = attachmentDrafts.filter(d => d.fileType === 'FILE');
                    const total = mediaDrafts.length;
                    const visible = total > GRID_MAX_VISIBLE ? mediaDrafts.slice(0, GRID_MAX_VISIBLE) : mediaDrafts;
                    const hiddenCount = total - visible.length;
                    return (<>
                      {total > 0 && (
                        <div className={cn('grid w-full gap-1.5 overflow-hidden rounded-lg', gridAspectClass(total), gridColumnsClass(total))}>
                          {visible.map((draft, index) => (
                            <div key={draft.id} className={cn('relative min-w-0 overflow-hidden', gridTileClass(total, index))}>
                              <div className="h-full w-full bg-black">{draft.fileType === 'IMAGE'
                                ? <img src={draft.previewUrl} alt="Attachment preview" className="h-full w-full object-cover" />
                                : <video src={draft.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />}</div>
                              {draft.status === 'failed' ? (
                                <button onClick={() => void uploadAllAndSend()} className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-[#d6a83f]/15 text-[#f2c75c]" aria-label="Retry upload"><RefreshCw size={10}/></button>
                              ) : (
                                <button onClick={() => cancelAttachment(draft.id)} className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white/80" aria-label="Remove attachment"><X size={10}/></button>
                              )}
                              {draft.status === 'uploading' && <span className="absolute inset-0 grid place-items-center bg-black/40 text-[9px] text-white">{draft.progress}%</span>}
                              {draft.status === 'sending' && <span className="absolute inset-0 grid place-items-center bg-black/40 text-white/80"><Loader2 size={12} className="animate-spin"/></span>}
                              {hiddenCount > 0 && index === visible.length - 1 && (
                                <span className="absolute inset-0 z-[1] grid place-items-center bg-black/60 text-base font-semibold text-white">+{hiddenCount}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {fileDrafts.map(draft => (
                        <div key={draft.id} className="relative mt-1.5 flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#151517] px-2.5 py-2">
                          <FileText size={15} className="shrink-0 text-[#f2c75c]" />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-white/75">{draft.file.name}</span>
                          {draft.status === 'failed' ? (
                            <button onClick={() => void uploadAllAndSend()} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#d6a83f]/15 text-[#f2c75c]" aria-label="Retry upload"><RefreshCw size={10}/></button>
                          ) : (
                            <button onClick={() => cancelAttachment(draft.id)} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/70 text-white/80" aria-label="Remove attachment"><X size={10}/></button>
                          )}
                        </div>
                      ))}
                      <p className="mt-1.5 pl-1 text-[10px] text-white/45">{readyDraftCount(attachmentDrafts)} attachment{attachmentDrafts.length === 1 ? '' : 's'} · tap ✕ to remove</p>
                    </>);
                  })()}
                </div>
              )}
              {/* Unified attachment sheet: live camera preview plus one compact action strip. */}
              {showAttachmentSheet && (
                <>
                  <button type="button" aria-label="Close attachment picker" onClick={() => setShowAttachmentSheet(false)} className="fixed inset-0 z-[60] bg-black/55" />
                  <section role="dialog" aria-label="Choose an attachment" className="fixed inset-x-3 bottom-[calc(var(--vanta-kb,0px)+5.25rem)] z-[70] mx-auto w-[calc(100%-1.5rem)] max-w-lg rounded-2xl border border-white/[0.09] bg-[#1F2630] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Share a file</h3>
                        <p className="mt-1 text-[11px] text-white/45">Choose how you want to attach it</p>
                      </div>
                      <button type="button" onClick={() => setShowAttachmentSheet(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/60" aria-label="Close"><X size={16}/></button>
                    </div>
                    <div className="mb-3 overflow-hidden rounded-xl bg-black">
                      <video ref={cameraPreviewRef} autoPlay playsInline muted className="max-h-52 min-h-32 w-full object-cover" />
                      {cameraPreviewError && <p className="px-3 py-2 text-[10px] text-white/55">{cameraPreviewError}</p>}
                      <div className="flex items-center justify-center gap-3 border-t border-white/10 px-3 py-2">
                        <button type="button" onClick={captureLivePhoto} disabled={Boolean(cameraPreviewError) || isUploadingAttachment || hasBusyDraft(attachmentDrafts)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">Take photo</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto border-t border-white/[0.07] pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); window.requestAnimationFrame(() => attachmentInputRef.current?.click()); }} disabled={isUploadingAttachment || hasBusyDraft(attachmentDrafts)} className="flex shrink-0 items-center gap-2 rounded-full bg-[#26384a] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"><ImageIcon size={15}/> Gallery</button>
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); window.requestAnimationFrame(() => fileInputRef.current?.click()); }} disabled={isUploadingAttachment || hasBusyDraft(attachmentDrafts)} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-40"><FileText size={15}/> Files</button>
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); sendLocationMessage(); }} disabled={specialSending} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-40"><MapPin size={15}/> Location</button>
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); setPollDraft({ question: '', options: ['', ''], allowMultiple: false, imageFile: null }); }} disabled={specialSending} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-40"><BarChart3 size={15}/> Poll</button>
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); setContactPickerOpen(true); }} disabled={specialSending} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-40"><User size={15}/> Contact</button>
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); musicInputRef.current?.click(); }} disabled={specialSending} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-40"><Music2 size={15}/> Music</button>
                      <button type="button" onClick={() => { setShowAttachmentSheet(false); openWallet(); }} disabled={specialSending} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-40"><WalletIcon size={15}/> Wallet</button>
                    </div>
                  </section>
                </>
              )}
              {pollDraft && (
                <>
                  <section role="dialog" aria-modal="true" aria-label="Create a poll" className="fixed inset-0 z-[90] flex h-[var(--chat-viewport-height,100dvh)] w-screen flex-col overflow-y-auto overscroll-contain bg-[#1F2630] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
                    <header className="sticky top-0 z-10 -mx-4 mb-5 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#1F2630]/95 px-4 backdrop-blur-xl">
                      <button type="button" onClick={() => setPollDraft(null)} className="grid h-10 w-10 place-items-center rounded-full text-white/75 hover:bg-white/[0.06]" aria-label="Back to chat"><ArrowLeft size={19}/></button>
                      <h3 className="text-sm font-semibold text-white">Create a poll</h3>
                      <button type="button" onClick={() => setPollDraft(null)} className="text-xs font-medium text-white/55">Cancel</button>
                    </header>
                    <input value={pollDraft.question} onChange={event => setPollDraft(draft => draft ? { ...draft, question: event.target.value } : draft)} maxLength={200} placeholder="Ask a question" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#161616] px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#d6a83f]/40" />
                    <div className="mt-3 flex items-center gap-3">
                      <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg bg-white/[0.06] px-3 text-xs font-medium text-white/80 hover:bg-white/[0.1]">
                        <ImageIcon size={15} /> Add image
                        <input type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0] ?? null; if (file && !file.type.startsWith('image/')) { showToast?.({ type: 'error', title: 'Choose an image', message: 'Poll attachments must be image files.' }); event.target.value = ''; return; } setPollDraft(draft => draft ? { ...draft, imageFile: file } : draft); }} />
                      </label>
                      {pollDraft.imageFile && <span className="text-[11px] text-white/55">Image attached</span>}
                      {pollDraft.imageFile && <button type="button" onClick={() => setPollDraft(draft => draft ? { ...draft, imageFile: null } : draft)} className="text-[11px] text-white/45 hover:text-white">Remove</button>}
                    </div>
                    {pollImagePreviewUrl && <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20"><img src={pollImagePreviewUrl} alt="Poll image preview" className="max-h-40 w-full object-contain" /></div>}
                    <label className="mt-3 flex items-center gap-2 text-xs text-white/70">
                      <input type="checkbox" checked={pollDraft.allowMultiple} onChange={event => setPollDraft(draft => draft ? { ...draft, allowMultiple: event.target.checked } : draft)} className="accent-[#d6a83f]" />
                      Allow multiple answers
                    </label>
                    <div className="mt-2 flex flex-col gap-2">
                      {pollDraft.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-2">
                          <input value={option} onChange={event => setPollDraft(draft => draft ? { ...draft, options: draft.options.map((value, index) => index === optionIndex ? event.target.value : value) } : draft)} maxLength={100} placeholder={`Option ${optionIndex + 1}`} className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#161616] px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#d6a83f]/40" />
                          {pollDraft.options.length > 2 && <button type="button" onClick={() => setPollDraft(draft => draft ? { ...draft, options: draft.options.filter((_, index) => index !== optionIndex) } : draft)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/50" aria-label="Remove option"><X size={14}/></button>}
                        </div>
                      ))}
                      {pollDraft.options.length < 10 && <button type="button" onClick={() => setPollDraft(draft => draft ? { ...draft, options: [...draft.options, ''] } : draft)} className="self-start text-[11px] font-semibold text-[#f2c75c]">+ Add option</button>}
                    </div>
                    <button type="button" onClick={() => void submitPoll()} disabled={specialSending} className="btn-gold sticky bottom-0 mt-6 h-12 w-full shrink-0 rounded-xl text-sm font-semibold disabled:opacity-50">{specialSending ? <><Loader2 size={16} className="mr-2 inline animate-spin"/>Creating poll…</> : "Create poll"}</button>
                  </section>
                </>
              )}
              {contactPickerOpen && (
                <>
                  <button type="button" aria-label="Close contact picker" onClick={() => { setContactPickerOpen(false); setContactSearch(''); setContactResults([]); }} className="fixed inset-0 z-30 bg-black/55" />
                  <section role="dialog" aria-modal="true" aria-label="Share a contact" className="absolute inset-x-2 bottom-[calc(100%+0.65rem)] z-[70] overflow-hidden rounded-[22px] border border-[#d6a83f]/30 bg-[#0b0c0e] shadow-[0_18px_60px_rgba(0,0,0,.72)] sm:inset-x-0">
                    <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-white">Share a contact</span>
                        <span className="mt-0.5 block text-[10px] text-white/40">Find someone on VANTA</span>
                      </span>
                      <button type="button" onClick={() => { setContactPickerOpen(false); setContactSearch(''); setContactResults([]); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/55 transition hover:bg-white/[.07] hover:text-white" aria-label="Close"><X size={17}/></button>
                    </div>
                    <div className="p-3">
                      <div className="relative">
                        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
                        <input value={contactSearch} onChange={event => void searchContacts(event.target.value)} placeholder="Search by username" autoFocus autoComplete="off" className="h-11 w-full rounded-xl border border-white/[.09] bg-[#141619] pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#d6a83f]/55" />
                      </div>
                      <div className="mt-2 max-h-60 overflow-y-auto scrollbar-hide">
                        {contactSearching && <p className="px-3 py-4 text-center text-xs text-white/45"><Loader2 size={14} className="mr-2 inline animate-spin text-[#e8bd59]"/>Searching VANTA…</p>}
                        {!contactSearching && contactSearchError && <p role="alert" className="px-3 py-5 text-center text-xs text-rose-300">{contactSearchError}</p>}
                        {!contactSearching && !contactSearchError && contactSearch.trim().length > 0 && contactResults.length === 0 && <p className="px-3 py-5 text-center text-xs text-white/40">No matching usernames. Check the spelling and try again.</p>}
                        {!contactSearching && contactResults.map(person => (
                          <button key={person.id} type="button" onClick={() => void sendContactMessage(person)} disabled={specialSending || contactSearching} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-white/[.045] disabled:cursor-wait disabled:opacity-50">
                            <Avatar src={person.avatar} alt={person.username || person.fullName} size="md" />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-white">{person.fullName || person.username}</span>
                                {person.verified && <VerificationBadge type={person.verificationType || undefined} size="xs" />}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-white/40">@{person.username}</span>
                            </span>
                            <span className="rounded-full border border-[#d6a83f]/30 px-2.5 py-1 text-[10px] font-semibold text-[#e8bd59]">Send</span>
                          </button>
                        ))}
                        {contactSearch.trim().length === 0 && <p className="px-3 py-5 text-center text-xs text-white/40">Enter a username to find and share a profile.</p>}
                      </div>
                    </div>
                  </section>
                </>
              )}
              <div className="flex items-center gap-1.5 bg-transparent px-0 py-0">
                {/* Hidden native pickers — each invokes a distinct real device capability */}
                <input ref={attachmentInputRef} type="file" className="hidden" accept="image/*,video/*" multiple onChange={handleAttachment} />
                <input ref={cameraInputRef} type="file" className="hidden" accept="image/*,video/*" capture="environment" onChange={handleAttachment} />
                <input ref={musicInputRef} type="file" className="hidden" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac" onChange={handleMusicAttachment} />
                <input ref={fileInputRef} type="file" className="hidden" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple onChange={handleDocumentAttachment} />
                <button onClick={() => setShowAttachmentSheet(value => !value)} disabled={isUploadingAttachment || hasBusyDraft(attachmentDrafts)} className="btn-icon h-9 w-9 shrink-0 rounded-full bg-white/[0.045] disabled:opacity-50" aria-label="Add attachment">{isUploadingAttachment ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={17} />}</button>
                <div className="flex-1 relative">
                  <textarea
                    ref={messageInputRef}
                    rows={1}
                    value={messageInput}
                    onChange={e => {
                      setMessageInput(e.target.value);
                      // Auto-expand vertically up to a sensible max height, then
                      // scroll inside the input. Keeps the composer compact.
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
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
                    placeholder="Message"
                    className="min-h-10 max-h-[100px] w-full resize-none overflow-y-auto rounded-2xl border-0 bg-[#27313d] px-3.5 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/35 focus:bg-[#354252]"
                    enterKeyHint="enter"
                    onKeyDown={e => {
                      // Keep Enter as a newline on phones; the visible Send button
                      // is the only send action on mobile keyboards.
                      const isMobile = window.matchMedia('(max-width: 767px)').matches;
                      if (!isMobile && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (messageInput.trim() || attachmentDrafts.length)) {
                        e.preventDefault();
                        sendComposer();
                      }
                    }}
                  />
                </div>
                {messageInput.trim() || attachmentDrafts.length ? (
                  <button
                    onClick={sendComposer}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c9a227] text-[#171b20] transition-colors hover:bg-[#e0b638]"
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
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1E9DE9] text-white transition-colors hover:bg-[#168bd0]"
                    aria-label="Record voice note"
                    title="Record voice note"
                  >
                    <Mic size={16} />
                  </motion.button>
                ) : recordingState === 'uploading' ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-[#151517] text-gray-500" aria-label="Uploading voice note"><Loader2 size={16} className="animate-spin" /></span>
                ) : recordingState === 'ready' ? (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    type="button"
                    onClick={() => void sendVoiceNote()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d6a83f]/60 bg-[#d6a83f] text-[#171b20] transition-all hover:bg-[#f2c75c]"
                    aria-label="Send voice note"
                    title="Send voice note"
                  >
                    <Send size={16} />
                  </motion.button>
                ) : (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    type="button"
                    onClick={stopRecordingPhase}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-400/40 bg-red-500/15 text-red-300 transition-all hover:bg-red-500/25"
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

      {activeConv?.type === 'direct' && directMenuOpen && (
        <>
          <button type="button" aria-label="Close conversation actions" onClick={() => setDirectMenuOpen(false)} className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-[2px]" />
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="direct-chat-actions-title"
            className="fixed inset-x-0 bottom-0 z-[81] mx-auto w-full max-w-lg rounded-t-3xl border border-white/[0.08] bg-[#1F2630] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 text-white shadow-[0_-18px_60px_rgba(0,0,0,.5)] sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
            <div className="flex items-center gap-3 border-b border-white/[0.07] pb-4">
              <Avatar src={activeConv.avatar} alt={activeConv.name} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 id="direct-chat-actions-title" className="truncate text-sm font-semibold">{activeConv.name}</h2>
                {activeConv.username && <p className="mt-0.5 truncate text-[11px] text-white/40">@{activeConv.username}</p>}
              </div>
              <button type="button" onClick={() => setDirectMenuOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-white/50 transition hover:bg-white/[0.07] hover:text-white" aria-label="Close menu"><X size={17}/></button>
            </div>
            <div className="grid gap-1 py-3">
              <button type="button" onClick={() => { setDirectMenuOpen(false); setMessageSearchOpen(true); }} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm text-white/80 transition hover:bg-white/[0.06]">
                <Search size={17} className="text-white/55"/>Search chat
              </button>
              <button type="button" onClick={() => { setDirectMenuOpen(false); void toggleMute(); }} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm text-white/80 transition hover:bg-white/[0.06]">
                <BellOff size={17} className="text-white/55"/>{activeConv.muted ? 'Unmute notifications' : 'Mute notifications'}
              </button>
              {activeConv.username && <a href={`/profile/${activeConv.username}`} onClick={() => setDirectMenuOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm text-white/80 transition hover:bg-white/[0.06]">
                <User size={17} className="text-white/55"/>View profile
              </a>}
            </div>
            <div className="border-t border-white/[0.07] pt-2">
              {activeConv.partnerId && <button type="button" onClick={() => { setDirectMenuOpen(false); void blockActiveUser(); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-red-300/90 transition hover:bg-red-500/[0.08]">
                <Ban size={17}/>Block account
              </button>}
              <button type="button" onClick={() => { setDirectMenuOpen(false); void reportActiveConversation(); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-red-300/90 transition hover:bg-red-500/[0.08]">
                <Flag size={17}/>Report account
              </button>
            </div>
          </motion.section>
        </>
      )}

      {activeConv && detailsOpen && <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="vanta-conversation-info fixed inset-0 z-50 h-[var(--chat-viewport-height,100dvh)] w-full overflow-y-auto overscroll-contain border-l border-white/[0.08] bg-[#1F2630] md:left-0 md:right-0 md:w-full">
        {memberBrowserOpen && activeConv.type !== 'direct' ? <section role="dialog" aria-modal="true" aria-label={activeConv.type === 'group' ? 'Group members' : 'Channel administrators'} className="fixed inset-0 z-[60] flex h-[var(--chat-viewport-height,100dvh)] flex-col bg-[#0d0d0f]"><header className="flex min-h-16 items-center gap-3 border-b border-white/[0.08] px-3 pt-[max(0px,env(safe-area-inset-top))]"><button type="button" onClick={() => setMemberBrowserOpen(false)} className="btn-icon h-10 w-10 shrink-0" aria-label="Back to information"><ArrowLeft size={18}/></button><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-white">{activeConv.type === 'group' ? 'Members' : 'Administrators'}</h2><p className="mt-0.5 text-[10px] text-white/35">{activeConv.type === 'group' ? managedEntity?._count?.members ?? activeConv.memberCount ?? activeConv.participants?.length ?? 0 : managedEntity?.members?.filter((member: any) => ['OWNER','ADMIN','MODERATOR'].includes(member.role)).length ?? 0} {activeConv.type === 'group' ? 'people in this group' : 'channel administrators'}</p></div></header><div className="border-b border-white/[0.07] p-3"><div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#151517] px-3"><Search size={15} className="shrink-0 text-white/35"/><input autoFocus type="search" value={memberBrowserQuery} onChange={event => setMemberBrowserQuery(event.target.value)} placeholder={activeConv.type === 'group' ? 'Find a member' : 'Find an administrator'} className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"/></div></div><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(20px,env(safe-area-inset-bottom))]"><div className="divide-y divide-white/[0.06]">{(managedEntity?.members || activeConv.participants || []).filter((member: any) => activeConv.type !== 'channel' || ['OWNER','ADMIN','MODERATOR'].includes(member.role)).filter((member: any) => { const person = member.user || member; const query = memberBrowserQuery.trim().toLowerCase(); return !query || `${person.fullName || ''} ${person.username || ''} ${member.role || ''}`.toLowerCase().includes(query); }).map((member: any) => { const person = member.user || member; const role = member.role || member.membershipRole; return <div key={member.userId || person.id} className="flex items-center gap-3 py-3"><Avatar src={person.avatar} alt={person.username || person.fullName || 'Member'} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white/85">{person.fullName || person.username || 'Member'}</p><p className="mt-0.5 truncate text-[11px] text-white/35">{person.username ? `@${person.username}` : ''}</p></div>{role && role !== 'MEMBER' && <span className="rounded-full bg-[#d6a83f]/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[#d6a83f]">{role.toLowerCase()}</span>}</div>; })}{(managedEntity?.members || activeConv.participants || []).filter((member: any) => activeConv.type !== 'channel' || ['OWNER','ADMIN','MODERATOR'].includes(member.role)).filter((member: any) => { const person = member.user || member; const query = memberBrowserQuery.trim().toLowerCase(); return !query || `${person.fullName || ''} ${person.username || ''} ${member.role || ''}`.toLowerCase().includes(query); }).length === 0 && <p className="py-10 text-center text-xs text-white/35">{memberBrowserQuery ? 'No matching people found.' : 'Member details are unavailable.'}</p>}</div></div></section> : <><div className="sticky top-0 z-10 grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-white/[0.08] bg-[#1F2630]/95 px-3 pt-[max(0px,env(safe-area-inset-top))] backdrop-blur-xl"><button onClick={() => closeChatSubview(() => setDetailsOpen(false))} className="btn-icon h-10 w-10 shrink-0" aria-label={`Close ${activeConv.type === 'group' ? 'group' : activeConv.type === 'channel' ? 'channel' : 'conversation'} information`}><ArrowLeft size={18}/></button><div className="min-w-0 text-center"><h2 className="truncate text-sm font-semibold text-white">{activeConv.type === 'group' ? 'Group info' : activeConv.type === 'channel' ? 'Channel info' : 'Conversation info'}</h2></div>{activeConv.type !== 'direct' && canEditEntity ? <button onClick={() => void openEntityEditor()} className="btn-icon h-10 w-10 shrink-0 text-[#f2c75c]" aria-label={`Manage ${activeConv.type === 'group' ? 'group' : 'channel'}`} title={`Edit ${activeConv.type === 'group' ? 'group' : 'channel'}`}><Pencil size={16}/></button> : <span className="h-10 w-10 shrink-0" aria-hidden="true"/>}</div>
        <div className="vanta-info-hero border-b border-white/[0.08] px-5 py-7 text-center"><div className="mx-auto w-fit"><Avatar src={activeConv.avatar} alt={activeConv.name} size="xl" /></div><h3 className="mt-3 text-base font-semibold text-white">{activeConv.name}</h3><p className="mt-1 text-xs text-white/40">{activeConv.type === 'direct' ? `@${activeConv.username || 'user'}` : activeConv.type === 'channel' ? `#${managedEntity?.handle || activeConv.handle || activeConv.name.toLowerCase().replace(/\s+/g, '-')}` : `${managedEntity?._count?.members ?? activeConv.memberCount ?? activeConv.participants?.length ?? 1} members`}</p>
        {activeConv.type === 'channel' && <p className="mt-1 text-[11px] text-white/35">{managedEntity?._count?.members ?? activeConv.memberCount ?? 0} subscribers</p>}
        {activeConv.type !== 'direct' && <div className="mt-4 w-full min-w-0 text-left"><div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#101012]"><div className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2"><span className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/35">About</span>{canEditEntity ? <button type="button" onClick={() => void openEntityEditor()} className="inline-flex items-center gap-1 pb-[2px] text-[9px] font-semibold uppercase tracking-[.1em] text-[#d6a83f] hover:text-[#f2c75c]"><Pencil size={10}/>Edit</button> : <span className="h-3" aria-hidden="true" />}</div><p className="whitespace-pre-wrap break-words px-3 py-3 text-xs font-normal leading-[1.6] text-white/55">{managedEntity?.description?.trim() || activeConv.description?.trim() ? (managedEntity?.description || activeConv.description)?.trim() : <span className="text-white/25">No description yet. Add an about text to help people know what this {activeConv.type === 'group' ? 'group' : 'channel'} is about.</span>}</p></div></div>}
        {activeConv.type === 'channel' && <div className="mt-4 flex items-center justify-center gap-2"><span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold', managedEntity?.visibility === 'PRIVATE' ? 'bg-white/[0.06] text-white/55' : 'bg-[#d6a83f]/10 text-[#f2c75c]')}>{managedEntity?.visibility === 'PRIVATE' ? 'Private channel' : 'Public channel'}</span>{(managedEntity?.handle || activeConv.handle) && <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/50">@{managedEntity?.handle || activeConv.handle}</span>}</div>}
        {activeConv.type !== 'direct' && isLoadingEntityInfo && <p className="mt-3 flex items-center justify-center gap-2 text-[10px] text-white/30"><Loader2 size={12} className="animate-spin"/>Loading members and channel details</p>}
        </div>
        <div className="border-b border-white/[0.08] p-3">
          <button onClick={searchWithinChat} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"><Search size={14}/>Search chat<ChevronRight size={13} className="ml-auto"/></button>
          <button onClick={toggleMute} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"><BellOff size={14}/>{activeConv.muted ? 'Unmute notifications' : 'Mute notifications'}<ChevronRight size={13} className="ml-auto"/></button>
          {activeConv.type === 'direct' && activeConv.username && <a href={`/profile/${activeConv.username}`} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"><Info size={14}/>View profile<ChevronRight size={13} className="ml-auto"/></a>}
          {activeConv.type === 'direct' && <div className="mt-2 border-t border-white/[0.06] pt-2">
            {activeConv.partnerId && <button type="button" onClick={() => void blockActiveUser()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-red-300/85 transition hover:bg-red-500/[0.07] hover:text-red-200"><Ban size={14}/>Block account<ChevronRight size={13} className="ml-auto"/></button>}
            <button type="button" onClick={() => void reportActiveConversation()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-red-300/85 transition hover:bg-red-500/[0.07] hover:text-red-200"><Flag size={14}/>Report account<ChevronRight size={13} className="ml-auto"/></button>
          </div>}
        </div>
          {activeConv.type !== 'direct' && (<><div className="mb-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setMemberBrowserQuery(''); setMemberBrowserOpen(true); }} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-left hover:bg-white/[0.05]"><Users size={14} className="text-[#d6a83f]"/><span className="min-w-0"><span className="block text-[11px] font-semibold text-white/80">{activeConv.type === 'group' ? 'Browse members' : 'Browse admins'}</span><span className="block truncate text-[9px] text-white/35">View the full list</span></span></button><button type="button" onClick={() => void openEntityEditor()} disabled={!canEditEntity} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-left hover:bg-white/[0.05] disabled:opacity-40"><Pencil size={14} className="text-[#d6a83f]"/><span className="min-w-0"><span className="block text-[11px] font-semibold text-white/80">Edit {activeConv.type}</span><span className="block truncate text-[9px] text-white/35">Info and settings</span></span></button></div><section className="mt-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101012]"><div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3"><div><h3 className="text-[10px] font-semibold uppercase tracking-[.14em] text-white/45">{activeConv.type === 'group' ? 'Members' : 'Administrators'}</h3><p className="mt-1 text-[10px] text-white/30">{activeConv.type === 'group' ? 'People in this group' : 'People who manage this channel'}</p></div><button type="button" onClick={() => { setMemberBrowserQuery(''); setMemberBrowserOpen(true); }} className="rounded-full border border-white/[0.08] px-2.5 py-1.5 text-[10px] font-medium text-[#f2c75c] transition hover:border-[#d6a83f]/40 hover:bg-[#d6a83f]/[0.08]">See all <span className="ml-1 text-white/50">{activeConv.type === 'group' ? managedEntity?._count?.members ?? activeConv.memberCount ?? 0 : managedEntity?.members?.filter((member: any) => ['OWNER','ADMIN','MODERATOR'].includes(member.role)).length ?? 0}</span></button></div>
          {activeConv.type === 'group' ? <div className="divide-y divide-white/[0.05] px-4">{(managedEntity?.members || activeConv.participants || []).slice(0, 8).map((member: any) => {const person = member.user || member; const role = member.role || member.membershipRole; return <div key={member.userId || person.id} className="flex items-center gap-3 py-2.5"><Avatar src={person.avatar} alt={person.username || person.fullName || 'Member'} size="xs"/><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{person.fullName || person.username || 'Member'}</p><p className="truncate text-[10px] text-white/35">{person.username ? `@${person.username}` : ''}</p></div>{role && role !== 'MEMBER' && <span className="text-[9px] uppercase tracking-wide text-[#d6a83f]">{role.toLowerCase()}</span>}</div>})}{!managedEntity?.members?.length && !activeConv.participants?.length && <p className="py-4 text-center text-[10px] text-white/30">Member details are unavailable.</p>}</div> : <div className="divide-y divide-white/[0.05] px-4">{(managedEntity?.members || []).filter((member: any) => ['OWNER','ADMIN','MODERATOR'].includes(member.role)).slice(0, 8).map((member: any) => <div key={member.userId} className="flex items-center gap-3 py-2.5"><Avatar src={member.user?.avatar} alt={member.user?.username || 'Administrator'} size="xs"/><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{member.user?.fullName || member.user?.username}</p><p className="truncate text-[10px] text-white/35">@{member.user?.username}</p></div><span className="text-[9px] uppercase tracking-wide text-[#d6a83f]">{member.role.toLowerCase()}</span></div>)}{!managedEntity?.members?.some((member: any) => ['OWNER','ADMIN','MODERATOR'].includes(member.role)) && <p className="py-4 text-center text-[10px] text-white/30">Administrator details are unavailable.</p>}</div>}
          </section></>)}
        </>}
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
        {mediaViewer && (mediaViewer.fileType === 'VIDEO' ? (
          <VideoFullscreenPlayer
            key={mediaViewer.url}
            attachment={mediaViewer}
            onClose={() => closeChatSubview(() => setMediaViewer(null))}
          />
        ) : (
          <motion.div role="dialog" aria-modal="true" aria-label={mediaViewer.fileName || 'Media viewer'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex h-[var(--chat-viewport-height,100dvh)] w-screen flex-col overflow-hidden bg-black">
            <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] bg-black/90 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-xl">
              <button type="button" onClick={() => closeChatSubview(() => setMediaViewer(null))} className="grid h-10 w-10 place-items-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.08] hover:text-white" aria-label="Close media viewer"><ArrowLeft size={19}/></button>
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-[#f5f5f5]">{mediaViewer.fileName || 'Shared media'}</p>
              <a href={mediaViewer.url} download={mediaViewer.fileName} target="_blank" rel="noreferrer" className="rounded-lg border border-white/[0.1] px-3 py-2 text-[10px] font-medium text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white">Download</a>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <img src={mediaViewer.url} alt={mediaViewer.fileName || 'Shared image'} className="max-h-full max-w-full object-contain"/>
            </div>
          </motion.div>
        ))}

        {deleteConfirmMessage && <DeleteConfirmDialog title="Delete message" description="Are you sure you want to delete this message?" confirmLabel="Delete" checkboxLabel={deleteConfirmMessage.isOwn ? (activeConv?.type === "direct" ? "Also delete for @" + (activeConv.username || activeConv.name) : "Also delete for everyone") : undefined} checkboxChecked={deleteForEveryone} onCheckboxChange={setDeleteForEveryone} onCancel={() => { setDeleteConfirmMessage(null); setDeleteForEveryone(false); }} onConfirm={() => void confirmDeleteMessage()} />}
        {deleteSelectedConfirmOpen && <DeleteConfirmDialog title="Delete selected messages" description="Are you sure you want to delete the selected messages?" confirmLabel="Delete" checkboxLabel={messages.some(message => selectedMessageIds.has(message.id) && message.isOwn) ? (activeConv?.type === "direct" ? "Also delete for @" + (activeConv.username || activeConv.name) : "Also delete for everyone") : undefined} checkboxChecked={deleteForEveryone} onCheckboxChange={setDeleteForEveryone} onCancel={() => { setDeleteSelectedConfirmOpen(false); setDeleteForEveryone(false); }} onConfirm={() => void confirmDeleteSelectedMessages()} />}
        {editEntityOpen && activeConv && activeConv.type !== 'direct' && (<>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => closeChatSubview(() => setEditEntityOpen(false))} className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" aria-label="Close management" />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] pointer-events-none"><motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="vanta-entity-settings pointer-events-auto ml-auto h-[var(--chat-viewport-height,100dvh)] w-full max-w-none overflow-y-auto overscroll-contain border-0 bg-[#1F2630] pb-[max(16px,env(safe-area-inset-bottom))]">
          <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-white/[0.08] bg-[#1F2630]/95 px-4 backdrop-blur-xl"><button onClick={() => closeChatSubview(() => setEditEntityOpen(false))} className="btn-icon h-9 w-9 shrink-0" aria-label="Close management"><ArrowLeft size={18}/></button><div className="min-w-0 text-center"><h2 className="text-sm font-semibold text-[#f5f5f5]">{activeConv.type === 'group' ? 'Group settings' : 'Channel settings'}</h2><p className="text-[9px] uppercase tracking-[.16em] text-[#d6a83f]">{isManagedOwner ? 'Owner controls' : 'Administrator controls'}</p></div><button onClick={saveEntityChanges} disabled={isSavingEntity || isUploadingAvatar || !editName.trim() || !canEditEntityInfo} className="btn-gold-ghost h-9 px-4 text-xs disabled:opacity-40 font-semibold">{isSavingEntity ? <Loader2 size={15} className="animate-spin"/> : 'Save'}</button></header>
          <div className="px-3.5">
            <section className="flex flex-col items-center border-b border-white/[0.06] px-4 pb-5 pt-6"><div className="relative"><button onClick={() => editAvatarInputRef.current?.click()} disabled={!canEditEntityInfo || isUploadingAvatar} className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-[#d6a83f]/25 bg-[#151517]" aria-label="Change photo">{editAvatar ? <Avatar src={editAvatar} alt={`${activeConv.name} photo`} size="xl" className="!h-full !w-full"/> : <Camera size={20} className="text-white/35"/>}{isUploadingAvatar && <span className="absolute inset-0 grid place-items-center bg-black/70"><Loader2 size={16} className="animate-spin"/></span>}<span className="absolute inset-x-0 bottom-0 grid h-7 place-items-center bg-black/60"><Camera size={13} className="text-white/85"/></span></button></div><input ref={editAvatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={uploadEntityAvatar}/><h3 className="mt-3 text-lg font-semibold text-[#f5f5f5]">{editName || activeConv.name}</h3><p className="mt-0.5 text-xs text-[#c8c8cc]/55">{managedEntity?._count?.members ?? managedEntity?.members?.length ?? 0} {activeConv.type === 'channel' ? 'subscribers' : 'members'}</p><div className="mt-3 flex gap-2">{editAvatar && <button onClick={() => setEditAvatar(null)} disabled={!canEditEntityInfo} className="btn-ghost h-8 rounded-full border border-white/[0.1] px-4 text-[11px] text-red-300 hover:text-red-200 disabled:opacity-40">Remove</button>}</div></section>

            {/* Identity */}
            <section className="mt-3 rounded-xl border border-white/[0.08] bg-[#151517]"><div className="border-b border-white/[0.06] px-4 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/30 flex items-center gap-2">{activeConv.type === 'channel' ? <Megaphone size={13} className="text-[#d6a83f]"/> : <Users size={13} className="text-[#d6a83f]"/>}{activeConv.type === 'channel' ? 'Channel information' : 'Group information'}</div>
              <div className="divide-y divide-white/[0.06]">
                <label className="flex items-center gap-3 px-4 py-3"><Pencil size={16} className="shrink-0 text-white/35"/><div className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-[.12em] text-white/35">Name</span><input value={editName} maxLength={60} disabled={!canEditEntityInfo} onChange={event => setEditName(event.target.value)} className="mt-1.5 w-full rounded-lg bg-transparent text-sm text-[#f5f5f5] outline-none" placeholder="Give it a name"/></div></label>
                <label className="flex items-start gap-3 px-4 py-3"><FileText size={16} className="mt-2.5 shrink-0 text-white/35"/><div className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-[.12em] text-white/35">Description</span><textarea value={editDescription} maxLength={500} disabled={!canEditEntityInfo} onChange={event => setEditDescription(event.target.value)} rows={4} placeholder={`What is this ${activeConv.type === 'group' ? 'group' : 'channel'} about?`} className="mt-2 w-full resize-none rounded-xl border border-white/[0.08] bg-[#101012] px-3 py-2.5 text-sm leading-relaxed text-[#f5f5f5] outline-none placeholder:text-white/25 focus:border-[#d6a83f]/40" /><span className="mt-1.5 text-right text-[10px] tabular-nums text-white/25">{editDescription.length}/500</span></div></label>
                {activeConv.type === 'channel' && <label className="flex items-center gap-3 px-4 py-3"><AtSign size={16} className="shrink-0 text-white/35"/><div className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-[.12em] text-white/35">Handle</span><div className="mt-1.5 flex items-center text-sm text-[#f5f5f5]"><span className="text-white/30 pr-1">@</span><input value={editHandle} disabled={!canEditEntityInfo} onChange={event => setEditHandle(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="channel_handle"/></div></div></label>}
                {activeConv.type === 'channel' && <div className="px-4 py-4"><div className="flex items-start gap-3"><div className="mt-0.5 shrink-0">{editVisibility === 'PUBLIC' ? <Globe2 size={17} className="text-[#d6a83f]"/> : <Lock size={17} className="text-[#d6a83f]"/>}</div><div className="min-w-0 flex-1"><p className="text-sm text-[#f5f5f5]">Who can access this channel?</p><p className="mt-1 text-[10px] leading-relaxed text-white/35">{editVisibility === 'PUBLIC' ? 'Anyone on VANTA can see it in discovery, join it, and read posts. Only you and your team can post.' : 'Only people you add can find or join it. It is hidden from discovery and joins require an invite.'}</p></div><button onClick={() => setEditVisibility(value => value === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC')} disabled={!canEditEntityInfo} className={cn('relative h-6 w-11 shrink-0 rounded-full border transition', editVisibility === 'PUBLIC' ? 'border-[#d6a83f]/60 bg-[#d6a83f]/25' : 'border-white/15 bg-[#202023]')} aria-label="Toggle channel access" aria-checked={editVisibility === 'PUBLIC'} role="switch"><span className={cn('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', editVisibility === 'PUBLIC' ? 'left-[22px] bg-[#f2c75c]' : 'left-0.5 bg-[#c8c8cc]')}/></button></div><div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"><p className="text-[10px] leading-relaxed text-white/35">{editVisibility === 'PUBLIC' ? 'Making it private later hides it from new people but existing members keep access.' : 'Making it public later lets anyone join and read posts.'}</p></div></div>}
              </div>
            </section>

            

            <section className="mt-4 rounded-2xl border border-white/[0.08] bg-[#151517]"><div className="flex items-center justify-between border-b border-white/[0.06] px-4 pb-3 pt-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-white/30">{activeConv.type === 'channel' ? <Globe2 size={13} className="text-[#d6a83f]"/> : <Users size={13} className="text-[#d6a83f]"/>}{activeConv.type === 'channel' ? 'Audience' : 'Members'}</div><span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/[0.06] px-1.5 text-[10px] tabular-nums text-white/50">{managedEntity?.members?.length || 0}</span></div>
              {canManageEntityMembers && <><div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#101012] px-3 py-2.5"><Search size={14} className="text-white/30"/><input value={managementSearch} onChange={event => void searchManagementUsers(event.target.value)} placeholder="Search people to add" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/25"/>{managementBusy === 'members' && <Loader2 size={13} className="animate-spin text-[#d6a83f]"/>}</div>
              {managementResults.length > 0 && <div className="border-y border-white/[0.06] bg-[#101012]">{managementResults.slice(0, 8).map(person => <button key={person.id} onClick={() => void addManagedMember(person)} className="flex w-full items-center gap-3 border-b border-white/[0.05] px-3 py-2.5 text-left last:border-0"><Avatar src={person.avatar} alt={person.username || person.fullName} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-xs text-white">{person.fullName || person.username}</p><p className="truncate text-[10px] text-white/35">@{person.username}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-[#d6a83f]/10 px-2 py-0.5 text-[10px] text-[#f2c75c]"><UserPlus size={12}/>Add</span></button>)}</div>}
              </>}<div className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.08]">{(managedEntity?.members || []).map((member: any) => { const owner = member.userId === managedEntity.ownerId; const elevated = owner || ['ADMIN', 'MODERATOR'].includes(member.role); return <div key={member.userId} className="flex items-center gap-3 px-3 py-3"><Avatar src={member.user?.avatar} alt={member.user?.username || 'Member'} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[#f5f5f5]">{member.user?.fullName || member.user?.username}</p><div className="mt-0.5 flex items-center gap-1.5"><span className="truncate text-[10px] text-white/35">@{member.user?.username}</span>{elevated && <span className="inline-flex items-center gap-1 rounded-full bg-[#d6a83f]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#d6a83f]">{owner ? <Crown size={9}/> : <Shield size={9}/>} {owner ? 'Owner' : member.role === 'MODERATOR' ? 'Moderator' : 'Admin'}</span>}</div></div>{!owner && member.userId !== user?.id && <div className="flex items-center gap-1.5">{isManagedOwner && <button disabled={managementBusy === member.userId} onClick={() => void changeManagedRole(member, elevated ? 'MEMBER' : 'ADMIN')} className="btn-ghost h-8 px-2.5 text-[11px] text-[#d6a83f] hover:text-[#f2c75c]" aria-label={elevated ? 'Remove administrator rights' : 'Promote to administrator'}>{managementBusy === member.userId ? <Loader2 size={13} className="animate-spin"/> : elevated ? 'Demote' : 'Promote'}</button>}{canRemoveEntityMembers && (!elevated || isManagedOwner) && <button onClick={() => removeManagedMember(member)} className="btn-ghost h-8 px-2.5 text-[11px] text-red-300 hover:text-red-200" aria-label="Remove member"><UserMinus size={13}/>Remove</button>}</div>}</div>})}</div>
            </section>

            {isManagedOwner && (
              <section className="mt-4 rounded-2xl border border-[#d6a83f]/25 bg-[#d6a83f]/[0.04]">
                <div className="flex items-center gap-2 border-b border-[#d6a83f]/15 px-4 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#d6a83f]"><Crown size={13}/>Transfer ownership</div>
                <div className="px-3 py-3">
                  <p className="text-[10px] leading-relaxed text-white/40">Pass this {activeConv.type === 'group' ? 'group' : 'channel'} to another member. You will keep administrator access but will no longer be the owner.</p>
                  {ownershipConfirm ? (
                    <div className="mt-3">
                      <div className="rounded-xl border border-[#d6a83f]/25 bg-[#d6a83f]/[0.07] px-3.5 py-3">
                        <p className="text-xs font-semibold text-[#f5f5f5]">Transfer to @{ownershipConfirm.user?.username || 'this member'}?</p>
                        <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">After confirming, they become the owner and can manage members, permissions and settings. This only takes effect after you confirm.</p>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button type="button" onClick={() => setOwnershipConfirm(null)} disabled={managementBusy === 'ownership'} className="btn-ghost h-9 flex-1 text-xs disabled:opacity-50">Cancel</button>
                        <button type="button" onClick={() => void confirmOwnershipTransfer()} disabled={managementBusy === 'ownership'} className="btn-gold h-9 flex-1 text-xs disabled:opacity-60">{managementBusy === 'ownership' ? <Loader2 size={14} className="animate-spin"/> : 'Confirm transfer'}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-0.5">
                      {(managedEntity?.members || []).filter((member: any) => member.userId !== user?.id).map((member: any) => (
                        <button key={member.userId} type="button" onClick={() => setOwnershipConfirm(member)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-white/[0.05]" aria-label={`Transfer ownership to ${member.user?.fullName || member.user?.username}`}>
                          <Avatar src={member.user?.avatar} alt={member.user?.username || 'Member'} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-[#f5f5f5]">{member.user?.fullName || member.user?.username}</p>
                            <p className="truncate text-[10px] text-white/35">@{member.user?.username}</p>
                          </div>
                          <ChevronRight size={14} className="shrink-0 text-white/30" />
                        </button>
                      ))}
                      {(!managedEntity?.members || managedEntity.members.filter((member: any) => member.userId !== user?.id).length === 0) && (
                        <p className="py-4 text-center text-[10px] text-white/30">There are no other members you can transfer ownership to.</p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="mt-4 rounded-2xl border border-white/[0.08] bg-[#151517]"><div className="flex items-center gap-2 border-b border-white/[0.06] px-4 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/30"><Shield size={13} className="text-[#d6a83f]"/>Permissions</div><div className="border-b border-white/[0.06] px-3 py-3"><p className="text-xs font-medium text-white/70">Who can do the following?</p><p className="mt-1 text-[10px] leading-relaxed text-white/35">{activeConv.type === 'group' ? 'Allow members to use selected group actions. Admins and the owner retain their management powers.' : 'Control member publishing and the actions channel administrators may perform.'} Permission checks are enforced on the server.</p></div><div className="divide-y divide-white/[0.06]">{managedPermissions.map(([key, label]) => { const enabled = managedEntity?.permissions?.[key] ?? (activeConv.type === 'channel' ? ['deleteMessages', 'manageChannelInfo', 'manageSubscribers'].includes(key) : ['sendMessages', 'sendMedia', 'sendLinks'].includes(key)); return <div key={key} className="flex items-start justify-between gap-3 px-4 py-3.5"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-[#c8c8cc]">{label}</p><p className="mt-0.5 text-[10px] leading-relaxed text-white/30">{permissionHints[key]}</p></div><button onClick={() => toggleManagedPermission(key)} disabled={!canManageEntityPermissions} className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40', enabled ? 'border-[#d6a83f]/60 bg-[#d6a83f]/25' : 'border-white/15 bg-[#202023]')} aria-label={`Toggle ${label}`} aria-checked={enabled} role="switch"><span className={cn('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', enabled ? 'left-[22px] bg-[#f2c75c]' : 'left-0.5 bg-[#c8c8cc]')}/></button></div>})}</div><p className="mt-3 px-4 pb-3 text-[10px] leading-relaxed text-white/25">{canManageEntityPermissions ? 'Changes take effect when you save and are enforced by VANTA on the server.' : 'Only the channel owner can change permission grants.'}</p></section>

            {/* Danger zone — irreversible actions kept apart (not shown to the owner: they cannot leave and must delete the group instead) */}
            {!isManagedOwner && <section className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/[0.04]"><div className="flex items-center gap-2 border-b border-red-500/15 px-4 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[.16em] text-red-400"><Ban size={13}/>Danger zone</div><div className="flex items-start gap-3 px-4 py-3.5"><div className="min-w-0 flex-1"><p className="text-sm text-white/80">Leave this {activeConv.type === 'group' ? 'group' : 'channel'}</p><p className="text-[10px] text-white/40">You will lose access to this conversation and its messages.</p></div><button onClick={() => setLeaveDialog(true)} className="btn-destructive h-9 px-3 text-xs">Leave {activeConv.type === 'group' ? 'Group' : 'Channel'}</button></div></section>}
          </div>
        </motion.div></motion.div>
          </>
        )}
        {createModalOpen && createType && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/70" onClick={() => resetCreateModal()} aria-label="Close creation" />
            <motion.section
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }} exit={{ opacity: 0, y: 12 }}
              role="dialog" aria-modal="true" aria-labelledby="entity-create-title"
              className="vanta-entity-create fixed inset-0 z-[61] flex h-[100dvh] min-h-0 w-screen max-w-none flex-col overflow-hidden bg-[#1F2630] text-white"
            >
              <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#1F2630] px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))] sm:px-7">
                <button type="button" onClick={() => resetCreateModal()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/65 transition hover:bg-white/[0.07] hover:text-white" aria-label="Go back"><ArrowLeft size={19} /></button>
                
                <div className="min-w-0 flex-1">
                  
                  <h2 id="entity-create-title" className="truncate text-base font-semibold tracking-tight">{createType === 'group' ? 'New Group' : 'New Channel'}</h2><p className="mt-0.5 text-[11px] text-white/40">{createType === 'group' ? 'Bring your people together' : 'Share updates with your audience'}</p>
                </div>
                <span className="h-9 w-9 shrink-0" aria-hidden="true" />
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-7 sm:py-6 [-webkit-overflow-scrolling:touch]">
                <div className="mx-auto grid w-full max-w-none gap-5 pb-6">
                  <section className="grid justify-items-center gap-2 px-2 py-1">
                    <div className="relative">
                      <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={isUploadingAvatar}
                        className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-[#d6a83f]/25 bg-[#303b49] text-white/80 transition hover:bg-[#394656] disabled:opacity-60"
                        aria-label={createAvatar ? "Change image" : "Choose image"}>
                        {isUploadingAvatar ? <Loader2 size={24} className="animate-spin" /> : createAvatar ? <Avatar src={createAvatar} alt="Image preview" size="xl" className="!h-full !w-full" /> : <Camera size={28} />}
                      </button>
                      <span aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border-2 border-[#1F2630] bg-[#d6a83f] text-[#17130a]">
                        <Pencil size={14} />
                      </span>
                    </div>
                    <p className="text-xs text-white/40">{createAvatar ? "Tap photo to change" : "Add photo (optional)"}</p>
                    {createAvatar && !isUploadingAvatar && <button type="button" onClick={() => void removeCreateAvatar()} className="text-xs font-medium text-red-300 hover:text-red-200">Remove photo</button>}
                    {createAvatarFileId && !isUploadingAvatar && <p className="text-[10px] text-emerald-300">Photo uploaded</p>}
                    <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="hidden" onChange={handleCreateImageUpload} />
                    {createAvatarError && <p className="text-xs text-red-300">{createAvatarError}</p>}
                  </section>
                  <section className="grid gap-4 rounded-2xl border border-white/[0.07] bg-[#18212b] p-4 sm:p-5">
                    <div>
                      <label className="mb-2 block text-xs font-semibold text-white/65">{createType === 'group' ? 'Group name' : 'Channel name'}</label>
                      <input value={createName} onChange={e => { setCreateName(e.target.value); if (createValidationError) setCreateValidationError(null); }} placeholder={createType === 'group' ? 'Give your group a name' : 'Give your channel a name'} maxLength={60} autoComplete="off" className={cn('h-12 w-full rounded-xl border bg-[#202b37] px-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#d6a83f]/60', createValidationError ? 'border-red-400/60' : 'border-white/[0.07]')} />
                      <div className="mt-2 flex items-center justify-between gap-3">{createValidationError ? <p className="text-xs text-red-300">{createValidationError}</p> : <p className="text-[11px] text-white/35">This is how it appears in Chats.</p>}<span className="shrink-0 text-[10px] tabular-nums text-white/30">{createName.length}/60</span></div>
                    </div>
                    {createType === 'channel' && (
                      <div>
                        <label className="mb-2 block text-xs font-semibold text-white/65">Description (Optional)</label>
                        <textarea value={createDescription} onChange={e => setCreateDescription(e.target.value)}
                          placeholder="You can provide an optional description for your channel." rows={3} maxLength={500}
                          className="min-h-24 w-full resize-y rounded-xl border border-white/[0.07] bg-[#202b37] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/35 focus:border-[#d6a83f]/60" />
                      </div>
                    )}
                  </section>
                  {createType === 'group' && <section className="rounded-2xl border border-white/[0.07] bg-[#18212b] p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">Auto-Delete Messages</h3></div><select aria-label="Auto delete messages" value={autoDeleteSeconds === 0 ? '0' : [86400,604800,2592000].includes(autoDeleteSeconds) ? String(autoDeleteSeconds) : 'custom'} onChange={e => setAutoDeleteSeconds(e.target.value === 'custom' ? 172800 : Number(e.target.value))} className="rounded-xl border border-white/[0.08] bg-[#202b37] px-3 py-2.5 text-sm text-[#e6bd58]"><option value="0">Off</option><option value="86400">1 day</option><option value="604800">1 week</option><option value="2592000">1 month</option><option value="custom">Custom time</option></select></div>{![0,86400,604800,2592000].includes(autoDeleteSeconds) && <div className="mt-3 flex items-center gap-2"><input aria-label="Custom auto delete days" type="number" min="1" max="365" value={customDeleteDays} onChange={e => {setCustomDeleteDays(e.target.value);setAutoDeleteSeconds(Math.max(1,Math.min(365,Number(e.target.value)||1))*86400);}} className="h-10 w-24 rounded-lg border border-white/[0.08] bg-[#202b37] px-3 text-sm text-white"/><span className="text-xs text-white/45">days</span></div>}</section>}
                  {createType === 'channel' && (
                    <section className="grid gap-4 rounded-2xl border border-white/[0.07] bg-[#18212b] p-4 sm:grid-cols-2 sm:p-5">
                      <div>
                        <label className="mb-2 block text-xs font-semibold text-white/65">Channel handle</label>
                        <div className="flex h-12 items-center rounded-xl border border-white/[0.07] bg-[#202b37] px-4 focus-within:border-[#d6a83f]/60"><span className="mr-1 text-sm text-white/35">@</span><input value={createHandle} onChange={e => setCreateHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} placeholder="your-channel" maxLength={30} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30" /></div>
                        <p className="mt-2 text-[10px] text-white/35">A unique identity for your channel.</p>
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-semibold text-white/65">Who can access it?</label>
                        <div className="grid grid-cols-2 gap-2">{(['PUBLIC', 'PRIVATE'] as const).map(vis => <button key={vis} type="button" onClick={() => setCreateVisibility(vis)} className={cn('min-h-12 rounded-xl px-3 text-left transition', createVisibility === vis ? 'bg-[#d6a83f]/15 text-[#f2c75c] ring-1 ring-[#d6a83f]/45' : 'bg-[#202b37] text-white/60 hover:bg-[#293746]')}><span className="block text-xs font-semibold">{vis === 'PUBLIC' ? 'Public' : 'Private'}</span><span className="mt-0.5 block text-[10px] opacity-65">{vis === 'PUBLIC' ? 'Discoverable' : 'Invite only'}</span></button>)}</div>
                      </div>
                    </section>
                  )}
                  {createType === 'group' && (<section className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#18212b] p-4">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">Members</h3><span className="text-xs tabular-nums text-[#e6bd58]">{selectedMembers.filter((member) => member.id !== user?.id).length} selected</span></div>
                    {selectedMembers.length > 0 && <div className="flex flex-wrap gap-2">{selectedMembers.map(member => <button key={member.id} type="button" onClick={() => toggleMemberSelection(member)} className="flex items-center gap-2 rounded-full bg-[#26313e] py-1.5 pl-1.5 pr-3 text-xs text-white/80 transition hover:bg-[#303d4b]"><Avatar src={member.avatar} alt={member.username || member.fullName} size="xs" /><span>{member.id === user?.id ? 'You' : member.username || member.fullName}</span>{member.id !== user?.id && <X size={12} className="text-white/40" />}</button>)}</div>}
                    <div className="relative"><Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" /><input value={memberSearch} onChange={e => handleSearchMembers(e.target.value)} placeholder="Search VANTA members" className="h-11 w-full rounded-xl border border-white/[0.07] bg-[#202b37] pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#d6a83f]/60" /></div>
                    {createType === 'group' && <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">{followersLoading ? <p className="px-3 py-5 text-center text-xs text-white/40">Loading your followers…</p> : memberSearchResults.map((item: any) => <button key={item.id} type="button" onClick={() => toggleMemberSelection(item)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]"><Avatar src={item.avatar} alt={item.username || item.fullName} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{item.fullName || item.username}</span><span className="mt-0.5 block truncate text-[10px] text-white/40">@{item.username}</span></span><UserPlus size={15} className="text-[#d6a83f]" /></button>)}{!followersLoading && memberSearchResults.length === 0 && <p className="px-3 py-5 text-center text-xs text-white/40">{memberSearch ? 'No matching followers found.' : 'No followers available to add.'}</p>}</div>}
                  </section>)}
                </div>
              </div>
              <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.07] bg-[#1F2630] px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-7">
                <p className="hidden text-[11px] text-white/35 sm:block">You can edit these details later.</p>
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={() => resetCreateModal()} className="h-11 rounded-xl px-4 text-sm font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white">Cancel</button>
                  <button type="button" onClick={() => void handleCreateEntity()} disabled={isCreatingEntity || isUploadingAvatar || !createName.trim()} className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-xl bg-[#d6a83f] px-5 text-sm font-semibold text-[#17130a] transition hover:bg-[#e4b94f] disabled:cursor-not-allowed disabled:opacity-50">
                    {isCreatingEntity ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : <>{createType === 'group' ? <Users size={15} /> : <Megaphone size={15} />} Create {createType}</>}
                  </button>
                </div>
              </footer>
            </motion.section>
          </>
        )}
      </AnimatePresence>

      {/* Shared VANTA video trimmer — same UI everywhere (Reel, Post, Story, Chat) */}
      <VideoTrimModal
        open={Boolean(trimVideoFile)}
        file={trimVideoFile}
        onClose={() => setTrimVideoFile(null)}
        onConfirm={handleTrimVideoConfirm}
        title="Trim Video"
        subtitle="Preview and trim the timeline before sending"
        confirmLabel="Send with this clip"
        trimActionLabel="Trim & Preview"
      />

      {/* Floating create button — only on the Chats index/list page. Never
          rendered inside an open private/group/channel conversation. `showMobileList`
          flips to false the moment a conversation is selected on every breakpoint. */}
      {showMobileList && (
        <MessageFab
          search={newChatSearch}
          results={newChatResults}
          onSearch={handleNewChatSearch}
          onSelectUser={handleNewChat}
          onNewGroup={handleNewGroup}
          onNewChannel={handleNewChannel}
        />
      )}

      {blockConfirmOpen && activeConv && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-5 py-8 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBlockConfirmOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="block-account-title" className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#1F2630] p-5 shadow-2xl">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-red-500/10 text-red-300"><Ban size={20} /></div>
            <h2 id="block-account-title" className="text-base font-semibold text-white">Block @{activeConv.username || activeConv.name}?</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">They won’t be able to message you, and VANTA will prevent direct messaging between both accounts. You can unblock them later in Privacy settings.</p>
            <div className="mt-6 flex gap-2">
              <button type="button" onClick={() => setBlockConfirmOpen(false)} className="min-h-11 flex-1 rounded-xl border border-white/[0.1] px-4 text-sm font-medium text-white/75 transition hover:bg-white/[0.05]">Cancel</button>
              <button type="button" onClick={() => void confirmBlockActiveUser()} className="min-h-11 flex-1 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400">Block account</button>
            </div>
          </section>
        </div>
      )}

    </motion.div>
  );
}