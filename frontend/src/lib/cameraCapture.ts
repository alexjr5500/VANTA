'use client';

/**
 * cameraCapture
 * -------------
 * Single source of truth for VANTA camera acquisition. Every capture path
 * (LIVE preview, LIVE publish, video calls) uses this module so the camera is
 * ALWAYS requested at the highest resolution the actual hardware supports
 * (up to a 1080p publish target) instead of a hard-coded 1280x720 that makes
 * HD phones capture soft/upscaled video.
 *
 * The module also drives real camera controls where the browser exposes them:
 *   - facingMode            -> prefer the front (user-facing) camera on mobile
 *   - focusMode=continuous  -> continuous autofocus (NOT fake CSS sharpening)
 *   - exposureMode          -> continuous auto exposure
 *   - whiteBalanceMode      -> continuous/auto white balance
 *
 * Every constraint below uses `ideal` (never `exact`/`max`-capped below the
 * device ceiling) so a camera that cannot meet the target simply falls back to
 * its closest supported mode instead of failing with OverconstrainedError.
 */

// ============================================================================
// Capture targets
// ============================================================================

export interface CaptureTarget {
  width: number;
  height: number;
  frameRate: number;
}

/** Ordered best-to-worst publish/capture targets (16:9). */
export const CAPTURE_TARGETS: CaptureTarget[] = [
  { width: 1920, height: 1080, frameRate: 30 }, // 1080p HD
  { width: 1280, height: 720, frameRate: 30 }, //  720p HD
];

export const DEFAULT_CAPTURE: CaptureTarget = { width: 1280, height: 720, frameRate: 30 };

// ============================================================================
// Capability reading
// ============================================================================

/**
 * Runtime camera capabilities. The W3C MediaTrackCapabilities surface in the
 * browser reports more members (focusMode/exposureMode/whiteBalanceMode/zoom/
 * torch) than the installed TypeScript lib.dom models, so we widen the shape.
 */
export interface VantaCameraCapabilities {
  focusMode?: string[] | string;
  exposureMode?: string[] | string;
  whiteBalanceMode?: string[] | string;
  zoom?: boolean[] | boolean;
  torch?: boolean[] | boolean;
  facingMode?: string[] | string;
  width?: { min?: number; max?: number; ideal?: number; exact?: number };
  height?: { min?: number; max?: number; ideal?: number; exact?: number };
  frameRate?: { min?: number; max?: number; ideal?: number; exact?: number };
}

export interface CameraProfile {
  /** Best supported width/height/frameRate, capped at the publish target. */
  width: number;
  height: number;
  frameRate: number;
  /** Highest raw capture the device reports (may exceed 1080p, e.g. 4K rear cameras). */
  maxWidth: number;
  maxHeight: number;
  facingMode?: string;
  focusMode: string[];
  exposureMode: string[];
  whiteBalanceMode: string[];
  canZoom: boolean;
  canTorch: boolean;
  hasCapabilities: boolean;
}
const capArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string' && value
      ? [value]
      : [];

const capBool = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(Boolean);
  return Boolean(value);
};

const rangeMax = (value: unknown): number => {
  if (!value || typeof value !== 'object') return 0;
  const r = value as { min?: number; max?: number; ideal?: number; exact?: number };
  // `max` is the true device ceiling. `ideal`/`exact` are hints some runtimes
  // report instead of a range.
  return Math.max(r.max ?? 0, r.ideal ?? 0, r.exact ?? 0, r.min ?? 0);
};

/**
 * Read the requested device's MediaTrackCapabilities (W3C) and turn them into
 * a usable profile. Returns null when the runtime exposes no capability API.
 */
