'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Check,
  CloudUpload,
  Image as ImageIcon,
  Loader2,
  Plus,
  Send,
  AtSign,
  RefreshCw,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { createStoryDraft, failStoryMedia, fetchStatusUsage, type StoryUsage } from '@/lib/storyApi';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';
import { MentionSuggestions, useMentionSuggestions } from '@/components/social/MentionSuggestions';
import { MentionTextarea } from '@/components/social/MentionTextarea';
import {
  cancelUpload,
  getJobs,
  retryUpload,
  requestWithUploadAuth,
  startUpload,
  subscribeUploads,
  type UploadJob,
} from '@/lib/uploads/store';
import StatusVideoPreview from '@/components/story/StatusVideoPreview';
import { prepareStatusVideo, statusRangeNeedsTrim, type StatusTrimRange } from '@/lib/statusVideoTrim';
import StatusGallerySheet from '@/components/story/StatusGallerySheet';
import { nativeGalleryConnection, parseNativeGallery, type NativeRecentMedia, type NativeGalleryStatus } from '@/lib/nativeStatusGallery';
import {
  normalizeStatusEditorValue,
} from '@/lib/statusLimits';
import {
  STORY_MAX_IMAGE_BYTES,
  STORY_MAX_VIDEO_BYTES,
  STORY_MAX_VIDEO_SECONDS,
  storyMediaCapacity,
  storyMediaKindOf,
  toUserFacingStoryError,
  validateStoryMediaFile,
  normalizeStoryMediaFile,
} from '@/lib/storyMedia';
import { formatFileSize, formatVideoTime, probeDuration } from '@/lib/videoTrim';

export type MediaStorySource = 'camera-photo' | 'camera-video' | 'gallery-image' | 'gallery-video' | 'gallery-mixed';

export interface StoryMediaEditorProps {
  source: MediaStorySource;
  initialFiles?: File[];
  onBack?: () => void;
  onText?: () => void;
  onClose: () => void;
}

