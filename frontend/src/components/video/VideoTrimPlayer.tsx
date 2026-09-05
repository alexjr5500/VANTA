'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatVideoTime } from '@/lib/videoTrim';

interface VideoTrimPlayerProps {
  src: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  aspect?: number;
  muted: boolean;
  onMutedChange?: (muted: boolean) => void;
  onLoadedMetadata?: () => void;
  onError?: () => void;
  onTimeUpdate?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  /** Hook called right before an explicit play toggle; used to seek playback
   *  back into the selected trim range when it drifted outside of it. */
  onPlayPress?: () => void;
  overlay?: React.ReactNode;
  controlsHidden?: boolean;
  /** While true the player never touches element.muted so an active
   *  MediaRecorder capture (which must be un-muted to record audio) cannot be
   *  re-muted by a re-render. */
  captureMode?: boolean;
  loading?: boolean;
  className?: string;
}

/**
 * Shared VANTA video preview/review player used by the reusable trim editor
 * (and therefore every video upload flow).
 */
export default function VideoTrimPlayer({
  src,
  videoRef,
  aspect,
  muted,
  onMutedChange,
  onLoadedMetadata,
  onError,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
  onPlayPress,
  overlay,
  controlsHidden = false,
  captureMode = false,
  loading = false,
  className,
}: VideoTrimPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Set mute through the element property (never the JSX attribute) so an
  // unrelated re-render during trimming cannot re-mute the capture source.
  useEffect(() => {
    const video = videoRef.current;
    if (video && !captureMode) video.muted = muted;
  }, [muted, videoRef, captureMode]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || controlsHidden) return;
    if (video.paused) {
      onPlayPress?.();
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    if (!controlsHidden) onMutedChange?.(!muted);
  };

  const enterFullscreen = () => {
    void containerRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  // Vertical videos keep a phone-like, height-capped column so the modal stays
  // manageable while preserving the source's aspect ratio.
  const maxWidth = aspect && aspect <= 1 ? 'min(100%, 300px)' : 'min(100%, 520px)';

  return (
    <div className={cn('mx-auto w-full', className)} style={{ maxWidth }}>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-black"
        style={{
          aspectRatio: aspect && aspect > 0 ? String(aspect) : undefined,
          minHeight: aspect && aspect > 0 ? undefined : 200,
        }}
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src={src}
          preload="auto"
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          onLoadedMetadata={() => {
            const video = videoRef.current;
            setDuration(video?.duration || 0);
            onLoadedMetadata?.();
          }}
          onError={onError}
          onTimeUpdate={() => {
            setCurrent(videoRef.current?.currentTime || 0);
            onTimeUpdate?.();
          }}
          onPlay={() => {
            setPlaying(true);
            onPlay?.();
          }}
          onPause={() => {
            setPlaying(false);
            onPause?.();
          }}
          onEnded={() => {
            setPlaying(false);
            onEnded?.();
          }}
        />

        {loading && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-white/40">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-xs">Preparing preview…</span>
            </div>
          </div>
        )}

        {overlay}

        {!controlsHidden && (
          <div
            className="relative flex items-center gap-1 border-t border-white/[0.06] bg-white/[0.03] px-2 py-1.5"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={togglePlay}
              className="grid h-8 w-8 place-items-center rounded-lg text-white transition hover:bg-white/[0.08] active:scale-90"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/[0.08] hover:text-white active:scale-90"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <span className="ml-1 text-[11px] tabular-nums text-white/60">
              {formatVideoTime(current)} <span className="text-white/30">/ {formatVideoTime(duration)}</span>
            </span>
            <button
              type="button"
              onClick={enterFullscreen}
              className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/[0.08] hover:text-white active:scale-90"
              aria-label="Fullscreen"
            >
              <Maximize size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}