export function readCameraProfile(input: MediaDeviceInfo | null | undefined): CameraProfile | null {
  if (!input) return null;
  // `getCapabilities()` lives on InputDeviceInfo (browser may also expose it
  // on MediaDeviceInfo entries returned by enumerateDevices).
  const capsGetter = (input as unknown as { getCapabilities?: () => MediaTrackCapabilities }).getCapabilities;
  if (typeof capsGetter !== 'function') return null;
  try {
    const caps = (capsGetter.call(input) as VantaCameraCapabilities) ?? {};
    const faceModes = capArray(caps.facingMode);
    const maxWidth = rangeMax(caps.width);
    const maxHeight = rangeMax(caps.height);
    const frameRate = rangeMax(caps.frameRate);
    return {
      width: pickIdealDimension(maxWidth, CAPTURE_TARGETS[0].width),
      height: pickIdealDimension(maxHeight, CAPTURE_TARGETS[0].height),
      frameRate,
      maxWidth,
      maxHeight,
      facingMode: faceModes[0],
      focusMode: capArray(caps.focusMode),
      exposureMode: capArray(caps.exposureMode),
      whiteBalanceMode: capArray(caps.whiteBalanceMode),
      canZoom: capBool(caps.zoom),
      canTorch: capBool(caps.torch),
      hasCapabilities: true,
    };
  } catch {
    return null;
  }
}

/** Largest target that fits under a device ceiling (falls back to the lowest). */
export function pickIdealDimension(deviceCeiling: number, preferred: number): number {
  if (!deviceCeiling || deviceCeiling <= 0) return 0;
  return Math.min(preferred, deviceCeiling);
}
// ============================================================================
// Constraint builders
// ============================================================================

export interface VideoConstraintOptions {
  /** Restrict acquisition to a physical device. */
  deviceId?: string;
  /** Prefer the front (user-facing) camera. Defaults to true on mobile. */
  preferFront?: boolean;
  /** Force a facing mode even when the device reports none (used by flip). */
  forceFacingMode?: 'user' | 'environment' | null;
}

/**
 * Build getUserMedia video constraints for the best supported configuration.
 * `ideal` constraints let the browser pick the closest supported mode, so we
 * never force a resolution the device cannot deliver.
 */
export function pickVideoConstraints(
  input: MediaDeviceInfo | null | undefined,
  options: VideoConstraintOptions = {},
): MediaTrackConstraints {
  const profile = readCameraProfile(input);
  const prefersFront = options.preferFront ?? true;
  const target = pickCaptureTarget(profile);

  const constraints: MediaTrackConstraints = {
    width: { ideal: target.width },
    height: { ideal: target.height },
    frameRate: { ideal: Math.min(target.frameRate, profile ? Math.max(profile.frameRate, 1) : target.frameRate) },
  };

  if (options.deviceId) {
    constraints.deviceId = { ideal: options.deviceId };
  }

  // facingMode: only set it when the capability exists or the caller forces a
  // flip — desktop webcams without facingMode would otherwise over-constrain.
  const facing = options.forceFacingMode
    ?? (profile?.facingMode
      ? (prefersFront
        ? (profile.facingMode === 'user' || profile.facingMode === 'front' ? 'user' : profile.facingMode)
        : (profile.facingMode === 'environment' || profile.facingMode === 'back' ? 'environment' : profile.facingMode))
      : undefined);
  if (facing) {
    (constraints as MediaTrackConstraints & { facingMode?: string }).facingMode = facing;
  }

  // Advanced camera controls (af/exposure/white-balance) are only included when
  // the device actually advertises them, otherwise the constraint set would
  // make getUserMedia reject the request.
  const advanced: MediaTrackConstraintSet[] = [];
  if (profile) {
    if (profile.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet);
    }
    if (profile.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' } as MediaTrackConstraintSet);
    }
    if (profile.whiteBalanceMode.includes('continuous') || profile.whiteBalanceMode.includes('auto')) {
      advanced.push({
        whiteBalanceMode: profile.whiteBalanceMode.includes('continuous') ? 'continuous' : 'auto',
      } as MediaTrackConstraintSet);
    }
  }
  if (advanced.length > 0) {
    constraints.advanced = advanced;
  }

  return constraints;
}

