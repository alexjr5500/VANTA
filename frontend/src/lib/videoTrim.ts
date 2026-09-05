/**
 * Shared VANTA video trimming engine.
 *
 * Used by every video upload flow (Reel, Post, Story, Chat, Fundraiser cover)
 * through the reusable <VideoTrimEditor /> component. Trimming is REAL
 * trimming: the selected start→end segment is re-encoded in the browser with
 * HTMLVideoElement.captureStream() + MediaRecorder (canvas + Web Audio
 * fallback for browsers without media capture). The output is a brand-new
 * WebM file that contains ONLY the selected time range — we never upload the
 * full original and pretend timestamps mean something.
 *
 * This module is feature-agnostic: it performs zero domain logic (no titles,
 * captions, visibility, publishing). Features only provide a File and receive
 * the resulting (trimmed) File back.
 */

export const VIDEO_MAX_DURATION_SECONDS = 600; // matches backend MAX_VIDEO_DURATION_SECONDS
export const VIDEO_MAX_SIZE_BYTES = 100 * 1024 * 1024; // matches backend UPLOAD_LIMITS.VIDEO
export const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
export const VIDEO_MIN_GAP_SECONDS = 0.5;

/** Format seconds as mm:ss (or h:mm:ss when ≥ 1 hour). */
export function formatVideoTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds >= 0 ? totalSeconds : 0;
  const rounded = Math.round(safe);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Parse "mm:ss", "h:mm:ss" or a bare number of seconds. Returns null if invalid. */
export function parseVideoTimeInput(text: string): number | null {
  const value = (text || '').trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  if (!value.includes(':')) return null;
  const parts = value.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2 && parts[1] >= 0 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] >= 0 && parts[1] < 60 && parts[2] >= 0 && parts[2] < 60) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function clampTime(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidateVideoOptions {
  maxSizeBytes?: number;
  allowedTypes?: Set<string>;
}

/**
 * Synchronous file-level validation for a candidate video. Duration and
 * readability must be checked against real metadata by the editor once the
 * <video> element has loaded (there is no reliable client-side way to probe a
 * file's duration synchronously).
 */
export function validateVideoFile(
  file: File,
  options: ValidateVideoOptions = {}
): string | null {
  const maxSize = options.maxSizeBytes ?? VIDEO_MAX_SIZE_BYTES;
  const allowed = options.allowedTypes ?? ALLOWED_VIDEO_TYPES;
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  const knownMime = allowed.has(file.type);
  const knownExtension = extension === 'mp4' || extension === 'webm';
  if (!knownMime && !knownExtension) {
    return 'Unsupported file type. Please choose an MP4 or WebM video.';
  }
  if (file.size > maxSize) {
    return `This video is larger than the ${maxSize / (1024 * 1024)}MB limit. Please choose a smaller file.`;
  }
  return null;
}

/** Turn a trimmed blob into a plain File named `<original>-trimmed.webm`. */
export function buildTrimmedVideoFile(blob: Blob, originalName: string): File {
  const baseName = (originalName || 'video').replace(/\.[^.]+$/, '') || 'video';
  // MediaRecorder reports codec hints (e.g. "video/webm;codecs=vp9,opus"). Strip
  // them so the uploaded part has a clean, multer-allow-listed base type.
  const mime = normalizeBaseMimeType(blob.type) || 'video/webm';
  return new File([blob], `${baseName}-trimmed.webm`, { type: mime });
}

/** Lowercase, parameter/whitespace-free base MIME (e.g. "video/webm;codecs=vp9" → "video/webm"). */
function normalizeBaseMimeType(value: string): string {
  return String(value || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
}

/**
 * Return a File that is guaranteed to carry a video MIME type accepted by the
 * VANTA backend, regardless of what the browser reported.
 *
 * Browsers/download managers occasionally tag real videos (usually .mp4) as
 * `text/plain`, `application/octet-stream` or empty. The trimmer validates and
 * plays those files fine (video elements sniff magic bytes), but uploading the
 * ORIGINAL file on the no-trim fast path then gets rejected by the backend's
 * multer allow-list. This clones the file with a corrected type so every flow
 * (Reel, Post, Story, Chat, Fundraiser cover) uploads a valid video part.
 */
export function normalizeVideoFileForUpload(file: File): File {
  if (!file) return file;
  const baseType = normalizeBaseMimeType(file.type);
  if (ALLOWED_VIDEO_TYPES.has(baseType)) {
    // Already clean (no codec params / case differences)? Keep the original
    // object. Otherwise clone so the uploaded multipart part has a bare
    // "video/webm" / "video/mp4" — not "video/webm;codecs=vp9,opus".
    const raw = String(file.type || '').toLowerCase().trim();
    return raw === baseType ? file : new File([file], file.name, { type: baseType });
  }

  const extension = (file.name.split('.').pop() || '').toLowerCase();
  const correctedType = extension === 'webm' ? 'video/webm' : 'video/mp4';
  return new File([file], file.name, { type: correctedType });
}

// ============================================================================
// Browser support
// ============================================================================

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // Type checks are advisory — keep probing.
    }
  }
  return '';
}

