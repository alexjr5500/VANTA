'use client';

import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import Link from 'next/link';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, Check, ChevronDown, ChevronUp, Copy, Edit3, FilePlus2, Flag, Heart, Loader2, MessageCircle, MoreHorizontal, RefreshCw, Reply, Send, Smile, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '@/lib/apiClient';
import { createSocket } from '@/lib/socketClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';
import { renderTextWithLinks } from '@/lib/linkify';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import type { VerificationType } from '@/types/verification';
import { MentionSuggestions, useMentionSuggestions } from '@/components/social/MentionSuggestions';
import { MentionTextarea } from '@/components/social/MentionTextarea';

type User = { id: string; username: string; fullName?: string | null; avatar?: string | null; verified?: boolean; verificationType?: VerificationType | null; role?: string };
export type CommentMedia = { fileId: string; url: string; type: 'IMAGE' | 'VIDEO' };
export type CommentItem = { id: string; userId: string; content: string; media?: CommentMedia[]; createdAt: string; updatedAt?: string; edited?: boolean; liked?: boolean; parentId?: string | null; user: User; _count?: { likes: number; replies: number }; replies?: CommentItem[] };
type Props = { postId: string; postAuthor?: User; initialCount: number; token: string; currentUser?: User | null; onClose?: () => void; onCountChange: (count: number) => void; kind?: 'post' | 'reel'; inline?: boolean; compact?: boolean; hideEmojiPicker?: boolean; enableAttachments?: boolean };

const EMOJIS = ['😀', '😂', '😍', '🥳', '😎', '🙌', '👏', '🔥', '❤️', '💜', '✨', '🎉', '🌹', '💯', '🙏', '😅', '🤔', '😭', '🤣', '🚀', '👑', '💎', '🫶', '😮'];
const timeAgo = (value: string) => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; };
const cnSort = (active: boolean) => `rounded-full px-3 py-1.5 text-[11px] font-medium transition ${active ? 'bg-[#d6a83f]/15 text-[#f2c75c]' : 'text-[#858585] hover:text-white'}`;

