'use client';

import { AlertTriangle, CameraOff, MicOff, BellRing, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PermissionIssue } from '@/lib/mediaPermissions';

// ============================================================================
// PermissionBanner
// ----------------
// A consistent, reusable VANTA block that surfaces a media/notification
// permission problem with a human-readable explanation and a Retry action.
//
// It NEVER shows the raw browser error (e.g. "NotAllowedError") to the user;
// the technical detail from the mapped PermissionIssue is only logged to the
// console for developers. Drop this component anywhere a permission issue needs
// to be surfaced (voice-note recording, live, calls, capture).
// ============================================================================

interface PermissionBannerProps {
  /** The mapped, human-readable issue (see mapMediaError in lib/mediaPermissions). */
  issue: PermissionIssue;
  /**
   * Optional device/context hint used to pick an icon. When omitted an alert
   * triangle is used.
   */
  device?: 'camera' | 'microphone' | 'notification' | 'generic';
  /** Label for the primary action (defaults to "Retry"). Hide by omitting onRetry. */
  retryLabel?: string;
  /** Called when the user taps Retry. */
  onRetry?: () => void;
  /** Called when the user dismisses the banner. */
  onDismiss?: () => void;
  /** Optional CSS classes applied to the root card. */
  className?: string;
}

const iconFor = (device?: 'camera' | 'microphone' | 'notification' | 'generic') =>
  device === 'camera' ? CameraOff : device === 'microphone' ? MicOff : device === 'notification' ? BellRing : AlertTriangle;

export default function PermissionBanner({
  issue,
  device = 'generic',
  retryLabel = 'Retry',
  onRetry,
  onDismiss,
  className,
}: PermissionBannerProps) {
  // Log the technical detail for developers only — never shown in the UI.
  if (issue.techDetail && typeof console !== 'undefined') {
    console.log(`[VANTA permission:${issue.kind}] ${issue.techDetail}`);
  }

  const Icon = iconFor(device);

  return (
    <div
      role="alert"
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3',
        className,
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-300">
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white/90">{issue.title}</p>
        <p className="mt-0.5 text-xs leading-snug text-white/65">{issue.message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#D6A83F] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#E4B64C]"
          >
            <RefreshCw size={13} className="inline" />
            {retryLabel}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto shrink-0 text-white/40 transition hover:text-white/70"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}