export interface TrimmingSupport {
  ok: boolean;
  reason?: string;
}

/** Feature-detect everything needed to faithfully re-encode a segment. */
export function getTrimmingSupport(): TrimmingSupport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, reason: 'Media APIs are not available in this context.' };
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      ok: false,
      reason: 'Your browser does not support in-browser video trimming. Try a recent version of Chrome, Edge, Firefox, or Safari.',
    };
  }
  const hasElementCapture =
    typeof HTMLVideoElement !== 'undefined' &&
    ('captureStream' in HTMLVideoElement.prototype || 'mozCaptureStream' in HTMLVideoElement.prototype);
  const hasCanvasCapture = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  if (!hasElementCapture && !hasCanvasCapture) {
    return { ok: false, reason: 'Your browser does not support capturing videos for trimming.' };
  }
  if (!pickRecorderMimeType()) {
    return { ok: false, reason: 'No supported video format could be found for trimming in this browser.' };
  }
  return { ok: true };
}

// ============================================================================
// Low-level video helpers
// ============================================================================

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : time;
    const target = clampTime(time, 0, duration);
    if (Math.abs(video.currentTime - target) < 0.02) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => finish();
    const timer = window.setTimeout(finish, 800);
    video.addEventListener('seeked', onSeeked, { once: true });
    try {
      video.currentTime = target;
    } catch {
      finish();
    }
  });
}

/** Read the duration of a video src (blob or URL). Resolves 0 on failure. */
export function probeDuration(src: string, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(0);
      return;
    }
    const video = document.createElement('video');
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener(
      'loadedmetadata',
      () => {
        cleanup();
        const duration = video.duration;
        resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
      },
      { once: true }
    );
    video.addEventListener(
      'error',
      () => {
        cleanup();
        resolve(0);
      },
      { once: true }
    );
    window.setTimeout(() => {
      if (video.readyState === 0) {
        cleanup();
        resolve(0);
      }
    }, timeoutMs);
    video.src = src;
  });
}

/** Convenience: probe a File's duration from a temporary object URL. */
export function probeVideoFileDuration(file: File, timeoutMs = 10_000): Promise<number> {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(0);
  const url = URL.createObjectURL(file);
  return probeDuration(url, timeoutMs).finally(() => URL.revokeObjectURL(url));
}

/**
 * Generate a filmstrip (single strip of sampled frames) for the timeline.
 * Returns a data URL, or null when the browser cannot seek/draw the source.
 */
export async function generateFilmstrip(
  src: string,
  duration: number,
  frameCount = 9,
  onProgress?: (done: number, total: number) => void
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (safeDuration <= 0) return null;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = src;

  const frameW = 180;
  const frameH = 100;
  const canvas = document.createElement('canvas');
  canvas.width = frameW * frameCount;
  canvas.height = frameH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      const onLoaded = () => resolve();
      const onError = () => reject(new Error('metadata'));
      const timer = window.setTimeout(() => reject(new Error('timeout')), 8000);
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
      window.setTimeout(() => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        clearTimeout(timer);
      }, 8500);
    });

    ctx.fillStyle = '#111113';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < frameCount; i++) {
      const t = (safeDuration * (i + 0.5)) / frameCount;
      await seekTo(video, t);
      ctx.drawImage(video, frameW * i, 0, frameW, frameH);
      onProgress?.(i + 1, frameCount);
    }
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

// ============================================================================
// Core trim engine
// ============================================================================

export interface TrimVideoOptions {
  /** The source <video> element. It should be visible and share-origin (blob URL). */
  video: HTMLVideoElement;
  start: number;
  end: number;
  onProgress?: (percent: number, currentTime: number) => void;
  signal?: AbortSignal;
}

/**
 * Re-encode the [start, end] segment of `video` into a NEW WebM blob that only
 * contains that time range. Runs in real time (segment length ≈ processing
 * time) but produces a truthful, independent file — no timestamp faking, no
 * uploading the full original.
 */
