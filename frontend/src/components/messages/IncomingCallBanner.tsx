'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Video, Volume2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import type { CallStatus, CallType } from '@/lib/hooks/useChatCalls';
import { cn } from '@/lib/utils';

// ============================================================================
// Global incoming-call banner
// ============================================================================
// Shown at the top of WHATEVER page the recipient is currently viewing when a
// private 1-to-1 call arrives. The banner stays until the call is answered,
// declined, cancelled by the caller, or times out. Answering opens the full
// call interface (rendered globally by AppLayout); declining rejects the call.
// The VANTA ringtone (frontend/public/sounds) plays only while an incoming call
// is active and stops as soon as the incoming-call state ends.
// ============================================================================

// Ringtone asset served from the public/ static directory.
const RINGTONE_SRC = '/sounds/vanta-ringtone.mp3';
// Clearly audible without being excessively loud.
const RINGTONE_VOLUME = 0.6;

export interface IncomingCallBannerProps {
  status: CallStatus;
  callType: CallType;
  peerName: string;
  peerAvatar?: string | null;
  onAnswer: () => void;
  onDecline: () => void;
}

export default function IncomingCallBanner({
  status,
  callType,
  peerName,
  peerAvatar,
  onAnswer,
  onDecline,
}: IncomingCallBannerProps) {
  const isVideo = callType === 'video';
  const label = isVideo ? 'Incoming video call' : 'Incoming voice call';

  // ONE audio element for the lifetime of this component, created lazily on the
  // first incoming call and reused for every later call. Reusing a single
  // instance guarantees an active incoming call can never have overlapping or
  // duplicated ringtone playback, and no new object is created when the
  // incoming-call state updates.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const stopRingtone = () => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.pause();
        // Rewind so the next incoming call always starts from the beginning.
        audio.currentTime = 0;
      } catch {
        // Never let audio cleanup break the incoming-call UI.
      }
    };

    // No longer an active incoming call (answered, declined, cancelled by the
    // caller, timed out, failed, state gone, or this component unmounting):
    // silence the ringtone immediately.
    if (status !== 'incoming') {
      stopRingtone();
      return;
    }

    // Lazy single instance. `useEffect` never runs during SSR, so Audio is only
    // ever constructed in the browser.
    if (!audioRef.current) {
      const audio = new Audio(RINGTONE_SRC);
      audio.loop = true; // loop continuously while the incoming call is active
      audio.preload = 'auto';
      audio.volume = RINGTONE_VOLUME;
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    if (!audio) return;

    // Every incoming call starts from the beginning.
    audio.currentTime = 0;

    const attemptPlay = () => {
      const el = audioRef.current;
      if (!el || !el.paused) return;
      void el.play().catch(() => {
        // Autoplay policies may reject playback because the call arrives over
        // the socket rather than from a user gesture. Swallow the rejection so
        // the banner keeps working — the user can still answer/decline — and
        // retry on the next gesture via the handlers below.
      });
    };

    attemptPlay();

    // Incoming calls are not a user gesture, so some browsers refuse the first
    // play(). Resume on the next interaction while the call is still incoming
    // (same pattern as the call overlay's remote media).
    const resume = () => attemptPlay();
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('touchstart', resume, { passive: true });
    window.addEventListener('keydown', resume);

    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('touchstart', resume);
      window.removeEventListener('keydown', resume);
      stopRingtone();
    };
  }, [status]);

  return (
    <AnimatePresence>
      {status === 'incoming' && (
        <motion.div
          initial={{ y: -90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -90, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          className="pointer-events-none fixed inset-x-0 top-0 z-[110] px-3 pt-[max(10px,env(safe-area-inset-top))]"
          data-call-status="incoming"
          role="dialog"
          aria-label={label}
        >
          <div className="pointer-events-auto mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl border border-[#d6a83f]/30 bg-[#0d0d0f]/95 shadow-[0_18px_50px_rgba(0,0,0,0.55),0_0_0_1px_rgba(201,162,39,0.08)] backdrop-blur-2xl">
            {/* Gold accent line */}
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#c9a227] to-transparent" />

            <div className="flex items-center gap-3 px-3.5 py-3 sm:px-4">
              {/* Caller avatar */}
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                <span className="absolute -inset-[2px] rounded-full bg-gradient-to-br from-[#d6a83f] via-[#c8c8cc] to-[#f5f5f5]" aria-hidden="true" />
                <Avatar src={peerAvatar} alt={peerName || 'Caller'} size="md" wrapperClassName="!h-full !w-full" className="ring-2 ring-[#0d0d0f]" />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400 ring-2 ring-[#0d0d0f]" aria-hidden="true" />
              </div>

              {/* Caller identity + status */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#f5f5f5]">
                  {peerName || 'VANTA user'}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#f2c75c]">
                  <motion.span
                    animate={{ opacity: [1, 0.35, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                    className="inline-flex items-center gap-1"
                  >
                    {isVideo ? <Video size={12} /> : <Volume2 size={12} />}
                    {label}
                  </motion.span>
                </p>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onAnswer}
                  aria-label="Answer call"
                  title="Answer call"
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-full text-white shadow-lg transition active:scale-90',
                    'bg-emerald-500 hover:bg-emerald-400'
                  )}
                >
                  <Phone size={18} className="fill-current" />
                </button>
                <button
                  type="button"
                  onClick={onDecline}
                  aria-label="Decline call"
                  title="Decline call"
                  className="grid h-11 w-11 place-items-center rounded-full bg-red-500/90 text-white shadow-lg transition hover:bg-red-400 active:scale-90"
                >
                  <PhoneOff size={18} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}