'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Film, RefreshCw, Scissors, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import {
  VIDEO_MAX_DURATION_SECONDS,
  VIDEO_MAX_SIZE_BYTES,
  VIDEO_MIN_GAP_SECONDS,
  buildTrimmedVideoFile,
  clampTime,
  formatFileSize,
  formatVideoTime,
  generateFilmstrip,
  getTrimmingSupport,
  normalizeVideoFileForUpload,
  probeDuration,
  trimVideoSegment,
  validateVideoFile,
} from '@/lib/videoTrim';
import VideoTrimPlayer from './VideoTrimPlayer';
import VideoTrimTimeline from './VideoTrimTimeline';

type Step = 'edit' | 'processing' | 'review';

/** Everything a feature needs after the user finishes trimming. */
export interface VideoTrimResult {
  /** The final file to upload/publish — the ORIGINAL when nothing is trimmed,
   *  otherwise a brand-new WebM containing only the selected range. */
  file: File;
  /** Duration of the uploaded clip in seconds (probed, or the selection estimate). */
  duration: number;
  /** Duration of the original source in seconds. */
  originalDuration: number;
  /** Selected range start (seconds, relative to the original timeline). */
  trimStart: number;
  /** Selected range end (seconds, relative to the original timeline). */
  trimEnd: number;
  /** Whether a real re-encode happened (false = full-range fast path). */
  isTrimmed: boolean;
}

export interface VideoTrimReviewContext {
  file: File;
  duration: number;
  originalDuration: number;
  trimStart: number;
  trimEnd: number;
  isTrimmed: boolean;
}

interface VideoTrimEditorProps {
  file: File | null;
  onConfirm: (result: VideoTrimResult) => void;
  maxDurationSeconds?: number;
  maxSizeBytes?: number;
  /** Feature-specific fields (caption, description, settings…) shown inside the
   *  review step so each flow keeps its own metadata while sharing the trimmer. */
  reviewExtras?: (context: VideoTrimReviewContext) => React.ReactNode;
  /** Label for the review confirm action. Defaults to "Use this video". */
  confirmLabel?: string;
  /** Label for the primary action in the edit step. Defaults to "Trim & Preview". */
  trimActionLabel?: string;
  className?: string;
}

/**
 * Reusable VANTA video upload + timeline trimming experience.
 *
 * Flow: file → validate → preview → timeline trim → REAL re-encode
 * (captureStream + MediaRecorder → new WebM containing only the selected range)
 * → processing → review → onConfirm({ file, duration, … }).
 *
 * Every VANTA feature that accepts a video (Reel, Post, Story, Chat, Fundraiser
 * cover) renders this same component — no copy-pasted trimming per page.
 */
