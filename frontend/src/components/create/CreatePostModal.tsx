'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Image as ImageIcon, Video, Smile, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from './ContentCreationContext';
import EmojiPicker from './EmojiPicker';
import MediaUploader, { MediaFile, MediaUploaderHandle } from './MediaUploader';
import CharacterCounter from './CharacterCounter';
import { savePostDraft } from './DraftManager';
import { apiPost, invalidateCache } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';

const MAX_CHARS = 5000;

interface CreatePostModalProps {
  open: boolean;
  initialIntent?: 'post' | 'photo' | 'video' | 'story' | 'poll' | 'event';
  onClose: () => void;
}

export default function CreatePostModal({ open, initialIntent = 'post', onClose }: CreatePostModalProps) {
  const { user, token } = useAuth();
  const { closeAll } = useContentCreation();
  const [content, setContent] = useState('');
  const [intent, setIntent] = useState(initialIntent);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStory = intent === 'story';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const uploaderRef = useRef<MediaUploaderHandle>(null);

  const hasContent = content.trim().length > 0 || media.length > 0;
  const isOverLimit = content.length > MAX_CHARS;
  const isUploadingMedia = media.some((item) => item.uploading || (!item.uploadedUrl && item.progress < 100 && !item.error));
  const hasFailedMedia = media.some((item) => item.error || !item.uploadedUrl);
  const canSubmit = hasContent && !isOverLimit && !isUploadingMedia && !hasFailedMedia;
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
    if (initialIntent === 'story') return;
    const timer = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(timer);
  }, [open, initialIntent]);

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
    setError(null);
    onClose();
    closeAll();
  }, [content, media, visibility, hasContent, isSubmitting, onClose, closeAll]);

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
        const resolvedMedia = media[0];
        if (!resolvedMedia?.file) {
          setError('Stories need at least one photo or video.');
          setIsSubmitting(false);
          return;
        }

        await apiPost('/api/stories', {
          mediaFileId: resolvedMedia.uploadedId,
          caption: content.trim() || undefined,
        }, token ?? undefined);
      } else {
        await apiPost('/api/feed', {
          content: content.trim(),
          mediaUrl: media[0]?.uploadedUrl,
          mediaFileId: media[0]?.uploadedId,
        }, token ?? undefined);
      }

      // The server confirmed creation - invalidate cached feed data so the
      // feed refetches fresh content using the existing architecture.
      invalidateCache();
      setContent('');
      setMedia([]);
      setVisibility('public');
      setShowEmojiPicker(false);
      onClose();
      closeAll();
    } catch {
      setError("Couldn't publish your post. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [content, media, canSubmit, isSubmitting, onClose, closeAll, token, intent]);

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

          {/* Mobile composer sheet - slides up from the bottom edge like Create+ */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { type: 'spring', damping: 30, stiffness: 320 } }}
            exit={{ y: '100%', transition: { duration: 0.2, ease: 'easeIn' } }}
            className={cn(
              'fixed inset-x-0 bottom-0 z-[101] mx-auto flex w-full max-w-[480px] flex-col overflow-hidden border-x border-t border-white/[0.08] bg-[#0d0d0f]/95 shadow-[0_-12px_48px_rgba(0,0,0,0.6)] backdrop-blur-2xl',
              isStory
                ? 'top-[env(safe-area-inset-top)] rounded-none border-0 bg-[#050505]'
                : 'h-[92dvh] rounded-t-[28px]'
            )}
            role="dialog"
            aria-modal="true"
            aria-label={isStory ? 'Create a story' : 'Create a post'}
          >
            {/* Grab handle */}
            {!isStory && (
              <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15" />
            )}

            {/* Header: back / title / Post */}
            <header className={cn('relative flex shrink-0 items-center justify-between py-1.5 pl-1 pr-3', isStory ? 'border-b-0' : 'border-b border-white/[0.06]')}>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white active:scale-95 disabled:opacity-40"
                aria-label="Close composer"
              >
                <ArrowLeft size={22} />
              </button>

              <h2 className="pointer-events-none absolute left-1/2 top-1/2 max-w-[45%] -translate-x-1/2 -translate-y-1/2 truncate text-center text-[15px] font-semibold tracking-tight text-[#f5f5f5]">
                {intentMeta.title}
              </h2>

              <motion.button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                whileTap={{ scale: 0.96 }}
                className={cn(
                  'flex min-h-[36px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-all duration-200',
                  canSubmit
                    ? 'bg-gradient-to-r from-[#f2c75c] to-[#d6a83f] text-black shadow-[0_4px_20px_rgba(214,168,63,0.28)]'
                    : 'cursor-not-allowed bg-white/[0.06] text-white/30'
                )}
                aria-label={intentMeta.submitLabel}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Posting...
                  </>
                ) : (
                  intentMeta.submitLabel
                )}
              </motion.button>
            </header>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
              <div className="space-y-4 px-5 pb-6 pt-4">
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
                        <VerificationBadge type={user?.verified ? 'BLUE' : 'NONE'} size="sm" showTooltip />
                      </p>
                      <p className="truncate text-xs text-[#666]">@{user?.username || 'you'}</p>
                    </div>
                  </div>
                )}

                {/* Post text - borderless, auto-growing, keyboard friendly */}
                {!isStory && (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleTextareaInput}
                    placeholder={intentMeta.placeholder}
                    rows={4}
                    maxLength={MAX_CHARS + 100}
                    className="min-h-[110px] w-full resize-none border-0 bg-transparent text-lg leading-relaxed text-[#f5f5f5] placeholder:text-[#666] outline-none focus:outline-none focus:ring-0 focus:shadow-none"
                    aria-label="Post content"
                  />
                )}

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

                {/* Media - real image/video previews from the shared uploader */}
                <MediaUploader
                  ref={uploaderRef}
                  onMediaChange={setMedia}
                  maxFiles={1}
                  storyMode={isStory}
                  openPickerOnMount={isStory}
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

                {uploadSummary && (
                  <p className={cn('text-xs font-medium', uploadSummary.tone)}>{uploadSummary.label}</p>
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

            {/* Creation toolbar - real actions only */}
            <footer className="shrink-0 border-t border-white/[0.06] bg-[#151517]/80 px-3 pt-1.5 pb-[max(8px,env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between">
                <div className="-ml-1.5 flex items-center">
                  <button
                    type="button"
                    onClick={() => uploaderRef.current?.openPicker('image')}
                    disabled={media.length >= 1}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Add photo"
                    title="Photo"
                  >
                    <ImageIcon size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => uploaderRef.current?.openPicker('video')}
                    disabled={media.length >= 1}
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
