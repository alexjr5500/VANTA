'use client';

/**
 * LiveParticipantGrid
 * -------------------
 * Responsive live-stage layout for 1–5 participants (host + up to 4 guests).
 * The host is always visually prioritized:
 *  - 1 person  → host fills the screen
 *  - 2 people  → host left / guest right (50/50)
 *  - 3 people  → host left / 2 guests stacked on the right
 *  - 4 people  → host left / 3 guests on the right
 *  - 5 people  → host left / 4 guests in a 2×2 grid on the right
 * On narrow screens the host moves to the top and guests flow below.
 * All video uses object-fit: cover so faces are never stretched and there are
 * no black gaps or overflow. Video <video> elements are keyed by participant id
 * so they are never unnecessarily recreated when chat/events arrive.
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { MicOff, VideoOff } from 'lucide-react';
import { stageLayoutFor } from './liveStageLayout';

export interface StageParticipant {
  id: string;
  username: string;
  avatar?: string | null;
  verified?: boolean;
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

function StageVideo({ stream, muted = false }: { stream: MediaStream | null; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!stream) {
      video.pause();
      video.srcObject = null;
      return;
    }
    video.srcObject = stream;
    video.muted = muted;
    video.play().catch(() => undefined);
  }, [stream, muted]);
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
  return <video ref={videoRef} playsInline autoPlay muted={muted} className="h-full w-full object-cover" aria-label="Live stage participant" />;
}

function Tile({ p, className, showCameraOff }: { p: StageParticipant; className?: string; showCameraOff?: boolean }) {
  const noVideo = !p.stream || !p.cameraOn;
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-[#0D0D0F]', className)}>
      {/* Remote media (video + audio) attached via srcObject. When a guest only
          publishes audio (camera disabled), the tile still routes their mic
          through this element — an avatar overlays the black video surface. */}
      {p.stream && (
        <div className="absolute inset-0">
          <StageVideo stream={p.stream} muted={p.muted === true} />
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
          {p.verified && <VerificationBadge size="xs" />}
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

  return (
    <div className={layout.containerClass}>
      {layout.arrangement === 'solo' && tiles.length === 1 && (
        <Tile className={layout.hostTileClass} p={tiles[0]} />
      )}

      {layout.arrangement === 'split' && tiles.length === 2 && (
        <>
          <Tile className={layout.hostTileClass} p={tiles[0]} />
          <Tile className={layout.guestTileClass} p={tiles[1]} />
        </>
      )}

      {layout.arrangement === 'host-col' && (tiles.length === 3 || tiles.length === 4) && (
        <>
          {/* Host: full height on desktop, top on mobile */}
          <div className={layout.hostWrapperClass}>
            <Tile className={layout.hostTileClass} p={tiles[0]} />
          </div>
          <div className={layout.guestAreaClass}>
            {tiles.slice(1).map((p) => (
              <Tile key={p.id} className={layout.guestTileClass} p={p} />
            ))}
          </div>
        </>
      )}

      {layout.arrangement === 'host-col-grid' && tiles.length === 5 && (
        <>
          <div className={layout.hostWrapperClass}>
            <Tile className={layout.hostTileClass} p={tiles[0]} />
          </div>
          <div className={layout.guestAreaClass}>
            {tiles.slice(1).map((p) => (
              <Tile key={p.id} className={layout.guestTileClass} p={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