export default function VideoTrimEditor({
  file,
  onConfirm,
  maxDurationSeconds = VIDEO_MAX_DURATION_SECONDS,
  maxSizeBytes = VIDEO_MAX_SIZE_BYTES,
  reviewExtras,
  confirmLabel = 'Use this video',
  trimActionLabel = 'Trim & Preview',
  className,
}: VideoTrimEditorProps) {
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('edit');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoAspect, setVideoAspect] = useState<number | undefined>(undefined);
  const [isReady, setIsReady] = useState(false);
  const [isPlayerError, setIsPlayerError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [filmstrip, setFilmstrip] = useState<string | null>(null);

  const [trimmedFile, setTrimmedFile] = useState<File | null>(null);
  const [trimmedUrl, setTrimmedUrl] = useState<string | null>(null);
  const [trimmedDuration, setTrimmedDuration] = useState(0);
  const [isTrimmed, setIsTrimmed] = useState(false);
  // Tracks the file currently loaded in the player — the `file` prop is only
  // the initial selection; the "Replace video" action swaps this locally.
  const [activeFile, setActiveFile] = useState<File | null>(file);

  const [processingProgress, setProcessingProgress] = useState(0);
  const [previewMuted, setPreviewMuted] = useState(true);
  const [reviewMuted, setReviewMuted] = useState(true);

  const previewRef = useRef<HTMLVideoElement>(null);
  const reviewRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressRef = useRef(0);
  const filmstripCacheRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const trimmedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    objectUrlRef.current = objectUrl;
  }, [objectUrl]);

  useEffect(() => {
    trimmedUrlRef.current = trimmedUrl;
  }, [trimmedUrl]);

  // ---- Loading / replacing the source file --------------------------------

  const resetSelection = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setTrimmedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDuration(0);
    setVideoAspect(undefined);
    setIsReady(false);
    setIsPlayerError(false);
    setError(null);
    setTrimStart(0);
    setTrimEnd(0);
    setPlayhead(0);
    setFilmstrip(null);
    setTrimmedFile(null);
    setTrimmedDuration(0);
    setIsTrimmed(false);
    setProcessingProgress(0);
    lastProgressRef.current = 0;
    filmstripCacheRef.current = null;
    setStep('edit');
  }, []);

  // New file (or replace) → drop the previous selection, load the new one.
  useEffect(() => {
    resetSelection();
    setActiveFile(file);
    if (!file) {
      setStep('edit');
      return;
    }
    const validation = validateVideoFile(file, { maxSizeBytes });
    if (validation) {
      setError(validation);
      setStep('edit');
      return;
    }
    setObjectUrl(URL.createObjectURL(file));
    // Stay on the edit step: the player mounts immediately, loads metadata and
    // shows its own "Preparing preview…" overlay until it's ready.
    setStep('edit');
  }, [file, maxSizeBytes, resetSelection]);

  // Cleanup URLs once when unmounting.
  useEffect(() => {
    return () => {
      // Abort any in-progress trim the moment the editor leaves the screen
      // (modal close/backdrop/Escape during processing).
      abortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (trimmedUrlRef.current && trimmedUrlRef.current !== objectUrlRef.current) {
        URL.revokeObjectURL(trimmedUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setFilmstrip(null);
    filmstripCacheRef.current = null;
  }, [objectUrl]);

  // ---- Validation ----------------------------------------------------------

  const canContinue =
    isReady && !isPlayerError && !error && duration > 0 && trimEnd - trimStart >= VIDEO_MIN_GAP_SECONDS;

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const candidate = event.target.files?.[0];
    event.target.value = '';
    if (!candidate) return;
    // Full reset: drop the previous selection, timeline, trim range and any
    // processed clip, then load the new video's metadata and preview.
    resetSelection();
    setActiveFile(candidate);
    const validation = validateVideoFile(candidate, { maxSizeBytes });
    if (validation) {
      setError(validation);
      setStep('edit');
      return;
    }
    setObjectUrl(URL.createObjectURL(candidate));
    setStep('edit');
  };

  // ---- Metadata & playback -----------------------------------------------

  const handleMetadataLoaded = () => {
    const video = previewRef.current;
    if (!video || !objectUrl) return;
    const detected = video.duration;
    if (!Number.isFinite(detected) || detected <= 0) {
      setIsReady(false);
      setIsPlayerError(true);
      setError('We could not read this video. It may be corrupted or in an unsupported format.');
      return;
    }
    if (detected > maxDurationSeconds) {
      setIsReady(false);
      setIsPlayerError(true);
      setError(
        `Videos are limited to ${Math.floor(maxDurationSeconds / 60)} minutes. This one is ${formatVideoTime(detected)} long.`
      );
      return;
    }
    setDuration(detected);
    setTrimStart(0);
    setTrimEnd(detected);
    setPlayhead(0);
    const w = video.videoWidth;
    const h = video.videoHeight;
    setVideoAspect(w && h ? w / h : undefined);
    setIsReady(true);
    // A real source loaded successfully — clear any transient error state.
    setIsPlayerError(false);
    setError(null);

    if (filmstripCacheRef.current !== objectUrl) {
      const url = objectUrl;
      filmstripCacheRef.current = url;
      setFilmstrip(null);
      void generateFilmstrip(url, detected).then((strip) => {
        if (filmstripCacheRef.current === url) setFilmstrip(strip);
      });
    }
  };

  const handlePreviewError = useCallback(() => {
    setIsReady(false);
    setIsPlayerError(true);
    setError('This video could not be read. It may be corrupted, damaged, or in an unsupported format.');
  }, []);

  const handleReviewError = useCallback(() => {
    setError('The trimmed video could not be played. Please trim again.');
  }, []);

  const handleRangeChange = useCallback((nextStart: number, nextEnd: number) => {
    setTrimStart(nextStart);
    setTrimEnd(nextEnd);
    const video = previewRef.current;
    if (video) {
      if (video.currentTime < nextStart) video.currentTime = nextStart;
      else if (video.currentTime > nextEnd) video.currentTime = nextEnd;
      setPlayhead(video.currentTime);
    }
  }, []);

  const handleSeek = useCallback(
    (time: number) => {
      const video = previewRef.current;
      if (!video) return;
      video.currentTime = clampTime(time, 0, duration || 0);
      setPlayhead(video.currentTime);
    },
    [duration]
  );

  // Correct playback position into the selected range whenever a play is
  // requested from the UI (button or tapping the preview).
  const handlePlayPress = useCallback(() => {
    const video = previewRef.current;
    if (!video || !isReady) return;
    if (video.currentTime < trimStart - 0.05 || video.currentTime >= trimEnd) {
      video.currentTime = trimStart;
      setPlayhead(trimStart);
    }
  }, [isReady, trimStart, trimEnd]);

  const handleTimeUpdate = useCallback(() => {
    const video = previewRef.current;
    if (!video) return;
    setPlayhead(video.currentTime);
    if (step === 'edit' && video.currentTime >= trimEnd) {
      video.pause();
    }
  }, [step, trimEnd]);

  // ---- Trim & capture ------------------------------------------------------

  const runCapture = useCallback(
    async (signal: AbortSignal) => {
      const video = previewRef.current;
      if (!video || !activeFile) {
        setStep('edit');
        setError('The preview player is not ready yet.');
        return;
      }
      try {
        const blob = await trimVideoSegment({
          video,
          start: trimStart,
          end: trimEnd,
          signal,
          onProgress: (percent) => {
            const rounded = Math.round(percent);
            if (rounded !== lastProgressRef.current) {
              lastProgressRef.current = rounded;
              setProcessingProgress(rounded);
            }
          },
        });
        const trimmedFile = buildTrimmedVideoFile(blob, activeFile.name);
        const url = URL.createObjectURL(trimmedFile);
        let outDuration = trimEnd - trimStart;
        try {
          const probed = await probeDuration(url);
          if (probed > 0) outDuration = probed;
        } catch {
          // keep the selection estimate
        }
        setTrimmedFile(trimmedFile);
        setTrimmedUrl(url);
        setTrimmedDuration(outDuration);
        setIsTrimmed(true);
        lastProgressRef.current = 0;
        setProcessingProgress(100);
        setError(null);
        setStep('review');
      } catch (error) {
        lastProgressRef.current = 0;
        const message = error instanceof Error ? error.message : 'The selected segment could not be processed.';
        if (error instanceof DOMException && error.name === 'AbortError') {
          setError(null);
          showToast?.({ type: 'info', title: 'Trimming cancelled', message: 'You can adjust the selection and try again.' });
        } else {
          showToast?.({ type: 'error', title: 'Trimming failed', message });
          setError(message);
        }
        setStep('edit');
      }
    },
    [trimStart, trimEnd, activeFile, showToast]
  );

  const handleContinue = useCallback(() => {
    setError(null);
    if (!canContinue || !activeFile || !objectUrl) return;
    const support = getTrimmingSupport();
    if (!support.ok) {
      setError(support.reason || 'Trimming is not supported in this browser.');
      return;
    }
    const isFullRange = trimStart <= 0.05 && trimEnd >= (duration || 0) - 0.05;
    if (isFullRange || duration <= VIDEO_MIN_GAP_SECONDS) {
      // The original already represents the entire timeline — publish as-is.
      setTrimmedFile(activeFile);
      setTrimmedUrl(objectUrl);
      setTrimmedDuration(duration);
      setIsTrimmed(false);
      setError(null);
      setStep('review');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastProgressRef.current = 0;
    setStep('processing');
    setProcessingProgress(0);
    void runCapture(controller.signal);
  }, [canContinue, activeFile, objectUrl, trimStart, trimEnd, duration, runCapture]);

  const handleCancelProcessing = useCallback(() => {
    setError(null);
    abortRef.current?.abort();
  }, []);

  // ---- Navigation ----------------------------------------------------------

  const handleBackFromReview = useCallback(() => {
    setStep('edit');
    setTrimmedFile(null);
    setTrimmedUrl((prev) => {
      if (prev && prev !== objectUrlRef.current) URL.revokeObjectURL(prev);
      return null;
    });
    setTrimmedDuration(0);
    setIsTrimmed(false);
    setError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!trimmedFile || !activeFile) return;
    // Guarantee a valid video MIME type. Some browsers report real .mp4/.webm
    // files as "text/plain" or empty (downloads / certain sources); uploading
    // those raw parts is what produced the backend "File type text/plain is not
    // allowed" rejection on the no-trim fast path.
    const uploadFile = normalizeVideoFileForUpload(trimmedFile);
    onConfirm({
      file: uploadFile,
      duration: trimmedDuration || Math.max(0, trimEnd - trimStart),
      originalDuration: duration,
      trimStart,
      trimEnd,
      isTrimmed,
    });
  }, [trimmedFile, activeFile, trimmedDuration, trimStart, trimEnd, duration, isTrimmed, onConfirm]);

  const reviewContext: VideoTrimReviewContext = {
    // `activeFile` is provably non-null here (the render returns null without
    // it), but TS can't narrow it inside the hook body — hence the assertion.
    file: normalizeVideoFileForUpload((trimmedFile ?? activeFile)!),
    duration: trimmedDuration || Math.max(0, trimEnd - trimStart),
    originalDuration: duration,
    trimStart,
    trimEnd,
    isTrimmed,
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!activeFile) return null;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="sr-only"
        aria-hidden="true"
        onChange={handleFileInput}
      />

      {/* ---- Edit (preview + timeline) / Processing --------------------------- */}
      {(step === 'edit' || step === 'processing') && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* The player only mounts once a blob URL exists — an empty src would
              fire onError in some browsers and look like a stuck loading state. */}
          {objectUrl && (
          <VideoTrimPlayer
            src={objectUrl}
            videoRef={previewRef}
            aspect={videoAspect}
            muted={previewMuted}
            onMutedChange={setPreviewMuted}
            onLoadedMetadata={handleMetadataLoaded}
            onError={handlePreviewError}
            onTimeUpdate={handleTimeUpdate}
            onPlayPress={handlePlayPress}
            loading={!isReady && !isPlayerError}
            controlsHidden={step === 'processing'}
            captureMode={step === 'processing'}
            overlay={
              step === 'processing' ? (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]">
                  <span className="absolute left-1/2 top-3 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500/90 px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                    Recording {formatVideoTime(trimStart)} → {formatVideoTime(trimEnd)}
                  </span>
                </div>
              ) : null
            }
            className="mx-auto"
          />
          )}

          <AnimatePresence mode="wait" initial={false}>
            {step === 'edit' ? (
              <motion.div
                key="edit"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* File info */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Film size={13} className="shrink-0 text-[#b8b8b8]" />
                    <span className="max-w-[220px] truncate">{activeFile.name}</span>
                  </span>
                  <span>{formatFileSize(activeFile.size)}</span>
                  {duration > 0 && <span>Duration {formatVideoTime(duration)}</span>}
                </div>

                {/* Errors */}
                {error && (
                  <div className="mt-3 w-full text-left">
                    <div className="form-error flex items-center justify-between gap-3">
                      <span className="min-w-0">{error}</span>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--vanta-gold-bright)] hover:underline"
                      >
                        <RefreshCw size={11} /> Replace
                      </button>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                {isReady && !isPlayerError && !error && (
                  <VideoTrimTimeline
                    duration={duration}
                    start={trimStart}
                    end={trimEnd}
                    currentTime={playhead}
                    filmstrip={filmstrip}
                    onRangeChange={handleRangeChange}
                    onSeek={handleSeek}
                    className="mt-4"
                  />
                )}

                {/* Edit footer actions */}
                <div className="mt-auto flex shrink-0 items-center gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-ghost min-h-11 shrink-0 px-4"
                  >
                    Replace Video
                  </button>
                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={!canContinue}
                    className="btn-gold min-h-11 flex-1"
                  >
                    <Scissors size={15} />
                    {trimActionLabel}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-left">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#c9a227]/15 text-[#dfbd55]">
                      <Scissors size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">Trimming your video…</p>
                      <p className="mt-0.5 text-xs text-white/45">
                        Keeps only the selected {formatVideoTime(trimStart)} → {formatVideoTime(trimEnd)} range.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#c9a227] to-[#dfbd55]"
                      style={{ width: `${Math.min(100, Math.max(0, processingProgress))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-white/40">
                    <span>{Math.min(100, processingProgress)}%</span>
                    <span>≈ {formatVideoTime((trimEnd - trimStart) * (1 - processingProgress / 100))} remaining</span>
                  </div>

                  <button type="button" onClick={handleCancelProcessing} className="btn-ghost mt-3 w-full">
                    Cancel trimming
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ---- Review ----------------------------------------------------------- */}
      {step === 'review' && (
        <motion.div
          key="review"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {trimmedUrl && (
            <VideoTrimPlayer
              key={trimmedUrl}
              src={trimmedUrl}
              videoRef={reviewRef}
              aspect={videoAspect}
              muted={reviewMuted}
              onMutedChange={setReviewMuted}
              onError={handleReviewError}
              className="mx-auto"
              loading={!trimmedDuration}
            />
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/40">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Check size={13} /> {reviewContext.isTrimmed ? 'Trimmed' : 'Full video'}
            </span>
            <span className="text-white/20">•</span>
            <span className="tabular-nums">
              {reviewContext.isTrimmed
                ? `Selected ${formatVideoTime(reviewContext.trimStart)} → ${formatVideoTime(reviewContext.trimEnd)}`
                : 'No trimming needed'}
            </span>
            <span className="text-white/20">•</span>
            <span className="tabular-nums">Final duration {formatVideoTime(reviewContext.duration)}</span>
          </div>

          {error && <div className="form-error mt-3 text-left">{error}</div>}

          {reviewExtras && (
            <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-left">
              {reviewExtras(reviewContext)}
            </div>
          )}

          <div className="mt-auto flex shrink-0 items-center gap-2 pt-4">
            <button type="button" onClick={handleBackFromReview} className="btn-secondary min-h-11 shrink-0 px-4">
              Back / Edit
            </button>
            <button type="button" onClick={handleConfirm} className="btn-gold min-h-11 flex-1">
              <Upload size={15} />
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}