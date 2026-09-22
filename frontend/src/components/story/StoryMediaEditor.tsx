'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { createStoryDraft } from '@/lib/storyApi';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';
import { startUpload } from '@/lib/uploads/store';
import VideoTrimModal from '@/components/video/VideoTrimModal';
import type { VideoTrimResult } from '@/components/video/VideoTrimEditor';
import { normalizeStatusEditorValue, statusCounts, STATUS_MAX_CHARS } from '@/lib/statusLimits';

export type MediaStorySource = 'camera-photo' | 'camera-video' | 'gallery-image' | 'gallery-video';

export interface StoryMediaEditorProps {
  source: MediaStorySource;
  onBack?: () => void;
  onClose: () => void;
}

interface DraftMedia {
  file: File;
  objectUrl: string;
  kind: 'image' | 'video';
}

const ACCEPTED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const ACCEPTED_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;

/**
 * Photo / Video Story flow — camera capture or gallery/file picker, live
 * preview, caption + publish through the existing upload pipeline.
 */
export default function StoryMediaEditor({ source, onBack, onClose }: StoryMediaEditorProps) {
  const { token } = useAuth();
  const toast = useToast();

  const [draft, setDraft] = useState<DraftMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [trimFile, setTrimFile] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraEnvRef = useRef<HTMLInputElement | null>(null);
  const cameraFrontRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLInputElement | null>(null);

  const objectUrlRef = useRef<string | null>(null);

  const counts = useMemo(() => statusCounts(caption), [caption]);
  // The composer never blocks on an upload: once a file is selected it is ready
  // to publish, and the transfer itself runs in the background afterwards.
  const isReady = Boolean(draft && !publishing);

  // Clean up object URLs on unmount.
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const openPickerFor = useCallback((kind: 'image' | 'video', capture?: boolean) => {
    if (kind === 'image') {
      if (capture === true && cameraEnvRef.current) cameraEnvRef.current.click();
      else if (capture === false && cameraFrontRef.current) cameraFrontRef.current.click();
      else if (galleryInputRef.current) galleryInputRef.current.click();
    } else {
      if (capture && cameraVideoRef.current) cameraVideoRef.current.click();
      else if (videoInputRef.current) videoInputRef.current.click();
    }
  }, []);

  const handleFile = useCallback((file: File | undefined | null) => {
    setMediaError('');
    if (!file) return;
    const isImage = ACCEPTED_IMAGE.includes(file.type);
    const isVideo = ACCEPTED_VIDEO.includes(file.type);
    if (!isImage && !isVideo) {
      setMediaError('Unsupported file. Choose a photo or a short video (MP4/WebM).');
      return;
    }
    if (isImage && file.size > MAX_IMAGE) {
      setMediaError('Image exceeds the 15MB limit.');
      return;
    }
    if (isVideo && file.size > MAX_VIDEO) {
      setMediaError('Video exceeds the 100MB limit.');
      return;
    }
    setDraft(previous => {
      if (previous) URL.revokeObjectURL(previous.objectUrl);
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      return { file, objectUrl, kind: isImage ? 'image' : 'video' };
    });
    setCaption('');
    setError('');
  }, []);

  // Apply the shared trimmer result: the trimmed file replaces the draft file so
  // ONLY the selected range is uploaded (the real WebM re-encode from the engine).
  const handleTrimConfirm = useCallback((result: VideoTrimResult) => {
    setTrimFile(null);
    if (!result.file) return;
    setDraft(previous => {
      if (previous) URL.revokeObjectURL(previous.objectUrl);
      const objectUrl = URL.createObjectURL(result.file);
      objectUrlRef.current = objectUrl;
      return { file: result.file, objectUrl, kind: 'video' };
    });
    setError('');
  }, []);

  const publish = useCallback(async () => {
    if (!token || !draft || publishing) return;
    setPublishing(true);
    setError('');
    try {
      const normalizedCaption = normalizeStatusEditorValue(caption).trim() || undefined;

      // 1. Create an instant Story draft (UPLOADING) — no media yet.
      const story = await createStoryDraft(token, normalizedCaption);

      // 2. Hand the media to the background upload manager. The composer closes
      //    immediately; the resumable chunk transfer runs (real byte progress,
      //    global indicator) while the user navigates anywhere in VANTA. The
      //    Story flips to PUBLISHED only when the media reaches storage.
      startUpload({
        kind: 'story',
        file: draft.file,
        draftId: story.id,
        token,
        meta: {
          caption: normalizedCaption,
          mimeType:
            draft.file.type ||
            (draft.kind === 'video'
              ? draft.file.name.toLowerCase().endsWith('.mp4')
                ? 'video/mp4'
                : 'video/webm'
              : 'image/jpeg'),
        },
      });
      notifyStoryFeedChanged();
      toast.success(`${draft.kind === 'video' ? 'Video' : 'Photo'} story is publishing in the background`);
      onClose();
    } catch (reason: any) {
      setError(reason?.message || 'Your story could not be published. Please try again.');
      setPublishing(false);
    }
  }, [publishing, draft, caption, token, onClose, toast]);

  const discard = useCallback(() => {
    if (draft) URL.revokeObjectURL(draft.objectUrl);
    objectUrlRef.current = null;
    setDraft(null);
    setCaption('');
    setTrimFile(null);
    setError('');
    setMediaError('');
  }, [draft]);

  const sourceLabel = source.startsWith('camera')
    ? source === 'camera-photo' ? 'Camera photo' : 'Video camera'
    : source === 'gallery-image' ? 'Photo' : 'Video';

  // Auto-open the initial source (this whole screen was opened by a user tap).
  const initialOpenedRef = useRef(false);
  useEffect(() => {
    if (initialOpenedRef.current) return;
    initialOpenedRef.current = true;
    const frame = requestAnimationFrame(() => {
      if (source === 'camera-photo') openPickerFor('image', true);
      else if (source === 'camera-video') openPickerFor('video', true);
      else openPickerFor(source === 'gallery-image' ? 'image' : 'video');
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col bg-[#050506]">
      {/* Hidden inputs */}
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={event => { handleFile(event.target.files?.[0]); event.target.value = ''; }} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={event => { handleFile(event.target.files?.[0]); event.target.value = ''; }} />
      <input ref={cameraEnvRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={event => { handleFile(event.target.files?.[0]); event.target.value = ''; }} />
      <input ref={cameraFrontRef} type="file" accept="image/*" capture="user" className="hidden" tabIndex={-1} aria-hidden="true" onChange={event => { handleFile(event.target.files?.[0]); event.target.value = ''; }} />
      <input ref={cameraVideoRef} type="file" accept="video/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={event => { handleFile(event.target.files?.[0]); event.target.value = ''; }} />

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-3 pt-[max(env(safe-area-inset-top,0px),6px)]">
        <button
          type="button"
          onClick={() => (draft ? discard() : onBack ? onBack() : onClose())}
          aria-label={draft ? 'Remove media' : 'Back to creation menu'}
          className={cn(
            'grid h-10 w-10 place-items-center rounded-full transition hover:bg-white/[0.06]',
            draft ? 'text-[#e5484d]' : 'text-[#8a8a8a] hover:text-white'
          )}
        >
          {draft ? <Trash2 size={18} /> : <ArrowLeft size={18} />}
        </button>
        <h2 className="text-sm font-semibold">{sourceLabel} Story</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close creation"
          className="grid h-10 w-10 place-items-center rounded-full text-[#8a8a8a] transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={18} />
        </button>
      </header>

      {/* Canvas / picker */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-2">
        <div
          className="relative flex w-full max-w-[380px] items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-black"
          style={{ aspectRatio: '9 / 16', maxHeight: '100%' }}
        >
          {draft ? (
            <>
              {draft.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.objectUrl} alt="Story preview" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <video src={draft.objectUrl} playsInline muted loop className="absolute inset-0 h-full w-full object-cover" />
              )}

              {caption.trim() && (
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-4 pb-4 pt-10">
                  <p className="whitespace-pre-wrap break-words text-left text-[15px] font-medium leading-snug text-white">
                    {caption}
                  </p>
                </div>
              )}
            </>
          ) : (
            <EmptyPicker
              source={source}
              onPick={kind => openPickerFor(kind)}
              onCamera={() => openPickerFor(source === 'gallery-video' || source === 'camera-video' ? 'video' : 'image', true)}
            />
          )}
        </div>
      </div>

      {mediaError && <p role="alert" className="shrink-0 px-5 pb-1 text-center text-xs text-[#ff9b9b]">{mediaError}</p>}
      {error && <p role="alert" className="shrink-0 px-5 pb-1 text-center text-xs text-[#ff9b9b]">{error}</p>}

      {/* Media toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-2">
        <MediaAction label="Photo" icon={ImageIcon} onClick={() => openPickerFor('image')} />
        <MediaAction label="Video" icon={Video} onClick={() => openPickerFor('video')} />
        <MediaAction label="Rear cam" icon={Camera} onClick={() => openPickerFor('image', true)} />
        <MediaAction label="Front cam" icon={Camera} onClick={() => openPickerFor('image', false)} />
        {draft && (
          <MediaAction label="Retake" icon={RefreshCw} onClick={() => openPickerFor(draft.kind === 'image' ? 'image' : 'video', true)} />
        )}
        {draft && draft.kind === 'video' && (
          <MediaAction label="Trim" icon={Video} onClick={() => setTrimFile(draft.file)} />
        )}
      </div>

      {/* Caption field */}
      <div className="shrink-0 px-4 pb-2">
        <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <textarea
            value={caption}
            onChange={event => setCaption(normalizeStatusEditorValue(event.target.value))}
            onPaste={event => {
              event.preventDefault();
              const pasted = event.clipboardData?.getData('text/plain') || '';
              setCaption(previous => normalizeStatusEditorValue(previous + pasted));
            }}
            placeholder="Add a caption to your story…"
            aria-label="Story caption"
            rows={1}
            className="max-h-24 min-h-[38px] flex-1 resize-none bg-transparent text-[15px] leading-tight text-white outline-none placeholder:text-white/30"
          />
          <span className={cn('shrink-0 text-[11px] tabular-nums', counts.overChars ? 'text-[#e5484d]' : 'text-white/35')}>
            {counts.chars}/{STATUS_MAX_CHARS}
          </span>
        </div>
      </div>

      {/* Publish bar */}
      <footer
        className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0e]/95 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--vanta-kb, 0px) + 16px)' }}
      >
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!isReady}
          aria-label="Publish story"
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a227] text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.99] disabled:opacity-30"
        >
          {publishing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {publishing ? 'Publishing…' : 'Publish Story'}
        </button>
      </footer>

      {/* Shared video trimmer — lets the user cut the Story video to the range
          they want before it is uploaded in the background. */}
      <VideoTrimModal
        open={Boolean(trimFile)}
        file={trimFile}
        onClose={() => setTrimFile(null)}
        onConfirm={handleTrimConfirm}
        title="Trim Story Video"
        subtitle="Preview and trim the timeline before publishing"
        confirmLabel="Use this video"
        trimActionLabel="Trim & Preview"
      />
    </div>
  );
}

function MediaAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] font-medium text-[#c8c8cc] transition hover:bg-white/[0.07] hover:text-white active:scale-95"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function EmptyPicker({
  source,
  onPick,
  onCamera,
}: {
  source: MediaStorySource;
  onPick: (kind: 'image' | 'video') => void;
  onCamera: () => void;
}) {
  const isVideo = source === 'gallery-video' || source === 'camera-video';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-4 px-6 text-center"
    >
      <span className="grid h-16 w-16 place-items-center rounded-full border border-white/[0.1] bg-white/[0.03] text-[#c9a227]">
        {source === 'camera-photo' || source === 'camera-video' ? <Camera size={26} /> : isVideo ? <Video size={26} /> : <ImageIcon size={26} />}
      </span>
      <div>
        <h3 className="text-base font-semibold">Add your {isVideo ? 'video' : 'photo'}</h3>
        <p className="mt-1 text-[13px] leading-5 text-white/45">Tap to open your camera or choose from your gallery.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPick(isVideo ? 'video' : 'image')}
          className="flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/85"
        >
          <ImageIcon size={16} />
          Gallery
        </button>
        <button
          type="button"
          onClick={onCamera}
          className="flex h-11 items-center gap-2 rounded-full bg-[#c9a227] px-4 text-sm font-bold text-black transition hover:bg-[#dfbd55]"
        >
          <Camera size={16} />
          Camera
        </button>
      </div>
    </motion.div>
  );
}