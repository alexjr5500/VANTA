'use client';

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
// ============================================================================

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
              <div className="relative shrink-0">
                <span className="absolute -inset-[2px] rounded-full bg-gradient-to-br from-[#d6a83f] via-[#c8c8cc] to-[#f5f5f5]" aria-hidden="true" />
                <Avatar src={peerAvatar} alt={peerName || 'Caller'} size="md" className="ring-2 ring-[#0d0d0f]" />
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