export interface DraftMedia {
  id: string;
  /** Stable Android MediaStore identity, when added from the native Recents grid. */
  nativeMediaId?: string;
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
  if (mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') return mime;
  const low = item.file.name.toLowerCase();
  const extension = low.split('.').pop() || '';
  const byExtension: Record<string, string> = { mov: 'video/quicktime', m4v: 'video/x-m4v', mp4: 'video/mp4', webm: 'video/webm', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', avif: 'image/avif', png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  return byExtension[extension] || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg');
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
export default function StoryMediaEditor({ source, initialFiles, onBack, onText, onClose }: StoryMediaEditorProps) {
  const { token, user, getAccessToken, renewAccessToken } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<DraftMedia[]>([]);
  // Choose media in the gallery before opening the photo/video editor.
  const [showMediaPreview, setShowMediaPreview] = useState(false);
  const [nativeRecentMedia, setNativeRecentMedia] = useState<NativeRecentMedia[]>([]);
  const [nativeGalleryStatus, setNativeGalleryStatus] = useState<NativeGalleryStatus>('unavailable');
  const [pickingRecentId, setPickingRecentId] = useState<string | null>(null);
  const nativeAccessAskedRef = useRef(false);
  const recentPickLockedRef = useRef(false);
  const itemsRef = useRef<DraftMedia[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [trimRanges, setTrimRanges] = useState<Record<string, StatusTrimRange>>({});
  const [preparing, setPreparing] = useState(false);
  const trimAbortRef = useRef<AbortController | null>(null);
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

  const appliedInitialFilesRef = useRef(false);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const captionMentions = useMentionSuggestions({ value: caption, onChange: value => setCaption(normalizeStatusEditorValue(value)), token, inputRef: captionRef });
  const cameraPhotoRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLInputElement | null>(null);
useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => {
    trimAbortRef.current?.abort();
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
  useEffect(() => subscribeUploads(() => setJobsTick((tick) => tick + 1)), []);

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
          ? `${failedJobs[0].fileName || 'One upload'} failed: ${toUserFacingStoryError(failedJobs[0].error)} Retry below.`
          : `${failedJobs.length} uploads failed. Retry the failed items below.`
      );
      setDraftFailed(true);
      publishingRef.current = false;
      // Preserve the progress panel so the user sees the actual error and
      // can retry only the failed files without creating a new Status draft.
      return;
    }
    // Never show the success toast while the expected uploads are incomplete.
    if (completedCount !== totalJobs || relatedJobs.length !== totalJobs) return;
    if (successShownRef.current) return;
    successShownRef.current = true;
    notifyStoryFeedChanged();
    toast.success('Status posted', `${totalJobs} media item${totalJobs === 1 ? '' : 's'} live on your Status.`);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => onClose(), 900);
  }, [jobsTick, publishing, totalJobs, completedCount, relatedJobs.length, activeJobs, failedJobs, onClose, toast]);

  /** Validate + append files, generating lightweight thumbnails. */
  const addFiles = useCallback(
    async (files: ReadonlyArray<File | null | undefined>, nativeMediaId?: string) => {
      if (publishingRef.current) return;
      setMediaError('');
      setError('');
      const room = Math.max(0, capacity - items.length);
      const issues: string[] = [];
      const valid: File[] = [];
      for (const file of files) {
        if (!file) continue;
        const normalizedFile = normalizeStoryMediaFile(file);
        const problem = validateStoryMediaFile(normalizedFile);
        if (problem) {
          if (!issues.includes(problem)) issues.push(problem);
          continue;
        }
        if (valid.length >= room) {
          issues.push(`A Status can include up to ${capacity} photo${capacity === 1 ? '' : 's'} & videos.`);
          break;
        }
        valid.push(normalizedFile);
      }
      if (valid.length === 0) {
        if (issues.length > 0) setMediaError(issues.join(' '));
        return;
      }
      const created = await buildDraftItems(valid);
      const accepted = created.filter(item => {
        if (item.kind !== 'video' || (item.duration != null && Number.isFinite(item.duration) && item.duration > 0 && item.duration <= STORY_MAX_VIDEO_SECONDS)) return true;
        URL.revokeObjectURL(item.objectUrl);
        issues.push(item.duration != null && item.duration > STORY_MAX_VIDEO_SECONDS ? 'Status videos are limited to 2 minutes (120 seconds).' : 'Unable to read this video duration. Choose another video.');
        return false;
      });
      if (!accepted.length) { setMediaError(issues.join(' ')); return; }
      if (nativeMediaId && accepted.length === 1) accepted[0].nativeMediaId = nativeMediaId;
      setItems((previous) => [...previous, ...accepted]);
      setActiveId(accepted[accepted.length - 1].id);
      if (issues.length > 0) setMediaError(issues.join(' '));
    },
    [capacity, items.length]
  );

  // Android's scoped MediaStore bridge supplies thumbnails from the device
  // only after permission. Older APKs and ordinary browsers use the picker.
  useEffect(() => {
    const refresh = () => {
      const connection = nativeGalleryConnection();
      if (!connection) {
        setNativeGalleryStatus('unavailable');
        return;
      }
      try {
        const result = parseNativeGallery(
          connection.bridge.listRecent(connection.nonce),
          window.location.origin, connection.nonce
        );
        if (result.status === 'permission' && !nativeAccessAskedRef.current) {
          nativeAccessAskedRef.current = true;
          setNativeGalleryStatus('loading');
          connection.bridge.requestAccess(connection.nonce);
          return;
        }
        setNativeRecentMedia(result.items);
        setNativeGalleryStatus(result.status);
      } catch {
        setNativeGalleryStatus('error');
      }
    };
    window.addEventListener('vanta-native-gallery-ready', refresh);
    window.addEventListener('vanta-native-gallery-changed', refresh);
    refresh();
    return () => {
      window.removeEventListener('vanta-native-gallery-ready', refresh);
      window.removeEventListener('vanta-native-gallery-changed', refresh);
    };
  }, []);

  const grantNativeGallery = useCallback(() => {
    const connection = nativeGalleryConnection();
    if (!connection) {
      galleryInputRef.current?.click();
      return;
    }
    setNativeGalleryStatus('loading');
    connection.bridge.requestAccess(connection.nonce);
  }, []);

  const pickNativeRecentMedia = useCallback(async (media: NativeRecentMedia) => {
    if (publishingRef.current || recentPickLockedRef.current) return;
    if (items.some(item => item.nativeMediaId === media.id)) return;
    const maxBytes = media.mimeType.startsWith('video/') ? STORY_MAX_VIDEO_BYTES : STORY_MAX_IMAGE_BYTES;
    if (media.size > maxBytes) {
      setMediaError(media.mimeType.startsWith('video/')
        ? 'This video is larger than the 100MB limit.'
        : 'This image is larger than the 15MB limit.');
      return;
    }
    recentPickLockedRef.current = true;
    setPickingRecentId(media.id);
    setMediaError('');
    try {
      // The URL resolves entirely inside the trusted Android WebView. No media
      // is uploaded to VANTA until the user later confirms Post Status.
      const response = await fetch(media.mediaUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('Cannot open this device photo. Use Recents to choose it instead.');
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('This device photo could not be read. Choose a different photo.');
      await addFiles([new File([blob], media.name, { type: media.mimeType })], media.id);
    } catch (reason) {
      setMediaError(reason instanceof Error ? reason.message : 'Unable to read the selected photo.');
    } finally {
      recentPickLockedRef.current = false;
      setPickingRecentId(null);
    }
  }, [addFiles, items]);

  // Accept the media chosen directly from Android Files without reopening a picker.
  useEffect(() => {
    if (appliedInitialFilesRef.current || !initialFiles?.length) return;
    appliedInitialFilesRef.current = true;
    void addFiles(initialFiles);
  }, [addFiles, initialFiles]);

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
      if (next.length === 0) setShowMediaPreview(false);
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
    setShowMediaPreview(false);
    setCaption('');
    setError('');
    setMediaError('');
    setTrimRanges({});
    onBack?.();
  }, [onBack]);

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
      // Finalizing may have already persisted the file and published the
      // Status; cancelling here would give the user an incorrect result.
      if (ids.has(job.id) && (job.phase === 'starting' || job.phase === 'uploading')) {
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
    setPreparing(true);
    setDraftFailed(false);
    setError('');
    setMediaError('');

    const createdDraftIds: string[] = [];
    const abort = new AbortController();
    trimAbortRef.current = abort;
    try {
      const prepared: DraftMedia[] = [];
      for (const item of items) {
        const range = trimRanges[item.id];
        const needsTrim = item.kind === 'video' && range && statusRangeNeedsTrim(range, item.duration);
        if (item.kind === 'video' && (!item.duration || item.duration > STORY_MAX_VIDEO_SECONDS)) throw new Error('Status videos are limited to 2 minutes (120 seconds).');
        const file = needsTrim && range ? await prepareStatusVideo(item.file, item.objectUrl, range, abort.signal) : item.file;
        prepared.push({ ...item, file, size: file.size, name: file.name });
      }
      if (abort.signal.aborted) throw new DOMException('Trimming cancelled', 'AbortError');
      setPreparing(false);
      setPublishing(true);
      // 1) Create one draft per file, preserving the selected order. Nothing is
      //    uploaded until EVERY draft exists, so a mid-way failure can never
      //    leave a partial-but-live Status.
      for (let index = 0; index < items.length; index += 1) {
        const story = await requestWithUploadAuth(token, getAccessToken, renewAccessToken, accessToken =>
          createStoryDraft(accessToken, normalizedCaption)
        );
        createdDraftIds.push(story.id);
      }

      // 2) Hand every file to the existing resumable chunk pipeline. Each job
      //    finalizes its own Story row server-side (quota + 24h enforced there).
      const jobIds: string[] = [];
      prepared.forEach((item, index) => {
        const job = startUpload({
          kind: 'story',
          file: item.file,
          draftId: createdDraftIds[index],
          token,
          getAccessToken,
          renewAccessToken,
          meta: { caption: normalizedCaption, mimeType: resolveStoryMime(item) },
        });
        jobIds.push(job.id);
      });
      startedJobIdsRef.current = jobIds;
      setJobsTick((tick) => tick + 1);
      toast.info(
        'Uploading your Status',
        `${jobIds.length} file${jobIds.length === 1 ? '' : 's'} queued. Your Status will appear once the uploads finish.`
      );
    } catch (reason) {
      // Mark created-but-unposted drafts FAILED so they never surface and never
      // block a retry (bounded server-side by the pending-draft cap).
      for (const draftId of createdDraftIds) {
        try {
          await requestWithUploadAuth(token, getAccessToken, renewAccessToken, accessToken =>
            failStoryMedia(accessToken, draftId)
          );
        } catch {
          // best effort
        }
      }
      setError(toUserFacingStoryError(reason));
      setDraftFailed(true);
      publishingRef.current = false;
      setPublishing(false);
    } finally {
      setPreparing(false);
      if (trimAbortRef.current === abort) trimAbortRef.current = null;
    }
  }, [token, items, caption, trimRanges, toast, getAccessToken, renewAccessToken]);

  const active = useMemo(() => items.find((item) => item.id === activeId) || items[0] || null, [items, activeId]);

  return (
    <div className={cn('flex h-full flex-col', items.length === 0 && !publishing ? 'bg-[#121719]' : 'bg-[#1F2630]')}>
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

      {items.length === 0 && !publishing && (
        <span aria-hidden="true" className="mx-auto mt-2 h-[5px] w-14 shrink-0 rounded-full bg-[#92999d]" />
      )}
      <header className="relative flex h-14 shrink-0 items-center justify-between px-4" aria-label="Status editor navigation">
        <button
          type="button"
          onClick={() => (preparing ? trimAbortRef.current?.abort() : showMediaPreview && !publishing ? setShowMediaPreview(false) : items.length > 0 ? discardAll() : onBack ? onBack() : onClose())}
          aria-label={showMediaPreview && !publishing ? 'Back to selected media' : items.length > 0 ? 'Discard selected media' : 'Close Add status'}
          className="grid h-11 w-11 place-items-center text-white transition hover:bg-white/[0.06]"
        >
          {items.length > 0 ? <ArrowLeft size={24} /> : <X size={28} />}
        </button>
        {items.length > 0 ? (
          <button type="button" onClick={onClose} aria-label="Close Add status" className="grid h-11 w-11 place-items-center text-white/70 hover:text-white">
            <X size={21} />
          </button>
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        )}
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
          cancellable={activeJobs.filter((job) => job.phase === 'starting' || job.phase === 'uploading').length}
          onClose={onClose}
        />
      ) : !showMediaPreview ? (
        <StatusGallerySheet
          source={source}
          selected={items}
          selectionLimit={capacity}
          error={mediaError || error}
          recentMedia={nativeRecentMedia}
          nativeGalleryStatus={nativeGalleryStatus}
          pickingRecentId={pickingRecentId}
          onPickRecent={media => void pickNativeRecentMedia(media)}
          onGrantGallery={grantNativeGallery}
          onGallery={openGalleryPicker}
          onCameraPhoto={openCameraPhoto}
          onCameraVideo={openCameraVideo}
          onRemove={removeItem}
          onNext={() => setShowMediaPreview(true)}
          onText={onText}
        />
      ) : (
<>
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[var(--background)]">
            {active?.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.objectUrl} alt="Status media preview" className="h-full w-full object-contain" />
            ) : active ? (
              <StatusVideoPreview key={active.id} src={active.objectUrl} duration={active.duration} size={active.size} poster={active.thumbUrl} range={trimRanges[active.id]}
                onRange={range => setTrimRanges(previous => ({ ...previous, [active.id]: range }))} />
            ) : null}
            {preparing && <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/70 text-white">
              <Loader2 className="animate-spin text-[#dfbd55]" size={28} />
              <p className="text-sm">Preparing your selected clips…</p>
              <button type="button" className="rounded-full border border-white/20 px-4 py-2 text-xs" onClick={() => trimAbortRef.current?.abort()}>Cancel</button>
            </div>}
          </div>

          {(mediaError || error) && (
            <p role="alert" className="shrink-0 px-5 pb-1 text-center text-xs leading-4 text-[#ff9b9b]">{mediaError || error}</p>
          )}
        </>
      )}
{!publishing && showMediaPreview && items.length > 0 && (
        <div className={cn("flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-1 scrollbar-hide", items.length <= 4 ? "justify-center" : "justify-start")} aria-label="Selected media">
          {items.map((item, index) => (
            <div key={item.id} className="relative shrink-0">
              <button
                type="button"
                disabled={preparing}
                onClick={() => setActiveId(item.id)}
                aria-pressed={item.id === activeId}
                aria-label={`Preview ${item.name}`}
                className={cn(
                  'relative block h-12 w-12 overflow-hidden rounded-lg',
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
                disabled={preparing}
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
            disabled={preparing || items.length >= capacity}
            aria-label="Add more photos or videos"
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed',
              items.length >= capacity
                ? 'border-white/[0.07] bg-white/[0.01] text-white/25'
                : 'border-[#c9a227]/45 bg-black/30 text-[#dfbd55] transition hover:border-[#c9a227] hover:bg-[#c9a227]/10 active:scale-95'
            )}
          >
            <Plus size={20} />
          </button>
        </div>
      )}
{!publishing && showMediaPreview && items.length > 0 && (
        <>
          {/* Compact caption composer — character limits remain enforced by normalization. */}
          <div className="shrink-0 px-3 pb-1">
            <MentionSuggestions mention={captionMentions} className="mb-2 rounded-xl" />
            <div className="flex min-h-9 items-center gap-1.5 rounded-full border border-white/[0.06] bg-[var(--surface)] px-2.5 py-0.5">
              <button type="button" disabled={preparing} onClick={openGalleryPicker} aria-label="Add more media" className="shrink-0 text-[#dfbd55]"><ImageIcon size={18} /></button>
              <MentionTextarea
                ref={captionRef}
                value={caption}
                onChange={(event) => { setCaption(normalizeStatusEditorValue(event.target.value)); captionMentions.syncCaret(event.currentTarget); }}
                onClick={event => captionMentions.syncCaret(event.currentTarget)}
                onKeyUp={event => captionMentions.syncCaret(event.currentTarget)}
                onKeyDown={event => { captionMentions.onKeyDown(event); }}
                onPaste={(event) => {
                  event.preventDefault();
                  const pasted = event.clipboardData?.getData('text/plain') || '';
                  setCaption((previous) => normalizeStatusEditorValue(previous + pasted));
                }}
                placeholder="Add a caption…"
                aria-label="Status caption"
                rows={1}
                disabled={preparing}
                surfaceClassName="flex items-center"
                className="block h-8 min-h-0 max-h-8 flex-1 resize-none overflow-y-auto border-0 bg-transparent p-0 py-1.5 text-[14px] leading-5 text-white outline-none placeholder:text-white/45"
              />
              <button type="button" disabled={preparing} aria-label="Mention account" onClick={() => { setCaption(value => normalizeStatusEditorValue(value + (value && !/\s$/.test(value) ? ' ' : '') + '@')); requestAnimationFrame(() => { const input = captionRef.current; input?.focus(); if (input) { input.setSelectionRange(input.value.length, input.value.length); captionMentions.syncCaret(input); } }); }} className="shrink-0 text-[#dfbd55]"><AtSign size={18} /></button>
            </div>
          </div>

        </>
      )}

      {atQuota && !publishing && (
        <p role="alert" className="shrink-0 px-4 pb-1 text-center text-[11px] leading-4 text-[#dfbd55]">
          You&apos;ve reached today&apos;s Status publishing limit — verified creators go unlimited.
        </p>
      )}

      {error && !publishing && (
        <p role="alert" className="shrink-0 px-4 pb-1 text-center text-xs leading-4 text-[#ff9b9b]">{error}</p>
      )}

      {!publishing && showMediaPreview && items.length > 0 && (
        <footer className="vanta-status-action-footer mt-auto flex shrink-0 items-center justify-between bg-[var(--background)] px-3 pt-1"
          style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))' }}>
          <span className="text-xs font-medium text-white/55">Status · {items.length} {items.length === 1 ? 'item' : 'items'}</span>
          <button type="button" onClick={() => failedJobs.length > 0 ? retryFailedUploads() : void publish()}
            disabled={preparing || items.length === 0 || atQuota}
            aria-label={failedJobs.length > 0 ? 'Retry failed Status uploads' : 'Post Status'}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#c9a227] text-black transition hover:bg-[#dfbd55] active:scale-95 disabled:opacity-35">
            {preparing ? <Loader2 size={21} className="animate-spin" /> : failedJobs.length > 0 ? <RefreshCw size={21} /> : <Send size={21} fill="currentColor" />}
          </button>
        </footer>
      )}

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
  cancellable,
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
  cancellable: number;
  onClose: () => void;
}) {
  const allDone = total > 0 && completed === total && active === 0 && failed === 0;
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
          {cancellable > 0 && (
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
