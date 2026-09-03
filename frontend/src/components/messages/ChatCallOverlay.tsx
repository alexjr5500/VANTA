'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import type { CallStatus, CallType } from '@/lib/hooks/useChatCalls';
import { cn } from '@/lib/utils';

// ============================================================================
// In-call overlay for private 1-to-1 voice/video calls.
// Handles incoming-call (accept/decline), calling/ringing and active-call UI
// with microphone/camera toggles and a hangup button. Fully responsive: video
// call shows the remote stream full-screen with a small local self-view.
// ============================================================================

export interface ChatCallOverlayProps {
  status: CallStatus;
  callType: CallType;
  peerName: string;
  peerAvatar?: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicOn: boolean;
  isCamOn: boolean;
  durationSeconds: number;
  error: string | null;
  permissionError: string | null;
  endedReason: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
}

const formatTimer = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/** Attaches a MediaStream to a <video> element via a ref (React's JSX types
 *  for this Next/React version do not include `srcObject`, which is a live
 *  assignable property rather than a serializable attribute). */
function StreamVideo({
  stream,
  className,
  muted = false,
}: {
  stream: MediaStream | null;
  className?: string;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (muted) video.muted = true;
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream, muted]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

export default function ChatCallOverlay(props: ChatCallOverlayProps) {
  const {
    status,
    callType,
    peerName,
    peerAvatar,
    localStream,
    remoteStream,
    isMicOn,
    isCamOn,
    durationSeconds,
    error,
    permissionError,
    endedReason,
    onAccept,
    onDecline,
    onEnd,
    onCancel,
    onToggleMic,
    onToggleCam,
  } = props;

  const showOverlay = status !== 'idle';
  if (!showOverlay) return null;

  const isVideo = callType === 'video';
  const connectionLabel =
    status === 'incoming' ? (isVideo ? 'Incoming video call' : 'Incoming voice call')
    : status === 'outgoing' || status === 'ringing' ? (isVideo ? 'Video call...' : 'Calling...')
    : status === 'connecting' ? 'Connecting...'
    : status === 'active' ? (isVideo ? 'On video call' : 'On voice call')
    : 'Call ended';

  // A short-lived "ended" screen so a finished call never just vanishes: the
  // user sees a clear "No answer" / "Call ended" state and can dismiss it.
  if (status === 'ended') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[120] grid place-items-center bg-[#050507]/95 px-6 backdrop-blur-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={endedReason || 'Call ended'}
        data-call-status="ended"
      >
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-white/[0.06] text-white/70 ring-1 ring-white/10">
            <PhoneOff size={26} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{endedReason || 'Call ended'}</h2>
            <p className="mt-1 text-sm text-white/50">{peerName || 'VANTA user'}</p>
          </div>
          <button
            type="button"
            onClick={onEnd}
            className="rounded-full bg-white/10 px-8 py-2.5 text-sm font-medium text-white ring-1 ring-white/15 transition hover:bg-white/20 active:scale-95"
          >
            Done
          </button>
        </div>
      </motion.div>
    );
  }

  const ControlIconButton = ({
    onClick,
    active,
    label,
    icon,
    danger,
  }: {
    onClick: () => void;
    active?: boolean;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-12 w-12 place-items-center rounded-full transition active:scale-90 sm:h-14 sm:w-14',
        danger
          ? 'bg-red-500/90 text-white hover:bg-red-400'
          : active === false
            ? 'bg-white/15 text-white ring-1 ring-white/25'
            : 'bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20'
      )}
    >
      {icon}
    </button>
  );

return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[120] flex flex-col overflow-hidden bg-[#050507]/95 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-label={connectionLabel}
      data-call-status={status}
    >
      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center gap-2 text-[11px] text-white/45">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {connectionLabel}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/45">
          {status === 'active' && <span className="tabular-nums">{formatTimer(durationSeconds)}</span>}
          {isVideo && status !== 'active' && <Video size={13} className="text-[#d6a83f]" />}
          {!isVideo && status !== 'active' && <Volume2 size={13} className="text-[#d6a83f]" />}
        </div>
      </div>

      {/* Remote video / fallback content */}
      <div className="relative z-0 min-h-0 flex-1">
        {isVideo && remoteStream ? (
          <StreamVideo
            stream={remoteStream}
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_35%,#1a1712_0%,#08080a_70%)]">
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="relative">
                <span className="absolute inset-0 -m-3 animate-ping rounded-full bg-[#d6a83f]/20" aria-hidden="true" />
                <Avatar
                  src={peerAvatar}
                  alt={peerName || 'Caller'}
                  size="2xl"
                  className={cn(
                    'ring-4 ring-white/[0.08]',
                    (status === 'outgoing' || status === 'ringing' || status === 'incoming') && 'animate-pulse'
                  )}
                />
              </div>
              <div>
                <h2 className="max-w-[80vw] truncate text-xl font-semibold text-white">{peerName || 'VANTA user'}</h2>
                <p className="mt-1 text-sm text-white/50">{connectionLabel}</p>
                {status === 'connecting' && (
                  <span className="mt-2 inline-flex items-center gap-2 text-xs text-[#f2c75c]">
                    <Loader2 size={13} className="animate-spin" /> Establishing secure connection...
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {isVideo && localStream && (status === 'active' || status === 'connecting') && (
          <div className="absolute right-4 top-4 z-20 w-28 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl sm:right-6 sm:top-6 sm:w-36">
            <StreamVideo
              stream={localStream}
              muted
              className="aspect-[3/4] w-full object-cover"
            />
          </div>
        )}

        {/* Error / permission banner */}
        {(error || permissionError) && (
          <div className="absolute inset-x-4 bottom-28 z-20 mx-auto max-w-md rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-center text-xs leading-relaxed text-amber-200 backdrop-blur">
            <ShieldAlert size={14} className="mr-1.5 inline -translate-y-px" />
            {permissionError || error}
          </div>
        )}
      </div>

{/* Controls */}
      <div className="relative z-20 shrink-0 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:px-6">
        {status === 'incoming' ? (
          <div className="flex items-center justify-center gap-8">
            <ControlIconButton
              onClick={onAccept}
              label="Accept call"
              icon={<Phone size={20} />}
              active
            />
            <ControlIconButton
              onClick={onDecline}
              label="Decline call"
              danger
              icon={<PhoneOff size={20} />}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center gap-5 sm:gap-8">
            {status === 'active' || status === 'connecting' ? (
              <>
                <ControlIconButton
                  onClick={onToggleMic}
                  active={isMicOn}
                  label={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
                  icon={isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                />
                {isVideo && (
                  <ControlIconButton
                    onClick={onToggleCam}
                    active={isCamOn}
                    label={isCamOn ? 'Turn camera off' : 'Turn camera on'}
                    icon={isCamOn ? <Video size={20} /> : <VideoOff size={20} />}
                  />
                )}
                {!isVideo && (
                  <div className="pointer-events-none grid h-12 w-12 place-items-center rounded-full bg-white/5 text-white/40 ring-1 ring-white/10">
                    <Volume2 size={20} />
                  </div>
                )}
                <ControlIconButton
                  onClick={onEnd}
                  label="End call"
                  danger
                  icon={<PhoneOff size={20} />}
                />
              </>
            ) : (
              <ControlIconButton
                onClick={onCancel}
                label="Cancel call"
                danger
                icon={<PhoneOff size={20} />}
              />
            )}
          </div>
        )}
        <p className="mt-4 text-center text-[10px] text-white/30">
          Calls are end-to-end direct between you and {peerName || 'the other person'}.
        </p>
      </div>
    </motion.div>
  );
}