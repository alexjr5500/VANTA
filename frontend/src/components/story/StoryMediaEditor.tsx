'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Check,
  Clock,
  CloudUpload,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { createStoryDraft, failStoryMedia, fetchStatusUsage, type StoryUsage } from '@/lib/storyApi';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';
import {
  cancelUpload,
  getJobs,
  retryUpload,
  startUpload,
  subscribeUploads,
  type UploadJob,
} from '@/lib/uploads/store';
import VideoTrimModal from '@/components/video/VideoTrimModal';
import type { VideoTrimResult } from '@/components/video/VideoTrimEditor';
import {
  STATUS_MAX_CHARS,
  normalizeStatusEditorValue,
  statusCounts,
} from '@/lib/statusLimits';
import {
  MAX_STATUS_MEDIA_FILES,
  storyMediaCapacity,
  storyMediaKindOf,
  toUserFacingStoryError,
  validateStoryMediaFile,
} from '@/lib/storyMedia';
import { formatFileSize, formatVideoTime, probeDuration } from '@/lib/videoTrim';

export type MediaStorySource = 'camera-photo' | 'camera-video' | 'gallery-image' | 'gallery-video' | 'gallery-mixed';

export interface StoryMediaEditorProps {
  source: MediaStorySource;
  onBack?: () => void;
  onClose: () => void;
}

export interface DraftMedia {
  id: string;
  file: File;
  kind: 'image' | 'video';
  /** Full-resolution blob preview URL (main canvas + upload source). */
  objectUrl: string;
  /** Small downscaled thumbnail (data URL) so the rail never decodes full files. */
  thumbUrl: string | null;
  /** Video duration in seconds (null when unknown or not a video). */
  duration: number | null;
  name: string;
  size: number;
}

/** Resolve the normalized media MIME for the upload pipeline. */
function resolveStoryMime(item: DraftMedia): string {
  const mime = String(item.file.type || '').toLowerCase().split(';')[0].trim();
  if (mime) return mime;
  const low = item.file.name.toLowerCase();
  if (item.kind === 'video') return low.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  return 'image/jpeg';
}

const makeMediaId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
/** Downscale an image blob to a small JPEG data-URL thumbnail. */
async function imageThumbnailDataUrl(src: string, maxWidth = 420): Promise<string | null> {
  const image = new Image();
  image.src = src;
  try {
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    });
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) return null;
    const scale = Math.min(1, maxWidth / naturalWidth);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

