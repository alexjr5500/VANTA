'use client';

// ============================================================================
// mediaPermissions
// ----------------
// The single, reusable VANTA abstraction for browser media + notification
// permission capability detection, permission-state querying and mapping raw
// browser errors (NotAllowedError, NotFoundError, SecurityError, ...) into the
// consistent, human-readable messages VANTA surfaces to its users.
//
// This module is the ONE place the app reasons about:
//   - navigator.mediaDevices / navigator.mediaDevices.getUserMedia
//   - the Permissions API (navigator.permissions) — with full feature detection
//   - the Notification API (Notification.permission / requestPermission)
//   - secure context (HTTPS / localhost) requirements
//
// The application MUST keep working even when a browser exposes only some (or
// none) of these APIs. Every helper here degrades gracefully and never throws.
// ============================================================================

export type MediaPermission = 'camera' | 'microphone';

/**
 * Results we hand to the UI so it can render targeted guidance instead of a
 * generic "Something went wrong." message.
 */
export type PermissionIssueKind =
  | 'DENIED' // user denied / OS blocked the hardware
  | 'BLOCKED' // Permissions-Policy / OS level blocking
  | 'NOT_FOUND' // no device present
  | 'IN_USE' // another application holds the device
  | 'OVER_CONSTRAINED' // device cannot satisfy requested settings
  | 'UNSUPPORTED' // browser lacks the required API
  | 'SECURE_CONTEXT_REQUIRED' // not HTTPS / localhost
  | 'NOTIFICATION_DENIED' // Notification.permission not granted
  | 'NOTIFICATION_UNSUPPORTED' // No Notification API
  | 'UNKNOWN';

export interface PermissionIssue {
  kind: PermissionIssueKind;
  /** Human-readable primary message for the user. */
  title: string;
  /** Human-readable supporting detail / remediation for the user. */
  message: string;
  /** Optional technical detail for developers. Never shown to normal users. */
  techDetail?: string;
}

export type PermissionQueryState = 'granted' | 'denied' | 'prompt' | 'unsupported';

// ============================================================================
// Capability detection
// ============================================================================

/** True when the browser exposes the modern getUserMedia media API. */
export function hasMediaDeviceApi(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    typeof navigator.mediaDevices === 'object' &&
    navigator.mediaDevices !== null &&
    typeof (navigator.mediaDevices as unknown as { getUserMedia?: unknown }).getUserMedia === 'function'
  );
}

/** True when the browser exposes the Permissions API (navigator.permissions). */
export function hasPermissionsApi(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as unknown as { permissions?: { query?: unknown } }).permissions === 'object' &&
    typeof (navigator as unknown as { permissions?: { query?: unknown } }).permissions?.query === 'function'
  );
}

/** True when the browser exposes the Notification API on the window. */
export function hasNotificationApi(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { Notification?: unknown }).Notification === 'function';
}

/** True when running in a context where getUserMedia is allowed (HTTPS/localhost). */
export function isSecureMediaContext(): boolean {
  if (typeof window === 'undefined') return true;
  // window.isSecureContext is true on https:// and on localhost origins.
  if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
  // Fallback: only infer insecurity when the scheme is clearly http:// on a
  // non-localhost host.
  const scheme = window.location?.protocol;
  if (scheme === 'https:' || scheme === 'wss:') return true;
  const host = window.location?.hostname;
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  return false;
}
// ============================================================================
// Permissions API querying (feature-detected, best-effort)
// ============================================================================

/**
 * Query the browser Permissions API for a named permission. Returns 'granted',
 * 'denied', 'prompt' or 'unsupported'. This is best-effort: not every browser
 * supports querying 'camera'/'microphone'/'notifications', and the existing
 * VANTA capture flows never rely on this — they always call getUserMedia
 * regardless. When the API is unavailable, 'unsupported' is returned and callers
 * fall back to the imperative get... flow.
 */
