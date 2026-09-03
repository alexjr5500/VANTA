'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, Check, ChevronDown, ChevronUp, Copy, Edit3, Flag, Heart, Loader2, MoreHorizontal, Reply, Send, Smile, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/apiClient';
import { createSocket } from '@/lib/socketClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';

type User = { id: string; username: string; fullName?: string | null; avatar?: string | null; verified?: boolean; role?: string };
export type CommentItem = { id: string; userId: string; content: string; createdAt: string; updatedAt?: string; edited?: boolean; liked?: boolean; parentId?: string | null; user: User; _count?: { likes: number; replies: number }; replies?: CommentItem[] };
type Props = { postId: string; postAuthor?: User; initialCount: number; token: string; currentUser?: User | null; onClose: () => void; onCountChange: (count: number) => void };

const EMOJIS = ['😀', '😂', '😍', '🥳', '😎', '🙌', '👏', '🔥', '❤️', '💜', '✨', '🎉', '🌹', '💯', '🙏', '😅', '🤔', '😭', '🤣', '🚀', '👑', '💎', '🫶', '😮'];
const timeAgo = (value: string) => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; };

export default function CommentPanel({ postId, postAuthor, initialCount, token, currentUser, onClose, onCountChange }: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<'newest' | 'top'>('newest');
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [editing, setEditing] = useState<CommentItem | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyCursors, setReplyCursors] = useState<Record<string, string | undefined>>({});
  const [replyLoading, setReplyLoading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const query = new URLSearchParams({ limit: '20', sort });
      if (!reset && cursor) query.set('cursor', cursor);
      if (search.trim()) query.set('search', search.trim());
      const result = await apiGet<{ items: CommentItem[]; nextCursor?: string }>(`/api/feed/${postId}/comments?${query}`, token, { skipCache: true });
      setComments(previous => reset ? result.items : [...previous, ...result.items.filter(item => !previous.some(existing => existing.id === item.id))]);
      setCursor(result.nextCursor);
    } catch (error: any) { toast.error('Comments unavailable', error.message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [cursor, postId, search, sort, token, toast]);

  useEffect(() => { void load(true); inputRef.current?.focus(); }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setExpanded(previous => ({ ...previous, [comment.id]: true })); setReplyLoading(comment.id);
    try {
      const query = new URLSearchParams({ limit: '20' }); const next = replyCursors[comment.id];
      if (!reset && next) query.set('cursor', next);
      const result = await apiGet<{ items: CommentItem[]; nextCursor?: string }>(`/api/feed/${postId}/comments/${comment.id}/replies?${query}`, token, { skipCache: true });
      setComments(previous => previous.map(item => item.id === comment.id ? { ...item, replies: reset ? result.items : [...(item.replies || []), ...result.items] } : item));
      setReplyCursors(previous => ({ ...previous, [comment.id]: result.nextCursor }));
    } catch (error: any) { toast.error('Replies unavailable', error.message); } finally { setReplyLoading(null); }
  };

  const toggleLike = async (comment: CommentItem) => {
    const update = (items: CommentItem[]): CommentItem[] => items.map(item => item.id === comment.id ? { ...item, liked: !item.liked, _count: { likes: Math.max(0, (item._count?.likes || 0) + (item.liked ? -1 : 1)), replies: item._count?.replies || 0 }, replies: item.replies && update(item.replies) } : { ...item, replies: item.replies && update(item.replies) });
    setComments(update); setMenu(null);
    try { await apiPost(`/api/feed/${postId}/comments/${comment.id}/like`, {}, token); } catch (error: any) { setComments(update); toast.error('Like not saved', error.message); }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault(); const clean = text.trim(); if (!clean || submitting) return; setSubmitting(true);
    try {
      if (editing) { const updated = await apiPut<CommentItem>(`/api/feed/${postId}/comments/${editing.id}`, { content: clean }, token); setComments(items => items.map(item => item.id === updated.id ? { ...item, ...updated } : item)); setEditing(null); }
      else { const result = await apiPost<{ comment: CommentItem; commentCount: number }>(`/api/feed/${postId}/comments`, { content: clean, parentId: replyTo?.id }, token); if (replyTo) setComments(items => items.map(item => item.id === replyTo.id ? { ...item, replies: [...(item.replies || []), result.comment], _count: { likes: item._count?.likes || 0, replies: (item._count?.replies || 0) + 1 } } : item)); else setComments(items => [result.comment, ...items]); onCountChange(result.commentCount); setReplyTo(null); }
      setText(''); setEmojiOpen(false);
    } catch (error: any) { toast.error('Comment not saved', error.message); }
    finally { setSubmitting(false); }
  };

  const remove = async (comment: CommentItem) => { if (!window.confirm('Delete this comment?')) return; try { const result = await apiDelete<{ commentCount: number }>(`/api/feed/${postId}/comments/${comment.id}`, token); const removeItem = (items: CommentItem[]): CommentItem[] => items.filter(item => item.id !== comment.id).map(item => ({ ...item, replies: item.replies && removeItem(item.replies) })); setComments(removeItem); onCountChange(result.commentCount); } catch (error: any) { toast.error('Comment not deleted', error.message); } setMenu(null); };
  const report = async (comment: CommentItem) => { const reason = window.prompt('Report reason: SPAM, HARASSMENT, HATE, THREATS, MISINFORMATION, or OTHER'); if (!reason) return; try { await apiPost(`/api/feed/${postId}/comments/${comment.id}/report`, { reason }, token); toast.success('Report submitted'); } catch (error: any) { toast.error('Report failed', error.message); } setMenu(null); };

  const CommentRow = ({ comment, depth = 0 }: { comment: CommentItem; depth?: number }) => <article className="group border-b border-white/[.06] py-4" style={{ marginLeft: Math.min(depth, 4) * 18 }}><div className="flex gap-3"><Avatar src={comment.user.avatar} alt={comment.user.username} size="sm" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-xs"><strong className="text-white">{comment.user.fullName || comment.user.username}</strong>{comment.user.verified && <VerificationBadge verified size="xs" className="align-[-1px]" />}{comment.user.role === 'CREATOR' && <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[9px] text-fuchsia-200">CREATOR</span>}<span className="text-white/35">@{comment.user.username} · {timeAgo(comment.createdAt)}</span>{comment.edited && <span className="text-white/30">· edited</span>}</div><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-white/80">{comment.content}</p><div className="mt-2 flex items-center gap-4 text-[11px] text-white/45"><button onClick={() => toggleLike(comment)} className={comment.liked ? 'text-[#f2c75c]' : 'hover:text-white'}><Heart size={13} className="mr-1 inline" fill={comment.liked ? 'currentColor' : 'none'} />Like {comment._count?.likes || 0}</button><button onClick={() => { setReplyTo(comment); inputRef.current?.focus(); }} className="hover:text-white"><Reply size={13} className="mr-1 inline" />Reply</button><button onClick={() => setMenu(menu === comment.id ? null : comment.id)} aria-label="More comment actions"><MoreHorizontal size={15} /></button></div>{menu === comment.id && <div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[.04] p-2 text-[11px] text-white/70"><button onClick={() => { navigator.clipboard.writeText(comment.content); setMenu(null); toast.success('Comment copied'); }}><Copy size={12} className="mr-1 inline" />Copy</button>{comment.userId === currentUser?.id && <><button onClick={() => { setEditing(comment); setText(comment.content); setMenu(null); inputRef.current?.focus(); }}><Edit3 size={12} className="mr-1 inline" />Edit</button><button onClick={() => void remove(comment)} className="text-rose-300"><Trash2 size={12} className="mr-1 inline" />Delete</button></>}<button onClick={() => void report(comment)} className="text-amber-200"><Flag size={12} className="mr-1 inline" />Report</button></div>}{(comment._count?.replies || 0) > 0 && <div className="mt-3">{!expanded[comment.id] ? <button onClick={() => void loadReplies(comment)} className="text-xs font-semibold text-[#c8c8cc]">View {comment._count?.replies} {comment._count?.replies === 1 ? 'reply' : 'replies'} <ChevronDown size={13} className="inline" /></button> : <><button onClick={() => setExpanded(items => ({ ...items, [comment.id]: false }))} className="text-xs font-semibold text-[#c8c8cc]">Hide replies <ChevronUp size={13} className="inline" /></button>{replyLoading === comment.id ? <Loader2 size={14} className="ml-2 inline animate-spin" /> : comment.replies?.map(reply => <CommentRow key={reply.id} comment={reply} depth={depth + 1} />)}{replyCursors[comment.id] && <button onClick={() => void loadReplies(comment, false)} className="mt-2 text-xs text-white/50">Load more replies</button>}</>}</div>}</div></div></article>;

  return <AnimatePresence><motion.div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} /><motion.section role="dialog" aria-modal="true" aria-labelledby="comments-title" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: .2 }} className="fixed inset-x-0 bottom-0 z-[80] flex h-[100dvh] w-full flex-col border-t border-white/10 bg-[#0d0d0f] shadow-2xl sm:left-1/2 sm:h-[88dvh] sm:max-w-[700px] sm:-translate-x-1/2 sm:rounded-t-lg">
    <header className="flex shrink-0 items-center justify-between border-b border-white/[.08] px-4 py-4 sm:px-5"><div><h2 id="comments-title" className="text-base font-semibold text-[#f5f5f5]">Comments <span className="text-white/45">({initialCount})</span></h2><p className="mt-1 text-[11px] text-[#858585]">Join the conversation around this post</p></div><button onClick={onClose} aria-label="Close comments" className="grid h-9 w-9 place-items-center rounded-lg text-[#b8b8b8] hover:bg-white/[.06] hover:text-white"><X size={18} /></button></header>
    <div className="flex shrink-0 items-center gap-2 border-b border-white/[.06] px-4 py-3 sm:px-5"><button onClick={() => setSort('newest')} className={`rounded-md px-3 py-1.5 text-xs ${sort === 'newest' ? 'bg-white/[.08] text-[#f2c75c]' : 'text-[#858585]'}`}>Newest</button><button onClick={() => setSort('top')} className={`rounded-md px-3 py-1.5 text-xs ${sort === 'top' ? 'bg-white/[.08] text-[#f2c75c]' : 'text-[#858585]'}`}>Top</button><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && void load(true)} placeholder="Search comments" aria-label="Search comments" className="ml-auto min-w-0 w-36 rounded-md border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white outline-none focus:border-[#c9a227]/60" /></div>
    <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 sm:px-5" onScroll={e => { const target = e.currentTarget; if (target.scrollHeight - target.scrollTop - target.clientHeight < 160 && cursor && !loadingMore) void load(false); }}>{loading ? <div className="space-y-4 py-6">{[1, 2, 3].map(item => <div key={item} className="flex animate-pulse gap-3"><div className="h-9 w-9 rounded-full bg-white/10" /><div className="h-14 flex-1 rounded-lg bg-white/[.05]" /></div>)}</div> : comments.length ? comments.map(comment => <CommentRow key={comment.id} comment={comment} />) : <p className="py-20 text-center text-sm text-white/40">Be the first to comment.</p>}{loadingMore && <Loader2 className="mx-auto my-4 animate-spin text-white/50" />}</div>
    <form onSubmit={submit} className="relative shrink-0 border-t border-white/[.08] bg-[#0d0d0f] px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-5"><div className="mb-2 flex items-center gap-2 text-[11px] text-white/50">{replyTo && <><span>Replying to @{replyTo.user.username}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={12} /></button></>}{editing && <><span>Editing comment</span><button type="button" onClick={() => { setEditing(null); setText(''); }} aria-label="Cancel edit"><X size={12} /></button></>}</div><div className="flex items-center gap-2"><Avatar src={currentUser?.avatar} alt={currentUser?.username || 'Your avatar'} size="xs" /><input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Write a comment..." aria-label="Write a comment" maxLength={2000} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-[#c9a227]/60" /><button type="button" onClick={() => setEmojiOpen(value => !value)} aria-label="Add emoji" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#858585] hover:bg-white/[.06] hover:text-white"><Smile size={17} /></button><button type="button" onClick={() => setText(value => `${value}${value ? ' ' : ''}@`)} aria-label="Mention a user" className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-[#858585] hover:bg-white/[.06] hover:text-white sm:grid"><AtSign size={17} /></button><button type="submit" aria-label="Send comment" disabled={!text.trim() || submitting} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#c9a227]/60 bg-[#c9a227] text-black transition hover:bg-[#f2c75c] disabled:opacity-30">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button></div>{emojiOpen && <div className="absolute bottom-16 right-4 grid w-64 max-w-[calc(100vw-2rem)] grid-cols-8 gap-1 rounded-lg border border-white/10 bg-[#151517] p-3 shadow-2xl">{EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => setText(value => value + emoji)} className="rounded-md p-1 text-lg hover:bg-white/10" aria-label={`Add ${emoji}`}>{emoji}</button>)}</div>}</form>
  </motion.section></AnimatePresence>;
}