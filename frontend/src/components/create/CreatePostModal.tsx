'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Globe2, Camera, Image as ImageIcon, Video, Smile, AlertCircle, Loader2, Type, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from './ContentCreationContext';
import EmojiPicker from './EmojiPicker';
import MediaUploader, { MediaFile, MediaUploaderHandle } from './MediaUploader';
import CharacterCounter from './CharacterCounter';
import DraftManager, { savePostDraft } from './DraftManager';
import { apiPost, invalidateCache } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import QuoteEmbed from '@/components/social/QuoteEmbed';

const MAX_CHARS = 5000;
/** VANTA posts accept up to 10 attachments (matches MediaUploader's default). */
const MAX_POST_MEDIA = 10;

interface CreatePostModalProps {
  open: boolean;
  initialIntent?: 'post' | 'photo' | 'video' | 'story' | 'poll' | 'event';
  onClose: () => void;
}

export default function CreatePostModal({ open, initialIntent = 'post', onClose }: CreatePostModalProps) {
  const { user, token } = useAuth();
  const { closeAll, postPrefill, quoteTarget } = useContentCreation();
  const [content, setContent] = useState('');
  const [intent, setIntent] = useState(initialIntent);
  const quoteUrl = quoteTarget && intent !== 'story' ? quoteTarget.url : '';
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [uploadSession, setUploadSession] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStory = intent === 'story';
  const [storyKind, setStoryKind] = useState<'media' | 'text'>('media');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const uploaderRef = useRef<MediaUploaderHandle>(null);

  const isTextStory = isStory && storyKind === 'text';
  const hasContent = content.trim().length > 0 || media.length > 0 || Boolean(quoteUrl);
  const isOverLimit = content.length > MAX_CHARS;
  const isUploadingMedia = media.some((item) => item.uploading || (!item.uploadedUrl && item.progress < 100 && !item.error));
  const hasFailedMedia = media.some((item) => item.error || !item.uploadedUrl);
  const canSubmit = isTextStory
    ? content.trim().length > 0 && !isOverLimit
    : hasContent && !isOverLimit && !isUploadingMedia && !hasFailedMedia && (!isStory || Boolean(media[0]?.uploadedId));
  const uploadSummary = media.length === 0
    ? null
    : media.every((item) => item.progress === 100 && !item.error)
      ? { label: 'Ready to publish', tone: 'text-emerald-400' }
      : isUploadingMedia
        ? { label: 'Uploading media...', tone: 'text-amber-400' }
        : { label: 'Upload needs attention', tone: 'text-red-400' };
  const intentMeta = {
    post: { title: 'Create Post', placeholder: "What's happening?", submitLabel: 'Post' },
    photo: { title: 'Share a Photo', placeholder: 'What is this photo about?', submitLabel: 'Share Photo' },
    video: { title: 'Share a Video', placeholder: 'Describe your video...', submitLabel: 'Share Video' },
    story: { title: 'Create a Story', placeholder: 'Add a caption...', submitLabel: 'Publish Story' },
    poll: { title: 'Create a Poll', placeholder: 'What question do you want to ask?', submitLabel: 'Publish Poll' },
    event: { title: 'Create an Event', placeholder: 'Describe the event...', submitLabel: 'Publish Event' },
  }[intent];

  // Lock background scroll while the sheet is open
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Reset intent and focus the text area once the sheet has settled.
  // Stories skip this - they open the media picker instead.
  useEffect(() => {
    if (!open) return;
    setIntent(initialIntent);
    if (postPrefill) setContent(current => current || postPrefill);
    if (initialIntent === 'story') return;
    const timer = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(timer);
  }, [open, initialIntent, postPrefill]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        if (showEmojiPicker) setShowEmojiPicker(false);
        else handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showEmojiPicker]);

  // Click outside emoji picker to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showEmojiPicker]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    if (hasContent) {
      const confirmed = window.confirm('Save this post as a draft before closing?');
      if (confirmed) {
        savePostDraft(content, media.map((m) => ({ type: m.type, url: m.url, name: m.name })), visibility);
      }
    }
    setContent('');
    setMedia([]);
    setVisibility('public');
    setShowEmojiPicker(false);
    setShowDrafts(false);
    setDraftNotice('');
    setError(null);
    onClose();
    closeAll();
  }, [content, media, visibility, hasContent, isSubmitting, onClose, closeAll]);

  const restoreDraft = useCallback((draft: { content: string; media: { type: 'image' | 'video'; url: string; name: string }[] }) => {
    if (hasContent && !window.confirm('Replace the current post with this saved draft?')) return;
    setContent(draft.content);
    setMedia([]);
    setUploadSession((session) => session + 1);
    // Drafts do not contain original File bytes: attachments must be reselected.
    setVisibility('public');
    setDraftNotice(draft.media.length ? 'Draft text loaded. This post is public; reattach photos or videos before posting.' : 'Draft loaded. This post will be public.');
    setShowDrafts(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [hasContent]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setContent((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || !canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      if (intent === 'story') {
        if (isTextStory) {
          // Text-only Story — no media/background required.
          const text = content.trim();
          if (!text) {
            setError('Type something to share as a text story.');
            setIsSubmitting(false);
            return;
          }
          await apiPost('/api/stories/text', { text }, token ?? undefined);
        } else {
          const resolvedMedia = media[0];
          if (!resolvedMedia?.file) {
            setError('Stories need at least one photo or video — or choose the Text option.');
            setIsSubmitting(false);
            return;
          }

          await apiPost('/api/stories', {
            mediaFileId: resolvedMedia.uploadedId,
            caption: content.trim() || undefined,
          }, token ?? undefined);
        }
      } else {
        // The Create Post and Upload Reel entry points share the same uploaded
        // media and Reel publishing lifecycle. Video attachments become real
        // published Video rows (visible in Home and Reels), not post-only URLs.
        // Photos/text remain regular Posts. Mixed selections publish a photo
        // post and one Reel for each video; never create a duplicate video Post.
        const attached = media.filter((item) => item.uploadedId || item.uploadedUrl);
        const photos = attached.filter(item => item.type === 'image');
        const videos = attached.filter(item => item.type === 'video');
        const caption = [content.trim(), quoteUrl].filter(Boolean).join('\n\n');

        if (photos.length > 0 || videos.length === 0) {
          const urls = photos.map(item => item.uploadedUrl).filter((url): url is string => Boolean(url));
          const fileIds = photos.map(item => item.uploadedId).filter((id): id is string => Boolean(id));
          await apiPost('/api/feed', {
            content: caption,
            mediaUrl: urls[0],
            mediaFileId: fileIds[0],
            media: { urls, fileIds },
          }, token ?? undefined);
        }

        for (const video of videos) {
          if (!video.uploadedId) throw new Error('Video upload is missing its file ID. Please retry the upload.');
          const draft = await apiPost<{ video: { id: string } }>('/api/reels', {
            title: (content.trim().split('\n')[0] || video.name || 'Reel').slice(0, 120),
            description: caption || undefined,
          }, token ?? undefined);
          if (!draft?.video?.id) throw new Error('Could not create a Reel draft.');
          try {
            await apiPost(`/api/reels/${encodeURIComponent(draft.video.id)}/finalize`, {
              fileId: video.uploadedId,
            }, token ?? undefined);
          } catch (publishError) {
            // Keep a failed draft out of public feeds and available for retry.
            void apiPost(`/api/reels/${encodeURIComponent(draft.video.id)}/fail`, {}, token ?? undefined).catch(() => undefined);
            throw publishError;
          }
        }
      }

      // The server confirmed creation - invalidate cached feed data so the
      // feed refetches fresh content using the existing architecture.
      invalidateCache();
      setContent('');
      setMedia([]);
      setVisibility('public');
      setShowEmojiPicker(false);
      setShowDrafts(false);
      setDraftNotice('');
      onClose();
      closeAll();
    } catch (publishError) {
      setError(publishError instanceof Error && publishError.message
        ? publishError.message
        : "Couldn't publish your post. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [content, media, canSubmit, isSubmitting, onClose, closeAll, token, intent, isTextStory, quoteUrl]);

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Restrained backdrop - Home stays visible behind the sheet */}
          <motion.div
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { if (!showEmojiPicker) handleClose(); }}
          />

          {/* Immersive full-screen editor — no bottom-sheet frame or grab handle. */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
            exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
            className="fixed inset-x-0 top-0 bottom-[var(--vanta-kb,0px)] z-[101] flex min-h-0 w-full flex-col overflow-hidden bg-[#050607] text-white"
            role="dialog"
            aria-modal="true"
            aria-label={isStory ? 'Create a story' : 'Create a post'}
          >
            <header className="relative flex h-[74px] shrink-0 items-center justify-between px-4">
              <button type="button" onClick={handleClose} disabled={isSubmitting}
                className="grid h-12 w-12 place-items-center rounded-full text-white/90 transition hover:bg-white/[0.06] disabled:opacity-40"
                aria-label="Close composer">
                <X size={28} />
              </button>
              {isStory && (
                <h2 className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-base font-semibold text-white">{intentMeta.title}</h2>
              )}
              <div className="ml-auto flex items-center gap-3">
                {!isStory && (
                  <button type="button" onClick={() => setShowDrafts((visible) => !visible)} disabled={isSubmitting}
                    className="min-h-11 px-1 text-sm font-semibold text-[#dfbd55] transition hover:text-[#f2c75c]"
                    aria-expanded={showDrafts} aria-label="Open saved post drafts">Drafts</button>
                )}
                <motion.button type="button" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}
                  whileTap={{ scale: 0.96 }}
                  className={cn('flex min-h-[42px] items-center justify-center gap-1.5 rounded-full px-5 text-sm font-bold transition-colors',
                    canSubmit && !isSubmitting ? 'bg-[#c9a227] text-[#090b0e] hover:bg-[#dfbd55]' : 'cursor-not-allowed bg-[#1f2932] text-white/40')}
                  aria-label={intentMeta.submitLabel}>
                  {isSubmitting ? <><Loader2 size={15} className="animate-spin" />Posting…</> : intentMeta.submitLabel}
                </motion.button>
              </div>
            </header>
            {!isStory && showDrafts && (
              <div className="absolute right-4 top-[70px] z-30 w-[min(92vw,400px)]">
                <DraftManager onClose={() => setShowDrafts(false)} onSelectDraft={restoreDraft} />
              </div>
            )}

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
              <div className="space-y-4 px-5 pb-8 pt-4">
                {/* Authenticated identity - shared Avatar + verification badge */}
                {!isStory && (
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={(user?.avatar ?? user?.avatarUrl) || undefined}
                      alt={user?.username || 'Your avatar'}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-[#f5f5f5]">
                        <span className="truncate">{user?.fullName || user?.username || 'VANTA creator'}</span>
                        <VerificationBadge type={user?.verified && user.verificationType ? user.verificationType : 'NONE'} size="sm" showTooltip />
                      </p>
                      <p className="truncate text-xs text-white/40">@{user?.username || 'you'}</p>
                    </div>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-[#c9a227]/45 px-3 py-1.5 text-xs font-semibold text-[#dfbd55]" aria-label="Posts are visible to everyone">
                      <Globe2 size={13} /> Everyone
                    </span>
                  </div>
                )}

                {/* Post text - borderless, auto-growing, keyboard friendly */}
                {!isStory && (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleTextareaInput}
                    placeholder={intentMeta.placeholder}
                    rows={5}
                    maxLength={MAX_CHARS + 100}
                    className="min-h-[38dvh] w-full resize-none border-0 bg-transparent text-[23px] leading-relaxed text-white placeholder:text-white/40 outline-none focus:outline-none focus:ring-0 focus:shadow-none"
                    aria-label="Post content"
                  />
                )}

                {quoteTarget && !isStory && <QuoteEmbed quote={quoteTarget} />}
                {!isStory && draftNotice && <p role="status" className="text-xs text-[#dfbd55]">{draftNotice}</p>}

                {/* Clean VANTA error state */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3"
                    >
                      <p className="flex items-center gap-2 text-sm font-medium text-red-300">
                        <AlertCircle size={15} className="shrink-0" />
                        Couldn&apos;t publish your post.
                      </p>
                      <p className="mt-1 pl-[26px] text-xs leading-relaxed text-red-300/70">{error}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Story media OR text — real image/video previews from the shared uploader */}
                {isStory && (
                  <div
                    role="tablist"
                    aria-label="Story type"
                    className="flex items-center gap-2 overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-1 scrollbar-hide"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={storyKind === 'media'}
                      onClick={() => { setStoryKind('media'); uploaderRef.current?.openPicker('image'); }}
                      className={cn(
                        'flex min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition',
                        storyKind === 'media' ? 'bg-[#d6a83f]/20 text-[#f2c75c]' : 'text-white/50 hover:text-white'
                      )}
                    >
                      <ImageIcon size={14} />
                      Photo
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={storyKind === 'media'}
                      onClick={() => { setStoryKind('media'); uploaderRef.current?.openPicker('video'); }}
                      className={cn(
                        'flex min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition',
                        storyKind === 'media' && media[0]?.type === 'video' ? 'bg-[#d6a83f]/20 text-[#f2c75c]' : 'text-white/50 hover:text-white'
                      )}
                    >
                      <Video size={14} />
                      Video
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={storyKind === 'text'}
                      onClick={() => { setStoryKind('text'); setMedia([]); }}
                      className={cn(
                        'flex min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition',
                        storyKind === 'text' ? 'bg-[#d6a83f]/20 text-[#f2c75c]' : 'text-white/50 hover:text-white'
                      )}
                    >
                      <Type size={14} />
                      Text
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={storyKind === 'media'}
                      onClick={() => { setStoryKind('media'); uploaderRef.current?.openPicker('image'); }}
                      className={cn(
                        'flex min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition',
                        storyKind === 'media' ? 'text-white/50 hover:text-white' : 'hidden'
                      )}
                      title="Attach a file"
                    >
                      <Paperclip size={14} />
                    </button>
                  </div>
                )}

                {isStory && storyKind === 'text' ? (
                  <div className="mx-auto flex min-h-[360px] w-full max-w-[520px] flex-col justify-center rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#1a1a1c] to-[#0e0e10] px-5">
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={handleTextareaInput}
                      autoFocus
                      placeholder="Type your story…"
                      maxLength={MAX_CHARS}
                      className="min-h-[280px] w-full resize-none border-0 bg-transparent text-center text-2xl font-semibold leading-relaxed text-[#f5f5f5] outline-none placeholder:font-normal placeholder:text-white/25 focus:outline-none"
                      aria-label="Text story content"
                    />
                    <div className="mx-auto mt-2 flex items-center gap-3">
                      {uploadSummary && <p className={cn('text-xs font-medium', uploadSummary.tone)}>{uploadSummary.label}</p>}
                      <CharacterCounter current={content.length} max={MAX_CHARS} />
                    </div>

                  </div>
                ) : (
                  <>
                    <MediaUploader
                      key={uploadSession}
                      ref={uploaderRef}
                      onMediaChange={setMedia}
                      maxFiles={isStory ? 1 : MAX_POST_MEDIA}
                      storyMode={isStory}
                      openPickerOnMount={isStory && storyKind === 'media'}
                      hideDropZone
                    />

                    {isStory && media.length > 0 && (
                      <div className="mx-auto w-full max-w-[520px]">
                        <label className="block text-xs font-medium text-white/60" htmlFor="story-caption">Add caption</label>
                        <textarea
                          id="story-caption"
                          ref={textareaRef}
                          value={content}
                          onChange={handleTextareaInput}
                          placeholder="Add caption"
                          rows={2}
                          maxLength={MAX_CHARS}
                          className="mt-2 w-full resize-none border-0 bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:outline-none focus:ring-0 focus:shadow-none"
                        />
                      </div>
                    )}
                  </>
                )}

                {uploadSummary && (
                  <div className="flex items-center justify-between gap-3">
                    <p className={cn('text-xs font-medium', uploadSummary.tone)}>{uploadSummary.label}</p>
                    {!isStory && media.length > 1 && (
                      <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/45">
                        {media.length}/{MAX_POST_MEDIA} selected
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Emoji panel - sits directly above the toolbar */}
            <AnimatePresence>
              {showEmojiPicker && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="shrink-0 overflow-hidden border-t border-white/[0.06]"
                >
                  <div ref={emojiPickerRef} className="scrollbar-hide max-h-[240px] overflow-y-auto overscroll-contain p-3">
                    <EmojiPicker onEmojiSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!isStory && (
              <div className="flex min-h-[46px] shrink-0 items-center gap-2 border-t border-white/[0.08] px-5 text-xs text-[#dfbd55]">
                <Globe2 size={16} /> Everyone can reply
              </div>
            )}
            {/* Creation toolbar — all visible controls use the existing uploader. */}
            <footer className="shrink-0 border-t border-white/[0.08] bg-[#0b1116] px-3 pt-1.5 pb-[max(8px,env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between">
                <div className="-ml-1.5 flex items-center">
                  <button
                    type="button"
                    onClick={() => { if (isStory) setStoryKind('media'); uploaderRef.current?.openPicker('image'); }}
                    disabled={media.length >= (isStory ? 1 : MAX_POST_MEDIA)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#dfbd55] transition hover:bg-white/[0.06] hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Add photo"
                    title="Photo"
                  >
                    <ImageIcon size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (isStory) setStoryKind('media'); uploaderRef.current?.openCamera(); }}
                    disabled={media.length >= (isStory ? 1 : MAX_POST_MEDIA)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#dfbd55] transition hover:bg-white/[0.06] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Open camera"
                    title="Camera"
                  >
                    <Camera size={21} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (isStory) setStoryKind('media'); uploaderRef.current?.openPicker('video'); }}
                    disabled={media.length >= (isStory ? 1 : MAX_POST_MEDIA)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Add video"
                    title="Video"
                  >
                    <Video size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/[0.06] hover:text-white active:scale-95',
                      showEmojiPicker ? 'bg-[#d6a83f]/15 text-[#d6a83f]' : 'text-[#c8c8cc]'
                    )}
                    aria-label="Add emoji"
                    title="Emoji"
                  >
                    <Smile size={20} />
                  </button>
                </div>

                {!isStory && <CharacterCounter current={content.length} max={MAX_CHARS} />}
              </div>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
