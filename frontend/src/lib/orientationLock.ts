'use client';

// ============================================================================
// orientationLock
// ---------------
// Best-effort platform-level portrait lock for the VANTA Live experience.
//
// VANTA is a mobile-first PWA. The web has no way to force a physical device
// to stay upright, but the platform DOES provide a supported orientation-lock
// mechanism for installed/fullscreen web apps: the W3C Screen Orientation API
// (`screen.orientation.lock('portrait')`, Chrome for Android). The installed
// PWA manifest also declares `"orientation": "portrait"` so the OS keeps the
// app's interface in portrait.
//
// Every helper here is strictly best-effort: browsers that lack the API simply
// no-op, and nothing ever rotates/transform-scales the UI to fake a lock.
// ============================================================================

type ScreenOrientationLike = {
  lock?: (_mode: 'portrait' | 'landscape' | 'any' | 'natural' | 'free') => Promise<void>;
  lockingFullscreen?: boolean;
};

function screenOrientationApi(): ScreenOrientationLike | null {
  if (typeof screen === 'undefined' || typeof screen.orientation !== 'object' || screen.orientation === null) {
    return null;
  }
  return screen.orientation as unknown as ScreenOrientationLike;
}

/** True when the browser exposes the W3C Screen Orientation API. */
export function supportsOrientationLock(): boolean {
  const api = screenOrientationApi();
  return !!api && typeof api.lock === 'function';
}

/**
 * Lock the app's screen orientation to portrait. Returns true when the lock
 * was accepted by the platform, false when unsupported or rejected. On
 * browsers where locking requires fullscreen, this is a no-op unless the app
 * is already displaying fullscreen (we intentionally never force fullscreen).
 */
export async function lockVantaPortrait(): Promise<boolean> {
  const api = screenOrientationApi();
  if (!api || typeof api.lock !== 'function') return false;
  try {
    await api.lock('portrait');
    return true;
  } catch {
    return false;
  }
}

/** Release a previously requested portrait lock (back to the OS default). */
export async function unlockVantaPortrait(): Promise<boolean> {
  const api = screenOrientationApi();
  if (!api || typeof api.lock !== 'function') return false;
  try {
    await api.lock('free');
    return true;
  } catch {
    return false;
  }
}