/** Choose the largest capture target a device supports (or the fallback). */
export function pickCaptureTarget(profile: CameraProfile | null): CaptureTarget {
  if (profile && profile.maxWidth > 0 && profile.maxHeight > 0) {
    for (const candidate of CAPTURE_TARGETS) {
      if (profile.maxWidth >= candidate.width && profile.maxHeight >= candidate.height) {
        return candidate;
      }
    }
  }
  return DEFAULT_CAPTURE;
}
// ============================================================================
// Camera selection (front/rear)
// ============================================================================

/** True when a camera reports (or is labeled as) a user-facing camera. */
export function isFrontCamera(input: MediaDeviceInfo | null | undefined): boolean {
  const profile = readCameraProfile(input);
  if (profile?.facingMode) {
    const mode = profile.facingMode;
    if (mode === 'user' || mode === 'front') return true;
    if (mode === 'environment' || mode === 'back') return false;
  }
  const label = (input?.label ?? '').toLowerCase();
  if (/(rear|back|environment)/i.test(label)) return false;
  if (/(front|selfie|user)/i.test(label)) return true;
  // No signal: treat the first enumerated camera as the primary/front.
  return true;
}

/** Pick the first enumerated camera, preferring a user-facing one on mobile. */
export function pickPrimaryCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | null {
  if (!devices || devices.length === 0) return null;
  return devices.find((d) => d.kind === 'videoinput' && isFrontCamera(d))
    ?? devices.find((d) => d.kind === 'videoinput')
    ?? null;
}

// ============================================================================
// Post-acquisition controls
// ============================================================================

/**
 * Enable real continuous autofocus / auto exposure / auto white-balance on a
 * LIVE track. W3C `applyConstraints` re-applies the whole constraint set, so we
 * carry over the current device/resolution to avoid resetting capture.
 * Returns true when at least one advanced control was applied.
 */
export async function applyContinuousAutofocus(track: MediaStreamTrack | null | undefined): Promise<boolean> {
  if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
    return false;
  }
  try {
    const caps = (track.getCapabilities() as VantaCameraCapabilities) ?? {};
    const advanced: MediaTrackConstraintSet[] = [];
    if (capArray(caps.focusMode).includes('continuous')) {
      advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet);
    }
    if (capArray(caps.exposureMode).includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' } as MediaTrackConstraintSet);
    }
    if (capArray(caps.whiteBalanceMode).some((m) => m === 'continuous' || m === 'auto')) {
      advanced.push({ whiteBalanceMode: 'continuous' } as MediaTrackConstraintSet);
    }
    if (advanced.length === 0) return false;

    const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
    const preserve: MediaTrackConstraints = {
      deviceId: settings?.deviceId ? { ideal: settings.deviceId } : undefined,
      width: settings?.width ? { ideal: settings.width } : undefined,
      height: settings?.height ? { ideal: settings.height } : undefined,
      frameRate: settings?.frameRate ? { ideal: settings.frameRate } : undefined,
      advanced,
    };
    await track.applyConstraints(preserve);
    return true;
  } catch {
    // Autofocus/exposure are best-effort enhancements — capturing must never
    // fail because an advanced control was rejected.
    return false;
  }
}

/** Actual captured dimensions of a track (falls back to settings). */
export function trackResolution(track: MediaStreamTrack | null | undefined): { width: number; height: number } | null {
  if (!track) return null;
  const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
  if (settings?.width && settings.height) {
    return { width: settings.width, height: settings.height };
  }
  return null;
}

/** Human-readable capture info used by diagnostics. */
export function describeCapture(track: MediaStreamTrack | null | undefined): string {
  if (!track) return 'no track';
  const res = trackResolution(track);
  const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
  const facing = settings?.facingMode;
  return `${res ? `${res.width}x${res.height}` : 'unknown'}@${settings?.frameRate ? `${settings.frameRate}fps` : '?'}${facing ? ` ${facing}` : ''}`;
}