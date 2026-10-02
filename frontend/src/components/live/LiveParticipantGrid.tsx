'use client';

/**
 * LiveParticipantGrid
 * -------------------
 * Responsive live-stage layout for 1–5 participants (host + up to 4 guests).
 * PORTRAIT-FIRST: the phone stays upright, the host is always visually
 * prioritized:
 *  - 1 person  → host fills the screen (full camera field of view, contained)
 *  - 2 people  → host and guest split the available height 50/50 (stacked)
 *  - 3 people  → host on top (larger), 2 guests side by side below
 *  - 4 people  → host on top, 3 guests below (2 + 1 full-width)
 *  - 5 people  → host on top, 4 guests in a 2×2 grid below
 * On landscape screens (md+) the host moves to the left and guests flow right.
 *
 * Sizes are flex/grid fractions of the AVAILABLE viewport (no fixed heights)
 * so the stage can never overflow a portrait screen. The solo full-bleed tile
 * renders its video `object-contain` (full camera FOV — head/shoulders and
 * surroundings) over a blurred full-bleed backdrop; grid tiles use
 * `object-cover object-center` so no face is stretched. Video <video>
 * elements are keyed by participant id and their MediaStream is debounced into
 * stable instances, so chat/event ticks never restart a playing tile.
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';
import { MicOff, VideoOff } from 'lucide-react';
import { stageLayoutFor } from './liveStageLayout';

export interface StageParticipant {
  id: string;
  username: string;
  avatar?: string | null;
  verified?: boolean;
  verificationType?: VerificationType | null;
  isHost?: boolean;
  stream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  /**
   * True when this tile plays a participant's OWN media (self view). Self
   * monitors stay muted so a host/guest never hears their own mic echo.
   * Remote participants default to audible — their real audio track is
   * attached to the tile element as part of `stream` (Task 4/5).
   */
  muted?: boolean;
}

function StageVideo({ stream, muted = false, fit = 'cover' }: { stream: MediaStream | null; muted?: boolean; fit?: 'cover' | 'contain' }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!stream) {
      video.pause();
      if (video.srcObject) video.srcObject = null;
      return;
    }
    // Only re-attach when the stream object itself changed (participants are
    // debounced into stable MediaStreams by LiveParticipantGrid), so event
    // ticks/chat updates never restart a playing video/audio pipe.
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = muted;
    video.play().catch(() => undefined);
  }, [stream, muted]);
  useEffect(() => {
    // The full-bleed blurred backdrop duplicates the same source. `object-cover`
    // + blur fills the whole viewport so the contained primary copy never shows
    // black bars. It is ALWAYS muted — only the primary layer is audible.
    const back = backdropRef.current;
    if (!back) return;
    if (!stream) {
      back.pause();
      if (back.srcObject) back.srcObject = null;
      return;
    }
    if (back.srcObject !== stream) back.srcObject = stream;
    back.muted = true;
    back.play().catch(() => undefined);
  }, [stream]);
  useEffect(() => {
    // Browsers may defer audible autoplay until the first user interaction.
    // Retry the same way the Reels feed does: as soon as the user touches/keys
    // the page, any deferred remote audio starts.
    const retry = () => {
      const video = videoRef.current;
      if (video && stream && !document.hidden) void video.play().catch(() => undefined);
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('touchstart', retry);
    window.addEventListener('keydown', retry);
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('touchstart', retry);
      window.removeEventListener('keydown', retry);
    };
  }, [stream, muted]);
  return (
    <>
      {fit === 'contain' && stream && (
        // Full-bleed ambient backdrop (kept muted) behind the contained copy.
        <video
          ref={backdropRef}
          playsInline
          autoPlay
          muted
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-[16px]"
        />
      )}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted={muted}
        className={
          fit === 'contain'
            // Contain shows the FULL camera field of view (head, shoulders and
            // surrounding frame) instead of a tight `cover` face crop when the
            // stage is taller/narrower than the 16:9 camera source — the camera
            // itself was never zoomed.
            ? 'relative z-[1] h-full w-full object-contain'
            : 'relative z-[1] h-full w-full object-cover object-center'
        }
        aria-label="Live stage participant"
      />
    </>
  );
}