export default function CommentPanel({ postId, postAuthor, token, currentUser, onClose, onCountChange, kind = 'post', inline = false, compact = false, hideEmojiPicker = false, enableAttachments = false }: Props) {
  const toast = useToast();
  const isInline = Boolean(inline);
  // Reels are stored in the prisma.video table and their comments live under
  // /api/reels; Posts live under /api/feed. Routing Reel IDs to /api/feed would
  // look them up in the Post table and fail. Points of divergence between the
  // two comment models (replies, like/update/report) are guarded below.
  const base = kind === 'reel' ? '/api/reels' : '/api/feed';
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sort, setSort] = useState<'newest' | 'top'>('top');
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [editing, setEditing] = useState<CommentItem | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
const [deleteConfirm, setDeleteConfirm] = useState<CommentItem | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyCursors, setReplyCursors] = useState<Record<string, string | undefined>>({});
  const [replyLoading, setReplyLoading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mentions = useMentionSuggestions({ value: text, onChange: setText, token, inputRef });

  // Create temporary local previews as soon as the user selects media. Revoke
  // every object URL when the selection changes or the panel unmounts.
  useEffect(() => {
    const previews = selectedFiles.map(file => ({ file, url: URL.createObjectURL(file) }));
    setFilePreviews(previews);
    return () => previews.forEach(preview => URL.revokeObjectURL(preview.url));
  }, [selectedFiles]);

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    setLoadError(false);
    try {
      const query = new URLSearchParams({ limit: '20', sort });
      if (!reset && cursor) query.set('cursor', cursor);
      if (search.trim()) query.set('search', search.trim());
      const result = await apiGet<{ items: CommentItem[]; nextCursor?: string }>(`${base}/${postId}/comments?${query}`, token, { skipCache: true });
      setComments(previous => reset ? result.items : [...previous, ...result.items.filter(item => !previous.some(existing => existing.id === item.id))]);
      setCursor(result.nextCursor);
    } catch (error: any) { setLoadError(true); toast.error('Comments unavailable', error.message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [base, cursor, postId, search, sort, token, toast]);

  useEffect(() => { void load(true); if (!isInline) inputRef.current?.focus(); }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the sheet (Escape is ignored while a comment is submitting).
  // The inline page variant never steals Escape — the page owns its own keys.
  useEffect(() => {
    if (isInline) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submittingRef.current) onClose?.(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose, isInline]);

  useEffect(() => {
    const socket = createSocket(token, `comments:${postId}`);
    const created = (event: { postId: string; comment: CommentItem; commentCount: number }) => {
      if (event.postId !== postId) return;
      setComments(items => event.comment.parentId
        ? items.map(item => item.id === event.comment.parentId && !item.replies?.some(reply => reply.id === event.comment.id) ? { ...item, replies: [...(item.replies || []), event.comment], _count: { likes: item._count?.likes || 0, replies: (item._count?.replies || 0) + 1 } } : item)
        : items.some(item => item.id === event.comment.id) ? items : [event.comment, ...items]);
      onCountChange(event.commentCount);
    };
    const updated = (event: { postId: string; comment: CommentItem }) => {
      if (event.postId !== postId) return;
      const replace = (items: CommentItem[]): CommentItem[] => items.map(item => item.id === event.comment.id ? { ...item, ...event.comment } : { ...item, replies: item.replies && replace(item.replies) });
      setComments(replace);
    };
    const deleted = (event: { postId: string; commentId: string; commentCount: number }) => {
      if (event.postId !== postId) return;
      const removeItem = (items: CommentItem[]): CommentItem[] => items.filter(item => item.id !== event.commentId).map(item => ({ ...item, replies: item.replies && removeItem(item.replies) }));
      setComments(removeItem); onCountChange(event.commentCount);
    };
    socket.on('social:comment-created', created); socket.on('social:comment-updated', updated); socket.on('social:comment-deleted', deleted); socket.connect();
    return () => { socket.off('social:comment-created', created); socket.off('social:comment-updated', updated); socket.off('social:comment-deleted', deleted); socket.disconnect(); };
  }, [onCountChange, postId, token]);

  const loadReplies = async (comment: CommentItem, reset = true) => {
    // Reel comments have no nested replies; the /api/reels endpoints do not
    // expose a replies resource. Swallow early instead of firing a wrong path.
    if (kind === 'reel') return;
    setExpanded(previous => ({ ...previous, [comment.id]: true })); setReplyLoading(comment.id);
    try {
      const query = new URLSearchParams({ limit: '20' }); const next = replyCursors[comment.id];
      if (!reset && next) query.set('cursor', next);
      const result = await apiGet<{ items: CommentItem[]; nextCursor?: string }>(`${base}/${postId}/comments/${comment.id}/replies?${query}`, token, { skipCache: true });
      setComments(previous => previous.map(item => item.id === comment.id ? { ...item, replies: reset ? result.items : [...(item.replies || []), ...result.items] } : item));
      setReplyCursors(previous => ({ ...previous, [comment.id]: result.nextCursor }));
    } catch (error: any) { toast.error('Replies unavailable', error.message); } finally { setReplyLoading(null); }
  };

  const toggleLike = async (comment: CommentItem) => {
    const wasLiked = Boolean(comment.liked);
    const previousCount = comment._count?.likes || 0;
    const applyLike = (items: CommentItem[], liked: boolean, likes: number): CommentItem[] =>
      items.map(item => item.id === comment.id
        ? { ...item, liked, _count: { likes, replies: item._count?.replies || 0 }, replies: item.replies && applyLike(item.replies, liked, likes) }
        : { ...item, replies: item.replies && applyLike(item.replies, liked, likes) });
    const optimisticLiked = !wasLiked;
    const optimisticCount = Math.max(0, previousCount + (wasLiked ? -1 : 1));
    setComments(items => applyLike(items, optimisticLiked, optimisticCount));
    setMenu(null);
    try {
      const result = kind === 'reel'
        ? await apiPost<{ liked: boolean; likes: number }>(`${base}/${postId}/comments/${comment.id}/like`, {}, token)
        : await apiPost<{ liked?: boolean; likes?: number }>(`${base}/${postId}/comments/${comment.id}/like`, {}, token);
      setComments(items => applyLike(items, result.liked ?? optimisticLiked, result.likes ?? optimisticCount));
    } catch (error: any) {
      setComments(items => applyLike(items, wasLiked, previousCount));
      toast.error('Like not saved', error.message);
    }
  };

  const selectCommentFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (incoming.length !== files.length) toast.error('Unsupported file', 'Select images or videos only.');
    setSelectedFiles(previous => {
      const merged = [...previous];
      for (const file of incoming) {
        if (!merged.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) merged.push(file);
      }
      if (merged.length > 4) toast.error('Attachment limit', 'You can add up to 4 images or videos.');
      return merged.slice(0, 4);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = text.trim();
    if ((!clean && selectedFiles.length === 0) || submitting || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    try {
      if (kind === 'post' && editing) {
        const updated = await apiPut<CommentItem>(`${base}/${postId}/comments/${editing.id}`, { content: clean }, token);
        setComments(items => items.map(item => item.id === updated.id ? { ...item, ...updated } : item));
        setEditing(null); setText(''); setEmojiOpen(false); return;
      }
      let mediaFileIds: string[] = [];
      if (kind === 'post' && enableAttachments && selectedFiles.length) {
        for (const file of selectedFiles) {
          const form = new FormData();
          form.append('file', file);
          form.append('category', 'comment-media');
          const uploaded = await apiUpload<{ id: string; url: string; type: 'IMAGE' | 'VIDEO' }>('/api/upload', form, token);
          mediaFileIds.push(uploaded.id);
        }
      }
      const result = kind === 'reel'
        ? await apiPost<CommentItem>(`${base}/${postId}/comments`, { content: clean }, token)
        : await apiPost<{ comment: CommentItem; commentCount: number }>(`${base}/${postId}/comments`, { content: clean, parentId: replyTo?.id, mediaFileIds }, token);
      if (kind === 'post' && replyTo) setComments(items => items.map(item => item.id === replyTo.id ? { ...item, replies: [...(item.replies || []), (result as { comment: CommentItem }).comment], _count: { likes: item._count?.likes || 0, replies: (item._count?.replies || 0) + 1 } } : item));
      else if (kind === 'post') setComments(items => [(result as { comment: CommentItem }).comment, ...items]);
      else setComments(items => [result as CommentItem, ...items]);
      onCountChange(kind === 'reel' ? comments.length + 1 : (result as { commentCount: number }).commentCount);
      setReplyTo(null); setText(''); setSelectedFiles([]); setEmojiOpen(false);
    } catch (error: any) { toast.error('Comment not saved', error.message); }
    finally { setSubmitting(false); submittingRef.current = false; }
  };

  const remove = async (comment: CommentItem) => {
    if (!comment) return;
    setDeleteConfirm(comment);
    setMenu(null);
  };
  const confirmDeleteComment = async () => {
    if (!deleteConfirm) return;
    const comment = deleteConfirm;
    setDeleteConfirm(null);
    try { const result = await apiDelete<{ commentCount?: number }>(`${base}/${postId}/comments/${comment.id}`, token); const removeItem = (items: CommentItem[]): CommentItem[] => items.filter(item => item.id !== comment.id).map(item => ({ ...item, replies: item.replies && removeItem(item.replies) })); setComments(removeItem); onCountChange(kind === 'reel' ? comments.length - 1 : Number(result?.commentCount || comments.length - 1)); } catch (error: any) { toast.error('Comment not deleted', error.message); }
  };
  const report = async (comment: CommentItem) => { if (kind === 'reel') return; const reason = window.prompt('Report reason: SPAM, HARASSMENT, HATE, THREATS, MISINFORMATION, or OTHER'); if (!reason) return; try { await apiPost(`${base}/${postId}/comments/${comment.id}/report`, { reason }, token); toast.success('Report submitted'); } catch (error: any) { toast.error('Report failed', error.message); } setMenu(null); };

  const CommentRow = ({ comment, depth = 0 }: { comment: CommentItem; depth?: number }) => <article className={`group relative px-1 ${compact ? 'py-2.5 first:pt-2.5' : 'py-3 first:pt-3'} transition-colors sm:px-2`} style={{ marginLeft: Math.min(depth, 4) * 14 }}><div className="flex gap-2.5"><Link href={`/profile/${encodeURIComponent(comment.user.username)}`} aria-label={`Open @${comment.user.username}'s profile`} className="h-9 w-9 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a227]"><Avatar src={comment.user.avatar} alt={comment.user.username} size="sm" /></Link><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]"><strong className="inline-flex min-w-0 items-center gap-1 font-semibold text-white"><Link href={`/profile/${encodeURIComponent(comment.user.username)}`} onClick={() => onClose?.()} className="truncate hover:underline">{comment.user.fullName || comment.user.username}</Link></strong>{comment.user.verified && comment.user.verificationType && <VerificationBadge verified type={comment.user.verificationType} size="xs" className="shrink-0 align-[-1px]" />}{comment.user.role === 'CREATOR' && <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[9px] text-fuchsia-200">CREATOR</span>}<span className="truncate text-white/35">@{comment.user.username}</span><span className="text-white/25">·</span><span className="shrink-0 text-white/35">{timeAgo(comment.createdAt)}</span>{comment.edited && <span className="text-white/30">· edited</span>}</div><p className={`${compact ? 'mt-1 text-[13px] leading-[1.5]' : 'mt-1.5 text-[13px] leading-[1.65] sm:text-sm'} whitespace-pre-wrap break-words text-white/80`}>{renderTextWithLinks(comment.content, 'linkify', { mentions: true, hashtags: true })}</p>{comment.media && comment.media.length > 0 && <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md">{comment.media.map(media => media.type === 'VIDEO' ? <video key={media.fileId} src={resolveMediaUrl(media.url)} controls playsInline preload="metadata" className="max-h-64 w-full rounded-xl bg-black object-contain" /> : <img key={media.fileId} src={resolveMediaUrl(media.url)} alt="Comment attachment" loading="lazy" className="max-h-64 w-full rounded-xl bg-black/20 object-cover" />)}</div>}<div className={`mt-2 flex items-center gap-1.5 text-[12px] text-white/50 ${compact ? 'mt-1.5' : ''}`}><button onClick={() => toggleLike(comment)} aria-label={comment.liked ? 'Unlike comment' : 'Like comment'} className={`rounded-full px-2.5 py-1 transition hover:bg-white/[0.06] ${comment.liked ? 'text-[#f2c75c]' : 'hover:text-white'}`}><Heart size={13} className="mr-1 inline" fill={comment.liked ? 'currentColor' : 'none'} />Like {comment._count?.likes || 0}</button><button onClick={() => { setReplyTo(comment); inputRef.current?.focus(); }} aria-label="Reply to comment" className="rounded-full px-2.5 py-1 transition hover:bg-white/[0.06] hover:text-white"><Reply size={13} className="mr-1 inline" />Reply</button><button onClick={() => setMenu(menu === comment.id ? null : comment.id)} aria-label="More comment actions"><MoreHorizontal size={15} /></button></div>{menu === comment.id && <div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[.04] p-2 text-[11px] text-white/70"><button onClick={() => { navigator.clipboard.writeText(comment.content); setMenu(null); toast.success('Comment copied'); }}><Copy size={12} className="mr-1 inline" />Copy</button>{comment.userId === currentUser?.id && <><button onClick={() => { setEditing(comment); setText(comment.content); setMenu(null); inputRef.current?.focus(); }}><Edit3 size={12} className="mr-1 inline" />Edit</button><button onClick={() => void remove(comment)} className="text-rose-300"><Trash2 size={12} className="mr-1 inline" />Delete</button></>}<button onClick={() => void report(comment)} className="text-amber-200"><Flag size={12} className="mr-1 inline" />Report</button></div>}{(comment._count?.replies || 0) > 0 && <div className="mt-3">{!expanded[comment.id] ? <button onClick={() => void loadReplies(comment)} className="text-xs font-semibold text-[#c8c8cc]">View {comment._count?.replies} {comment._count?.replies === 1 ? 'reply' : 'replies'} <ChevronDown size={13} className="inline" /></button> : <><button onClick={() => setExpanded(items => ({ ...items, [comment.id]: false }))} className="text-xs font-semibold text-[#c8c8cc]">Hide replies <ChevronUp size={13} className="inline" /></button>{replyLoading === comment.id ? <Loader2 size={14} className="ml-2 inline animate-spin" /> : comment.replies?.map(reply => <CommentRow key={reply.id} comment={reply} depth={depth + 1} />)}{replyCursors[comment.id] && <button onClick={() => void loadReplies(comment, false)} className="mt-2 text-xs text-white/50">Load more replies</button>}</>}</div>}</div></div></article>;

  // Shared delete-confirmation dialog (used by both the sheet and inline modes).
  const deleteConfirmDialog = deleteConfirm && <DeleteConfirmDialog title="Delete this comment?" description="This cannot be undone. The comment will be removed permanently." confirmLabel="Delete comment" onCancel={() => setDeleteConfirm(null)} onConfirm={() => void confirmDeleteComment()} />;

  // Inline mode renders the exact same comment system (same fetch, optimistic
  // submit, replies, likes, edit/delete/report, realtime and counts) as a
  // page-flow conversation instead of a bottom sheet — used on Post / Reel
  // detail pages so comments live directly under the content.
  if (isInline) {
    return (
      <section aria-label="Comments" className="flex min-h-[320px] w-full min-w-0 flex-col pb-24">
        <header className={`flex shrink-0 items-center justify-between gap-3 px-1 ${compact ? 'pt-2' : 'pt-3'}`}>
          <h2 id="comments-title" className="truncate text-sm font-bold text-[#f5f5f5]">Comments</h2>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.045] p-0.5" role="group" aria-label="Comment sorting">
            <button type="button" onClick={() => setSort('top')} aria-pressed={sort === 'top'} className={cnSort(sort === 'top')}>Relevant</button>
            <button type="button" onClick={() => setSort('newest')} aria-pressed={sort === 'newest'} className={cnSort(sort === 'newest')}>Latest</button>
          </div>
        </header>
        <div className="min-w-0 px-1">
          {loading ? (
            <div className="space-y-4 py-6">{[1, 2, 3].map(item => <div key={item} className="flex animate-pulse gap-3"><div className="h-9 w-9 rounded-full bg-white/10" /><div className="h-14 flex-1 rounded-lg bg-white/[.05]" /></div>)}</div>
          ) : loadError ? (
            <div className="py-10 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white/[0.04]"><MessageCircle size={18} className="text-white/25" /></div>
              <p className="mt-3 text-sm font-medium text-white/55">Comments could not load</p>
              <p className="mt-1 text-xs text-white/30">Check your connection and try again.</p>
              <button type="button" onClick={() => void load(true)} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-xs font-medium text-white transition hover:bg-white/[0.1]"><RefreshCw size={14} /> Retry</button>
            </div>
          ) : comments.length ? (
            <div>{comments.map(comment => <CommentRow key={comment.id} comment={comment} />)}</div>
          ) : (
            <div className="py-10 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white/[0.04]"><MessageCircle size={18} className="text-white/25" /></div>
              <p className="mt-3 text-sm font-medium text-white/55">{search.trim() ? 'No matching comments' : 'No replies yet'}</p>
              <p className="mt-1 text-xs text-white/30">{search.trim() ? 'Try a different search or clear the search to see all comments.' : 'Start the conversation — your thoughts belong here.'}</p>
              {search.trim() && <button type="button" onClick={() => { setSearch(''); void load(true); }} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-white/10 bg-white/[0.05] px-3.5 text-xs font-medium text-white transition hover:bg-white/[0.1]">Clear search</button>}
            </div>
          )}
          {loadingMore && <Loader2 className="mx-auto my-4 animate-spin text-white/50" />}
        </div>
        <form onSubmit={submit} className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[680px] border-t border-white/[.06] bg-[var(--header-surface)]/95 px-3 pt-2 pb-[calc(.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-white/50">
            {replyTo && <><span>Replying to @{replyTo.user.username}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={12} /></button></>}
            {editing && <><span>Editing comment</span><button type="button" onClick={() => { setEditing(null); setText(''); }} aria-label="Cancel edit"><X size={12} /></button></>}
          </div>
          <MentionSuggestions mention={mentions} className="mb-2 rounded-xl" />
          {filePreviews.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{filePreviews.map(({ file, url }, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white/[.06]">{file.type.startsWith('video/') ? <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={url} alt={`Selected image ${index + 1}`} className="h-full w-full object-cover" />}<button type="button" onClick={() => setSelectedFiles(items => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove attachment ${index + 1}`} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/75 text-white"><X size={12} /></button></div>)}</div>}
          <div className="flex items-end gap-1.5 bg-transparent px-0 py-0">
            {enableAttachments ? <><button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Select images or videos" title="Select images or videos" className="btn-icon mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.045] text-white/70 transition hover:bg-white/[0.08]"><FilePlus2 size={17} /></button><input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={event => selectCommentFiles(event.target.files)} /></> : <Avatar src={currentUser?.avatar} alt={currentUser?.username || 'Your avatar'} size="xs" />}
            <MentionTextarea surfaceClassName="rounded-2xl bg-[var(--surface)]" ref={inputRef} onClick={e => mentions.syncCaret(e.currentTarget)} onKeyUp={e => mentions.syncCaret(e.currentTarget)} rows={1} value={text} onChange={e => { setText(e.target.value); mentions.syncCaret(e.currentTarget); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Add a comment..." aria-label="Add a comment" maxLength={2000} className="min-h-10 max-h-[120px] min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border-0 bg-[#27313d] px-3.5 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/35 focus:bg-[#354252]" />
            {!hideEmojiPicker && <button type="button" onClick={() => setEmojiOpen(value => !value)} aria-label="Add emoji" className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.045] text-white/60 transition hover:bg-white/[.08] hover:text-white"><Smile size={16} /></button>}
            <button type="button" onClick={() => setText(value => `${value}${value ? ' ' : ''}@`)} aria-label="Mention a user" className="mb-0.5 hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.045] text-white/60 transition hover:bg-white/[.08] hover:text-white sm:grid"><AtSign size={16} /></button>
            <button type="submit" aria-label="Send comment" disabled={(!text.trim() && selectedFiles.length === 0) || submitting} className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c9a227] text-[#171b20] transition-colors hover:bg-[#e0b638] disabled:opacity-30">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
          </div>
          {!hideEmojiPicker && emojiOpen && <div className="absolute bottom-16 right-4 grid w-64 max-w-[calc(100vw-2rem)] grid-cols-8 gap-1 rounded-lg border border-white/10 bg-[#151517] p-3 shadow-2xl">{EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => setText(value => value + emoji)} className="rounded-md p-1 text-lg hover:bg-white/10" aria-label={`Add ${emoji}`}>{emoji}</button>)}</div>}
          </form>
        {deleteConfirmDialog}
      </section>
    );
  }

  return <AnimatePresence><motion.div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} /><motion.section role="dialog" aria-modal="true" aria-labelledby="comments-title" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: .22, ease: 'easeOut' }} className={kind === "reel" ? "fixed inset-x-0 bottom-[var(--vanta-kb,0px)] z-[80] mx-auto flex h-[min(62dvh,680px)] w-full max-w-[520px] flex-col overflow-hidden rounded-t-2xl border border-white/[.08] bg-[var(--background)] shadow-2xl sm:bottom-0 sm:left-1/2 sm:-translate-x-1/2" : "fixed inset-x-0 bottom-[var(--vanta-kb,0px)] z-[80] mx-auto flex h-[var(--vanta-vh,100dvh)] w-full max-w-[760px] flex-col overflow-hidden bg-[var(--background)] sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(86dvh,820px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:ring-1 sm:ring-white/[0.06]"}>
    <header className="flex h-14 max-h-14 min-h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <h2 id="comments-title" className="min-w-0 truncate text-base font-semibold leading-none tracking-[-0.02em] text-[#f5f5f5]">Comments</h2>
      </div>
      <button onClick={onClose} aria-label="Close comments" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#b8b8b8] transition hover:bg-white/[0.06] hover:text-white"><X size={17} /></button>
    </header>
    <div className="flex shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-white/[0.012] px-4 py-3 sm:px-6">
      <span className="flex items-center gap-1 rounded-full bg-white/[0.045] p-0.5" role="group" aria-label="Comment sorting">
        <button type="button" onClick={() => setSort('top')} aria-pressed={sort === 'top'} className={cnSort(sort === 'top')}>Relevant</button>
        <button type="button" onClick={() => setSort('newest')} aria-pressed={sort === 'newest'} className={cnSort(sort === 'newest')}>Latest</button>
      </span>
      <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && void load(true)} placeholder="Search comments" aria-label="Search comments" className="ml-auto min-w-0 w-36 rounded-xl border border-white/[0.08] bg-white/[0.025] py-2 pl-3 pr-3 text-xs text-white outline-none transition placeholder:text-white/30 focus:border-[#c9a227]/40 focus:bg-white/[0.04] sm:w-48" />
    </div>
    <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-1 sm:px-6" onScroll={e => { const target = e.currentTarget; if (target.scrollHeight - target.scrollTop - target.clientHeight < 160 && cursor && !loadingMore) void load(false); }}>{loading ? <div className="space-y-4 py-6">{[1, 2, 3].map(item => <div key={item} className="flex animate-pulse gap-3"><div className="h-9 w-9 rounded-full bg-white/10" /><div className="h-14 flex-1 rounded-lg bg-white/[.05]" /></div>)}</div> : loadError ? <div className="px-4 py-14 text-center sm:px-5"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/[0.04]"><MessageCircle size={20} className="text-white/25" /></div><p className="mt-3 text-sm font-medium text-white/55">Comments could not load</p><p className="mt-1 text-xs text-white/30">Check your connection and try again.</p><button type="button" onClick={() => void load(true)} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-xs font-medium text-white transition hover:bg-white/[0.1]"><RefreshCw size={14} /> Retry</button></div> : comments.length ? comments.map(comment => <CommentRow key={comment.id} comment={comment} />) : <div className="px-4 py-14 text-center sm:px-5"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/[0.04]"><MessageCircle size={20} className="text-white/25" /></div><p className="mt-3 text-sm font-medium text-white/55">{search.trim() ? 'No matching comments' : 'No comments yet'}</p><p className="mt-1 text-xs text-white/30">{search.trim() ? 'Try a different search or clear the search to see all comments.' : 'Start the conversation — your thoughts belong here.'}</p>{search.trim() && <button type="button" onClick={() => { setSearch(''); void load(true); }} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-white/10 bg-white/[0.05] px-3.5 text-xs font-medium text-white transition hover:bg-white/[0.1]">Clear search</button>}</div>}{loadingMore && <Loader2 className="mx-auto my-4 animate-spin text-white/50" />}</div>
    <form onSubmit={submit} className="relative shrink-0 bg-transparent px-3 pt-2 pb-[calc(.75rem+env(safe-area-inset-bottom))]"><MentionSuggestions mention={mentions} className="mb-2 rounded-xl" /><div className="mb-2 flex items-center gap-2 text-[11px] text-white/50">{replyTo && <><span>Replying to @{replyTo.user.username}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={12} /></button></>}{editing && <><span>Editing comment</span><button type="button" onClick={() => { setEditing(null); setText(''); }} aria-label="Cancel edit"><X size={12} /></button></>}</div><div className="flex items-end gap-1.5 bg-transparent"><Avatar src={currentUser?.avatar} alt={currentUser?.username || 'Your avatar'} size="xs" /><MentionTextarea surfaceClassName="rounded-2xl bg-[var(--surface)]" ref={inputRef} onClick={e => mentions.syncCaret(e.currentTarget)} onKeyUp={e => mentions.syncCaret(e.currentTarget)} rows={1} value={text} onChange={e => { setText(e.target.value); mentions.syncCaret(e.currentTarget); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Write a comment..." aria-label="Write a comment" maxLength={2000} className="min-h-10 max-h-[120px] min-w-0 flex-1 resize-none overflow-y-auto rounded-[20px] border-0 bg-[#19191c] px-3.5 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/35 focus:bg-[#202024]" /><button type="button" onClick={() => setEmojiOpen(value => !value)} aria-label="Add emoji" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.045] text-white/60 transition hover:bg-white/[.08] hover:text-white"><Smile size={16} /></button><button type="button" onClick={() => setText(value => `${value}${value ? ' ' : ''}@`)} aria-label="Mention a user" className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.045] text-white/60 transition hover:bg-white/[.08] hover:text-white sm:grid"><AtSign size={16} /></button><button type="submit" aria-label="Send comment" disabled={!text.trim() || submitting} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d6a83f] text-[#1f2630] transition-colors hover:bg-[#dfbd55] disabled:opacity-30">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button></div>{emojiOpen && <div className="absolute bottom-16 right-4 grid w-64 max-w-[calc(100vw-2rem)] grid-cols-8 gap-1 rounded-lg border border-white/10 bg-[#151517] p-3 shadow-2xl">{EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => setText(value => value + emoji)} className="rounded-md p-1 text-lg hover:bg-white/10" aria-label={`Add ${emoji}`}>{emoji}</button>)}</div>}</form>
  </motion.section>{deleteConfirmDialog}</AnimatePresence>;
}