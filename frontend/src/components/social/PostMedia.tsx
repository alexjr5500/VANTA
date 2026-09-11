'use client';

import { useEffect, useRef, useState } from 'react';
import { Video, Volume2, VolumeX } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/mediaUrl';

/**
 * PostMedia
 * ---------
 * Shared, reusable post media renderer for VANTA.
 *
 * The VANTA principle for post content is:
 *
 *   "Fit the content to the post — don't crop the content to fit the post."
 *
 * Every image / video rendered through this component keeps its FULL content
 * visible and preserves its ORIGINAL aspect ratio. We never force a fixed
 * browser box (no `aspect-[9/16]` trap), never use `object-fit: cover`, and
 * never crop edges. The media is letterboxed with `object-contain` inside a
 * RESPONSIVE container that grows to the media's natural proportions but is
 * capped with sensible maximum dimensions so it never destroys the feed or
 * page layout.
 *
 * This guarantees consistent behaviour across Home, Profile, Post detail,
 * search/discovery, feeds and any modal/viewer that uses the normal post
 * component.
 */

type PostMediaProps = {
  /** Resolved or raw media URL (image or video). */
  src: string;
  /** Video poster frame. */
  poster?: string;
  /** Accessible label. */
  alt: string;
  /** True when the source is a video (reel / video post). */
  isVideo?: boolean;
  /** Preload the video (default: metadata). */
  preload?: 'none' | 'metadata' | 'auto';
  /** Called when the media is double-clicked (e.g. toggle like). */
  onDoubleClick?: () => void;
  /** Autoplay the video while it is on screen (default true). */
  autoplayOnView?: boolean;
  /** Start muted (default true). */
  defaultMuted?: boolean;
  /** Whether to render the mute toggle (default true for video). */
  showMute?: boolean;
  /** Whether to render the centered play affordance (default true for video). */
  showPlay?: boolean;
  /** Extra className for the underlying media element. */
  className?: string;
};

/** Regex used to tell video sources apart from plain images. */
export const isVideoSource = (src: string) =>
  /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(src);

export default function PostMedia({
  src,
  poster,
  alt,
  isVideo,
  preload = 'metadata',
  onDoubleClick,
  autoplayOnView = true,
  defaultMuted = true,
  showMute = true,
  showPlay = true,
  className,
}: PostMediaProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(defaultMuted);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const resolved = resolveMediaUrl(src);
  const video = isVideo ?? (resolved ? isVideoSource(resolved) : false);

  // Autoplay/pause the video while it is sufficiently on screen.
  useEffect(() => {
    if (!video || !autoplayOnView) return;
    const frame = frameRef.current;
    const element = videoRef.current;
    if (!frame || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
          void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          element.pause();
          setPlaying(false);
        }
      },
      { threshold: [0, 0.65, 1] },
    );
    observer.observe(frame);
    return () => {
      observer.disconnect();
      element.pause();
    };
  }, [video, autoplayOnView]);

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play();
      setPlaying(true);
    } else {
      element.pause();
      setPlaying(false);
    }
  };

  if (!resolved) return null;

  if (video) {
    return (
      <div
        ref={frameRef}
        className="relative mx-auto w-full bg-black"
      >
        <video
          ref={videoRef}
          src={resolved}
          poster={poster ? resolveMediaUrl(poster) : undefined}
          muted={muted}
          loop
          playsInline
          preload={preload}
          onClick={togglePlay}
          onDoubleClick={onDoubleClick}
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            setProgress(element.duration ? (element.currentTime / element.duration) * 100 : 0);
          }}
          className={`block h-auto max-h-[min(76dvh,820px)] w-full object-contain ${className ?? ''}`}
          aria-label={alt}
        />
        {showPlay && !playing && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play video"
            className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur"
          >
            <Video size={22} />
          </button>
        )}
        {showMute && (
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white backdrop-blur"
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/15">
          <div className="h-full bg-[#f5f5f5]" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  // Plain image: full content, original proportions, responsive max-height.
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      onDoubleClick={onDoubleClick}
      className={`mx-auto block h-auto max-h-[min(76dvh,820px)] w-full object-contain ${className ?? ''}`}
    />
  );
}