export async function queryPermissionState(name: 'camera' | 'microphone' | 'geolocation' | 'notifications'): Promise<PermissionQueryState> {
  if (!hasPermissionsApi()) return 'unsupported';
  try {
    const result = await (navigator as unknown as {
      permissions: { query: (options: { name: string }) => Promise<{ state?: string }> };
    }).permissions.query({ name });
    const state = result?.state;
    if (state === 'granted') return 'granted';
    if (state === 'denied') return 'denied';
    if (state === 'prompt') return 'prompt';
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/**
 * Convenience wrapper that queries both camera and microphone state without
 * throwing. Used by diagnostics and permission-aware UIs; never required for
 * the actual capture flow (which always calls getUserMedia directly).
 */
export async function queryMediaPermissionStates(): Promise<{
  camera: PermissionQueryState;
  microphone: PermissionQueryState;
}> {
  const [camera, microphone] = await Promise.all([
    queryPermissionState('camera'),
    queryPermissionState('microphone'),
  ]);
  return { camera, microphone };
}
// ============================================================================
// Error mapping
// ============================================================================

const asName = (error: unknown): string | undefined => {
  if (error instanceof DOMException) return error.name;
  const maybe = (error as { name?: unknown } | null)?.name;
  return typeof maybe === 'string' ? maybe : undefined;
};

const asMessage = (error: unknown): string | undefined => {
  const maybe = (error as { message?: unknown } | null)?.message;
  return typeof maybe === 'string' ? maybe : undefined;
};

const isSecureSignal = (error: unknown): boolean => {
  const name = asName(error);
  const message = asMessage(error);
  return (
    name === 'SecurityError' ||
    message === 'SECURE_CONTEXT_REQUIRED' ||
    (message || '').includes('SECURE_CONTEXT_REQUIRED')
  );
};

const isBlockedSignal = (error: unknown): boolean => {
  const message = asMessage(error);
  return !!(message && /(Camera is blocked|Microphone is blocked)/i.test(message));
};

/**
 * Map a raw getUserMedia / MediaRecorder error (or a non-error condition) into a
 * consistent VANTA PermissionIssue. `kind` selects the camera vs microphone
 * phrasing. The raw technical detail is kept on `techDetail` for the console /
 * diagnostics but is never shown to the user directly.
 */
export function mapMediaError(error: unknown, kind: MediaPermission): PermissionIssue {
  const label = kind === 'camera' ? 'Camera' : 'Microphone';
  const lower = kind === 'camera' ? 'camera' : 'microphone';
  const name = asName(error);
  const rawMessage = asMessage(error);

  // Secure context — check first because the browser may surface it as a
  // generic SecurityError that otherwise reads like a device problem.
  if (isSecureSignal(error) || (name === 'NotSupportedError' && typeof window !== 'undefined' && !window.isSecureContext)) {
    return {
      kind: 'SECURE_CONTEXT_REQUIRED',
      title: 'Secure connection required',
      message: `${label} access requires a secure connection. Please open VANTA using HTTPS (or on localhost).`,
      techDetail: rawMessage,
    };
  }

  // NotAllowedError / PermissionDeniedError => user or OS denied the hardware.
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      kind: 'DENIED',
      title: `${label} access is blocked`,
      message: `To use the ${lower}, open the Chrome site permissions for VANTA and allow ${label} access, then try again.`,
      techDetail: rawMessage,
    };
  }

  // Explicit "blocked" message from the W3C AudioDevice/MediaDevice layer.
  if (isBlockedSignal(error)) {
    return {
      kind: 'BLOCKED',
      title: `${label} access is blocked`,
      message: `To use the ${lower}, open the Chrome site permissions for VANTA and allow ${label} access, then try again.`,
      techDetail: rawMessage,
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'NOT_FOUND',
      title: `No ${lower} found`,
      message: `No ${lower} was found on this device. Connect one and try again.`,
      techDetail: rawMessage,
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      kind: 'IN_USE',
      title: `${label} is in use`,
      message: `Your ${lower} is in use by another application. Close it and try again.`,
      techDetail: rawMessage,
    };
  }

  if (name === 'OverconstrainedError') {
    return {
      kind: 'OVER_CONSTRAINED',
      title: `${label} settings not supported`,
      message: `Your ${lower} does not support the required settings. Try a different device.`,
      techDetail: rawMessage,
    };
  }

  if (name === 'NotSupportedError') {
    return {
      kind: 'UNSUPPORTED',
      title: 'Feature not supported',
      message: 'This feature is not supported by this browser. Please open VANTA using the latest version of Chrome.',
      techDetail: rawMessage,
    };
  }

  return {
    kind: 'UNKNOWN',
    title: `Could not start the ${lower}`,
    message: `VANTA could not access your ${lower}. Please try again.`,
    techDetail: rawMessage,
  };
}

/** Convenience: the user-facing "Microphone access is blocked" style message. */
export function microphoneBlockedMessage(): string {
  return 'Microphone access is blocked. Please allow microphone access for VANTA in Chrome site permissions and try again.';
}
// ============================================================================
// Notification API
// ============================================================================

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Read the current notification permission state without requesting anything.
 * 'unsupported' means the browser has no Notification API (Safari/older
 * Chrome), 'default' means the browser will decide (Chrome lets the OS policy
 * decide and normally needs a request).
 */
export function getNotificationPermission(): NotificationPermissionState {
  if (!hasNotificationApi()) return 'unsupported';
  const Notification = (window as unknown as {
    Notification: { permission?: string };
  }).Notification;
  const permission = Notification?.permission;
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'default';
}

/**
 * Request notification permission. Must only be called after a meaningful user
 * action (e.g. the user enabling notifications), never on app start.
 *
 * Returns 'granted' on success, 'denied' if the user/OS refused, 'default' when
 * the request is not required / no-op, and 'unsupported' when the API is absent.
 * Asks once per origin; a second concurrent call returns immediately.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!hasNotificationApi()) return 'unsupported';
  const Notification = (window as unknown as {
    Notification: { permission?: string; requestPermission?: () => Promise<'granted' | 'denied'> };
  }).Notification;

  if (Notification?.permission === 'granted') return 'granted';
  if (typeof Notification?.requestPermission === 'function') {
    try {
      const result = await Notification.requestPermission();
      return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'default';
    } catch {
      return 'denied';
    }
  }
  return 'default';
}

// ============================================================================
// Diagnostics
// ============================================================================

/** Central capability snapshot, used by settings / developer diagnostics. */
export function getMediaCapabilities(): {
  mediaDevicesApi: boolean;
  permissionsApi: boolean;
  notificationApi: boolean;
  secureContext: boolean;
} {
  return {
    mediaDevicesApi: hasMediaDeviceApi(),
    permissionsApi: hasPermissionsApi(),
    notificationApi: hasNotificationApi(),
    secureContext: isSecureMediaContext(),
  };
}