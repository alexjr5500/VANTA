'use client';

/**
 * LiveParticipantGrid
 * -------------------
 * Responsive VANTA live-stage for 1–5 participants (host + up to 4 guests).
 *
 * Layout comes from `liveStageLayout` as explicit CSS-grid geometry. The host
 * is ALWAYS anchored to the primary `host` grid area via its explicit role
 * (never array order), so a reordered roster can never move the host.
 *
 * Every tile mounts/unmounts through framer-motion (scale + fade + layout
 * reflow) so joins and leaves animate smoothly with GPU-friendly transforms —
 * real stream playback is untouched (MediaStreams are debounced into stable
 * instances, so chat/event ticks never restart a playing tile).
 *
 * The speaking state is driven by REAL audio state (LiveKit active-speaker
 * identities passed down from the page) and renders as a soft breathing glow.
 */
import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
   * attached to the tile element as part of `stream`.
   */
  muted?: boolean;
  /** True when the participant is actively speaking (real audio levels). */
  speaking?: boolean;
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
    // + blur fills the whole tile so the contained primary copy never shows
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
            ? 'relative h-full w-full object-contain'
            : 'relative h-full w-full object-cover object-center'
        }
        aria-label="Live stage participant"
      />
    </>
  );
}
function Tile({ p, fit = 'cover' }: { p: StageParticipant; fit?: 'cover' | 'contain' }) {
  const noVideo = !p.stream || !p.cameraOn;
  return (
    <div className="absolute inset-0">
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

      {/* Camera-off chip */}
      {noVideo && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[9.5px] font-semibold uppercase tracking-wide text-white/70 backdrop-blur-md">
          <VideoOff size={11} aria-hidden /> Camera off
        </span>
      )}

      {/* Identity + status chrome over a soft gradient */}
      <div className="absolute inset-x-0 bottom-0 z-[3] flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-2 pb-2 pt-8">
        <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2 py-1 backdrop-blur-md">
          <span className="shrink-0 max-w-[9rem] truncate text-[12px] font-semibold text-white">{p.username}</span>
          {p.verified && p.verificationType && <VerificationBadge type={p.verificationType} size="xs" />}
          {p.isHost && (
            <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#C9A227] to-[#F2C75C] px-1.5 py-[2px] text-[8.5px] font-extrabold uppercase tracking-[0.12em] text-black">
              Host
            </span>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {p.speaking && (
            <span
              className="inline-flex h-5 items-center gap-[2px] rounded-full border border-purple-300/25 bg-black/55 px-1.5 backdrop-blur-md"
              title="Speaking"
              role="status"
              aria-label={`${p.username} is speaking`}
            >
              <span className="h-2 w-[2.5px] rounded-full bg-purple-300/90" />
              <span className="h-3 w-[2.5px] rounded-full bg-purple-200" />
              <span className="h-2 w-[2.5px] rounded-full bg-purple-300/90" />
            </span>
          )}
          {!p.micOn && (
            <span
              className="grid h-5 w-5 place-items-center rounded-full border border-white/10 bg-black/60"
              role="status"
              aria-label={`${p.username} microphone is muted`}
            >
              <MicOff size={11} aria-hidden />
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
export default function LiveParticipantGrid({ participants }: { participants: StageParticipant[] }) {
  const tiles = participants.length > 0 ? participants : [];
  const layout = stageLayoutFor(tiles.length);

  // Order the roster by ROLE: the host always occupies the primary area,
  // guests flow into the remaining areas in their arrival order. This is
  // independent of how the parent ordered the array.
  const ordered = useMemo(() => {
    const hostIndex = participants.findIndex((p) => p.isHost);
    let host: StageParticipant | undefined;
    const guests: StageParticipant[] = [];
    participants.forEach((p, index) => {
      if (index === hostIndex) host = p;
      else guests.push(p);
    });
    return host ? [host, ...guests] : participants;
  }, [participants]);

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

  const gridStyle = {
    gridTemplateAreas: layout.areas.join(' '),
    gridTemplateColumns: layout.columns,
    gridTemplateRows: layout.rows,
  };

  return (
    <div className={layout.containerClass} style={gridStyle} role="group" aria-label="Live participants">
      <AnimatePresence initial={false}>
        {ordered.map((p, index) => {
          const area = index === 0 ? layout.hostArea : layout.guestAreas[index - 1];
          const soloContain = layout.soloContain && index === 0;
          return (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.86, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.86, y: 6 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28, mass: 0.9 }}
              style={{ gridArea: area, position: 'relative' }}
              className={cn(layout.tileClass, index === 0 && layout.hostTileClass, 'will-change-transform')}
              data-host={p.isHost ? 'true' : undefined}
              data-speaking={p.speaking ? 'true' : undefined}
            >
              <Tile p={{ ...p, stream: stabilize(p.id, p.stream) }} fit={soloContain ? 'contain' : 'cover'} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}