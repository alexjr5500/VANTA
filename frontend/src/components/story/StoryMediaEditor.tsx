'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  Plus,
  Send,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { createStoryDraft, failStoryMedia, fetchStatusUsage, type StoryUsage } from '@/lib/storyApi';
import { MentionSuggestions, useMentionSuggestions } from '@/components/social/MentionSuggestions';
import { MentionTextarea } from '@/components/social/MentionTextarea';
import {
  requestWithUploadAuth,
  startUpload,
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
import { formatVideoTime, probeDuration } from '@/lib/videoTrim';

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
  const router = useRouter();

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
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [usage, setUsage] = useState<StoryUsage | null>(null);

  // Ref-based submission lock: set synchronously BEFORE the first await so a
  // rapid double-tap on Post Status can never create duplicate drafts/uploads.
  const publishingRef = useRef(false);

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

  const publish = useCallback(() => {
    if (!token || publishingRef.current || items.length === 0 || atQuota) return;
    publishingRef.current = true;
    const normalizedCaption = normalizeStatusEditorValue(caption).trim() || undefined;
    // The detached task owns independent blob URLs. Closing the editor can
    // revoke its previews without interrupting video preparation.
    const selected = items.map(item => ({ ...item, objectUrl: URL.createObjectURL(item.file) }));
    const ranges = { ...trimRanges };
    const abort = new AbortController();
    const createdDraftIds: string[] = [];
    onClose();
    router.push('/home');
    void (async () => {
      try {
        const prepared: DraftMedia[] = [];
        for (const item of selected) {
          const range = ranges[item.id];
          if (item.kind === 'video' && (!item.duration || item.duration > STORY_MAX_VIDEO_SECONDS)) throw new Error('Status videos are limited to 2 minutes (120 seconds).');
          const file = item.kind === 'video' && range && statusRangeNeedsTrim(range, item.duration)
            ? await prepareStatusVideo(item.file, item.objectUrl, range, abort.signal)
            : item.file;
          prepared.push({ ...item, file, size: file.size, name: file.name });
        }
        // Create every draft before starting any upload.
        for (let index = 0; index < prepared.length; index += 1) {
          const story = await requestWithUploadAuth(token, getAccessToken, renewAccessToken, accessToken =>
            createStoryDraft(accessToken, normalizedCaption)
          );
          createdDraftIds.push(story.id);
        }
        prepared.forEach((item, index) => {
          startUpload({
            kind: 'story',
            file: item.file,
            draftId: createdDraftIds[index],
            token,
            getAccessToken,
            renewAccessToken,
            meta: { caption: normalizedCaption, mimeType: resolveStoryMime(item) },
          });
        });
      } catch (reason) {
        for (const draftId of createdDraftIds) {
          try {
            await requestWithUploadAuth(token, getAccessToken, renewAccessToken, accessToken => failStoryMedia(accessToken, draftId));
          } catch { /* best effort */ }
        }
        toast.error('Status could not be posted', toUserFacingStoryError(reason));
      } finally {
        for (const item of selected) URL.revokeObjectURL(item.objectUrl);
      }
    })();
  }, [token, items, caption, trimRanges, atQuota, toast, getAccessToken, renewAccessToken, onClose, router]);

  const active = useMemo(() => items.find((item) => item.id === activeId) || items[0] || null, [items, activeId]);

  return (
    <div className={cn('flex h-full flex-col', items.length === 0 ? 'bg-[#121719]' : 'bg-[#1F2630]')}>
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

      {items.length === 0 && (
        <span aria-hidden="true" className="mx-auto mt-2 h-[5px] w-14 shrink-0 rounded-full bg-[#92999d]" />
      )}
      <header className="relative flex h-14 shrink-0 items-center justify-between px-4" aria-label="Status editor navigation">
        <button
          type="button"
          onClick={() => (showMediaPreview ? setShowMediaPreview(false) : items.length > 0 ? discardAll() : onBack ? onBack() : onClose())}
          aria-label={showMediaPreview ? 'Back to selected media' : items.length > 0 ? 'Discard selected media' : 'Close Add status'}
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

      {!showMediaPreview ? (
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
          </div>

          {mediaError && (
            <p role="alert" className="shrink-0 px-5 pb-1 text-center text-xs leading-4 text-[#ff9b9b]">{mediaError}</p>
          )}
        </>
      )}
{showMediaPreview && items.length > 0 && (
        <div className={cn("flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-1 scrollbar-hide", items.length <= 4 ? "justify-center" : "justify-start")} aria-label="Selected media">
          {items.map((item, index) => (
            <div key={item.id} className="relative shrink-0">
              <button
                type="button"
                
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
            disabled={items.length >= capacity}
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
{showMediaPreview && items.length > 0 && (
        <>
          {/* Compact caption composer — character limits remain enforced by normalization. */}
          <div className="shrink-0 px-3 pb-1">
            <MentionSuggestions mention={captionMentions} className="mb-2 rounded-xl" />
            <div className="flex min-h-9 items-center gap-1.5 rounded-full border border-white/[0.06] bg-[var(--surface)] px-2.5 py-0.5">
              <button type="button"  onClick={openGalleryPicker} aria-label="Add more media" className="shrink-0 text-[#dfbd55]"><ImageIcon size={18} /></button>
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
                
                surfaceClassName="flex items-center"
                className="block h-8 min-h-0 max-h-8 flex-1 resize-none overflow-y-auto border-0 bg-transparent p-0 py-1.5 text-[14px] leading-5 text-white outline-none placeholder:text-white/45"
              />

            </div>
          </div>

        </>
      )}

      {atQuota && (
        <p role="alert" className="shrink-0 px-4 pb-1 text-center text-[11px] leading-4 text-[#dfbd55]">
          You&apos;ve reached today&apos;s Status publishing limit — verified creators go unlimited.
        </p>
      )}

      {error && (
        <p role="alert" className="shrink-0 px-4 pb-1 text-center text-xs leading-4 text-[#ff9b9b]">{error}</p>
      )}

      {showMediaPreview && items.length > 0 && (
        <footer className="vanta-status-action-footer mt-auto flex shrink-0 items-center justify-end bg-[var(--background)] px-3 pt-1"
          style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))' }}>

          <button type="button" onClick={publish}
            disabled={items.length === 0 || atQuota}
            aria-label="Post Status"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#c9a227] text-black transition hover:bg-[#dfbd55] active:scale-95 disabled:opacity-35">
            <Send size={21} fill="currentColor" />
          </button>
        </footer>
      )}

    </div>
  );
}
