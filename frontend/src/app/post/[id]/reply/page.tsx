'use client';

import { use, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AtSign, Camera, Image as ImageIcon, Loader2, Smile, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { apiGet, apiPost, apiUpload } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { renderTextWithLinks } from '@/lib/linkify';
import type { VerificationType } from '@/types/verification';

type Post = {
  id: string;
  content?: string;
  mediaUrl?: string | null;
  createdAt?: string;
  author: {
    id: string;
    username: string;
    fullName?: string | null;
    avatar?: string | null;
    verified?: boolean;
    verificationType?: VerificationType | null;
  };
};

type UploadedMedia = { id: string };
type ReplyResult = { comment: { id: string }; commentCount: number };
const MAX_FILES = 4;
const EMOJIS = ['😀', '😂', '😍', '🥹', '👏', '❤️', '🔥', '🙌', '🎉', '💯', '🙏', '✨'];

export default function DirectPostReplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = decodeURIComponent(rawId).trim();
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; file: File }[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiGet<Post>(`/api/feed/${encodeURIComponent(id)}`, token || undefined, { skipCache: true })
      .then(value => { if (active) setPost(value?.id ? value : null); })
      .catch(() => { if (active) setPost(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, token]);

  // Start in the reply field, just like a native compose screen. On Android
  // the software keyboard reduces the available viewport and the toolbar
  // remains at the bottom of this flex column, above the keyboard.
  useEffect(() => {
    if (!post || !token) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [post?.id, token]);

  useEffect(() => {
    const next = files.map(file => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach(preview => URL.revokeObjectURL(preview.url));
  }, [files]);

  const appendFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.currentTarget.files ?? [])
      .filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (incoming.length !== (event.currentTarget.files?.length ?? 0)) {
      toast.error('Unsupported attachment', 'Choose an image or video.');
    }
    setFiles(previous => {
      const next = [...previous];
      for (const file of incoming) {
        if (!next.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) {
          next.push(file);
        }
      }
      if (next.length > MAX_FILES) toast.error('Attachment limit', 'You can add up to four images or videos.');
      return next.slice(0, MAX_FILES);
    });
    event.currentTarget.value = '';
  };

  const insertText = (value: string) => {
    const field = inputRef.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    setText(current => current.slice(0, start) + value + current.slice(end));
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const canSubmit = Boolean(token && (text.trim() || files.length) && !submitting);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!token || submittingRef.current || (!text.trim() && !files.length)) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const mediaFileIds: string[] = [];
      for (const file of files) {
        const data = new FormData();
        data.append('file', file);
        data.append('category', 'comment-media');
        const uploaded = await apiUpload<UploadedMedia>('/api/upload', data, token);
        mediaFileIds.push(uploaded.id);
      }
      await apiPost<ReplyResult>(`/api/feed/${encodeURIComponent(id)}/comments`, {
        content: text.trim(),
        mediaFileIds,
      }, token);
      toast.success('Reply posted');
      // Use the existing post discussion for reading replies, rather than
      // returning to an empty comment-list screen instead of the composer.
      router.replace(`/post/${encodeURIComponent(id)}#comments`);
    } catch (error) {
      toast.error('Reply not posted', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.replace('/home');
  };

  const author = post?.author;
  const avatar = user?.avatar || user?.avatarUrl || (user?.profile as { avatar?: string; avatarUrl?: string } | undefined)?.avatar || (user?.profile as { avatarUrl?: string } | undefined)?.avatarUrl;
  const date = post?.createdAt && !Number.isNaN(new Date(post.createdAt).getTime())
    ? new Date(post.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : '';

  return (
    <main
      data-vanta-post-reply
      className="mx-auto flex h-full min-h-0 w-full max-w-[680px] flex-col overflow-hidden bg-[var(--background)] text-[var(--text-primary)]"
      style={{ height: 'min(100%, var(--vanta-vh, 100dvh))' }}
    >
      <header className="flex h-16 shrink-0 items-center justify-between px-4 sm:px-6">
        <button type="button" onClick={goBack} aria-label="Close reply" className="grid h-11 w-11 place-items-center rounded-full text-[var(--text-primary)] transition hover:bg-white/[0.06]">
          <X size={26} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="min-h-10 min-w-[94px] rounded-full bg-[#c9a227] px-5 text-sm font-semibold text-[#1f2630] transition hover:bg-[#dfbd55] disabled:cursor-not-allowed disabled:bg-[var(--surface)] disabled:text-[var(--text-muted)]"
        >
          {submitting ? <span className="flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" />Posting</span> : 'Reply'}
        </button>
      </header>

      {loading ? (
        <div className="grid min-h-0 flex-1 place-items-center"><Loader2 className="animate-spin text-white/50" aria-label="Loading post" /></div>
      ) : !post || !author ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
          <p className="text-sm text-[var(--text-secondary)]">This post is unavailable.</p>
          <button type="button" onClick={goBack} className="rounded-full border border-[var(--border)] px-5 py-2 text-sm">Go back</button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4 sm:px-6">
          <div className="flex gap-3">
            <div className="flex w-12 shrink-0 flex-col items-center">
              <Link href={`/profile/${encodeURIComponent(author.username)}`} aria-label={`View ${author.username}'s profile`}>
                <Avatar src={author.avatar} alt={author.username} size="lg" verified={author.verified} verificationType={author.verificationType} />
              </Link>
              <div aria-hidden="true" className="my-2 min-h-7 w-[2px] flex-1 rounded-full bg-white/[0.16]" />
            </div>
            <div className="min-w-0 flex-1 pb-5">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                <span className="max-w-full truncate font-semibold">{author.fullName || author.username}</span>
                <span className="truncate text-[var(--text-muted)]">@{author.username}</span>
                {date && <span className="text-[var(--text-muted)]">· {date}</span>}
              </div>
              {post.content && (
                <p className="mt-2 line-clamp-5 whitespace-pre-wrap break-words text-[15px] leading-6 text-[var(--text-primary)]">
                  {renderTextWithLinks(post.content, 'linkify', { mentions: true, hashtags: true })}
                </p>
              )}
              {post.mediaUrl && (
                <div className="mt-3 max-w-[108px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <img src={resolveMediaUrl(post.mediaUrl)} alt="Original post attachment" className="max-h-24 w-full object-cover" />
                </div>
              )}
              <p className="mt-4 text-sm text-[var(--text-muted)]">
                Replying to <span className="font-medium text-[#dfbd55]">@{author.username}</span>
              </p>
            </div>
          </div>

          <form id="vanta-post-reply-form" onSubmit={event => void submit(event)} className="flex min-h-[180px] items-start gap-3">
            <Avatar src={avatar} alt={user?.username || 'You'} size="lg" />
            <div className="min-w-0 flex-1">
              <label htmlFor="vanta-reply-text" className="sr-only">Post your reply</label>
              <textarea
                id="vanta-reply-text"
                ref={inputRef}
                value={text}
                onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={4}
                maxLength={5000}
                disabled={!token || submitting}
                placeholder={token ? 'Post your reply' : 'Sign in to reply'}
                className="min-h-[160px] w-full resize-none border-0 bg-transparent pt-1 text-[19px] leading-7 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:outline-none"
              />
            </div>
          </form>

          {previews.length > 0 && (
            <div className="ml-[60px] flex flex-wrap gap-2 pb-3" aria-label="Selected attachments">
              {previews.map(({ file, url }, index) => (
                <div key={url} className="relative h-24 w-24 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  {file.type.startsWith('video/') ? (
                    <video src={url} muted playsInline className="h-full w-full object-cover" />
                  ) : (
                    <img src={url} alt={file.name} className="h-full w-full object-cover" />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove attachment ${index + 1}`}
                    onClick={() => setFiles(current => current.filter((_, i) => i !== index))}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-[#1f2630]/90 text-white"
                  ><X size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {post && token && (
        <div className="relative shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
          {emojiOpen && (
            <div className="absolute bottom-full left-4 right-4 mb-2 grid grid-cols-6 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl">
              {EMOJIS.map(emoji => (
                <button key={emoji} type="button" aria-label={`Insert ${emoji}`} onClick={() => insertText(emoji)} className="grid h-10 place-items-center rounded-lg text-xl hover:bg-white/[0.06]">{emoji}</button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-[#d6b45a]">
            <button type="button" aria-label="Add photo or video" title="Photo or video" disabled={submitting} onClick={() => photosRef.current?.click()} className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-white/[0.06] disabled:opacity-40"><ImageIcon size={22} /></button>
            <button type="button" aria-label="Take photo" title="Camera" disabled={submitting} onClick={() => cameraRef.current?.click()} className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-white/[0.06] disabled:opacity-40"><Camera size={22} /></button>
            <button type="button" aria-label="Add GIF" title="GIF" disabled={submitting} onClick={() => gifRef.current?.click()} className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-white/[0.06] disabled:opacity-40"><span className="rounded border border-current px-1 py-0.5 text-[10px] font-bold">GIF</span></button>
            <button type="button" aria-label="Add emoji" title="Emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(value => !value)} className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-white/[0.06]"><Smile size={22} /></button>
            <button type="button" aria-label="Mention someone" title="Mention" onClick={() => insertText('@')} className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-white/[0.06]"><AtSign size={22} /></button>
          </div>
          <input ref={photosRef} type="file" multiple accept="image/*,video/*" onChange={appendFiles} className="hidden" aria-label="Choose photo or video" />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={appendFiles} className="hidden" aria-label="Capture photo" />
          <input ref={gifRef} type="file" accept="image/gif" onChange={appendFiles} className="hidden" aria-label="Choose GIF" />
        </div>
      )}
    </main>
  );
}