export function trimVideoSegment(options: TrimVideoOptions): Promise<Blob> {
  const { video, start, end, onProgress, signal } = options;

  const support = getTrimmingSupport();
  if (!support.ok) return Promise.reject(new Error(support.reason || 'Trimming is not supported here.'));
  const mimeType = pickRecorderMimeType();
  if (!mimeType) return Promise.reject(new Error('No supported video format found for trimming.'));
  if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
    return Promise.reject(new Error('The selected time range is not valid.'));
  }

  return new Promise<Blob>((resolve, reject) => {
    // ---- Build the capture stream ------------------------------------------------
    let sourceStream: MediaStream;
    let canvas: HTMLCanvasElement | null = null;
    let audioContext: AudioContext | null = null;

    const htmlVideo = video as HTMLVideoElement & {
      mozCaptureStream?: () => MediaStream;
      captureStream?: () => MediaStream;
    };
    if (typeof htmlVideo.captureStream === 'function') {
      sourceStream = htmlVideo.captureStream();
    } else if (typeof htmlVideo.mozCaptureStream === 'function') {
      sourceStream = htmlVideo.mozCaptureStream();
    } else {
      // Fallback: draw frames into a canvas + route the element audio through
      // Web Audio so the recording still carries sound.
      canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const canvasStream = canvas.captureStream(60);
      audioContext = new AudioContext();
      const mediaSource = audioContext.createMediaElementSource(video);
      const audioDestination = audioContext.createMediaStreamDestination();
      mediaSource.connect(audioDestination);
      mediaSource.connect(audioContext.destination);
      sourceStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    }

    if (sourceStream.getVideoTracks().length === 0) {
      sourceStream.getTracks().forEach((track) => track.stop());
      if (audioContext) void audioContext.close().catch(() => undefined);
      reject(new Error('The selected video could not be captured for trimming.'));
      return;
    }

    // ---- Recording --------------------------------------------------------------
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(sourceStream, { mimeType, videoBitsPerSecond: 5_000_000 });
    } catch {
      sourceStream.getTracks().forEach((track) => track.stop());
      if (audioContext) void audioContext.close().catch(() => undefined);
      reject(new Error('The browser could not start recording this video.'));
      return;
    }

    const chunks: BlobPart[] = [];
    let finished = false;
    let canceled = false;
    let raf = 0;
    let completionTimer = 0;

    const stopTracks = () => {
      sourceStream.getTracks().forEach((track) => track.stop());
      if (raf) cancelAnimationFrame(raf);
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
        audioContext = null;
      }
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
        canvas = null;
      }
    };

    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      video.pause();
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // recorder may already be stopping
        }
      }
      stopTracks();
      clearTimeout(completionTimer);
      reject(error);
    };

    const onDataAvailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const onStop = () => {
      if (finished && !canceled) return; // already handled by fail()
      finished = true;
      clearTimeout(completionTimer);
      stopTracks();
      if (canceled) {
        reject(new DOMException('Trimming cancelled', 'AbortError'));
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
      resolve(blob);
    };

    const onError = () => fail(new Error('Recording failed while trimming the selected segment.'));

    completionTimer = window.setTimeout(
      () => fail(new Error('Trimming timed out while processing the selected segment.')),
      Math.max(20_000, (end - start) * 2_500 + 15_000)
    );

    recorder.addEventListener('dataavailable', onDataAvailable);
    recorder.addEventListener('stop', onStop);
    recorder.addEventListener('error', onError);
    signal?.addEventListener(
      'abort',
      () => {
        canceled = true;
        video.pause();
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            // noop
          }
        }
      },
      { once: true }
    );

    // ---- Capture loop -----------------------------------------------------------
    const run = async () => {
      try {
        await seekTo(video, start);
        video.pause();

        // Never capture muted audio: unmute so the output keeps its sound.
        video.muted = false;
        recorder.start(250);

        const tick = () => {
          if (finished || canceled) return;
          if (recorder.state === 'inactive') return;
          const current = video.currentTime;
          if (current >= end) {
            video.pause();
            if (recorder.state === 'recording') recorder.stop();
            return;
          }
          const percent = clampTime(((current - start) / (end - start)) * 100, 0, 100);
          onProgress?.(percent, current);
          raf = window.requestAnimationFrame(tick);
        };

        const draw = () => {
          if (finished || canceled) return;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          raf = window.requestAnimationFrame(draw);
        };

        try {
          await video.play();
        } catch {
          fail(new Error('The browser blocked playback needed for trimming. Tap "Continue" again.'));
          return;
        }
        draw();
        tick();
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Trimming failed unexpectedly.'));
      }
    };

    void run();
  });
}