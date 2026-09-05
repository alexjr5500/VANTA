'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// CHAT MEDIA PLAYERS — compact voice notes + video messages.
//
// One shared component system is used by BOTH sent and received messages so
// every media bubble looks and behaves identically inside the existing VANTA
// chat bubbles:
//   - VoiceNotePlayer       → small inline voice-note player
//     (play/pause, waveform/progress, elapsed + total time)
//   - VideoMessagePreview   → compact aspect-preserving preview inside the bubble
//   - VideoFullscreenPlayer → tap-to-open full-screen viewer with autoplay
// ============================================================================

const formatVoiceTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const safe = Math.floor(seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Deterministic waveform used by every voice note. A small fixed shape keeps
 * the notes compact and consistent without paying for audio analysis on every
 * message — the played portion is simply filled with the gold accent.
 */
const VOICE_WAVE_BARS = [
  34, 58, 42, 72, 50, 38, 64, 80, 46, 62, 36, 70, 54, 30, 60, 68, 44, 52, 76, 40, 66, 34, 56, 48, 72, 38, 58, 64, 42, 74,
];

export interface ChatMediaAttachment {
  url: string;
  fileType: string;
  fileName?: string;
}

/** Compact inline voice-note player used for AUDIO message attachments. */
export function VoiceNotePlayer({ src, name }: { src: string; name?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const label = isPlaying ? 'Pause voice note' : `Play voice note${name ? `: ${name.replace(/\.[a-z0-9]+$/i, '')}` : ''}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration); };
    const onEnd = () => { setIsPlaying(false); setProgress(0); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const activeBars = duration > 0 ? Math.round((progress / duration) * VOICE_WAVE_BARS.length) : 0;

  return (
    <div className="flex w-full max-w-[212px] select-none items-center gap-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={label}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#d6a83f]/15 text-[#f2c75c] transition hover:bg-[#d6a83f]/25 active:scale-90"
      >
        {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        {/* Waveform / progress indicator */}
        <div className="flex h-[20px] items-center gap-[2px]" aria-hidden="true">
          {VOICE_WAVE_BARS.map((bar, index) => (
            <span
              key={index}
              className={cn(
                'w-[2.5px] rounded-full transition-colors duration-150',
                index < activeBars ? 'bg-[#d6a83f]' : 'bg-white/[0.14]'
              )}
              style={{ height: `${bar}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[9px] leading-none">
          <span className={cn('tabular-nums', isPlaying ? 'text-[#f2c75c]' : 'text-white/45')}>
            {formatVoiceTime(progress)}
          </span>
          {duration > 0 && <span className="tabular-nums text-white/25">{formatVoiceTime(duration)}</span>}
        </div>
      </div>
    </div>
  );
}
// ============================================================================
// VIDEO MESSAGE PREVIEW — small, clean, aspect-preserving preview in Chat.
// ============================================================================

const PREVIEW_MAX_WIDTH = 288;
const PREVIEW_MAX_HEIGHT = 232;

/**
 * Compact video preview inside a chat bubble. The display size is computed from
 * the video's real dimensions as soon as metadata is ready (and a sensible
 * default is used before that) so media never distorts, overflows the chat or
 * jumps the layout while it loads. Tapping opens the full-screen player.
 */
export function VideoMessagePreview({
  attachment,
  onOpen,
}: {
  attachment: ChatMediaAttachment;
  onOpen: (_attachment: ChatMediaAttachment) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) setDims({ w, h });
    };
    const onDuration = () => { if (Number.isFinite(video.duration)) setDuration(video.duration); };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('loadedmetadata', onDuration);
    video.addEventListener('durationchange', onDuration);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('loadedmetadata', onDuration);
      video.removeEventListener('durationchange', onDuration);
    };
  }, []);

  // Pick the largest size that fits both constraints while preserving aspect.
  const ratio = dims && dims.h > 0 ? dims.w / dims.h : 16 / 9;
  const boxWidth = Math.round(Math.min(PREVIEW_MAX_WIDTH, ratio * PREVIEW_MAX_HEIGHT));
  const boxHeight = Math.round(Math.min(PREVIEW_MAX_HEIGHT, PREVIEW_MAX_WIDTH / ratio));

  return (
    <button
      type="button"
      onClick={() => onOpen(attachment)}
      aria-label={`Open ${attachment.fileName || 'video'} in full screen`}
      className="group relative block overflow-hidden rounded-[15px] border border-white/[0.06] bg-black text-left shadow-[0_8px_20px_rgba(0,0,0,.28)] transition hover:border-white/[0.12]"
      style={{ width: `${boxWidth}px`, maxWidth: '100%', height: `${boxHeight}px` }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={attachment.url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
      />
      {/* Centered play affordance */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-[2px] transition group-hover:bg-black/75 group-hover:scale-105">
          <Play size={16} className="ml-0.5 fill-current" />
        </span>
      </span>
      {/* Duration badge */}
      {duration > 0 && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-white backdrop-blur-[1px]">
          {formatVoiceTime(duration)}
        </span>
      )}
    </button>
  );
}

// ============================================================================
// FULL-SCREEN VIDEO VIEWER — tap a preview to open this immediately.
// ============================================================================

/**
 * Full-screen video viewer. Mounting it opens instantly over the chat, starts
 * playback automatically and keeps the video centered with its original aspect
 * ratio. Closing returns straight to the same chat position.
 */
export function VideoFullscreenPlayer({
  attachment,
  onClose,
}: {
  attachment: ChatMediaAttachment;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    const attemptPlay = () => {
      if (!cancelled && video) video.play().catch(() => undefined);
    };
    if (video) {
      video.addEventListener('loadedmetadata', attemptPlay);
      attemptPlay();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      if (video) {
        video.removeEventListener('loadedmetadata', attemptPlay);
        video.pause();
      }
    };
  }, [attachment.url]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.fileName || 'Video player'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[100] flex h-[var(--chat-viewport-height,100dvh)] w-screen flex-col overflow-hidden bg-black"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute left-3 top-[max(12px,env(safe-area-inset-top))] z-10 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/75 active:scale-90"
        aria-label="Close video player"
      >
        <ArrowLeft size={19} />
      </button>
      <div className="flex min-h-0 flex-1 items-center justify-center px-1 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={attachment.url}
          autoPlay
          playsInline
          controls
          controlsList="nodownload"
          disablePictureInPicture
          preload="auto"
          className="max-h-full max-w-full object-contain shadow-2xl"
        />
      </div>
    </motion.div>
  );
}