function Tile({ p, className, showCameraOff, fit = 'cover' }: { p: StageParticipant; className?: string; showCameraOff?: boolean; fit?: 'cover' | 'contain' }) {
  const noVideo = !p.stream || !p.cameraOn;
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-[#0D0D0F]', className)}>
      {/* Remote media (video + audio) attached via srcObject. When a guest only
          publishes audio (camera disabled), the tile still routes their mic
          through this element — an avatar overlays the black video surface. */}
      {p.stream && (
        <div className="absolute inset-0">
          <StageVideo stream={p.stream} muted={p.muted === true} fit={fit} />
        </div>
      )}
      {noVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar src={p.avatar} alt={p.username} size="lg" />
        </div>
      )}

      {/* Status + identity chrome */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
        <span className="flex min-w-0 items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <span className="shrink-0 font-semibold">{p.username}</span>
          {p.verified && p.verificationType && <VerificationBadge type={p.verificationType} size="xs" />}
          {p.isHost && <span className="ml-0.5 rounded bg-[#D6A83F]/25 px-1 text-[9px] font-bold uppercase tracking-wide text-[#F2C75C]">Host</span>}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {!p.micOn && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-black/60" title="Muted">
              <MicOff size={11} />
            </span>
          )}
          {noVideo && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-black/60" title="Camera off">
              <VideoOff size={11} />
            </span>
          )}
        </span>
      </div>
      {showCameraOff && noVideo && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/70">Camera off</span>}
    </div>
  );
}

export default function LiveParticipantGrid({ participants }: { participants: StageParticipant[] }) {
  const tiles = participants.length > 0 ? participants : [];
  const layout = stageLayoutFor(tiles.length);

  // Participants are re-built into fresh MediaStreams on every subscription
  // tick, which would tear down and restart each tile's video/audio pipe on
  // every unrelated event. Debounce them here: the same MediaStream (same
  // underlying browser track instances) is reused across ticks so playback is
  // never interrupted; a genuinely new track (re-subscribe / new mic) produces
  // a fresh MediaStream automatically.
  const streamCache = useRef(new Map<string, { signature: string; stream: MediaStream }>());
  const stabilize = (id: string, stream: MediaStream | null): MediaStream | null => {
    if (!stream) {
      streamCache.current.delete(id);
      return null;
    }
    const signature = stream.getTracks().map((t) => t.id ?? t).join('::');
    const cached = streamCache.current.get(id);
    if (cached && cached.signature === signature) return cached.stream;
    streamCache.current.set(id, { signature, stream });
    return stream;
  };

  const tileFor = (p: StageParticipant, className: string, options?: { fit?: 'cover' | 'contain'; span?: boolean }) => (
    <Tile
      key={p.id}
      className={cn(className, options?.span ? layout.guestSpanClass : undefined)}
      p={{ ...p, stream: stabilize(p.id, p.stream) }}
      fit={options?.fit ?? 'cover'}
    />
  );

  return (
    <div className={layout.containerClass}>
      {layout.arrangement === 'solo' && tiles.length === 1 && (
        <Tile fit="contain" className={layout.hostTileClass} p={{ ...tiles[0], stream: stabilize(tiles[0].id, tiles[0].stream) }} />
      )}

      {layout.arrangement === 'split' && tiles.length === 2 && (
        <>
          <Tile className={layout.hostTileClass} p={{ ...tiles[0], stream: stabilize(tiles[0].id, tiles[0].stream) }} />
          <Tile className={layout.guestTileClass} p={{ ...tiles[1], stream: stabilize(tiles[1].id, tiles[1].stream) }} />
        </>
      )}

      {layout.arrangement === 'host-col' && (tiles.length === 3 || tiles.length === 4) && (
        <>
          {/* Host: top (full width) on portrait, left column on landscape */}
          <div className={layout.hostWrapperClass}>
            <Tile className={layout.hostTileClass} p={{ ...tiles[0], stream: stabilize(tiles[0].id, tiles[0].stream) }} />
          </div>
          <div className={layout.guestAreaClass}>
            {tiles.slice(1).map((p, index) => (
              tileFor(p, layout.guestTileClass, {
                // 4 participants = 3 guests in a 2-col portrait grid: the last
                // guest spans the full row instead of leaving a dead cell.
                span: layout.guestSpanClass !== undefined && tiles.length === 4 && index === tiles.length - 2,
              })
            ))}
          </div>
        </>
      )}

      {layout.arrangement === 'host-col-grid' && tiles.length === 5 && (
        <>
          <div className={layout.hostWrapperClass}>
            <Tile className={layout.hostTileClass} p={{ ...tiles[0], stream: stabilize(tiles[0].id, tiles[0].stream) }} />
          </div>
          <div className={layout.guestAreaClass}>
            {tiles.slice(1).map((p) => tileFor(p, layout.guestTileClass))}
          </div>
        </>
      )}
    </div>
  );
}