/** Capture a poster frame from a video blob URL into a small JPEG data URL. */
async function videoPosterDataUrl(src: string, maxWidth = 300): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = src;
  try {
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      const onLoaded = () => resolve();
      const onError = () => resolve();
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      window.setTimeout(() => resolve(), 6000);
    });
    if (!(video.duration > 0)) return null;
    await new Promise<void>((resolve) => {
      video.currentTime = Math.min(video.duration * 0.05, 0.05);
      video.addEventListener('seeked', () => resolve(), { once: true });
      window.setTimeout(() => resolve(), 2500);
    });
    const videoWidth = video.videoWidth || video.width || 240;
    const videoHeight = video.videoHeight || video.height || 16;
    const width = Math.max(1, Math.min(maxWidth, videoWidth));
    const height = Math.max(1, Math.round(width * videoHeight / Math.max(1, videoWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function buildDraftItems(files: File[]): Promise<DraftMedia[]> {
  return Promise.all(
    files.map(async (file): Promise<DraftMedia> => {
      const kind = storyMediaKindOf(file) || 'image';
      const objectUrl = URL.createObjectURL(file);
      let duration: number | null = null;
      let thumbUrl: string | null = null;
      try {
        if (kind === 'image') {
          thumbUrl = await imageThumbnailDataUrl(objectUrl);
        } else {
          duration = await probeDuration(objectUrl);
          thumbUrl = await videoPosterDataUrl(objectUrl);
        }
      } catch {
        thumbUrl = null;
      }
      return { id: makeMediaId(), file, kind, objectUrl, thumbUrl, duration, name: file.name, size: file.size };
    })
  );
}
/**
 * Photo & Video Status composer — full multi-file creation.
 *
 * A Status post is backed by the existing Story model where ONE row holds ONE
 * media item, so multi-file statuses publish several Story rows through the
 * existing background chunk-upload pipeline. The composer:
 *  - selects MULTIPLE photos and videos in a single session (mixed allowed),
 *  - keeps a thumbnail rail with remove / add-more / tap-to-preview,
 *  - uploads every file with REAL byte progress ("Uploading X of Y"),
 *  - never creates a broken Status: drafts are created for every file first
 *    and uploads only start once every draft exists,
 *  - guards against double-submission with an immediate ref-based lock.
 */
export default function StoryMediaEditor({ source, onBack, onClose }: StoryMediaEditorProps) {
  const { token, user } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<DraftMedia[]>([]);
  const itemsRef = useRef<DraftMedia[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [trimItem, setTrimItem] = useState<DraftMedia | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [usage, setUsage] = useState<StoryUsage | null>(null);
  const [jobsTick, setJobsTick] = useState(0);

  // Ref-based submission lock: set synchronously BEFORE the first await so a
  // rapid double-tap on Post Status can never create duplicate drafts/uploads.
  const publishingRef = useRef(false);
  const startedJobIdsRef = useRef<string[]>([]);
  const successShownRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraPhotoRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLInputElement | null>(null);
useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    for (const item of itemsRef.current) {
      try {
        URL.revokeObjectURL(item.objectUrl);
      } catch {
        // no-op
      }
    }
    itemsRef.current = [];
  }, []);

  const counts = useMemo(() => statusCounts(caption), [caption]);

  // Quota: the server stays authoritative, this only shapes the UX. Verified
  // users are unlimited; every media file publishes its own Story row, so a
  // standard user's remaining daily quota caps how many files they can add.
  const capacity = useMemo(
    () => storyMediaCapacity({ verified: Boolean(user?.verified), usedToday: usage?.used, limit: usage?.limit }),
    [user, usage]
  );
  const atQuota = Boolean(
    !user?.verified && usage && typeof usage.limit === 'number' && usage.used >= usage.limit
  );

  useEffect(() => {
    if (!token) return;
    void fetchStatusUsage(token)
      .then((data) => {
        if (typeof data?.used === 'number' && typeof data?.limit === 'number') setUsage(data);
      })
      .catch(() => undefined);
  }, [token]);

  // Live upload progress — re-read the job store whenever any job changes.
  useEffect(() => {
    if (!publishing) return;
    return subscribeUploads(() => setJobsTick((tick) => tick + 1));
  }, [publishing]);

  // jobsTick is the re-render trigger: the upload store is a module singleton,
  // so the memo re-reads it whenever any upload job changes.
  const relatedJobs = useMemo(() => {
    void jobsTick;
    const ids = new Set(startedJobIdsRef.current);
    return getJobs().filter((job) => ids.has(job.id));
  }, [jobsTick]);

  const totalJobs = startedJobIdsRef.current.length;
  const completedCount = relatedJobs.filter((job) => job.phase === 'completed').length;
  const failedJobs = relatedJobs.filter((job) => job.phase === 'failed' || job.phase === 'cancelled');
  const activeJobs = relatedJobs.filter((job) => job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'processing');
// Watch for the whole batch settling: every upload finished → success + close;
  // any failure with nothing left running → surface retry, never a silent break.
  useEffect(() => {
    if (!publishing || totalJobs === 0) return;
    if (activeJobs.length > 0) return;
    if (failedJobs.length > 0) {
      setError(
        failedJobs.length === 1
          ? `${failedJobs[0].fileName || 'One upload'} failed. Retry it or post the remaining files.`
          : `${failedJobs.length} uploads failed. Retry them or post the remaining files.`
      );
      setDraftFailed(true);
      publishingRef.current = false;
      setPublishing(false);
      return;
    }
    if (successShownRef.current) return;
    successShownRef.current = true;
    notifyStoryFeedChanged();
    toast.success('Status posted', `${totalJobs} media item${totalJobs === 1 ? '' : 's'} live on your Status.`);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => onClose(), 900);
  }, [jobsTick, publishing, totalJobs, activeJobs, failedJobs, onClose, toast]);

  /** Validate + append files, generating lightweight thumbnails. */
  const addFiles = useCallback(
    async (files: ReadonlyArray<File | null | undefined>) => {
      if (publishingRef.current) return;
      setMediaError('');
      setError('');
      const room = Math.max(0, capacity - items.length);
      const issues: string[] = [];
      const valid: File[] = [];
      for (const file of files) {
        if (!file) continue;
        const problem = validateStoryMediaFile(file);
        if (problem) {
          if (!issues.includes(problem)) issues.push(problem);
          continue;
        }
        if (valid.length >= room) {
          issues.push(`A Status can include up to ${capacity} photo${capacity === 1 ? '' : 's'} & videos.`);
          break;
        }
        valid.push(file);
      }
      if (valid.length === 0) {
        if (issues.length > 0) setMediaError(issues.join(' '));
        return;
      }
      const created = await buildDraftItems(valid);
      setItems((previous) => [...previous, ...created]);
      setActiveId(created[created.length - 1].id);
      if (issues.length > 0) setMediaError(issues.join(' '));
    },
    [capacity, items.length]
  );

  const openGalleryPicker = useCallback(() => {
    galleryInputRef.current?.click();
  }, []);
  const openCameraPhoto = useCallback(() => {
    cameraPhotoRef.current?.click();
  }, []);
  const openCameraVideo = useCallback(() => {
    cameraVideoRef.current?.click();
  }, []);

  const handleGalleryChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      void addFiles(files);
    },
    [addFiles]
  );

  const handleSingleCapture = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      void addFiles([file]);
    },
    [addFiles]
  );

  const removeItem = useCallback(
    (id: string) => {
      if (publishingRef.current) return;
      const index = items.findIndex((item) => item.id === id);
      const target = index >= 0 ? items[index] : undefined;
      const next = items.filter((item) => item.id !== id);
      setItems(next);
      if (target) {
        try {
          URL.revokeObjectURL(target.objectUrl);
        } catch {
          // no-op
        }
      }
      if (activeId === id) {
        const fallbackIndex = Math.min(Math.max(index - 1, 0), Math.max(next.length - 1, 0));
        const fallback = next[fallbackIndex];
        setActiveId(fallback ? fallback.id : null);
      }
      setError('');
      setMediaError('');
    },
    [items, activeId]
  );

  const discardAll = useCallback(() => {
    for (const item of itemsRef.current) {
      try {
        URL.revokeObjectURL(item.objectUrl);
      } catch {
        // no-op
      }
    }
    itemsRef.current = [];
    setItems([]);
    setActiveId(null);
    setCaption('');
    setError('');
    setMediaError('');
    setTrimItem(null);
    onBack?.();
  }, [onBack]);

  const handleTrimConfirm = useCallback(
    (result: VideoTrimResult) => {
      const target = trimItem;
      setTrimItem(null);
      if (!result.file || !target) return;
      try {
        URL.revokeObjectURL(target.objectUrl);
      } catch {
        // no-op
      }
      const objectUrl = URL.createObjectURL(result.file);
      setItems((previous) =>
        previous.map((item) =>
          item.id === target.id
            ? { ...item, file: result.file, objectUrl, thumbUrl: null, duration: null, name: result.file.name, size: result.file.size, kind: 'video' }
            : item
        )
      );
      setError('');
      setMediaError('');
    },
    [trimItem]
  );

  const retryFailedUploads = useCallback(() => {
    const ids = new Set(startedJobIdsRef.current);
    const failed = getJobs().filter((job) => ids.has(job.id) && (job.phase === 'failed' || job.phase === 'cancelled'));
    if (failed.length === 0) return;
    for (const job of failed) retryUpload(job);
    successShownRef.current = false;
    publishingRef.current = true;
    setPublishing(true);
    setDraftFailed(false);
    setError('');
    window.setTimeout(() => setJobsTick((tick) => tick + 1), 300);
  }, []);

  const cancelAllPending = useCallback(() => {
    const ids = new Set(startedJobIdsRef.current);
    for (const job of getJobs()) {
      if (ids.has(job.id) && (job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'processing')) {
        cancelUpload(job);
      }
    }
  }, []);

  const absentMessage =
    failedJobs.length > 0
      ? `${failedJobs.length} upload${failedJobs.length === 1 ? '' : 's'} need${failedJobs.length === 1 ? 's' : ''} attention — retry them below or in the upload tray.`
      : draftFailed
        ? 'Some files could not be queued. Review the message and try again.'
        : activeJobs.length > 0
          ? 'Uploads run in the background — you can close this screen at any time.'
          : '';

  const publish = useCallback(async () => {
    if (!token || publishingRef.current || items.length === 0) return;
    const normalizedCaption = normalizeStatusEditorValue(caption).trim() || undefined;
    publishingRef.current = true;
    successShownRef.current = false;
    setPublishing(true);
    setDraftFailed(false);
    setError('');
    setMediaError('');

    const createdDraftIds: string[] = [];
    try {
      // 1) Create one draft per file, preserving the selected order. Nothing is
      //    uploaded until EVERY draft exists, so a mid-way failure can never
      //    leave a partial-but-live Status.
      for (let index = 0; index < items.length; index += 1) {
        const story = await createStoryDraft(token, normalizedCaption);
        createdDraftIds.push(story.id);
      }

      // 2) Hand every file to the existing resumable chunk pipeline. Each job
      //    finalizes its own Story row server-side (quota + 24h enforced there).
      const jobIds: string[] = [];
      items.forEach((item, index) => {
        const job = startUpload({
          kind: 'story',
          file: item.file,
          draftId: createdDraftIds[index],
          token,
          meta: { caption: normalizedCaption, mimeType: resolveStoryMime(item) },
        });
        jobIds.push(job.id);
      });
      startedJobIdsRef.current = jobIds;
      setJobsTick((tick) => tick + 1);
      toast.info(
        'Posting your Status',
        `Uploading ${jobIds.length} file${jobIds.length === 1 ? '' : 's'} — you can close this screen; it continues in the background.`
      );
    } catch (reason) {
      // Mark created-but-unposted drafts FAILED so they never surface and never
      // block a retry (bounded server-side by the pending-draft cap).
      for (const draftId of createdDraftIds) {
        try {
          await failStoryMedia(token, draftId);
        } catch {
          // best effort
        }
      }
      setError(toUserFacingStoryError(reason));
      setDraftFailed(true);
      publishingRef.current = false;
      setPublishing(false);
    }
  }, [token, items, caption, toast]);

  const active = useMemo(() => items.find((item) => item.id === activeId) || items[0] || null, [items, activeId]);
  const isVerified = Boolean(user?.verified);

  // Auto-open the initial source (this screen was opened by a user tap), just
  // like the original single-file flow did.
  const initialOpenedRef = useRef(false);
  useEffect(() => {
    if (initialOpenedRef.current) return;
    initialOpenedRef.current = true;
    const frame = requestAnimationFrame(() => {
      if (source === 'camera-photo') openCameraPhoto();
      else if (source === 'camera-video') openCameraVideo();
      else openGalleryPicker();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
const sourceLabel = source === 'camera-video' ? 'Record a video'
    : source === 'camera-photo' ? 'Take a photo'
    : 'Photo & Video Status';

  return (
    <div className="flex h-full flex-col bg-[#050506]">
      {/* Hidden inputs */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleGalleryChange}
      />
      <input
        ref={cameraPhotoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleSingleCapture}
      />
      <input
        ref={cameraVideoRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleSingleCapture}
      />

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-3 pt-[max(env(safe-area-inset-top,0px),6px)]">
        <button
          type="button"
          onClick={() => (items.length > 0 ? discardAll() : onBack ? onBack() : onClose())}
          aria-label={items.length > 0 ? 'Remove all media and go back' : 'Back to creation menu'}
          className={cn(
            'grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/[0.06]',
            items.length > 0 ? 'text-[#e5484d]' : 'text-[#8a8a8a] hover:text-white'
          )}
        >
          {items.length > 0 ? <Trash2 size={18} /> : <ArrowLeft size={18} />}
        </button>
        <div className="flex min-w-0 flex-col items-center">
          <h2 className="text-sm font-semibold text-white">Create Status</h2>
          <p className="max-w-[220px] truncate text-[10px] text-white/40">{sourceLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close creation"
          className="grid h-11 w-11 place-items-center rounded-full text-[#8a8a8a] transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={18} />
        </button>
      </header>

      {publishing ? (
        <PublishingPanel
          total={totalJobs}
          completed={completedCount}
          failed={failedJobs.length}
          active={activeJobs.length}
          jobs={relatedJobs}
          error={error}
          absentMessage={absentMessage}
          onRetry={retryFailedUploads}
          onCancel={cancelAllPending}
          onClose={onClose}
        />
      ) : items.length === 0 ? (
        <EmptyPicker
          source={source}
          onGallery={openGalleryPicker}
          onCameraPhoto={openCameraPhoto}
          onCameraVideo={openCameraVideo}
        />
      ) : (
<>
          {/* Main preview */}
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-1">
            <div
              className="relative flex w-full max-w-[380px] items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-black"
              style={{ aspectRatio: '9 / 16', maxHeight: '100%' }}
            >
              {active?.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={active.objectUrl} alt="Status media preview" className="absolute inset-0 h-full w-full object-cover" />
              ) : active ? (
                <video src={active.objectUrl} playsInline muted loop className="absolute inset-0 h-full w-full object-cover" />
              ) : null}

              {/* Selected index + kind chip */}
              {active && items.length > 0 && (
                <span className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                  {active.kind === 'video' ? <Film size={11} /> : <ImageIcon size={11} />}
                  {items.findIndex((item) => item.id === active.id) + 1}
                  <span className="text-white/35">/</span>
                  {items.length}
                </span>
              )}
              {active && active.kind === 'video' && active.duration && active.duration > 0 && (
                <span className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white/90 backdrop-blur-sm">
                  <Clock size={11} />
                  {formatVideoTime(active.duration)}
                </span>
              )}

              {caption.trim() && (
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-4 pb-4 pt-10">
                  <p className="whitespace-pre-wrap break-words text-left text-[15px] font-medium leading-snug text-white">
                    {caption.trim()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {(mediaError || error) && (
            <p role="alert" className="shrink-0 px-5 pb-1 text-center text-xs leading-4 text-[#ff9b9b]">{mediaError || error}</p>
          )}
        </>
      )}
{!publishing && items.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-3 pb-1 scrollbar-hide" aria-label="Selected media">
          {items.map((item, index) => (
            <div key={item.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setActiveId(item.id)}
                aria-pressed={item.id === activeId}
                aria-label={`Preview ${item.name}`}
                className={cn(
                  'relative block h-[88px] w-[58px] overflow-hidden rounded-lg',
                  item.id === activeId
                    ? 'border-2 border-[#dfbd55] shadow-[0_0_12px_rgba(201,162,39,0.35)]'
                    : 'border border-white/[0.12] opacity-85 transition hover:border-white/25 hover:opacity-100'
                )}
              >
                {item.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center bg-[#121216] text-[#8a8a8a]">
                    {item.kind === 'video' ? <Video size={18} /> : <ImageIcon size={18} />}
                  </span>
                )}
                <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 text-[9px] font-bold tabular-nums text-white/90">
                  {index + 1}
                </span>
                {item.kind === 'video' && item.duration && item.duration > 0 && (
                  <span className="absolute bottom-4 right-0.5 rounded bg-black/70 px-1 text-[8.5px] font-semibold tabular-nums text-[#dfbd55]">
                    {formatVideoTime(item.duration)}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                aria-label={`Remove ${item.name}`}
                className="absolute -right-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/20 bg-black/80 text-white/80 transition hover:bg-[#e5484d] hover:text-white active:scale-90"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={openGalleryPicker}
            aria-label="Add more photos or videos"
            className={cn(
              'flex h-[88px] w-[58px] shrink-0 items-center justify-center rounded-lg border border-dashed',
              items.length >= capacity
                ? 'border-white/[0.07] bg-white/[0.01] text-white/25'
                : 'border-[#c9a227]/45 bg-black/30 text-[#dfbd55] transition hover:border-[#c9a227] hover:bg-[#c9a227]/10 active:scale-95'
            )}
          >
            <Plus size={20} />
          </button>
        </div>
      )}
{!publishing && items.length > 0 && (
        <>
          {/* Media toolbar */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-1.5">
            <MediaAction label="Photo & Video" icon={ImageIcon} onClick={openGalleryPicker} />
            <MediaAction label="Camera" icon={Camera} onClick={openCameraPhoto} />
            <MediaAction label="Record" icon={Video} onClick={openCameraVideo} />
            {active && active.kind === 'video' && (
              <MediaAction label="Trim" icon={Clock} onClick={() => setTrimItem(active)} />
            )}
          </div>

          {/* Caption field with live status counter */}
          <div className="shrink-0 px-4 pb-1.5">
            <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <textarea
                value={caption}
                onChange={(event) => setCaption(normalizeStatusEditorValue(event.target.value))}
                onPaste={(event) => {
                  event.preventDefault();
                  const pasted = event.clipboardData?.getData('text/plain') || '';
                  setCaption((previous) => normalizeStatusEditorValue(previous + pasted));
                }}
                placeholder="Add a caption to your Status…"
                aria-label="Status caption"
                rows={1}
                className="max-h-24 min-h-[38px] flex-1 resize-none bg-transparent text-[15px] leading-tight text-white outline-none placeholder:text-white/30"
              />
              <span className={cn('shrink-0 text-[11px] tabular-nums', counts.overChars ? 'text-[#e5484d]' : 'text-white/35')}>
                {counts.chars}/{STATUS_MAX_CHARS}
              </span>
            </div>
          </div>

          {/* Quota + limits hint */}
          <div className="flex shrink-0 items-center justify-center gap-1.5 px-4 pb-1 text-center text-[10.5px] leading-4 text-white/35">
            {isVerified ? (
              <span className="flex items-center gap-1 rounded-full border border-[#c9a227]/35 bg-[#c9a227]/10 px-2 py-0.5 font-semibold text-[#dfbd55]">
                <Check size={10} /> Verified — unlimited
              </span>
            ) : (
              usage && <span>Today: {usage.used} / {usage.limit} used</span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              Up to {MAX_STATUS_MEDIA_FILES} photos &amp; videos per Status · vanishes in 24 hours
            </span>
          </div>
        </>
      )}

      {atQuota && !publishing && (
        <p role="alert" className="shrink-0 px-4 pb-1 text-center text-[11px] leading-4 text-[#dfbd55]">
          You&apos;ve reached today&apos;s Status publishing limit — verified creators go unlimited.
        </p>
      )}

      {error && publishing && (
        <p role="alert" className="shrink-0 px-4 pb-1 text-center text-xs leading-4 text-[#ff9b9b]">{error}</p>
      )}

      {/* Publish bar */}
      {!publishing && (
        <footer
          className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0e]/95 px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--vanta-kb, 0px) + 16px)' }}
        >
          <button
            type="button"
            onClick={() => void publish()}
            disabled={items.length === 0 || atQuota}
            aria-label="Post Status"
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a227] text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.99] disabled:opacity-30"
          >
            {publishing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            Post Status
            {items.length > 0 && <span className="text-black/50">({items.length})</span>}
          </button>
        </footer>
      )}

      {/* Shared video trimmer — lets the user cut a Story video to the range they
          want before it is uploaded in the background. */}
      <VideoTrimModal
        open={Boolean(trimItem)}
        file={trimItem?.file || null}
        onClose={() => setTrimItem(null)}
        onConfirm={handleTrimConfirm}
        title="Trim Story Video"
        subtitle="Preview and trim the timeline before publishing"
        confirmLabel="Use this video"
        trimActionLabel="Trim & Preview"
      />
    </div>
  );
}
function PublishingPanel({
  total,
  completed,
  failed,
  active,
  jobs,
  error,
  absentMessage,
  onRetry,
  onCancel,
  onClose,
}: {
  total: number;
  completed: number;
  failed: number;
  active: number;
  jobs: UploadJob[];
  error: string;
  absentMessage: string;
  onRetry: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const allDone = total > 0 && active === 0 && failed === 0;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide px-6 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex flex-col items-center pt-2"
      >
        <span
          className={cn(
            'grid h-16 w-16 place-items-center rounded-full border',
            allDone
              ? 'border-[#dfbd55]/60 bg-[#c9a227]/15 text-[#dfbd55]'
              : failed > 0 && active === 0
                ? 'border-[#e5484d]/40 bg-[#2a1214]/95 text-[#ff8b93]'
                : 'border-white/[0.12] bg-white/[0.04] text-[#dfbd55]'
          )}
        >
          {allDone ? <Check size={26} /> : failed > 0 && active === 0 ? <RefreshCw size={24} /> : <CloudUpload size={24} />}
        </span>
        <h3 className="mt-2 text-[16px] font-bold text-white">
          {allDone ? 'Status posted' : failed > 0 && active === 0 ? 'Some uploads failed' : 'Posting your Status'}
        </h3>
        <p className="mt-0.5 text-xs leading-4 text-white/45">
          {allDone
            ? `${total} media item${total === 1 ? '' : 's'} are now live on your Status.`
            : `${completed} of ${total} uploaded`}
        </p>
      </motion.div>

      {/* Overall progress bar */}
      <div className="mx-auto mt-4 h-1.5 w-full max-w-[300px] overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full bg-gradient-to-r from-[#dfbd55] to-[#c9a227] transition-all" style={{ width: `${progress}%` }} />
      </div>

      {/* Per-file rows */}
      {jobs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {jobs.map((job) => {
            const isError = job.phase === 'failed' || job.phase === 'cancelled';
            const isActive = job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'processing';
            return (
              <li key={job.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
                <span
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                    job.phase === 'completed'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : isError
                        ? 'bg-[#e5484d]/15 text-[#ff8b93]'
                        : 'bg-[#c9a227]/15 text-[#dfbd55]'
                  )}
                >
                  {job.phase === 'completed'
                    ? <Check size={14} />
                    : isError
                      ? <RefreshCw size={14} />
                      : isActive
                        ? <Loader2 size={14} className="animate-spin" />
                        : <CloudUpload size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block max-w-full truncate text-[12px] font-semibold leading-tight text-white">{job.fileName}</span>
                  <span className="mt-0.5 block text-[10px] tabular-nums leading-tight text-white/40">
                    {job.phase === 'completed'
                      ? 'Uploaded · live'
                      : isError
                        ? job.error || 'Upload failed'
                        : job.phase === 'processing'
                          ? 'Finalizing…'
                          : job.phase === 'uploading'
                            ? `${Math.round(job.progress)}% · ${formatFileSize(job.bytesSent)} / ${formatFileSize(job.bytesTotal)}`
                            : 'Preparing…'}
                  </span>
                </span>
                <span className="max-w-[52px] shrink-0 text-[10px] font-semibold tabular-nums text-[#dfbd55]">
                  {job.phase === 'completed' ? '100%' : isError ? '—' : job.phase === 'processing' ? '100%' : `${Math.round(job.progress)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {failed > 0 && (
        <p className="mt-3 text-center text-[12px] font-medium leading-4 text-[#ff8b93]">
          {failed === 1 ? '1 upload failed' : `${failed} uploads failed`} — you can retry just the ones that failed.
        </p>
      )}
{!allDone && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          {failed > 0 && (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-11 items-center gap-2 rounded-xl bg-[#c9a227] px-4 text-sm font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.98]"
            >
              <RefreshCw size={15} />
              Retry failed
            </button>
          )}
          {active > 0 && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel pending uploads"
              className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-sm font-medium text-[#c8c8cc] transition hover:bg-white/[0.08] hover:text-white active:scale-95"
            >
              <X size={14} />
              Cancel uploads
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-sm font-medium text-[#c8c8cc] transition hover:bg-white/[0.08] hover:text-white active:scale-95"
          >
            Close · continue in background
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-center text-xs leading-4 text-[#ff9b9b]">{error}</p>}
      {absentMessage && !error && <p className="mt-2 text-center text-[10.5px] leading-4 text-white/40">{absentMessage}</p>}
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
  onGallery,
  onCameraPhoto,
  onCameraVideo,
}: {
  source: MediaStorySource;
  onGallery: () => void;
  onCameraPhoto: () => void;
  onCameraVideo: () => void;
}) {
  const camera = source === 'camera-photo' || source === 'camera-video';
  const videoCamera = source === 'camera-video';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 pb-[max(env(safe-area-inset-bottom,0px),16px)] text-center"
    >
      <span className="grid h-20 w-20 place-items-center rounded-[22px] border border-white/[0.1] bg-gradient-to-br from-white/[0.05] to-white/[0.01] text-[#dfbd55] shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
        {camera ? <Camera size={32} /> : <ImageIcon size={32} />}
      </span>
      <div>
        <h3 className="text-[17px] font-bold text-white">
          {camera ? (videoCamera ? 'Record a Story video' : 'Take a Story photo') : 'Choose your media'}
        </h3>
        <p className="mt-1 text-[13px] leading-5 text-white/45">
          {camera
            ? 'Capture a photo or short video for your Status.'
            : 'Select one or more photos and videos — they all post to the same Status.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {camera ? (
          <>
            <button
              type="button"
              onClick={videoCamera ? onCameraVideo : onCameraPhoto}
              className="flex h-12 items-center gap-2 rounded-full bg-[#c9a227] px-5 text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.98]"
            >
              <Camera size={16} />
              {videoCamera ? 'Record video' : 'Take photo'}
            </button>
            <button
              type="button"
              onClick={onGallery}
              className="flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black transition hover:bg-white/85 active:scale-[0.98]"
            >
              <ImageIcon size={16} />
              Gallery
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onGallery}
              className="flex h-12 items-center gap-2 rounded-full bg-[#c9a227] px-5 text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.98]"
            >
              <ImageIcon size={16} />
              Photo &amp; Video
            </button>
            <button
              type="button"
              onClick={onCameraPhoto}
              className="flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black transition hover:bg-white/85 active:scale-[0.98]"
            >
              <Camera size={16} />
              Camera
            </button>
          </>
        )}
      </div>
      <p className="mt-1 text-[10.5px] leading-4 text-white/35">Up to 7 photos &amp; videos per Status · Stories vanish after 24 hours.</p>
    </motion.div>
  );
}